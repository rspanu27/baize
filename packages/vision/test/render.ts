import {
  ballAppearance,
  ballSizeOf,
  CUE_BALL_COLOUR,
  CUSHION_TOP_DEPTH_M,
  pocketDropCircles,
} from "@baize/tables";
import type { BallKind, BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { apparentRadiusPx, projectPoint } from "../src/index";
import type { Camera, ImagePoint, PhotoImage, TableCorners } from "../src/index";
import { cornersSeen, seeded } from "./synthetic";

/**
 * A synthetic photo renderer for tests of the photo import: a picture of a table and balls
 * seen through a known pinhole camera, so that every test photo comes with exact ground truth.
 *
 * Convention. The image is `round(2 * centre.u)` by `round(2 * centre.v)` pixels. Pixel
 * (i, j) is the square [i, i + 1) x [j, j + 1) and is coloured by ONE ray through its centre
 * (i + 0.5, j + 0.5). A point that projects to (u, v) is therefore drawn in pixel
 * (floor(u), floor(v)), which is how `corners` and ball `centre` are to be read.
 *
 * Limitations. Cushions and rails are drawn flat at z = 0 (no height, no cushion shading, no
 * pocket jaws), so they do not hide anything. The widths of the cushion band (`CUSHION_TOP_DEPTH_M`) and the
 * rail (0.12 m) are fixture choices, not table data. Balls have no numbers, and there are no
 * reflections of balls in the cloth.
 */

export interface SceneLook {
  /** Cloth colour "#rrggbb". */
  cloth: string;
  /** Wooden rail colour. Default "#4a2f1c". */
  rail?: string;
  /** Floor around the table. Default "#6b6660". */
  floor?: string;
  /** Overall light level, 1 = normal. Default 1. */
  brightness?: number;
  /** Direction the light comes from (table coordinates, need not be unit). Default {x: 0.3, y: -0.2, z: 1}. */
  light?: { x: number; y: number; z: number };
  /** Standard deviation of per-pixel noise in 8-bit levels. Default 0 (no noise). */
  noise?: number;
  /** Seed for the noise. Default 1. */
  seed?: number;
}

export interface RenderedPhoto {
  image: PhotoImage;
  /** Exact corners of the playing area in the photo (may be outside it). */
  corners: TableCorners;
  /** For each ball of the layout, in order: kind, true table position, and where its centre appears. */
  balls: {
    kind: BallKind;
    x: number;
    y: number;
    radiusM: number;
    centre: ImagePoint;
    radiusPx: number;
  }[];
}

/** Width of the cushion band outside the playing area: the depth the finder assumes. */
const CUSHION_BAND_M = CUSHION_TOP_DEPTH_M;
/** Width of the rail outside the cushion band (fixture choice). */
const RAIL_BAND_M = 0.12;
/** Colour of a pocket seen from above. */
const POCKET_RGB: Rgb = [10, 10, 10];
/** Cloth is darkened by this much at the cushion band. */
const CUSHION_DARKEN = 0.75;
/** Cloth gets up to this much darker towards the corners of the table. */
const CLOTH_FALLOFF = 0.1;
/** Multiplier for cloth in the shadow of a ball. */
export const SHADOW = 0.6;
/** Share of the floor colour kept for a ray that goes above the horizon. */
const SKY_DARKEN = 0.5;
/** Ambient share of the ball shading; the rest is Lambert. */
const AMBIENT = 0.45;
const SPECULAR = 0.35;
const SPECULAR_POWER = 40;
/** Half-height of the band of a striped ball, as a share of its radius. */
const STRIPE_HALF = 0.45;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface BallPrep {
  cx: number;
  cy: number;
  cz: number;
  r: number;
  main: Rgb;
  white: Rgb;
  striped: boolean;
  /** Camera position minus centre, for the ray-sphere test. */
  ocx: number;
  ocy: number;
  ocz: number;
  ocLen2: number;
}

/** Approximately normal, mean 0, standard deviation 1: four uniforms summed (variance 1/3). */
export function gaussian(rand: () => number): number {
  return (rand() + rand() + rand() + rand() - 2) * Math.sqrt(3);
}

export function renderPhoto(
  camera: Camera,
  table: TableSpec,
  ballSet: BallSetSpec,
  layout: Layout,
  look: SceneLook,
): RenderedPhoto {
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  return {
    image: renderPixels(camera, table, ballSet, layout, look),
    corners: cornersSeen(camera, W, L),
    balls: layout.balls.map((b) => {
      const radiusM = ballSizeOf(ballSet, b.kind).diameterM / 2;
      const p = { x: b.x, y: b.y, z: radiusM };
      const centre = projectPoint(camera, p);
      if (!centre) throw new Error(`ball ${b.kind} is behind the camera`);
      return {
        kind: b.kind,
        x: b.x,
        y: b.y,
        radiusM,
        centre,
        radiusPx: apparentRadiusPx(camera, p, radiusM) ?? 0,
      };
    }),
  };
}

/** A rectangle of pixels: columns i0 to i1 - 1, rows j0 to j1 - 1. */
export interface PixelBox {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

/**
 * The picture of `renderPhoto`, or only the pixels inside `box` of it, as an image the size of
 * the box whose pixel (0, 0) is pixel (i0, j0) of the photo. Every pixel is computed exactly as
 * in the whole photo, so the clip renderer can redraw only where balls move. Noise is the one
 * exception: it is drawn in the scan order of the box, so it matches the whole photo only when
 * the box is the whole photo.
 */
export function renderPixels(
  camera: Camera,
  table: TableSpec,
  ballSet: BallSetSpec,
  layout: Layout,
  look: SceneLook,
  box?: PixelBox,
): PhotoImage {
  const { i0, j0, i1, j1 } = box ?? {
    i0: 0,
    j0: 0,
    i1: Math.round(2 * camera.centre.u),
    j1: Math.round(2 * camera.centre.v),
  };
  const width = i1 - i0;
  const height = j1 - j0;
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  const data = new Uint8ClampedArray(4 * width * height);

  const cloth = parseHex(look.cloth);
  const rail = parseHex(look.rail ?? "#4a2f1c");
  const floor = parseHex(look.floor ?? "#6b6660");
  const brightness = look.brightness ?? 1;
  const noise = look.noise ?? 0;
  const rand = seeded(look.seed ?? 1);
  const lightIn = look.light ?? { x: 0.3, y: -0.2, z: 1 };
  const lLen = Math.hypot(lightIn.x, lightIn.y, lightIn.z);
  const lx = lightIn.x / lLen;
  const ly = lightIn.y / lLen;
  const lz = lightIn.z / lLen;

  const cam = camera.position;
  const R = camera.rotation;
  const f = camera.focalPx;
  const pockets = pocketDropCircles(table);
  const halfDiag = Math.hypot(W, L) / 2;

  const white = parseHex(CUE_BALL_COLOUR);
  const balls: BallPrep[] = layout.balls.map((b) => {
    const r = ballSizeOf(ballSet, b.kind).diameterM / 2;
    const look2 = ballAppearance(b.kind);
    const ocx = cam.x - b.x;
    const ocy = cam.y - b.y;
    const ocz = cam.z - r;
    return {
      cx: b.x,
      cy: b.y,
      cz: r,
      r,
      main: parseHex(look2.colour),
      white,
      striped: look2.striped,
      ocx,
      ocy,
      ocz,
      ocLen2: ocx * ocx + ocy * ocy + ocz * ocz,
    };
  });

  /** Does the ray from (px, py, 0) towards the light hit a ball? */
  const shadowed = (px: number, py: number): boolean => {
    for (const b of balls) {
      const ox = px - b.cx;
      const oy = py - b.cy;
      const oz = -b.cz;
      const bb = ox * lx + oy * ly + oz * lz;
      const c = ox * ox + oy * oy + oz * oz - b.r * b.r;
      const disc = bb * bb - c;
      if (disc > 0 && -bb + Math.sqrt(disc) > 1e-6 && -bb - Math.sqrt(disc) > 1e-6) return true;
    }
    return false;
  };

  const pixel: Rgb = [0, 0, 0];
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const xc = (i + 0.5 - camera.centre.u) / f;
      const yc = (j + 0.5 - camera.centre.v) / f;
      // Ray direction in table coordinates: R^T (xc, yc, 1), normalised.
      let dx = R[0] * xc + R[3] * yc + R[6];
      let dy = R[1] * xc + R[4] * yc + R[7];
      let dz = R[2] * xc + R[5] * yc + R[8];
      const dl = Math.hypot(dx, dy, dz);
      dx /= dl;
      dy /= dl;
      dz /= dl;

      // Nearest ball.
      let hitBall: BallPrep | undefined;
      let tBall = Infinity;
      for (const b of balls) {
        const bb = b.ocx * dx + b.ocy * dy + b.ocz * dz;
        const disc = bb * bb - (b.ocLen2 - b.r * b.r);
        if (disc <= 0) continue;
        const t = -bb - Math.sqrt(disc);
        if (t > 0 && t < tBall) {
          tBall = t;
          hitBall = b;
        }
      }

      // The plane z = 0.
      const tPlane = dz < 0 ? -cam.z / dz : Infinity;

      if (hitBall && tBall < tPlane) {
        const hx = cam.x + tBall * dx;
        const hy = cam.y + tBall * dy;
        const hz = cam.z + tBall * dz;
        const nx = (hx - hitBall.cx) / hitBall.r;
        const ny = (hy - hitBall.cy) / hitBall.r;
        const nz = (hz - hitBall.cz) / hitBall.r;
        const base = hitBall.striped && Math.abs(nz) >= STRIPE_HALF ? hitBall.white : hitBall.main;
        const diffuse = Math.max(0, nx * lx + ny * ly + nz * lz);
        const shade = AMBIENT + (1 - AMBIENT) * diffuse;
        // Blinn-Phong highlight: half vector between the light and the way back to the camera.
        let hxv = lx - dx;
        let hyv = ly - dy;
        let hzv = lz - dz;
        const hl = Math.hypot(hxv, hyv, hzv);
        hxv /= hl;
        hyv /= hl;
        hzv /= hl;
        const spec =
          diffuse > 0
            ? SPECULAR * Math.pow(Math.max(0, nx * hxv + ny * hyv + nz * hzv), SPECULAR_POWER)
            : 0;
        for (let k = 0; k < 3; k++) pixel[k] = (base[k] as number) * shade + 255 * spec;
      } else if (tPlane === Infinity) {
        // Above the horizon.
        for (let k = 0; k < 3; k++) pixel[k] = (floor[k] as number) * SKY_DARKEN;
      } else {
        const px = cam.x + tPlane * dx;
        const py = cam.y + tPlane * dy;
        let colour: Rgb = floor;
        let factor = 1;
        let inPocket = false;
        for (const p of pockets) {
          if (Math.hypot(px - p.x, py - p.y) <= p.radiusM) {
            inPocket = true;
            break;
          }
        }
        if (inPocket) {
          colour = POCKET_RGB;
        } else {
          const outX = Math.max(-px, px - W, 0);
          const outY = Math.max(-py, py - L, 0);
          const out = Math.max(outX, outY);
          if (out <= 0 || out <= CUSHION_BAND_M) {
            colour = cloth;
            const away = Math.hypot(px - W / 2, py - L / 2) / halfDiag;
            factor = 1 - CLOTH_FALLOFF * Math.min(1, away);
            if (out > 0) factor *= CUSHION_DARKEN;
            else if (shadowed(px, py)) factor *= SHADOW;
          } else if (out <= CUSHION_BAND_M + RAIL_BAND_M) {
            colour = rail;
          }
        }
        for (let k = 0; k < 3; k++) pixel[k] = (colour[k] as number) * factor;
      }

      const o = 4 * ((j - j0) * width + (i - i0));
      for (let k = 0; k < 3; k++) {
        let v = (pixel[k] as number) * brightness;
        if (noise > 0) v += noise * gaussian(rand);
        data[o + k] = v; // Uint8ClampedArray rounds and clamps to 0..255.
      }
      data[o + 3] = 255;
    }
  }

  return { widthPx: width, heightPx: height, data };
}

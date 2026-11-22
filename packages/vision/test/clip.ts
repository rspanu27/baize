import {
  frictionalBallBall,
  mathavanCushion,
  prepareTable,
  sampleAt,
  simulate,
} from "@baize/physics";
import type { BallSample, MotionState, SimResult } from "@baize/physics";
import { BALL_BALL_FRICTION, ballSizeOf, cueEndMassKg } from "@baize/tables";
import type { BallKind, BallSetSpec, ClothSpec, LayoutBall, TableSpec } from "@baize/tables";
import { apparentRadiusPx, projectPoint } from "../src/index";
import type { Camera, ImagePoint, PhotoImage } from "../src/index";
import { gaussian, renderPixels } from "./render";
import type { PixelBox, SceneLook } from "./render";
import { seeded } from "./synthetic";

/**
 * Synthetic video clips for the tracking tests: a shot simulated by the physics engine (with
 * the editor's models), drawn frame by frame through a known camera by the photo renderer,
 * with motion blur and an optional moving occluder, so that every frame comes with exact truth.
 *
 * Time. Clip time starts at 0; the cue ball is struck at `strikeS` (= `leadInS`) and every ball
 * is still from `endS` on. Frame i starts at i / fps and its shutter is open for
 * `shutter / fps` seconds from then.
 *
 * Blur. A frame is the average of `blurSamples` pictures taken at evenly spaced times from the
 * moment the shutter opens to the moment it closes, both included, so a ball's streak spans
 * exactly the distance it travels while the shutter is open. With no shutter time (or one
 * sample) the frame is a single picture at mid-exposure. Each picture equals a full
 * `renderPhoto`, but only the pixels near a ball (its disc and its shadow) or under the
 * occluder are redrawn; the rest is a ball-free background drawn once per clip. The pixel sums
 * are kept as integers, so the result is the average of full renders, rounded once.
 *
 * Truth. A ball's `centre` and `radiusPx` are those of its centre at mid-exposure,
 * t + shutter / (2 fps), which is where the middle of its streak is drawn on a straight path.
 * `hidden` is measured on the disc of that centre and radius at the same moment.
 *
 * Noise. Noise from `look.noise` is added once per frame, after the average, from a seed made
 * of `look.seed` and the frame index: fresh in every frame like a camera sensor, and the same
 * whichever frames are rendered, in whatever order.
 *
 * The camera must be a plain pinhole camera (as from `cameraOf`), which is what the renderer draws.
 */

export interface ClipBall {
  id: string;
  kind: BallKind;
  x: number;
  y: number;
}

/** A capsule in image coordinates: every point within `radiusPx` of the segment (u0, v0)-(u1, v1). */
export interface Occluder {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  radiusPx: number;
}

export interface ClipSpec {
  table: TableSpec;
  ballSet: BallSetSpec;
  cloth: ClothSpec;
  balls: ClipBall[];
  shot: {
    cueBallId: string;
    aimAngleRad: number;
    speedMps: number;
    tipOffset: { side: number; vertical: number };
  };
  /** E.g. `cameraOf(pose)`. */
  camera: Camera;
  look: SceneLook;
  /** Frames per second, e.g. 30 or 120. */
  fps: number;
  /** Still frames before the strike and after everything stops. */
  leadInS: number;
  tailS: number;
  /** Shutter open time as a share of the frame interval (0 = no blur). Default 0.5. */
  shutter?: number;
  /** Sub-samples per frame for the blur. Default 8. */
  blurSamples?: number;
  /**
   * Optional occluder (a player's arm or body): a dark capsule in IMAGE coordinates whose place
   * is a function of clip time, drawn over the table and balls. Undefined: nothing in the way.
   */
  occluder?: (tS: number) => Occluder | undefined;
}

export interface ClipFrameTruth {
  index: number;
  /** Frame start time, clip time (the strike is at `leadInS`). */
  timeS: number;
  balls: {
    id: string;
    kind: BallKind;
    x: number;
    y: number;
    pocketed: boolean;
    moving: boolean;
    centre: ImagePoint;
    radiusPx: number;
    /** Share of the ball's disc hidden by the occluder, 0..1. */
    hidden: number;
  }[];
}

export interface RenderedClip {
  widthPx: number;
  heightPx: number;
  fps: number;
  strikeS: number;
  endS: number;
  frameCount: number;
  result: SimResult;
  /** A frame and its truth, rendered on demand (nothing is kept between calls). */
  frame(index: number): { image: PhotoImage; truth: ClipFrameTruth };
  /** The truth of a frame alone, without rendering it. */
  truth(index: number): ClipFrameTruth;
}

/** Colour of the occluder: a dark sleeve. */
export const OCCLUDER_RGB: readonly [number, number, number] = [38, 30, 26];

/** Grid side for measuring `hidden` (samples across the disc's bounding square). */
const HIDDEN_GRID = 32;

interface Placed {
  x: number;
  y: number;
  state: MotionState;
}

function distanceToSegment(u: number, v: number, o: Occluder): number {
  const du = o.u1 - o.u0;
  const dv = o.v1 - o.v0;
  const len2 = du * du + dv * dv;
  const s = len2 > 0 ? Math.max(0, Math.min(1, ((u - o.u0) * du + (v - o.v0) * dv) / len2)) : 0;
  return Math.hypot(u - (o.u0 + s * du), v - (o.v0 + s * dv));
}

/** Share of the disc (centre, radius) inside the occluder, by sampling a grid over the disc. */
function hiddenShare(o: Occluder | undefined, c: ImagePoint, radiusPx: number): number {
  if (!o || radiusPx <= 0) return 0;
  let inDisc = 0;
  let covered = 0;
  for (let a = 0; a < HIDDEN_GRID; a++) {
    for (let b = 0; b < HIDDEN_GRID; b++) {
      const du = (((a + 0.5) / HIDDEN_GRID) * 2 - 1) * radiusPx;
      const dv = (((b + 0.5) / HIDDEN_GRID) * 2 - 1) * radiusPx;
      if (du * du + dv * dv > radiusPx * radiusPx) continue;
      inDisc++;
      if (distanceToSegment(c.u + du, c.v + dv, o) <= o.radiusPx) covered++;
    }
  }
  return covered / inDisc;
}

export function renderClip(spec: ClipSpec): RenderedClip {
  const { table, ballSet, camera, look, fps } = spec;
  const shutter = spec.shutter ?? 0.5;
  const blurSamples = spec.blurSamples ?? 8;
  if (!(fps > 0)) throw new Error("fps must be positive");
  if (!(shutter >= 0 && shutter <= 1)) throw new Error("shutter must be within 0..1");
  if (!Number.isInteger(blurSamples) || blurSamples < 1) {
    throw new Error("blurSamples must be a whole number of at least 1");
  }
  if (camera.plane) throw new Error("the clip renderer draws through a plain pinhole camera");

  const width = Math.round(2 * camera.centre.u);
  const height = Math.round(2 * camera.centre.v);
  const nPix = width * height;

  // The shot, with the editor's physics (version 2 models and squirt).
  const sizes = spec.balls.map((b) => ballSizeOf(ballSet, b.kind));
  const cueIndex = spec.balls.findIndex((b) => b.id === spec.shot.cueBallId);
  const cueSize = sizes[cueIndex];
  if (!cueSize) throw new Error(`no ball ${spec.shot.cueBallId}`);
  const result = simulate({
    table: prepareTable(table),
    cloth: spec.cloth,
    balls: spec.balls.map((b, k) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radiusM: (sizes[k] as { diameterM: number }).diameterM / 2,
      massKg: (sizes[k] as { massKg: number }).massKg,
    })),
    ballRestitution: ballSet.restitution,
    shot: {
      ballId: spec.shot.cueBallId,
      aimAngleRad: spec.shot.aimAngleRad,
      speedMps: spec.shot.speedMps,
      tipOffset: spec.shot.tipOffset,
      cueEndMassKg: cueEndMassKg(cueSize.massKg),
    },
    models: { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion },
  });
  // A capped run has no "everything is still" moment to build the tail on.
  if (result.status !== "complete") throw new Error(`the shot did not finish: ${result.status}`);

  const radii = sizes.map((s) => s.diameterM / 2);
  const strikeS = spec.leadInS;
  const endS = strikeS + result.durationS;
  const frameCount = Math.max(1, Math.ceil((endS + spec.tailS) * fps));
  const exposureS = shutter / fps;
  const samples = exposureS > 0 ? blurSamples : 1;

  // Pictures for the average are drawn without noise; noise goes on the finished frame.
  const quiet: SceneLook = { ...look, noise: 0 };
  const background = renderPixels(camera, table, ballSet, { balls: [] }, quiet).data;

  const lightIn = look.light ?? { x: 0.3, y: -0.2, z: 1 };
  const lightLen = Math.hypot(lightIn.x, lightIn.y, lightIn.z);
  const light = { x: lightIn.x / lightLen, y: lightIn.y / lightLen, z: lightIn.z / lightLen };

  const placedAt = (tS: number): Placed[] => {
    if (tS < strikeS) return spec.balls.map((b) => ({ x: b.x, y: b.y, state: "stationary" }));
    return sampleAt(result, tS - strikeS).map((s: BallSample) => ({
      x: s.position.x,
      y: s.position.y,
      state: s.state,
    }));
  };

  const whole: PixelBox = { i0: 0, j0: 0, i1: width, j1: height };

  /** Image box around the points, padded by a pixel and clipped to the image. */
  const boxOf = (points: { x: number; y: number; z: number }[]): PixelBox => {
    let uMin = Infinity;
    let uMax = -Infinity;
    let vMin = Infinity;
    let vMax = -Infinity;
    for (const p of points) {
      const q = projectPoint(camera, p);
      // A point behind the camera has no box: redraw everything.
      if (!q) return whole;
      uMin = Math.min(uMin, q.u);
      uMax = Math.max(uMax, q.u);
      vMin = Math.min(vMin, q.v);
      vMax = Math.max(vMax, q.v);
    }
    return {
      i0: Math.max(0, Math.floor(uMin) - 1),
      j0: Math.max(0, Math.floor(vMin) - 1),
      i1: Math.min(width, Math.ceil(uMax) + 1),
      j1: Math.min(height, Math.ceil(vMax) + 1),
    };
  };

  /**
   * Boxes holding every pixel a ball at (x, y) can change: its disc, which lies inside the image
   * of its bounding cube, and its shadow, which lies inside a disc of radius r / lz around the
   * point below the ball along the light (the cloth section of a cylinder of radius r).
   */
  const ballBoxes = (x: number, y: number, r: number): PixelBox[] => {
    const cube: { x: number; y: number; z: number }[] = [];
    for (const dx of [-r, r]) {
      for (const dy of [-r, r]) {
        for (const z of [0, 2 * r]) cube.push({ x: x + dx, y: y + dy, z });
      }
    }
    // A light from (nearly) the side throws long shadows; just redraw everything then.
    if (light.z < 0.05) return [whole];
    const sx = x - (r * light.x) / light.z;
    const sy = y - (r * light.y) / light.z;
    const sr = (r / light.z) * 1.01 + 1e-4;
    const shadow: { x: number; y: number; z: number }[] = [];
    for (const dx of [-sr, sr]) {
      for (const dy of [-sr, sr]) shadow.push({ x: sx + dx, y: sy + dy, z: 0 });
    }
    return [boxOf(cube), boxOf(shadow)];
  };

  // Scratch space, reused between frames (frames are rendered one at a time).
  const sum = new Uint32Array(3 * nPix);
  const value = new Uint8Array(3 * nPix);
  const mark = new Int32Array(nPix);
  const changed = new Int32Array(nPix);
  let stamp = 0;

  const truthAt = (index: number): ClipFrameTruth => {
    const timeS = index / fps;
    const midS = timeS + exposureS / 2;
    const placed = placedAt(midS);
    const occluder = spec.occluder?.(midS);
    return {
      index,
      timeS,
      balls: spec.balls.map((b, k) => {
        const p = placed[k] as Placed;
        const r = radii[k] as number;
        const at = { x: p.x, y: p.y, z: r };
        const centre = projectPoint(camera, at);
        if (!centre) throw new Error(`ball ${b.id} is behind the camera`);
        const radiusPx = apparentRadiusPx(camera, at, r) ?? 0;
        const pocketed = p.state === "pocketed";
        return {
          id: b.id,
          kind: b.kind,
          x: p.x,
          y: p.y,
          pocketed,
          moving: p.state === "sliding" || p.state === "rolling",
          centre,
          radiusPx,
          hidden: pocketed ? 0 : hiddenShare(occluder, centre, radiusPx),
        };
      }),
    };
  };

  const frame = (index: number): { image: PhotoImage; truth: ClipFrameTruth } => {
    if (!Number.isInteger(index) || index < 0 || index >= frameCount) {
      throw new Error(`no frame ${index}`);
    }
    const timeS = index / fps;
    for (let p = 0; p < nPix; p++) {
      for (let k = 0; k < 3; k++) sum[3 * p + k] = samples * (background[4 * p + k] as number);
    }

    for (let s = 0; s < samples; s++) {
      const tS = samples === 1 ? timeS + exposureS / 2 : timeS + (exposureS * s) / (samples - 1);
      stamp++;
      let nChanged = 0;
      const touch = (p: number) => {
        if (mark[p] !== stamp) {
          mark[p] = stamp;
          changed[nChanged++] = p;
        }
      };

      const placed = placedAt(tS);
      const layout: LayoutBall[] = [];
      const onTable: number[] = [];
      spec.balls.forEach((b, k) => {
        const p = placed[k] as Placed;
        if (p.state === "pocketed") return;
        layout.push({ kind: b.kind, x: p.x, y: p.y });
        onTable.push(k);
      });
      // Every box is drawn with all the balls on the table, so a neighbour's disc or shadow
      // reaching into it is drawn too and each pixel equals the full picture's.
      for (const k of onTable) {
        const p = placed[k] as Placed;
        for (const box of ballBoxes(p.x, p.y, radii[k] as number)) {
          if (box.i1 <= box.i0 || box.j1 <= box.j0) continue;
          const part = renderPixels(camera, table, ballSet, { balls: layout }, quiet, box).data;
          const bw = box.i1 - box.i0;
          for (let j = box.j0; j < box.j1; j++) {
            for (let i = box.i0; i < box.i1; i++) {
              const p2 = j * width + i;
              const o = 4 * ((j - box.j0) * bw + (i - box.i0));
              touch(p2);
              for (let c = 0; c < 3; c++) value[3 * p2 + c] = part[o + c] as number;
            }
          }
        }
      }

      const occ = spec.occluder?.(tS);
      if (occ) {
        const i0 = Math.max(0, Math.floor(Math.min(occ.u0, occ.u1) - occ.radiusPx) - 1);
        const i1 = Math.min(width, Math.ceil(Math.max(occ.u0, occ.u1) + occ.radiusPx) + 1);
        const j0 = Math.max(0, Math.floor(Math.min(occ.v0, occ.v1) - occ.radiusPx) - 1);
        const j1 = Math.min(height, Math.ceil(Math.max(occ.v0, occ.v1) + occ.radiusPx) + 1);
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            // Pixel centres, as the renderer samples them.
            if (distanceToSegment(i + 0.5, j + 0.5, occ) > occ.radiusPx) continue;
            const p2 = j * width + i;
            touch(p2);
            for (let c = 0; c < 3; c++) value[3 * p2 + c] = OCCLUDER_RGB[c] as number;
          }
        }
      }

      for (let n = 0; n < nChanged; n++) {
        const p2 = changed[n] as number;
        for (let c = 0; c < 3; c++) {
          sum[3 * p2 + c] =
            (sum[3 * p2 + c] as number) +
            (value[3 * p2 + c] as number) -
            (background[4 * p2 + c] as number);
        }
      }
    }

    const data = new Uint8ClampedArray(4 * nPix);
    const noise = look.noise ?? 0;
    const rand = seeded((((look.seed ?? 1) >>> 0) + Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    for (let p = 0; p < nPix; p++) {
      for (let c = 0; c < 3; c++) {
        let v = (sum[3 * p + c] as number) / samples;
        if (noise > 0) v += noise * gaussian(rand);
        data[4 * p + c] = v; // Uint8ClampedArray rounds and clamps, as in the renderer.
      }
      data[4 * p + 3] = 255;
    }
    return { image: { widthPx: width, heightPx: height, data }, truth: truthAt(index) };
  };

  return {
    widthPx: width,
    heightPx: height,
    fps,
    strikeS,
    endS,
    frameCount,
    result,
    frame,
    truth: truthAt,
  };
}

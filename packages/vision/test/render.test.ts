import {
  TABLE_PRESETS,
  ballAppearance,
  getBallSet,
  getTablePreset,
  pocketDropCircles,
  rackLayout,
  racksFor,
} from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { projectPoint } from "../src/index";
import type { Camera, PhotoImage } from "../src/index";
import { renderPhoto } from "./render";
import type { RenderedPhoto, SceneLook } from "./render";
import { cameraOf, cornersSeen } from "./synthetic";

/** The synthetic photo renderer, checked against its own ground truth. */

const CLOTH = "#2e7d4f";
const LOOK: SceneLook = { cloth: CLOTH };

function parse(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A person standing behind the baulk end, looking down the table, scaled to its size. */
function standing(table: TableSpec): Camera {
  const { widthM: W, lengthM: L } = table.playingArea;
  return cameraOf({
    position: { x: W / 2, y: -0.42 * L, z: 0.62 * L },
    target: { x: W / 2, y: 0.45 * L },
    rollRad: 0,
    focalPx: 500,
    widthPx: 800,
    heightPx: 600,
  });
}

function setup(id: string) {
  const table = getTablePreset(id) as TableSpec;
  const ballSet = getBallSet(table.defaultBallSetId) as BallSetSpec;
  return { table, ballSet, camera: standing(table) };
}

function pixelAt(image: PhotoImage, u: number, v: number): [number, number, number] {
  const i = 4 * (Math.floor(v) * image.widthPx + Math.floor(u));
  return [image.data[i] as number, image.data[i + 1] as number, image.data[i + 2] as number];
}

function groundPixel(photo: RenderedPhoto, camera: Camera, x: number, y: number) {
  const p = projectPoint(camera, { x, y, z: 0 });
  if (!p) throw new Error("behind the camera");
  expect(p.u).toBeGreaterThan(0);
  expect(p.u).toBeLessThan(photo.image.widthPx);
  expect(p.v).toBeGreaterThan(0);
  expect(p.v).toBeLessThan(photo.image.heightPx);
  return pixelAt(photo.image, p.u, p.v);
}

const sum = (c: number[]) => c[0]! + c[1]! + c[2]!;
const EMPTY: Layout = { balls: [] };

describe("renderPhoto basics", () => {
  const { table, ballSet, camera } = setup("snooker-12@1");
  const layout = rackLayout(table, ballSet, "snooker-15");

  test("size, alpha and determinism", () => {
    const a = renderPhoto(camera, table, ballSet, layout, LOOK);
    expect(a.image.widthPx).toBe(800);
    expect(a.image.heightPx).toBe(600);
    expect(a.image.data.length).toBe(4 * 800 * 600);
    for (let i = 3; i < a.image.data.length; i += 4) {
      if (a.image.data[i] !== 255) throw new Error("alpha is not 255");
    }
    const b = renderPhoto(camera, table, ballSet, layout, LOOK);
    expect(Buffer.from(b.image.data).equals(Buffer.from(a.image.data))).toBe(true);
  });

  test("noise is repeatable with the same seed and differs with another", () => {
    const noisy = { ...LOOK, noise: 6, seed: 7 };
    const a = renderPhoto(camera, table, ballSet, layout, noisy);
    const b = renderPhoto(camera, table, ballSet, layout, noisy);
    const c = renderPhoto(camera, table, ballSet, layout, { ...noisy, seed: 8 });
    expect(Buffer.from(b.image.data).equals(Buffer.from(a.image.data))).toBe(true);
    expect(Buffer.from(c.image.data).equals(Buffer.from(a.image.data))).toBe(false);
  });

  test("noise changes pixels by about the requested amount", () => {
    const clean = renderPhoto(camera, table, ballSet, EMPTY, LOOK);
    const noisy = renderPhoto(camera, table, ballSet, EMPTY, { ...LOOK, noise: 10 });
    const diffs: number[] = [];
    for (let i = 0; i < clean.image.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        diffs.push((noisy.image.data[i + k] as number) - (clean.image.data[i + k] as number));
      }
    }
    const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
    const sd = Math.sqrt(diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / diffs.length);
    expect(sd).toBeGreaterThan(7);
    expect(sd).toBeLessThan(13);
  });

  test("corners and ball centres are the projections of the truth", () => {
    const photo = renderPhoto(camera, table, ballSet, layout, LOOK);
    expect(photo.corners).toEqual(
      cornersSeen(camera, table.playingArea.widthM, table.playingArea.lengthM),
    );
    expect(photo.balls.length).toBe(layout.balls.length);
    photo.balls.forEach((b, i) => {
      const src = layout.balls[i]!;
      expect(b.kind).toBe(src.kind);
      expect(b.x).toBe(src.x);
      expect(b.y).toBe(src.y);
      expect(b.centre).toEqual(projectPoint(camera, { x: b.x, y: b.y, z: b.radiusM }));
      expect(b.radiusPx).toBeGreaterThan(2);
    });
  });

  test("a full snooker rack renders at 800 x 600 in well under 1.5 s", () => {
    const t0 = performance.now();
    renderPhoto(camera, table, ballSet, layout, LOOK);
    const ms = performance.now() - t0;
    console.log(`render 800x600 snooker rack (${layout.balls.length} balls): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(1500);
  });
});

describe("balls", () => {
  function nearestKind(colour: [number, number, number], kinds: string[]): string {
    let best = kinds[0]!;
    let bestD = Infinity;
    for (const k of kinds) {
      const c = parse(ballAppearance(k).colour);
      const d = (c[0] - colour[0]) ** 2 + (c[1] - colour[1]) ** 2 + (c[2] - colour[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return best;
  }

  function spread(table: TableSpec, kinds: string[]): Layout {
    // One ball of each kind, well apart, in two rows across the middle of the table.
    const { widthM: W, lengthM: L } = table.playingArea;
    return {
      balls: kinds.map((kind, i) => ({
        kind: kind as never,
        x: W * (0.15 + 0.7 * ((i % 4) / 3)),
        y: L * (0.3 + 0.15 * Math.floor(i / 4)),
      })),
    };
  }

  test("snooker: each ball's centre pixel is nearest its own colour", () => {
    const { table, ballSet, camera } = setup("snooker-12@1");
    const kinds = ["cue", "red", "yellow", "green", "brown", "blue", "pink", "black"];
    const layout = spread(table, kinds);
    const photo = renderPhoto(camera, table, ballSet, layout, LOOK);
    for (const b of photo.balls) {
      expect(nearestKind(pixelAt(photo.image, b.centre.u, b.centre.v), kinds)).toBe(b.kind);
    }
  });

  test("pool: solid balls", () => {
    const { table, ballSet, camera } = setup("pool-9@1");
    const kinds = ["cue", "1", "2", "3", "4", "5", "6", "7", "8"];
    const layout = spread(table, kinds);
    const photo = renderPhoto(camera, table, ballSet, layout, LOOK);
    for (const b of photo.balls) {
      expect(nearestKind(pixelAt(photo.image, b.centre.u, b.centre.v), kinds)).toBe(b.kind);
    }
  });

  test("a striped ball shows white and its colour near its centre", () => {
    const { table, ballSet, camera } = setup("pool-9@1");
    const layout: Layout = {
      balls: [{ kind: "10", x: table.playingArea.widthM / 2, y: table.playingArea.lengthM * 0.4 }],
    };
    const photo = renderPhoto(camera, table, ballSet, layout, LOOK);
    const b = photo.balls[0]!;
    const blue = parse(ballAppearance("10").colour);
    let whiteish = 0;
    let coloured = 0;
    const r = Math.floor(0.7 * b.radiusPx);
    for (let dv = -r; dv <= r; dv++) {
      for (let du = -r; du <= r; du++) {
        if (du * du + dv * dv > r * r) continue;
        const [pr, pg, pb] = pixelAt(photo.image, b.centre.u + du, b.centre.v + dv);
        if (pr > 150 && pg > 150 && pb > 130) whiteish++;
        if (pb > pr + 40 && Math.abs(pb - blue[2] * 0.8) < 70) coloured++;
      }
    }
    expect(whiteish).toBeGreaterThan(5);
    expect(coloured).toBeGreaterThan(5);
  });

  test("a ball casts a shadow on the side away from the light", () => {
    const { table, ballSet, camera } = setup("snooker-12@1");
    const { widthM: W, lengthM: L } = table.playingArea;
    const r = ballSet.object.diameterM / 2;
    const layout: Layout = { balls: [{ kind: "red", x: W / 2, y: L / 2 }] };
    const light = { x: 1, y: 0, z: 1 };
    const photo = renderPhoto(camera, table, ballSet, layout, { ...LOOK, light });
    const shadowSide = groundPixel(photo, camera, W / 2 - 1.5 * r, L / 2);
    const litSide = groundPixel(photo, camera, W / 2 + 1.5 * r, L / 2);
    expect(sum(shadowSide)).toBeLessThan(0.8 * sum(litSide));
  });
});

describe("table surfaces", () => {
  const { table, ballSet, camera } = setup("snooker-12@1");
  const { widthM: W, lengthM: L } = table.playingArea;
  const photo = renderPhoto(camera, table, ballSet, EMPTY, LOOK);

  test("open cloth is close to the cloth colour", () => {
    const px = groundPixel(photo, camera, W / 2, L * 0.4);
    const ref = parse(CLOTH);
    for (let k = 0; k < 3; k++)
      expect(Math.abs(px[k]! - ref[k]!)).toBeLessThanOrEqual(0.15 * ref[k]!);
  });

  test("just outside the playing area is darker than the cloth", () => {
    const cushion = groundPixel(photo, camera, W / 2, L + 0.02);
    const cloth = groundPixel(photo, camera, W / 2, L - 0.15);
    expect(sum(cushion)).toBeLessThan(0.9 * sum(cloth));
  });

  test("the rail is the rail colour and the far side is floor", () => {
    const rail = groundPixel(photo, camera, W / 2, L + 0.1);
    expect(rail[0]).toBeGreaterThan(rail[2]); // brown, not grey
    const floor = groundPixel(photo, camera, W + 0.6, L * 0.6);
    const ref = parse("#6b6660");
    for (let k = 0; k < 3; k++) expect(Math.abs(floor[k]! - ref[k]!)).toBeLessThanOrEqual(3);
  });

  test("a pocket centre is near black", () => {
    const middle = pocketDropCircles(table).find((p) => p.id === "middle-l")!;
    const px = groundPixel(photo, camera, middle.x, middle.y);
    expect(Math.max(...px)).toBeLessThan(40);
  });

  test("brightness scales the picture", () => {
    const dim = renderPhoto(camera, table, ballSet, EMPTY, { ...LOOK, brightness: 0.5 });
    const a = groundPixel(photo, camera, W / 2, L * 0.4);
    const b = groundPixel(dim, camera, W / 2, L * 0.4);
    expect(sum(b)).toBeLessThan(0.55 * sum(a));
  });
});

describe("table presets", () => {
  test.each(TABLE_PRESETS.map((t) => t.id))("%s with its default balls and first rack", (id) => {
    const { table, ballSet, camera } = setup(id);
    const rack = racksFor(table.game)[0]!;
    const layout = rackLayout(table, ballSet, rack);
    const photo = renderPhoto(camera, table, ballSet, layout, LOOK);
    expect(photo.balls.length).toBe(layout.balls.length);
    for (const b of photo.balls) {
      expect(b.centre.u).toBeGreaterThan(0);
      expect(b.centre.u).toBeLessThan(photo.image.widthPx);
      expect(b.centre.v).toBeGreaterThan(0);
      expect(b.centre.v).toBeLessThan(photo.image.heightPx);
    }
  });
});

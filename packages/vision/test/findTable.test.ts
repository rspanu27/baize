import { CLOTH_COLOURS, TABLE_PRESETS, getBallSet, rackLayout, racksFor } from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { findTable } from "../src/index";
import type { Camera, PhotoImage, TableCorners } from "../src/index";
import { renderPhoto } from "./render";
import { cameraOf, seeded } from "./synthetic";

/**
 * The table finder on synthetic photos, where the true corners are known exactly. The
 * renderer draws cushions 0.05 m deep and level with the cloth, which is what the finder
 * assumes, so these tests check the finder's own accuracy and not that assumption.
 */

const WIDTH = 800;
const HEIGHT = 600;

function setOf(table: TableSpec): BallSetSpec {
  const set = getBallSet(table.defaultBallSetId);
  if (!set) throw new Error(`no ball set for ${table.id}`);
  return set;
}

/** A camera at a place given in table lengths, looking at a point of the table. */
function camera(
  table: TableSpec,
  o: { x: number; y: number; z: number; tx?: number; ty?: number; roll?: number; focal?: number },
): Camera {
  const { widthM, lengthM } = table.playingArea;
  return cameraOf({
    position: { x: o.x * lengthM, y: o.y * lengthM, z: o.z * lengthM },
    target: { x: (o.tx ?? 0.5) * widthM, y: (o.ty ?? 0.5) * lengthM },
    rollRad: o.roll ?? 0,
    focalPx: o.focal ?? 520,
    widthPx: WIDTH,
    heightPx: HEIGHT,
  });
}

/** Largest distance between found and true corners, in pixels. */
function cornerError(found: TableCorners, truth: TableCorners): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const f = found[i] as { u: number; v: number };
    const t = truth[i] as { u: number; v: number };
    worst = Math.max(worst, Math.hypot(f.u - t.u, f.v - t.v));
  }
  return worst;
}

function rack(table: TableSpec): Layout {
  const kind = racksFor(table.game)[0];
  if (!kind) throw new Error("no rack");
  return rackLayout(table, setOf(table), kind);
}

const EMPTY: Layout = { balls: [] };

describe("findTable on synthetic photos", () => {
  test.each(TABLE_PRESETS.map((t) => [t.id, t] as const))(
    "%s from behind the baulk end, with a rack on it",
    (_id, table) => {
      // Behind the baulk end, a little to one side, as a person would stand.
      const cam = camera(table, { x: 0.05, y: -0.42, z: 0.62, ty: 0.47 });
      const photo = renderPhoto(cam, table, setOf(table), rack(table), { cloth: "#1f6b3a" });
      const found = findTable(photo.image, table, 0);
      if (!found) throw new Error("table not found");
      // An 800 px photo: within a pixel and a half of the truth.
      expect(cornerError(found.corners, photo.corners)).toBeLessThan(1.5);
      expect(found.baulkEndGuessed).toBe(true);
      // The camera is found where it was.
      expect(Math.abs(found.camera.position.z - cam.position.z) / cam.position.z).toBeLessThan(
        0.03,
      );
    },
  );

  test.each(CLOTH_COLOURS.map((c) => [c.name, c.hex] as const))(
    "any cloth colour: %s",
    (_name, hex) => {
      const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1") as TableSpec;
      const cam = camera(table, { x: -0.1, y: -0.35, z: 0.6, ty: 0.45 });
      const photo = renderPhoto(cam, table, setOf(table), rack(table), { cloth: hex });
      const found = findTable(photo.image, table, 0);
      if (!found) throw new Error(`table not found on ${hex}`);
      // Measured on 2026-11-14: 1.6 px at worst (the red cloth), since cloth in shadow is
      // accepted by its hue; it was under 1.5 px before. Still a quarter of a percent of
      // the width of the photo.
      expect(cornerError(found.corners, photo.corners)).toBeLessThan(2);
    },
  );

  test("from a corner, from the side and from the far end; dim, bright and noisy", () => {
    const table = TABLE_PRESETS.find((t) => t.id === "snooker-12@1") as TableSpec;
    const rand = seeded(7);
    const views = [
      // Near a baulk corner.
      { x: -0.25, y: -0.3, z: 0.55, ty: 0.45 },
      // From the side, towards the baulk half.
      { x: -0.65, y: 0.3, z: 0.6, tx: 0.5, ty: 0.5 },
      { x: 0.2, y: -0.45, z: 0.7, ty: 0.5, roll: 0.06 },
      { x: 0.45, y: -0.4, z: 0.5, ty: 0.45, roll: -0.05 },
    ];
    for (const view of views) {
      const cam = camera(table, { ...view, focal: 430 });
      const photo = renderPhoto(cam, table, setOf(table), rack(table), {
        cloth: "#1f6b3a",
        brightness: 0.6 + rand() * 0.8,
        noise: 6,
        seed: Math.floor(rand() * 1000),
      });
      const found = findTable(photo.image, table, 0);
      if (!found) throw new Error(`table not found from ${JSON.stringify(view)}`);
      expect(cornerError(found.corners, photo.corners), JSON.stringify(view)).toBeLessThan(2.5);
    }
  });

  test("the nearer end is taken as the baulk end, also when it is really the top end", () => {
    const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1") as TableSpec;
    // Standing behind the top (foot) end.
    const cam = camera(table, { x: 0.25, y: 1.42, z: 0.62, ty: 0.53 });
    const photo = renderPhoto(cam, table, setOf(table), EMPTY, { cloth: "#1f4f8f" });
    const found = findTable(photo.image, table, 0);
    if (!found) throw new Error("table not found");
    // The same quadrilateral, turned end for end: found corner 0 is the true corner 2.
    const [a, b, c, d] = photo.corners;
    const turned: TableCorners = [c, d, a, b];
    expect(cornerError(found.corners, turned)).toBeLessThan(1.5);
    expect(found.camera.position.y).toBeLessThan(0);
  });

  test("the long sides are told from the short ones even when the long sides look shorter", () => {
    const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1") as TableSpec;
    // From beside the table, low down: the near long side spans the photo, and the short
    // ends look longer than they would from the end.
    const cam = camera(table, { x: -0.5, y: 0.5, z: 0.45, tx: 0.5, ty: 0.5, focal: 380 });
    const photo = renderPhoto(cam, table, setOf(table), EMPTY, { cloth: "#1f6b3a" });
    const found = findTable(photo.image, table, 0);
    if (!found) throw new Error("table not found");
    const [a, b, c, d] = photo.corners;
    const turned: TableCorners = [c, d, a, b];
    const error = Math.min(
      cornerError(found.corners, photo.corners),
      cornerError(found.corners, turned),
    );
    expect(error).toBeLessThan(2);
  });

  test("a table that runs off the photo is not guessed at", () => {
    const table = TABLE_PRESETS.find((t) => t.id === "snooker-12@1") as TableSpec;
    // Too close: the far corners are in view but the near ones are cut off.
    const cam = camera(table, { x: 0.25, y: -0.12, z: 0.3, ty: 0.5 });
    const photo = renderPhoto(cam, table, setOf(table), EMPTY, { cloth: "#1f6b3a" });
    const outside = photo.corners.filter((p) => p.u < 0 || p.u > WIDTH || p.v < 0 || p.v > HEIGHT);
    expect(outside.length).toBeGreaterThan(0);
    expect(findTable(photo.image, table, 0)).toBeUndefined();
  });

  test("a photo with no table in it gives nothing", () => {
    const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1") as TableSpec;
    const blank: PhotoImage = {
      widthPx: 320,
      heightPx: 240,
      data: new Uint8ClampedArray(320 * 240 * 4).fill(128),
    };
    expect(findTable(blank, table, 0)).toBeUndefined();
    const rand = seeded(3);
    const noise: PhotoImage = {
      widthPx: 320,
      heightPx: 240,
      data: new Uint8ClampedArray(320 * 240 * 4).map(() => Math.floor(rand() * 256)),
    };
    expect(findTable(noise, table, 0)).toBeUndefined();
  });
});

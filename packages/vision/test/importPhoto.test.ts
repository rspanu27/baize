import { TABLE_PRESETS, getBallSet, sanitizeLayout } from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { importPhoto } from "../src/index";
import type { Camera, TableCorners } from "../src/index";
import { renderPhoto } from "./render";
import { cameraOf } from "./synthetic";

function preset(id: string): { table: TableSpec; set: BallSetSpec } {
  const table = TABLE_PRESETS.find((t) => t.id === id);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error(`no preset ${id}`);
  return { table, set };
}

function standing(table: TableSpec, width: number, height: number): Camera {
  const { widthM, lengthM } = table.playingArea;
  return cameraOf({
    position: { x: 0.08 * lengthM, y: -0.4 * lengthM, z: 0.62 * lengthM },
    target: { x: 0.5 * widthM, y: 0.47 * lengthM },
    rollRad: 0,
    focalPx: 0.65 * width,
    widthPx: width,
    heightPx: height,
  });
}

/** The test renderer draws cushions flat on the cloth, so the corners are at height 0. */
const FLAT = { cornerHeightM: 0 };

const LAYOUT: Layout = {
  balls: [
    { kind: "cue", x: 0.4, y: 0.6 },
    { kind: "1", x: 0.9, y: 1.4 },
    { kind: "3", x: 0.3, y: 2.0 },
    { kind: "8", x: 0.7, y: 1.0 },
  ],
};

describe("importPhoto", () => {
  const { table, set } = preset("pool-9@1");
  const photo = renderPhoto(standing(table, 1600, 1200), table, set, LAYOUT, { cloth: "#1f6b3a" });

  test("finds the table and the balls, and reports that it found the corners itself", () => {
    const result = importPhoto(photo.image, table, set, FLAT);
    expect(result.problem).toBeUndefined();
    expect(result.diagnostics.cornersDetected).toBe(true);
    expect(result.corners).toBeDefined();
    expect(result.layout.balls).toHaveLength(4);
    let named = 0;
    for (const truth of LAYOUT.balls) {
      const found = result.layout.balls.find(
        (b) => Math.hypot(b.x - truth.x, b.y - truth.y) < 0.01,
      );
      if (!found) throw new Error(`no ball within 1 cm of the ${truth.kind}`);
      expect(found.confidence).toBeGreaterThan(0);
      if (found.kind === truth.kind) named++;
    }
    // Measured on 2026-11-13: three of the four are named; the red 3 is taken for another
    // ball of a similar colour. Positions do not depend on the name.
    expect(named).toBeGreaterThanOrEqual(3);
    // What comes out is already a legal layout for this table.
    const again = sanitizeLayout(result.layout, table, set);
    expect(again.moved).toEqual([]);
    expect(again.removed).toEqual([]);
  });

  test("corners placed by hand are used as given", () => {
    const result = importPhoto(photo.image, table, set, { corners: photo.corners, ...FLAT });
    expect(result.problem).toBeUndefined();
    expect(result.diagnostics.cornersDetected).toBe(false);
    expect(result.corners).toBe(photo.corners);
    expect(result.layout.balls).toHaveLength(4);
  });

  test("corners in the wrong order are a named problem, with no balls", () => {
    const [a, b, c, d] = photo.corners;
    const mirrored: TableCorners = [b, a, d, c];
    const result = importPhoto(photo.image, table, set, { corners: mirrored, ...FLAT });
    expect(result.problem).toBe("corners-invalid");
    expect(result.layout.balls).toEqual([]);
  });

  // Found in the Stage A review (2026-11-15): these two passed, with a camera a few
  // centimetres above the cloth, and the review offered "Use these balls".
  test("a corner dragged inwards (a folded figure) is a named problem", () => {
    const [a, b, c, d] = photo.corners;
    const inside = { u: (a.u + b.u + c.u + d.u) / 4, v: (a.v + b.v + c.v + d.v) / 4 };
    const folded: TableCorners = [
      a,
      b,
      {
        u: (inside.u + c.u) / 2 - 0.3 * (c.u - inside.u),
        v: (inside.v + c.v) / 2 - 0.3 * (c.v - inside.v),
      },
      d,
    ];
    const result = importPhoto(photo.image, table, set, { corners: folded, ...FLAT });
    expect(result.problem).toBe("corners-invalid");
    expect(result.layout.balls).toEqual([]);
  });

  test("three corners in a line are a named problem", () => {
    const [a, b, , d] = photo.corners;
    const inLine = { u: b.u + (b.u - a.u), v: b.v + (b.v - a.v) };
    const result = importPhoto(photo.image, table, set, {
      corners: [a, b, inLine, d],
      ...FLAT,
    });
    expect(result.problem).toBe("corners-invalid");
    expect(result.layout.balls).toEqual([]);
  });

  test("corners placed a little off by hand are still accepted", () => {
    // By eye, corners are some pixels off, and four such corners fit no camera exactly. They
    // must not be refused for that (a check on how well the camera sees them again refused
    // the user's real photo and was dropped).
    const [a, b, c, d] = photo.corners;
    const off: TableCorners = [
      { u: a.u + 12, v: a.v - 9 },
      b,
      { u: c.u - 10, v: c.v + 14 },
      { u: d.u + 15, v: d.v + 6 },
    ];
    const result = importPhoto(photo.image, table, set, { corners: off, ...FLAT });
    expect(result.problem).toBeUndefined();
  });

  test("corners from a real view pass the check whatever the view", () => {
    // From the far end and from a side, not only the usual one.
    for (const pose of [
      { position: { x: 0.6, y: 3.2, z: 1.5 }, target: { x: 0.6, y: 1.2 } },
      { position: { x: 2.6, y: 1.3, z: 1.8 }, target: { x: 0.6, y: 1.3 } },
    ]) {
      const cam = cameraOf({ ...pose, rollRad: 0.05, focalPx: 900, widthPx: 1200, heightPx: 900 });
      const view = renderPhoto(cam, table, set, { balls: [] }, { cloth: "#1f6b3a" });
      const result = importPhoto(view.image, table, set, { corners: view.corners, ...FLAT });
      expect(result.problem).toBeUndefined();
    }
  });

  test("a photo with no table is a named problem, with no balls", () => {
    const blank = {
      widthPx: 200,
      heightPx: 150,
      data: new Uint8ClampedArray(200 * 150 * 4).fill(90),
    };
    const result = importPhoto(blank, table, set, FLAT);
    expect(result.problem).toBe("table-not-found");
    expect(result.layout.balls).toEqual([]);
    expect(result.corners).toBeUndefined();
  });

  test("the photo is not changed, and timings appear only when a clock is given", () => {
    const before = photo.image.data.slice();
    const plain = importPhoto(photo.image, table, set, FLAT);
    expect(plain.diagnostics.timingsMs).toEqual({});
    let t = 0;
    const timed = importPhoto(photo.image, table, set, { now: () => (t += 5), ...FLAT });
    expect(Object.keys(timed.diagnostics.timingsMs).sort()).toEqual(["balls", "sanity", "table"]);
    expect(photo.image.data).toEqual(before);
    expect(timed.layout).toEqual(plain.layout);
  });

  test("speed: a 12 megapixel photo is imported well inside the 8 second limit", () => {
    const big = renderPhoto(standing(table, 4000, 3000), table, set, LAYOUT, { cloth: "#1f6b3a" });
    const start = performance.now();
    const result = importPhoto(big.image, table, set, FLAT);
    const ms = performance.now() - start;
    expect(result.layout.balls).toHaveLength(4);
    // Measured on 2026-11-13 on a desktop; a phone is several times slower.
    expect(ms).toBeLessThan(2000);
  }, 60_000);
});

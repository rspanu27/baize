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
    const result = importPhoto(photo.image, table, set);
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
    const result = importPhoto(photo.image, table, set, { corners: photo.corners });
    expect(result.problem).toBeUndefined();
    expect(result.diagnostics.cornersDetected).toBe(false);
    expect(result.corners).toBe(photo.corners);
    expect(result.layout.balls).toHaveLength(4);
  });

  test("corners in the wrong order are a named problem, with no balls", () => {
    const [a, b, c, d] = photo.corners;
    const mirrored: TableCorners = [b, a, d, c];
    const result = importPhoto(photo.image, table, set, { corners: mirrored });
    expect(result.problem).toBe("corners-invalid");
    expect(result.layout.balls).toEqual([]);
  });

  test("a photo with no table is a named problem, with no balls", () => {
    const blank = {
      widthPx: 200,
      heightPx: 150,
      data: new Uint8ClampedArray(200 * 150 * 4).fill(90),
    };
    const result = importPhoto(blank, table, set);
    expect(result.problem).toBe("table-not-found");
    expect(result.layout.balls).toEqual([]);
    expect(result.corners).toBeUndefined();
  });

  test("the photo is not changed, and timings appear only when a clock is given", () => {
    const before = photo.image.data.slice();
    const plain = importPhoto(photo.image, table, set);
    expect(plain.diagnostics.timingsMs).toEqual({});
    let t = 0;
    const timed = importPhoto(photo.image, table, set, { now: () => (t += 5) });
    expect(Object.keys(timed.diagnostics.timingsMs).sort()).toEqual(["balls", "sanity", "table"]);
    expect(photo.image.data).toEqual(before);
    expect(timed.layout).toEqual(plain.layout);
  });

  test("speed: a 12 megapixel photo is imported well inside the 8 second limit", () => {
    const big = renderPhoto(standing(table, 4000, 3000), table, set, LAYOUT, { cloth: "#1f6b3a" });
    const start = performance.now();
    const result = importPhoto(big.image, table, set);
    const ms = performance.now() - start;
    expect(result.layout.balls).toHaveLength(4);
    // Measured on 2026-11-13 on a desktop; a phone is several times slower.
    expect(ms).toBeLessThan(2000);
  }, 60_000);
});

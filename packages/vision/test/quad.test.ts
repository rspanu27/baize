import { describe, expect, test } from "vitest";
import { clipToRect, polygonArea } from "../src/table/quad";

describe("clipping a polygon to the photo", () => {
  test("a polygon inside is kept as it is", () => {
    const square = [
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 3 },
      { x: 1, y: 3 },
    ];
    expect(clipToRect(square, 10, 10)).toEqual(square);
  });

  test("a corner beyond the edge is cut off along the edge", () => {
    // A 4 x 4 square from (3, 3) in a 6 x 6 photo: the 3 x 3 part up to (6, 6) is inside.
    const square = [
      { x: 3, y: 3 },
      { x: 7, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 7 },
    ];
    const clipped = clipToRect(square, 6, 6);
    expect(polygonArea(clipped)).toBeCloseTo(9, 12);
    for (const p of clipped) {
      expect(p.x).toBeLessThanOrEqual(6);
      expect(p.y).toBeLessThanOrEqual(6);
    }
  });

  test("a triangle across one edge keeps the part inside", () => {
    const triangle = [
      { x: -2, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 4 },
    ];
    // Right half of the triangle: area 4 of 8.
    expect(polygonArea(clipToRect(triangle, 10, 10))).toBeCloseTo(4, 12);
  });

  test("a polygon wholly outside leaves nothing", () => {
    const away = [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 25, y: 30 },
    ];
    expect(clipToRect(away, 10, 10)).toEqual([]);
  });
});

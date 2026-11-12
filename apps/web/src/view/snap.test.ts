import { describe, expect, test } from "vitest";
import { snapDistanceFor, snapPoint } from "./snap";

const spots = [
  { x: 0.5, y: 1 },
  { x: 0.5, y: 1.02 },
  { x: 2, y: 2 },
];

describe("snapPoint", () => {
  test("snaps to a spot inside the distance", () => {
    expect(snapPoint({ x: 2.004, y: 1.998 }, spots, 0.01)).toEqual({ x: 2, y: 2 });
  });

  test("does not snap outside the distance, and returns the same object", () => {
    const p = { x: 2.02, y: 2 };
    expect(snapPoint(p, spots, 0.01)).toBe(p);
  });

  test("picks the nearest of several spots", () => {
    expect(snapPoint({ x: 0.5, y: 1.016 }, spots, 0.05)).toEqual({ x: 0.5, y: 1.02 });
  });

  test("no spots, no snap", () => {
    const p = { x: 1, y: 1 };
    expect(snapPoint(p, [], 1)).toBe(p);
  });

  test("snap distance is half a ball radius", () => {
    expect(snapDistanceFor(0.028)).toBeCloseTo(0.014);
  });
});

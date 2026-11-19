import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { atan2, erf, normalCdf, wrapAngle } from "../src/index";

describe("atan2", () => {
  test("exact quadrant values", () => {
    expect(atan2(0, 1)).toBe(0);
    expect(atan2(1, 0)).toBe(Math.PI / 2);
    expect(atan2(0, -1)).toBe(Math.PI);
    expect(atan2(-1, 0)).toBe(-Math.PI / 2);
    expect(atan2(0, 0)).toBe(0);
    expect(atan2(1, 1)).toBeCloseTo(Math.PI / 4, 15);
    expect(Number.isNaN(atan2(Number.NaN, 1))).toBe(true);
  });

  test("agrees with Math.atan2 to a few ulp everywhere", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        fc.double({ min: -1e3, max: 1e3, noNaN: true }),
        (y, x) => {
          // The zero vector has no direction: this atan2 gives 0, Math.atan2 gives 0 or +-pi
          // by the signs of the zeros (found by a run that drew x = -0, y = 0).
          fc.pre(x !== 0 || y !== 0);
          const want = Math.atan2(y, x);
          const got = atan2(y, x);
          // At the negative x axis Math.atan2 may give -pi for y = -0; both mean the same angle.
          const diff = Math.abs(wrapAngle(got - want));
          // A few ulp: neither function is correctly rounded. 2 million samples found at most
          // 4.44e-16 relative (2 ulp near 1), which the first bound of 4e-16 sometimes caught.
          expect(diff).toBeLessThanOrEqual(1e-15 * Math.max(1, Math.abs(want)));
        },
      ),
      { numRuns: 20_000 },
    );
  });

  test("small and lopsided vectors", () => {
    for (const [y, x] of [
      [1e-300, 1],
      [1, 1e-300],
      [-1e-12, -1],
      [3, -4],
      [-0.41421356, 1],
      [0.41421357, 1],
    ] as const) {
      expect(Math.abs(atan2(y, x) - Math.atan2(y, x))).toBeLessThan(1e-15);
    }
  });
});

describe("wrapAngle", () => {
  test("wraps into (-pi, pi]", () => {
    expect(wrapAngle(Math.PI)).toBe(Math.PI);
    expect(wrapAngle(-Math.PI)).toBe(Math.PI);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(0.5 - 4 * Math.PI)).toBeCloseTo(0.5, 12);
  });
});

describe("normal distribution", () => {
  test("known values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1)).toBeCloseTo(0.8413447, 6);
    expect(normalCdf(-1)).toBeCloseTo(0.1586553, 6);
    expect(normalCdf(1.959964)).toBeCloseTo(0.975, 6);
    expect(normalCdf(5)).toBeCloseTo(1, 6);
    expect(normalCdf(-5)).toBeCloseTo(0, 6);
    expect(erf(0.5)).toBeCloseTo(0.5204999, 6);
  });

  test("rises with z and is symmetric", () => {
    let last = 0;
    for (let z = -6; z <= 6; z += 0.01) {
      const p = normalCdf(z);
      expect(p).toBeGreaterThanOrEqual(last);
      expect(p + normalCdf(-z)).toBeCloseTo(1, 7);
      last = p;
    }
  });
});

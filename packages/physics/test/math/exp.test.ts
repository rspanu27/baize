import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { expNeg } from "../../src/math/exp";

describe("expNeg", () => {
  test("exact and edge values", () => {
    expect(expNeg(0)).toBe(1);
    expect(expNeg(1000)).toBe(0);
    expect(expNeg(Number.POSITIVE_INFINITY)).toBe(0);
    expect(expNeg(-1)).toBeNaN();
    expect(expNeg(Number.NaN)).toBeNaN();
  });

  test("known values", () => {
    expect(expNeg(1)).toBeCloseTo(0.36787944117144233, 15);
    expect(expNeg(Math.LN2)).toBeCloseTo(0.5, 15);
    expect(expNeg(10)).toBeCloseTo(4.5399929762484854e-5, 19);
  });

  test("within 2 ulp of the true value over the range the engine uses", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 60, noNaN: true }), (x) => {
        const want = Math.exp(-x);
        expect(Math.abs(expNeg(x) - want)).toBeLessThanOrEqual(4.5e-16 * want);
      }),
      { numRuns: 2000 },
    );
  });

  test("never increases as x grows, and stays in (0, 1]", () => {
    let last = 1;
    for (let i = 0; i <= 4000; i++) {
      const y = expNeg(i * 0.01);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThanOrEqual(last);
      last = y;
    }
  });

  test("far tail: tiny, positive until underflow, never negative", () => {
    expect(expNeg(700)).toBeGreaterThan(0);
    expect(expNeg(700)).toBeLessThan(1e-300);
    expect(expNeg(745)).toBeGreaterThanOrEqual(0);
  });
});

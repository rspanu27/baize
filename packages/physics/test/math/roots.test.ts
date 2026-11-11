import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { NO_CROSSING, firstDownCrossing } from "../../src/math/roots";
import type { CrossingOptions } from "../../src/math/roots";

const OPTS: CrossingOptions = { closingTol: 1e-9, penetrationTol: 1e-6 };

function f(c: readonly number[], t: number): number {
  const [c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0] = c;
  return c0 + t * (c1 + t * (c2 + t * (c3 + t * c4)));
}

function solve(c: readonly number[], T: number, opts: CrossingOptions = OPTS): number {
  const [c0 = 0, c1 = 0, c2 = 0, c3 = 0, c4 = 0] = c;
  return firstDownCrossing(c0, c1, c2, c3, c4, T, opts);
}

/** Index of the first of N+1 evenly spaced samples on [0, T] that is at or below zero, or -1. */
function firstSampleBelow(c: readonly number[], T: number, N: number): number {
  for (let i = 0; i <= N; i++) {
    if (f(c, (i * T) / N) <= 0) return i;
  }
  return -1;
}

// (t-1)(t-2)(t-3)(t-4): positive on [0,1), negative on (1,2), positive on (2,3), negative on (3,4).
const FOUR_ROOTS = [24, -50, 35, -10, 1];

describe("firstDownCrossing", () => {
  test("finds the first of four roots", () => {
    expect(solve(FOUR_ROOTS, 10)).toBeCloseTo(1, 13);
  });

  test("respects the window", () => {
    expect(solve(FOUR_ROOTS, 0.5)).toBe(NO_CROSSING);
    expect(solve(FOUR_ROOTS, 1)).toBeCloseTo(1, 13);
  });

  test("returns a time on the contact side of the crossing", () => {
    const t = solve(FOUR_ROOTS, 10);
    expect(f(FOUR_ROOTS, t)).toBeLessThanOrEqual(0);
  });

  test("ignores an upward crossing: start below zero and separating", () => {
    // -(t-1)(t-2) = -2 + 3t - t^2 : negative, rises through 0 at 1, falls through 0 at 2.
    expect(solve([-2, 3, -1], 10)).toBeCloseTo(2, 13);
    expect(solve([-2, 3, -1], 1.5)).toBe(NO_CROSSING);
  });

  test("start in contact and closing gives t = 0", () => {
    expect(solve([0, -1, 0], 5)).toBe(0);
    expect(solve([-1e-12, -1, 0], 5)).toBe(0);
  });

  test("resting contact pressed together: event after the penetration bound", () => {
    // f = -t^2 falls 1e-6 below its start at t = 1e-3.
    expect(solve([0, 0, -1], 5)).toBeCloseTo(1e-3, 12);
  });

  test("closing slower than the tolerance is treated as resting contact", () => {
    const t = solve([0, -1e-12, -1], 5);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeCloseTo(1e-3, 9);
  });

  test("grazing contact (double root) counts", () => {
    expect(solve([1, -2, 1], 5)).toBeCloseTo(1, 7);
  });

  test("a near miss does not count", () => {
    expect(solve([1 + 1e-9, -2, 1], 5)).toBe(NO_CROSSING);
  });

  test("degenerate polynomials", () => {
    expect(solve([1, 0, 0, 0, 0], 5)).toBe(NO_CROSSING);
    expect(solve([0, 0, 0, 0, 0], 5)).toBe(NO_CROSSING);
    expect(solve([1, -1], 5)).toBeCloseTo(1, 14);
    expect(solve([1, 0, -1], 5)).toBeCloseTo(1, 14);
    expect(solve([1, 0, 0, -1], 5)).toBeCloseTo(1, 14);
    expect(solve([1, 0, 0, 0, -1], 5)).toBeCloseTo(1, 14);
  });

  test("zero-length window", () => {
    expect(solve([1, -1], 0)).toBe(NO_CROSSING);
    expect(solve([0, -1], 0)).toBe(0);
  });

  test("accept can veto a crossing; the search continues with the next one", () => {
    const t = solve(FOUR_ROOTS, 10, { ...OPTS, accept: (x) => x > 1.5 });
    expect(t).toBeCloseTo(3, 12);
    expect(solve(FOUR_ROOTS, 10, { ...OPTS, accept: () => false })).toBe(NO_CROSSING);
  });

  test("a vetoed start contact does not come back as a penetration event", () => {
    expect(solve([0, -1, 0], 5, { ...OPTS, accept: () => false })).toBe(NO_CROSSING);
  });

  test("tiny and huge time scales", () => {
    // (t - 1e-7)(t - 1) and (t - 500)(t - 1000)
    const tiny = solve([1e-7, -(1 + 1e-7), 1], 2, { closingTol: 1e-9, penetrationTol: 1e-12 });
    expect(Math.abs(tiny - 1e-7) / 1e-7).toBeLessThan(1e-8);
    expect(solve([500000, -1500, 1], 2000)).toBeCloseTo(500, 9);
  });

  test("is deterministic", () => {
    const c = [0.37, -1.9, 2.2, -0.71, 0.05];
    expect(solve(c, 7)).toBe(solve(c, 7));
  });

  test("agrees with dense sampling on random quartics", () => {
    const coef = fc.double({ min: -5, max: 5, noNaN: true });
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 5, noNaN: true }),
        coef,
        coef,
        coef,
        coef,
        fc.double({ min: 0.05, max: 6, noNaN: true }),
        (c0, c1, c2, c3, c4, T) => {
          const c = [c0, c1, c2, c3, c4];
          const t = solve(c, T);
          const N = 4000;
          const firstBelow = firstSampleBelow(c, T, N);
          if (t === NO_CROSSING) {
            expect(firstBelow).toBe(-1);
          } else {
            expect(t).toBeGreaterThan(0);
            expect(t).toBeLessThanOrEqual(T);
            const a = Math.abs;
            const scale = a(c0) + T * (a(c1) + T * (a(c2) + T * (a(c3) + T * a(c4))));
            expect(Math.abs(f(c, t))).toBeLessThan(1e-9 * scale);
            // No sample before the reported time may be at or below zero.
            if (firstBelow !== -1) expect((firstBelow * T) / N).toBeGreaterThanOrEqual(t - 1e-12);
          }
        },
      ),
      { numRuns: 3000 },
    );
  });

  test("agrees with dense sampling on random relative-motion quartics", () => {
    // Gap between two balls with constant accelerations: |c + b t + a t^2|^2 - D^2.
    const comp = fc.double({ min: -3, max: 3, noNaN: true });
    fc.assert(
      fc.property(comp, comp, comp, comp, comp, comp, (ax, ay, bx, by, cx, cy) => {
        const D = 0.0525;
        fc.pre(cx * cx + cy * cy > D * D * 1.01);
        const c = [
          cx * cx + cy * cy - D * D,
          2 * (bx * cx + by * cy),
          bx * bx + by * by + 2 * (ax * cx + ay * cy),
          2 * (ax * bx + ay * by),
          ax * ax + ay * ay,
        ];
        const T = 3;
        const t = solve(c, T);
        const N = 6000;
        const firstBelow = firstSampleBelow(c, T, N);
        if (t === NO_CROSSING) {
          expect(firstBelow).toBe(-1);
        } else {
          const gap = Math.sqrt(Math.max(0, f(c, t) + D * D)) - D;
          expect(Math.abs(gap)).toBeLessThan(1e-11);
          if (firstBelow !== -1) expect((firstBelow * T) / N).toBeGreaterThanOrEqual(t - 1e-12);
        }
      }),
      { numRuns: 3000 },
    );
  });
});

describe("contact tolerance", () => {
  test("a gap within the tolerance counts as touching: closing collides at once", () => {
    // Gap of 1e-7 with tolerance 1e-6, closing at 1: no need to wait for the gap to close.
    expect(solve([1e-7, -1, 0], 5)).toBe(0);
  });

  test("leaving contact by less than the tolerance and coming back is still resting contact", () => {
    // Starts at +1e-9 moving away at 1e-6, pulled back at 2 per s^2: peaks at about 1.25e-12
    // above its start, far inside the tolerance, so it only counts once it has pressed in.
    const t = solve([1e-9, 1e-6, -1], 5);
    expect(t).toBeGreaterThan(5e-4);
    expect(t).toBeCloseTo(1e-3, 5);
  });

  test("a real separation followed by a return is an ordinary collision", () => {
    // Rises to 0.25 (far above the tolerance), then falls through zero at t = 1.
    expect(solve([0, 1, -1], 5)).toBeCloseTo(1, 12);
  });
});

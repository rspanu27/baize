import fc from "fast-check";
import { expect, test } from "vitest";
import { quadraticRoots } from "../../src/math/quadratic";

test("two roots in ascending order", () => {
  const out = [0, 0];
  expect(quadraticRoots(1, -3, 2, out)).toBe(2);
  expect(out).toEqual([1, 2]);
  expect(quadraticRoots(-1, 3, -2, out)).toBe(2);
  expect(out).toEqual([1, 2]);
});

test("double root, no root, linear and degenerate cases", () => {
  const out = [0, 0];
  expect(quadraticRoots(1, -2, 1, out)).toBe(1);
  expect(out[0]).toBe(1);
  expect(quadraticRoots(1, 0, 1, out)).toBe(0);
  expect(quadraticRoots(0, 2, -4, out)).toBe(1);
  expect(out[0]).toBe(2);
  expect(quadraticRoots(0, 0, 5, out)).toBe(0);
  expect(quadraticRoots(0, 0, 0, out)).toBe(0);
});

test("no catastrophic cancellation when b^2 >> 4ac", () => {
  const out = [0, 0];
  expect(quadraticRoots(1, -1e8, 1, out)).toBe(2);
  expect(Math.abs((out[0] as number) - 1e-8) / 1e-8).toBeLessThan(1e-12);
  expect(Math.abs((out[1] as number) - 1e8) / 1e8).toBeLessThan(1e-12);
});

test("roots built from factors are recovered", () => {
  fc.assert(
    fc.property(
      fc.double({ min: -100, max: 100, noNaN: true }),
      fc.double({ min: -100, max: 100, noNaN: true }),
      fc.double({ min: 0.01, max: 100, noNaN: true }),
      (r1, r2, a) => {
        fc.pre(Math.abs(r1 - r2) > 1e-3);
        const out = [0, 0];
        const n = quadraticRoots(a, -a * (r1 + r2), a * r1 * r2, out);
        expect(n).toBe(2);
        expect(out[0]).toBeCloseTo(Math.min(r1, r2), 6);
        expect(out[1]).toBeCloseTo(Math.max(r1, r2), 6);
      },
    ),
  );
});

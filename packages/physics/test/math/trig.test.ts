import fc from "fast-check";
import { expect, test } from "vitest";
import { sinCos } from "../../src/math/trig";

test("exact values at multiples of pi/2", () => {
  expect(sinCos(0)).toEqual({ sin: 0, cos: 1 });
  const q = sinCos(Math.PI / 2);
  expect(q.sin).toBe(1);
  expect(Math.abs(q.cos)).toBeLessThan(1e-16);
  const h = sinCos(Math.PI);
  expect(h.cos).toBe(-1);
  expect(Math.abs(h.sin)).toBeLessThan(2e-16);
});

test("matches the platform functions to within 1e-15 over a wide range", () => {
  fc.assert(
    fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (x) => {
      const { sin, cos } = sinCos(x);
      expect(Math.abs(sin - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(cos - Math.cos(x))).toBeLessThan(1e-15);
    }),
    { numRuns: 5000 },
  );
});

test("result is a unit vector to within rounding", () => {
  for (let i = -720; i <= 720; i++) {
    const { sin, cos } = sinCos((i * Math.PI) / 360);
    expect(Math.abs(sin * sin + cos * cos - 1)).toBeLessThan(4e-16);
  }
});

test("non-finite input gives NaN", () => {
  expect(sinCos(Number.NaN).sin).toBeNaN();
  expect(sinCos(Number.POSITIVE_INFINITY).cos).toBeNaN();
});

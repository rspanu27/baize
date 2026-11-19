import { expNeg } from "@baize/physics";

/**
 * Deterministic maths for the planner.
 *
 * Like the physics, the planner must give the same route on every machine, so it uses only
 * `+ - * /`, `Math.sqrt` and comparisons, which IEEE 754 specifies exactly, plus the physics
 * package's own `sinCos` and `expNeg`. `Math.atan2` and `Math.exp` may differ between
 * JavaScript engines in the last bit, which could flip a close choice between two shots.
 */

const PI = Math.PI;
const PI_2 = PI / 2;
const PI_4 = PI / 4;
/** tan(pi/8) = sqrt(2) - 1. */
const TAN_PI_8 = Math.SQRT2 - 1;

/** atan(v) for |v| <= 0.2, by its Taylor series (error below 1e-17 there). */
function atanSmall(v: number): number {
  const z = v * v;
  let p = 0;
  for (let n = 27; n >= 3; n -= 2) p = (n % 4 === 1 ? 1 / n : -1 / n) + z * p;
  return v + v * z * p;
}

/** atan(t) for 0 <= t <= 1. */
function atanUnit(t: number): number {
  // Above tan(pi/8), atan(t) = pi/4 + atan((t - 1) / (t + 1)), which lands within tan(pi/8).
  let base = 0;
  let u = t;
  if (t > TAN_PI_8) {
    base = PI_4;
    u = (t - 1) / (t + 1);
  }
  // Halve the angle once: atan(u) = 2 atan(u / (1 + sqrt(1 + u^2))), |result| <= 0.199.
  const v = u / (1 + Math.sqrt(1 + u * u));
  return base + 2 * atanSmall(v);
}

/**
 * The angle of the vector (x, y), counter-clockwise from +x, in (-pi, pi]; 0 for (0, 0).
 * Bit-identical on every engine; within a few ulp of `Math.atan2`.
 */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax === 0 && ay === 0) return 0;
  let a: number;
  if (ay <= ax) {
    a = atanUnit(ay / ax);
  } else {
    a = PI_2 - atanUnit(ax / ay);
  }
  if (x < 0) a = PI - a;
  return y < 0 ? -a : a;
}

/** The angle a, wrapped into (-pi, pi]. */
export function wrapAngle(a: number): number {
  let r = a;
  const twoPi = 2 * PI;
  while (r > PI) r -= twoPi;
  while (r <= -PI) r += twoPi;
  return r;
}

// Abramowitz and Stegun 7.1.26: erf(x) for x >= 0 with an absolute error below 1.5e-7, which is
// far below anything a pot chance needs.
const ERF_P = 0.3275911;
const ERF_A = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429] as const;

/** erf(x), to 1.5e-7. */
export function erf(x: number): number {
  const ax = Math.abs(x);
  const t = 1 / (1 + ERF_P * ax);
  let poly = 0;
  for (let i = ERF_A.length - 1; i >= 0; i--) poly = (poly + (ERF_A[i] as number)) * t;
  const y = 1 - poly * expNeg(ax * ax);
  return x < 0 ? -y : y;
}

/** The standard normal distribution function, Phi(z) = P(Z <= z), to 1e-7. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Deterministic sine and cosine.
 *
 * `Math.sin` and `Math.cos` are not required to be correctly rounded and differ between
 * JavaScript engines in the last bit. The simulator must give bit-identical results everywhere,
 * so angles entering the engine go through this implementation, which uses only
 * `+ - * /`, `Math.round` and comparisons, all of which are exactly specified by IEEE 754.
 *
 * Accuracy is about 1 ulp for |angle| up to about 1e5 rad, which is far beyond any aim angle.
 */

// pi/2 split in two parts (Cody-Waite): HI has its low bits clear so k * HI is exact for
// |k| < 2^20, LO holds the remainder. HI + LO = 1.57079632679489661923...
const PIO2_HI = 1.5707963267341256;
const PIO2_LO = 6.077100506506192e-11;
const TWO_OVER_PI = 0.6366197723675814;

// Taylor coefficients 1/n!, built by exact-rounded divisions so there are no hand-typed digits.
function inverseFactorials(count: number): number[] {
  const out: number[] = [1];
  let f = 1;
  for (let n = 1; n < count; n++) {
    f *= n;
    out.push(1 / f);
  }
  return out;
}
const INV_FACT = inverseFactorials(21);

function coefficient(n: number): number {
  const c = INV_FACT[n];
  if (c === undefined) throw new Error("trig coefficient out of range");
  return c;
}
const S3 = coefficient(3);
const S5 = coefficient(5);
const S7 = coefficient(7);
const S9 = coefficient(9);
const S11 = coefficient(11);
const S13 = coefficient(13);
const S15 = coefficient(15);
const S17 = coefficient(17);
const C2 = coefficient(2);
const C4 = coefficient(4);
const C6 = coefficient(6);
const C8 = coefficient(8);
const C10 = coefficient(10);
const C12 = coefficient(12);
const C14 = coefficient(14);
const C16 = coefficient(16);
const C18 = coefficient(18);

/** sin(r) for |r| <= pi/4. */
function kernelSin(r: number): number {
  const z = r * r;
  const p =
    z * (-S3 + z * (S5 + z * (-S7 + z * (S9 + z * (-S11 + z * (S13 + z * (-S15 + z * S17)))))));
  return r + r * p;
}

/** cos(r) for |r| <= pi/4. */
function kernelCos(r: number): number {
  const z = r * r;
  const p =
    z *
    (-C2 +
      z * (C4 + z * (-C6 + z * (C8 + z * (-C10 + z * (C12 + z * (-C14 + z * (C16 - z * C18))))))));
  return 1 + p;
}

export interface SinCos {
  readonly sin: number;
  readonly cos: number;
}

/** Sine and cosine of `angleRad`, bit-identical on every JavaScript engine. */
export function sinCos(angleRad: number): SinCos {
  if (!Number.isFinite(angleRad)) return { sin: Number.NaN, cos: Number.NaN };
  const k = Math.round(angleRad * TWO_OVER_PI);
  const r = angleRad - k * PIO2_HI - k * PIO2_LO;
  const s = kernelSin(r);
  const c = kernelCos(r);
  // k mod 4, correct for negative k.
  const q = ((k % 4) + 4) % 4;
  if (q === 0) return { sin: s, cos: c };
  if (q === 1) return { sin: c, cos: -s };
  if (q === 2) return { sin: -s, cos: -c };
  return { sin: -c, cos: s };
}

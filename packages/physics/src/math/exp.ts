/**
 * Deterministic exponential decay, exp(-x) for x >= 0.
 *
 * `Math.exp` is not required to be correctly rounded and differs between JavaScript engines in
 * the last bit. Like `sinCos`, this uses only `+ - * /`, `Math.round` and comparisons, so the
 * result is bit-identical everywhere. Accuracy is about 1 ulp.
 */

// ln 2 split in two parts (Cody-Waite, the fdlibm constants): HI has its low bits clear so
// k * HI is exact for the k used here. HI + LO = 0.693147180559945309417...
const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;

/** exp(-x) is below the smallest double beyond this. */
const UNDERFLOW_X = 745.2;

// 1/n! built by exact-rounded divisions so there are no hand-typed digits.
const INV_FACT: readonly number[] = (() => {
  const out: number[] = [1];
  let f = 1;
  for (let n = 1; n <= 14; n++) {
    f *= n;
    out.push(1 / f);
  }
  return out;
})();

/** exp(r) for |r| <= ln(2)/2, by its Taylor series to degree 14 (error below 1e-18). */
function kernelExp(r: number): number {
  let p = 0;
  for (let n = 14; n >= 1; n--) p = (p + (INV_FACT[n] as number)) * r;
  return 1 + p;
}

/** exp(-x) for x >= 0, bit-identical on every JavaScript engine. NaN for anything else. */
export function expNeg(x: number): number {
  if (!(x >= 0)) return Number.NaN;
  if (x > UNDERFLOW_X) return 0;
  const k = Math.round(x * INV_LN2);
  // -x = -k ln2 + r, with |r| <= ln(2)/2.
  const r = -(x - k * LN2_HI - k * LN2_LO);
  let result = kernelExp(r);
  // Times 2^-k: halving is exact until the result becomes subnormal.
  for (let i = 0; i < k; i++) result *= 0.5;
  return result;
}

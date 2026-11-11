/**
 * Real roots of a*x^2 + b*x + c = 0, written into `out` in ascending order.
 * Returns the number of roots (0, 1 or 2). Handles a = 0 (linear) and a = b = 0 (no roots,
 * even when c = 0: an identically zero polynomial has no isolated root).
 *
 * Uses the cancellation-free form: q = -(b + sign(b) * sqrt(disc)) / 2, roots q/a and c/q.
 */
export function quadraticRoots(a: number, b: number, c: number, out: number[]): number {
  if (a === 0) {
    if (b === 0) return 0;
    out[0] = -c / b;
    return 1;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return 0;
  if (disc === 0) {
    out[0] = -b / (2 * a);
    return 1;
  }
  const sq = Math.sqrt(disc);
  const q = b >= 0 ? -(b + sq) / 2 : -(b - sq) / 2;
  const r1 = q / a;
  // q is zero only when b = 0 and disc = 0, which was handled above.
  const r2 = c / q;
  if (r1 <= r2) {
    out[0] = r1;
    out[1] = r2;
  } else {
    out[0] = r2;
    out[1] = r1;
  }
  return 2;
}

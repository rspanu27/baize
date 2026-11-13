import type { Mat3 } from "../types";

/**
 * Solves A x = b for a small dense system by Gaussian elimination with partial pivoting.
 * `a` is row-major, n x n, and is not changed. Returns undefined when the system is singular.
 */
export function solveLinear(a: readonly number[], b: readonly number[]): number[] | undefined {
  const n = b.length;
  const m: number[] = [...a];
  const x: number[] = [...b];
  let scale = 0;
  for (const v of m) scale = Math.max(scale, Math.abs(v));
  if (!(scale > 0)) return undefined;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row * n + col] as number) > Math.abs(m[pivot * n + col] as number))
        pivot = row;
    }
    const p = m[pivot * n + col] as number;
    if (Math.abs(p) < 1e-13 * scale) return undefined;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = m[col * n + k] as number;
        m[col * n + k] = m[pivot * n + k] as number;
        m[pivot * n + k] = t;
      }
      const t = x[col] as number;
      x[col] = x[pivot] as number;
      x[pivot] = t;
    }
    for (let row = col + 1; row < n; row++) {
      const f = (m[row * n + col] as number) / p;
      if (f === 0) continue;
      for (let k = col; k < n; k++)
        m[row * n + k] = (m[row * n + k] as number) - f * (m[col * n + k] as number);
      x[row] = (x[row] as number) - f * (x[col] as number);
    }
  }
  for (let row = n - 1; row >= 0; row--) {
    let sum = x[row] as number;
    for (let k = row + 1; k < n; k++) sum -= (m[row * n + k] as number) * (x[k] as number);
    x[row] = sum / (m[row * n + row] as number);
  }
  return x;
}

export function multiply3(a: Mat3, b: Mat3): Mat3 {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(
        (a[r * 3] as number) * (b[c] as number) +
          (a[r * 3 + 1] as number) * (b[3 + c] as number) +
          (a[r * 3 + 2] as number) * (b[6 + c] as number),
      );
    }
  }
  return out as unknown as Mat3;
}

export function determinant3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** Inverse of a 3 x 3 matrix, or undefined when it has none. */
export function invert3(m: Mat3): Mat3 | undefined {
  const det = determinant3(m);
  let scale = 0;
  for (const v of m) scale = Math.max(scale, Math.abs(v));
  if (!(Math.abs(det) > 1e-13 * scale * scale * scale)) return undefined;
  const d = 1 / det;
  return [
    (m[4] * m[8] - m[5] * m[7]) * d,
    (m[2] * m[7] - m[1] * m[8]) * d,
    (m[1] * m[5] - m[2] * m[4]) * d,
    (m[5] * m[6] - m[3] * m[8]) * d,
    (m[0] * m[8] - m[2] * m[6]) * d,
    (m[2] * m[3] - m[0] * m[5]) * d,
    (m[3] * m[7] - m[4] * m[6]) * d,
    (m[1] * m[6] - m[0] * m[7]) * d,
    (m[0] * m[4] - m[1] * m[3]) * d,
  ];
}

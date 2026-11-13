import type { ImagePoint, Mat3, TableCorners, TablePoint } from "../types";
import { invert3, solveLinear } from "./linear";

/**
 * The homography of the cloth plane: the 3 x 3 matrix H with
 *   (u, v, 1) ~ H (x, y, 1)
 * for a point (x, y) on the cloth (z = 0) and its place (u, v) in the photo.
 *
 * Four point pairs fix it exactly: each pair gives two linear equations in the eight unknown
 * entries (the ninth is set to 1). Image coordinates are scaled to about 1 first so that the
 * system is well conditioned for photos of any size.
 */
export function homographyFromCorners(
  corners: TableCorners,
  widthM: number,
  lengthM: number,
): Mat3 | undefined {
  const table: TablePoint[] = [
    { x: 0, y: 0 },
    { x: widthM, y: 0 },
    { x: widthM, y: lengthM },
    { x: 0, y: lengthM },
  ];
  let size = 0;
  for (const c of corners) size = Math.max(size, Math.abs(c.u), Math.abs(c.v));
  if (!(size > 0) || !Number.isFinite(size) || !(widthM > 0) || !(lengthM > 0)) return undefined;
  // Table coordinates in units of the table length, image coordinates in units of `size`.
  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const p = table[i] as TablePoint;
    const c = corners[i] as ImagePoint;
    const x = p.x / lengthM;
    const y = p.y / lengthM;
    const u = c.u / size;
    const v = c.v / size;
    a.push(x, y, 1, 0, 0, 0, -u * x, -u * y);
    b.push(u);
    a.push(0, 0, 0, x, y, 1, -v * x, -v * y);
    b.push(v);
  }
  const h = solveLinear(a, b);
  if (!h) return undefined;
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  // Undo the scaling: H = S_image * Hn * S_table^-1.
  return [
    (size * h0) / lengthM,
    (size * h1) / lengthM,
    size * h2,
    (size * h3) / lengthM,
    (size * h4) / lengthM,
    size * h5,
    h6 / lengthM,
    h7 / lengthM,
    1,
  ];
}

/** Where a point of the cloth is in the photo. */
export function tableToImage(h: Mat3, p: TablePoint): ImagePoint {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  return { u: (h[0] * p.x + h[1] * p.y + h[2]) / w, v: (h[3] * p.x + h[4] * p.y + h[5]) / w };
}

/** Where a point of the photo is on the cloth, taking it to lie in the cloth plane. */
export function imageToTable(hInverse: Mat3, p: ImagePoint): TablePoint {
  const w = hInverse[6] * p.u + hInverse[7] * p.v + hInverse[8];
  return {
    x: (hInverse[0] * p.u + hInverse[1] * p.v + hInverse[2]) / w,
    y: (hInverse[3] * p.u + hInverse[4] * p.v + hInverse[5]) / w,
  };
}

export function invertHomography(h: Mat3): Mat3 | undefined {
  return invert3(h);
}

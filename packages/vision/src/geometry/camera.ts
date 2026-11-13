import type { Camera, ImagePoint, Mat3, TablePoint } from "../types";

/**
 * Recovering the camera from the homography of the cloth.
 *
 * Pinhole camera with square pixels and its principal point at the middle of the photo:
 *   (u - cx, v - cy, f) ~ R X + t          (camera axes: x right, y down, z forward)
 * For points on the cloth (z = 0) this is the homography H = K [r1 r2 t] up to scale, where
 * r1 and r2 are the first two columns of R and K = diag(f, f, 1) after moving the origin to
 * the principal point. Writing the columns of the shifted H as h1 = (a1, b1, c1) and
 * h2 = (a2, b2, c2), the two facts "r1 and r2 are perpendicular" and "r1 and r2 are equally
 * long" give two equations for f^2:
 *   f^2 c1 c2          = -(a1 a2 + b1 b2)
 *   f^2 (c1^2 - c2^2)  = (a2^2 + b2^2) - (a1^2 + b1^2)
 * They are solved together by least squares. When the camera looks straight down, c1 and c2
 * vanish and the photo does not say what f is; a typical phone value is assumed then.
 *
 * Why the camera is needed at all: a ball's centre is one radius above the cloth, so mapping
 * its place in the photo with H alone puts it too far from the camera (by height / camera
 * height of the distance, several centimetres at the far end). With the camera known, the
 * ray through the ball's image is cut with the plane at the height of the ball's centre.
 */

/**
 * Focal length assumed when the photo does not determine it, as a fraction of the longer side
 * of the photo. A phone's main camera is about 26 mm in 35 mm terms, and 26 / 36 = 0.72.
 */
export const ASSUMED_FOCAL_PER_LONG_SIDE = 0.72;

/** Below this share of the largest term the focal-length equations are taken as degenerate. */
const FOCAL_DEGENERATE = 1e-6;

function cross(a: readonly number[], b: readonly number[]): [number, number, number] {
  return [
    (a[1] as number) * (b[2] as number) - (a[2] as number) * (b[1] as number),
    (a[2] as number) * (b[0] as number) - (a[0] as number) * (b[2] as number),
    (a[0] as number) * (b[1] as number) - (a[1] as number) * (b[0] as number),
  ];
}

function norm(a: readonly number[]): number {
  return Math.sqrt(
    (a[0] as number) * (a[0] as number) +
      (a[1] as number) * (a[1] as number) +
      (a[2] as number) * (a[2] as number),
  );
}

/**
 * The camera behind a homography of the cloth, for a photo of the given size. Returns
 * undefined when the homography does not come from a camera above the cloth looking at it
 * (for example when the corners were given in the wrong order).
 */
export function cameraFromHomography(
  h: Mat3,
  widthPx: number,
  heightPx: number,
): Camera | undefined {
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  // Columns of H with the image origin moved to the principal point.
  const col = (k: 0 | 1 | 2): [number, number, number] => {
    const top = h[k] as number;
    const middle = h[3 + k] as number;
    const bottom = h[6 + k] as number;
    return [top - cx * bottom, middle - cy * bottom, bottom];
  };
  const [a1, b1, c1] = col(0);
  const [a2, b2, c2] = col(1);

  const d1 = c1 * c2;
  const n1 = -(a1 * a2 + b1 * b2);
  const d2 = c1 * c1 - c2 * c2;
  const n2 = a2 * a2 + b2 * b2 - (a1 * a1 + b1 * b1);
  const longSide = Math.max(widthPx, heightPx);
  // Compare the tilt terms (c * pixels) with the in-plane terms to see if f is determined.
  const inPlane = a1 * a1 + b1 * b1 + a2 * a2 + b2 * b2;
  const tilt = (c1 * c1 + c2 * c2) * longSide * longSide;
  let focalSq = (n1 * d1 + n2 * d2) / (d1 * d1 + d2 * d2);
  let focalSource: Camera["focalSource"] = "estimated";
  // Residual of the two equations at the least-squares answer, relative to their size.
  const e1 = n1 - focalSq * d1;
  const e2 = n2 - focalSq * d2;
  let focalMisfit = Math.sqrt((e1 * e1 + e2 * e2) / (n1 * n1 + n2 * n2 + 1e-300));
  const determined = tilt > FOCAL_DEGENERATE * inPlane;
  if (!determined || !(focalSq > 0) || !Number.isFinite(focalSq)) {
    focalSq = ASSUMED_FOCAL_PER_LONG_SIDE * longSide * (ASSUMED_FOCAL_PER_LONG_SIDE * longSide);
    focalSource = "assumed";
    // Looking straight down says nothing either way. A view that should determine the focal
    // length but gives an impossible one means the corners are not those of this rectangle.
    focalMisfit = determined ? 1 : 0;
  }
  const f = Math.sqrt(focalSq);

  // K^-1 h for each column, then the scale that makes r1 and r2 unit vectors.
  const k1 = [a1 / f, b1 / f, c1];
  const k2 = [a2 / f, b2 / f, c2];
  const [a3, b3, c3] = col(2);
  const k3 = [a3 / f, b3 / f, c3];
  const l1 = norm(k1);
  const l2 = norm(k2);
  if (!(l1 > 0) || !(l2 > 0)) return undefined;
  let scale = 2 / (l1 + l2);
  // The table must be in front of the camera.
  if (k3[2] !== undefined && k3[2] * scale < 0) scale = -scale;
  let r1 = k1.map((v) => (v / l1) * Math.sign(scale));
  const r2raw = k2.map((v) => (v / l2) * Math.sign(scale));
  // Make r2 exactly perpendicular to r1 (they are, up to error in the corners).
  const dot =
    (r1[0] as number) * (r2raw[0] as number) +
    (r1[1] as number) * (r2raw[1] as number) +
    (r1[2] as number) * (r2raw[2] as number);
  let r2 = r2raw.map((v, i) => v - dot * (r1[i] as number));
  const l2b = norm(r2);
  if (!(l2b > 0)) return undefined;
  r2 = r2.map((v) => v / l2b);
  r1 = r1.map((v) => v / norm(r1));
  const r3 = cross(r1, r2);
  const t = k3.map((v) => v * scale);

  // Camera position: C = -R^T t.
  const position = {
    x: -(
      (r1[0] as number) * (t[0] as number) +
      (r1[1] as number) * (t[1] as number) +
      (r1[2] as number) * (t[2] as number)
    ),
    y: -(
      (r2[0] as number) * (t[0] as number) +
      (r2[1] as number) * (t[1] as number) +
      (r2[2] as number) * (t[2] as number)
    ),
    z: -(r3[0] * (t[0] as number) + r3[1] * (t[1] as number) + r3[2] * (t[2] as number)),
  };
  // Above the cloth, with the table in front of it, and finite.
  if (!(position.z > 0) || !((t[2] as number) > 0)) return undefined;
  if (![position.x, position.y, position.z, f].every(Number.isFinite)) return undefined;

  const rotation: Mat3 = [
    r1[0] as number,
    r2[0] as number,
    r3[0],
    r1[1] as number,
    r2[1] as number,
    r3[1],
    r1[2] as number,
    r2[2] as number,
    r3[2],
  ];
  return { focalPx: f, focalSource, focalMisfit, centre: { u: cx, v: cy }, rotation, position };
}

/** Where a point in space (table coordinates, `z` up from the cloth) appears in the photo. */
export function projectPoint(
  camera: Camera,
  p: { x: number; y: number; z: number },
): ImagePoint | undefined {
  const r = camera.rotation;
  const dx = p.x - camera.position.x;
  const dy = p.y - camera.position.y;
  const dz = p.z - camera.position.z;
  const xc = r[0] * dx + r[1] * dy + r[2] * dz;
  const yc = r[3] * dx + r[4] * dy + r[5] * dz;
  const zc = r[6] * dx + r[7] * dy + r[8] * dz;
  if (!(zc > 0)) return undefined;
  return {
    u: camera.centre.u + (camera.focalPx * xc) / zc,
    v: camera.centre.v + (camera.focalPx * yc) / zc,
  };
}

/**
 * The point at height `heightM` above the cloth that is seen at `p` in the photo: the ray
 * from the camera through `p`, cut with the horizontal plane at that height. Used with the
 * ball radius as the height to place a ball from the image of its centre. Returns undefined
 * when the ray does not come down to that plane (the point is at or above the horizon).
 */
export function imageToTableAtHeight(
  camera: Camera,
  p: ImagePoint,
  heightM: number,
): TablePoint | undefined {
  const r = camera.rotation;
  // Ray direction in camera coordinates, turned into table coordinates (R^T d).
  const xc = (p.u - camera.centre.u) / camera.focalPx;
  const yc = (p.v - camera.centre.v) / camera.focalPx;
  const dx = r[0] * xc + r[3] * yc + r[6];
  const dy = r[1] * xc + r[4] * yc + r[7];
  const dz = r[2] * xc + r[5] * yc + r[8];
  const drop = heightM - camera.position.z;
  if (!(dz < 0) || !(drop < 0)) return undefined;
  const s = drop / dz;
  return { x: camera.position.x + s * dx, y: camera.position.y + s * dy };
}

/** Radius in pixels at which a ball of radius `radiusM`, centred at `p`, appears (roughly). */
export function apparentRadiusPx(
  camera: Camera,
  p: { x: number; y: number; z: number },
  radiusM: number,
): number | undefined {
  const r = camera.rotation;
  const zc =
    r[6] * (p.x - camera.position.x) +
    r[7] * (p.y - camera.position.y) +
    r[8] * (p.z - camera.position.z);
  return zc > 0 ? (camera.focalPx * radiusM) / zc : undefined;
}

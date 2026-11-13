import type { Camera, ImagePoint, Mat3, TableCorners } from "../src/index";
import { projectPoint } from "../src/index";

/** Test helper: a camera built from where it stands and what it looks at. */
export interface Pose {
  /** Camera position in table coordinates, metres. */
  position: { x: number; y: number; z: number };
  /** Point on the cloth the camera looks at. */
  target: { x: number; y: number };
  /** Roll about the viewing direction, radians. */
  rollRad: number;
  focalPx: number;
  widthPx: number;
  heightPx: number;
}

function normalise(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** The true camera for a pose (camera axes: x right, y down, z forward). */
export function cameraOf(pose: Pose): Camera {
  const forward = normalise([
    pose.target.x - pose.position.x,
    pose.target.y - pose.position.y,
    -pose.position.z,
  ]);
  // Looking straight down has no "up"; take the table's y axis as up in the picture then.
  const up: [number, number, number] = Math.abs(forward[2]) > 0.999999 ? [0, 1, 0] : [0, 0, 1];
  let right = normalise(cross(forward, up));
  let down = cross(forward, right);
  const c = Math.cos(pose.rollRad);
  const s = Math.sin(pose.rollRad);
  const r2: [number, number, number] = [
    c * right[0] + s * down[0],
    c * right[1] + s * down[1],
    c * right[2] + s * down[2],
  ];
  const d2: [number, number, number] = [
    -s * right[0] + c * down[0],
    -s * right[1] + c * down[1],
    -s * right[2] + c * down[2],
  ];
  right = r2;
  down = d2;
  const rotation: Mat3 = [
    right[0],
    right[1],
    right[2],
    down[0],
    down[1],
    down[2],
    forward[0],
    forward[1],
    forward[2],
  ];
  return {
    focalPx: pose.focalPx,
    focalSource: "estimated",
    focalMisfit: 0,
    centre: { u: pose.widthPx / 2, v: pose.heightPx / 2 },
    rotation,
    position: pose.position,
  };
}

/** Where the four corners of a W x L playing area appear to a camera. */
export function cornersSeen(camera: Camera, widthM: number, lengthM: number): TableCorners {
  const at = (x: number, y: number): ImagePoint => {
    const p = projectPoint(camera, { x, y, z: 0 });
    if (!p) throw new Error("a corner is behind the camera");
    return p;
  };
  return [at(0, 0), at(widthM, 0), at(widthM, lengthM), at(0, lengthM)];
}

/** A small repeatable random number generator (mulberry32), for noise in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

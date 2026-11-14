import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";

/**
 * Types of the photo import. Image points are pixels: `u` to the right, `v` down, origin at
 * the top-left corner of the photo. Table points are metres in table coordinates, `z` up from
 * the cloth.
 */

export interface ImagePoint {
  u: number;
  v: number;
}

export interface TablePoint {
  x: number;
  y: number;
}

/** A photo as pixels in memory: RGBA, row by row from the top. Never stored by this package. */
export interface PhotoImage {
  widthPx: number;
  heightPx: number;
  data: Uint8ClampedArray;
}

/**
 * The four corners of the playing area (the cushion-nose rectangle) in the photo, in this
 * order: (0, 0) baulk left, (W, 0) baulk right, (W, L) top right, (0, L) top left. A corner
 * may lie outside the photo.
 */
export type TableCorners = readonly [ImagePoint, ImagePoint, ImagePoint, ImagePoint];

/** A 3 x 3 matrix, row by row. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** Where the camera was and how it looked at the table, recovered from the four corners. */
export interface Camera {
  /** Focal length in pixels. */
  focalPx: number;
  /** "estimated" from the corners, or "assumed" when the view does not determine it. */
  focalSource: "estimated" | "assumed";
  /**
   * How badly the two equations for the focal length disagree, from 0 (they agree: the
   * corners are those of a rectangle of the stated size) towards 1. Used to tell which pair
   * of sides of a found quadrilateral are the long ones. 0 when the camera looks straight
   * down (nothing can be said), 1 when the corners give an impossible focal length.
   */
  focalMisfit: number;
  /** Principal point (the middle of the photo). */
  centre: ImagePoint;
  /** Rotation from table to camera coordinates (camera: x right, y down, z forward). */
  rotation: Mat3;
  /** Camera position in table coordinates, metres; `z` is its height above the cloth. */
  position: { x: number; y: number; z: number };
}

export type ImportProblem =
  /** The corners do not describe a table seen from above the cloth (wrong order, or folded). */
  | "corners-invalid"
  /** No table was found in the photo; the corners must be placed by hand. */
  | "table-not-found";

export interface ImportDiagnostics {
  /** True when the corners were found automatically, false when they were given. */
  cornersDetected: boolean;
  camera?: Camera;
  /** Milliseconds per stage, for the speed target. */
  timingsMs: Record<string, number>;
}

export interface ImportResult {
  problem?: ImportProblem;
  corners?: TableCorners;
  /** Balls found, with confidences; empty when there is a problem. */
  layout: Layout;
  diagnostics: ImportDiagnostics;
}

export interface ImportOptions {
  /** Corners placed by the person; skips the automatic table finder. */
  corners?: TableCorners;
  /**
   * Height above the cloth of the corners (the cushion noses) and of the cushion tops and
   * rails. Default: the nose height of the table. 0 is for pictures in which the cushions
   * are drawn flat on the cloth, as the test renderer draws them.
   */
  cornerHeightM?: number;
}

/** The contract of the whole pipeline (implemented in later tasks). */
export type ImportPhoto = (
  image: PhotoImage,
  table: TableSpec,
  ballSet: BallSetSpec,
  options?: ImportOptions,
) => ImportResult;

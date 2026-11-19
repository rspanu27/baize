/**
 * The one place that turns table coordinates into screen coordinates and back.
 *
 * Table: metres, origin at the head/baulk-end left corner of the playing area, x across the
 * width (0..widthM), y along the length (0..lengthM), y increasing away from the head end.
 * Screen: y down. Both orientations are rotations, never mirrors, so a counter-clockwise turn on
 * the table is still counter-clockwise on screen and side spin curves the right way.
 *
 * - Landscape: screen = (y, x). The head end is on the left.
 * - Portrait: screen = (x, lengthM - y). The head end is at the bottom.
 */

export type Orientation = "landscape" | "portrait";

/** How the editor draws the table: always lengthways, the head end on the left. */
export const EDITOR_ORIENTATION: Orientation = "landscape";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewTransform {
  readonly orientation: Orientation;
  readonly widthM: number;
  readonly lengthM: number;
  /** Table point to screen point (still in metres; the SVG viewBox does the scaling). */
  toScreen(p: Point): Point;
  /** Screen point back to table coordinates. */
  toTable(p: Point): Point;
  /** The SVG viewBox showing the whole playing area plus `marginM` on every side. */
  viewBox(marginM: number): Box;
}

export function makeViewTransform(
  table: { widthM: number; lengthM: number },
  orientation: Orientation,
): ViewTransform {
  const { widthM, lengthM } = table;
  if (orientation === "landscape") {
    return {
      orientation,
      widthM,
      lengthM,
      toScreen: (p) => ({ x: p.y, y: p.x }),
      toTable: (p) => ({ x: p.y, y: p.x }),
      viewBox: (m) => ({ x: -m, y: -m, width: lengthM + 2 * m, height: widthM + 2 * m }),
    };
  }
  return {
    orientation,
    widthM,
    lengthM,
    toScreen: (p) => ({ x: p.x, y: lengthM - p.y }),
    toTable: (p) => ({ x: p.x, y: lengthM - p.y }),
    viewBox: (m) => ({ x: -m, y: -m, width: widthM + 2 * m, height: lengthM + 2 * m }),
  };
}

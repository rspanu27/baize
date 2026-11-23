import { projectPoint } from "@baize/vision";
import { RAIL_WIDTH_M } from "../../view/constants";
import { makeViewTransform } from "../../view/transform";
import type { Box, Orientation, Point, ViewTransform } from "../../view/transform";
import type { ClipAnalysis } from "../types";
import { overlayUnit } from "./canvas";

/**
 * Where the minimap sits in the frame and how table points map into it.
 *
 * The minimap is turned like the table in the clip: lengthways when the table's length runs
 * across the picture, upright when it runs up it, and turned half round when the head end is
 * on the right (or at the top), so the balls move the same way in both. Every turn is a
 * rotation, never a mirror, so spin curves the right way. It goes in the top right corner,
 * at most a quarter of the frame's width and 40 % of its height.
 */

/** Largest share of the frame's width and height the minimap takes. */
export const MINIMAP_MAX_WIDTH = 0.25;
export const MINIMAP_MAX_HEIGHT = 0.4;
/** Gap between the overlays and the frame's edges, in overlay units (pixels at 1080p). */
export const EDGE_MARGIN = 24;

export interface MinimapLayout {
  orientation: Orientation;
  /** Turned half round from the editor's view (head end on the right, or at the top). */
  flipped: boolean;
  /** Frame pixels; whole numbers so that the cached picture lands on pixel edges. */
  box: Box;
  /** Pixels per metre. */
  scale: number;
  /** Table metres to frame pixels. */
  toPx(p: Point): Point;
  /**
   * The same mapping as a view transform, so the editor's table drawing helpers draw the
   * minimap straight in frame pixels (`toScreen` gives pixels; `viewBox` gives the box).
   */
  transform: ViewTransform;
}

export function minimapLayout(analysis: ClipAnalysis): MinimapLayout {
  const { widthM: W, lengthM: L } = analysis.table.playingArea;
  const { widthPx, heightPx, camera } = analysis;

  // Which way the table's length runs in the picture.
  const a = projectPoint(camera, { x: W / 2, y: L / 2, z: 0 });
  const b = projectPoint(camera, { x: W / 2, y: (3 * L) / 4, z: 0 });
  let orientation: Orientation = "landscape";
  let flipped = false;
  if (a && b) {
    const du = b.u - a.u;
    const dv = b.v - a.v;
    if (Math.abs(du) >= Math.abs(dv)) flipped = du < 0;
    else {
      orientation = "portrait";
      flipped = dv > 0;
    }
  }

  const view = makeViewTransform({ widthM: W, lengthM: L }, orientation);
  const vb = view.viewBox(RAIL_WIDTH_M);
  const unit = overlayUnit(widthPx, heightPx);
  const margin = Math.round(EDGE_MARGIN * unit);
  const scale = Math.min(
    (MINIMAP_MAX_WIDTH * widthPx) / vb.width,
    (MINIMAP_MAX_HEIGHT * heightPx) / vb.height,
  );
  const width = Math.floor(vb.width * scale);
  const height = Math.floor(vb.height * scale);
  const box: Box = { x: Math.round(widthPx - margin - width), y: margin, width, height };
  const cx = vb.x + vb.width / 2;
  const cy = vb.y + vb.height / 2;

  const fromView = (s: Point): Point => {
    const t = flipped ? { x: 2 * cx - s.x, y: 2 * cy - s.y } : s;
    return { x: box.x + (t.x - vb.x) * scale, y: box.y + (t.y - vb.y) * scale };
  };
  const toView = (q: Point): Point => {
    const t = { x: (q.x - box.x) / scale + vb.x, y: (q.y - box.y) / scale + vb.y };
    return flipped ? { x: 2 * cx - t.x, y: 2 * cy - t.y } : t;
  };
  const toPx = (p: Point): Point => fromView(view.toScreen(p));

  const transform: ViewTransform = {
    orientation,
    widthM: W,
    lengthM: L,
    toScreen: toPx,
    toTable: (q) => view.toTable(toView(q)),
    viewBox: (marginM) => ({
      x: box.x + (RAIL_WIDTH_M - marginM) * scale,
      y: box.y + (RAIL_WIDTH_M - marginM) * scale,
      width: (vb.width - 2 * (RAIL_WIDTH_M - marginM)) * scale,
      height: (vb.height - 2 * (RAIL_WIDTH_M - marginM)) * scale,
    }),
  };
  return { orientation, flipped, box, scale, toPx, transform };
}

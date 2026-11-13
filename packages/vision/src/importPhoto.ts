import { sanitizeLayout } from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { findBalls } from "./balls/findBalls";
import { cameraFromHomography } from "./geometry/camera";
import { homographyFromCorners } from "./geometry/homography";
import { findTable } from "./table/findTable";
import type { Camera, ImportOptions, ImportResult, PhotoImage, TableCorners } from "./types";

/**
 * One photo to a layout of balls.
 *
 * 1. The table: its four corners, given by the person or found from the cloth.
 * 2. The camera behind those corners.
 * 3. The balls, each with a kind and a confidence.
 * 4. Sanity: balls kept inside the cushions and apart, duplicate identities resolved by
 *    confidence (`sanitizeLayout` from `@baize/tables`, the same rules the editor uses).
 *
 * The photo is only read. Nothing here keeps a reference to it after returning.
 *
 * `now` supplies a clock for the timings (for example `() => performance.now()`); without it
 * the timings are left empty, which keeps this function free of any global.
 */
export function importPhoto(
  image: PhotoImage,
  table: TableSpec,
  ballSet: BallSetSpec,
  options: ImportOptions & { now?: () => number } = {},
): ImportResult {
  const timingsMs: Record<string, number> = {};
  const clock = options.now;
  const timed = <T>(name: string, work: () => T): T => {
    if (!clock) return work();
    const start = clock();
    const out = work();
    timingsMs[name] = clock() - start;
    return out;
  };
  const empty: Layout = { balls: [] };
  const { widthM, lengthM } = table.playingArea;

  let corners: TableCorners | undefined = options.corners;
  let camera: Camera | undefined;
  const cornersDetected = corners === undefined;
  if (corners) {
    const given = corners;
    camera = timed("camera", () => {
      const h = homographyFromCorners(given, widthM, lengthM);
      return h ? cameraFromHomography(h, image.widthPx, image.heightPx) : undefined;
    });
    if (!camera) {
      return {
        problem: "corners-invalid",
        corners,
        layout: empty,
        diagnostics: { cornersDetected, timingsMs },
      };
    }
  } else {
    const found = timed("table", () => findTable(image, table));
    if (!found) {
      return {
        problem: "table-not-found",
        layout: empty,
        diagnostics: { cornersDetected, timingsMs },
      };
    }
    corners = found.corners;
    camera = found.camera;
  }

  const seen = camera;
  const balls = timed("balls", () => findBalls(image, table, ballSet, seen));
  const clean = timed("sanity", () => sanitizeLayout({ balls }, table, ballSet));
  return {
    corners,
    layout: clean.layout,
    diagnostics: { cornersDetected, camera, timingsMs },
  };
}

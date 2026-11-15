import { sanitizeLayout } from "@baize/tables";
import type { BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { findBalls } from "./balls/findBalls";
import { cameraFromCorners } from "./geometry/camera";
import { homographyFromCorners } from "./geometry/homography";
import { findTable } from "./table/findTable";
import { cross } from "./table/quad";
import type { Camera, ImportOptions, ImportResult, PhotoImage, TableCorners } from "./types";

/**
 * One photo to a layout of balls.
 *
 * 1. The table: its four corners, given by the person or found from the cloth.
 * 2. The camera behind those corners, which are at the height of the cushion noses.
 * 3. The balls, each with a kind and a confidence.
 * 4. Sanity: balls kept inside the cushions and apart, duplicate identities resolved by
 *    confidence (`sanitizeLayout` from `@baize/tables`, the same rules the editor uses).
 *
 * The photo is only read. Nothing here keeps a reference to it after returning.
 *
 * `now` supplies a clock for the timings (for example `() => performance.now()`); without it
 * the timings are left empty, which keeps this function free of any global.
 */
/**
 * True when the corners make a strictly convex four-sided figure, turning the way a table's
 * corners turn on the screen in the order of `TableCorners`. A dragged corner can fold the
 * figure or put three corners in a line; no table looks like that.
 */
function convexClockwise(corners: TableCorners): boolean {
  let size = 0;
  for (const c of corners) size = Math.max(size, Math.abs(c.u), Math.abs(c.v), 1);
  for (let i = 0; i < 4; i++) {
    const a = corners[i] as { u: number; v: number };
    const b = corners[(i + 1) % 4] as { u: number; v: number };
    const c = corners[(i + 2) % 4] as { u: number; v: number };
    // Negative for a turn the table's way (v grows downwards); clearly away from zero.
    const turn = cross({ x: a.u, y: a.v }, { x: b.u, y: b.v }, { x: c.u, y: c.v });
    if (!(turn < -MIN_TURN * size * size)) return false;
  }
  return true;
}

/** Smallest turn at a corner, as a share of the square of the photo's size (a near-straight corner). */
const MIN_TURN = 1e-4;

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
  const cornerHeightM = options.cornerHeightM ?? table.cushion.noseHeightM;
  const { widthM, lengthM } = table.playingArea;

  let corners: TableCorners | undefined = options.corners;
  let camera: Camera | undefined;
  const cornersDetected = corners === undefined;
  if (corners) {
    const given = corners;
    camera = timed("camera", () => {
      if (!convexClockwise(given)) return undefined;
      const h = homographyFromCorners(given, widthM, lengthM);
      return h ? cameraFromCorners(h, image.widthPx, image.heightPx, cornerHeightM) : undefined;
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
    const found = timed("table", () => findTable(image, table, cornerHeightM));
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
  const balls = timed("balls", () => findBalls(image, table, ballSet, seen, cornerHeightM));
  const clean = timed("sanity", () => sanitizeLayout({ balls }, table, ballSet));
  return {
    corners,
    layout: clean.layout,
    diagnostics: { cornersDetected, camera, timingsMs },
  };
}

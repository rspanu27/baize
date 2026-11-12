import type { BallTrack, TableGeometry, Vec2 } from "@baize/physics";
import { cushionPaths as tableCushionPaths } from "../view/tableArt";
import { makeViewTransform } from "../view/transform";

/**
 * Pure drawing helpers for the playground: table coordinates in, SVG strings out.
 *
 * The table is drawn landscape. Table coordinates are metres with x across the width and y
 * along the length (y up); the screen has x to the right and y down. Swapping the two
 * coordinates turns the table a quarter turn without mirroring it, so the head end is on the
 * left and side spin curves the same way it does on a real table seen from above.
 */

/** Table point to screen point (still in metres; the SVG viewBox does the scaling). */
export function toScreen(p: Vec2): Vec2 {
  return { x: p.y, y: p.x };
}

/** Screen point back to table coordinates. */
export function toTable(p: Vec2): Vec2 {
  return { x: p.y, y: p.x };
}

function fmt(n: number): string {
  // Tenth of a millimetre is plenty for drawing and keeps the markup short.
  return (Math.round(n * 1e4) / 1e4).toString();
}

function pt(p: Vec2): string {
  const s = toScreen(p);
  return `${fmt(s.x)} ${fmt(s.y)}`;
}

/**
 * SVG path data for the six cushions of a landscape table (the editor's version, which takes
 * any view transform, lives in `view/tableArt`).
 */
export function cushionPaths(geometry: TableGeometry, depthM: number): string[] {
  return tableCushionPaths(geometry, depthM, makeViewTransform(geometry, "landscape"));
}

/**
 * SVG path data for the whole path of a ball: one quadratic Bezier per motion segment, which
 * is exact because every segment has constant acceleration. Empty if the ball never moves.
 */
export function trackPath(track: BallTrack): string {
  let d = "";
  for (const s of track.segments) {
    if (s.state !== "sliding" && s.state !== "rolling") continue;
    if (!Number.isFinite(s.duration) || s.duration <= 0) continue;
    const T = s.duration;
    const control = { x: s.r0.x + (s.v0.x * T) / 2, y: s.r0.y + (s.v0.y * T) / 2 };
    const end = {
      x: s.r0.x + T * (s.v0.x + 0.5 * s.a.x * T),
      y: s.r0.y + T * (s.v0.y + 0.5 * s.a.y * T),
    };
    // Segments are contiguous, but a ball can rest between two moves, so always re-anchor.
    d += `${d ? " " : ""}M ${pt(s.r0)} Q ${pt(control)} ${pt(end)}`;
  }
  return d;
}

/** Distance a ball travels over its whole track, in metres (chord length of fine samples). */
export function trackLength(track: BallTrack): number {
  let total = 0;
  for (const s of track.segments) {
    if (s.state !== "sliding" && s.state !== "rolling") continue;
    if (!Number.isFinite(s.duration) || s.duration <= 0) continue;
    let prev = s.r0;
    const steps = 16;
    for (let i = 1; i <= steps; i++) {
      const t = (s.duration * i) / steps;
      const p = {
        x: s.r0.x + t * (s.v0.x + 0.5 * s.a.x * t),
        y: s.r0.y + t * (s.v0.y + 0.5 * s.a.y * t),
      };
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      prev = p;
    }
  }
  return total;
}

// Moved to the view layer so the editor and the playground draw balls the same way.
export { ballLook } from "../view/ballLook";
export type { BallLook } from "../view/ballLook";

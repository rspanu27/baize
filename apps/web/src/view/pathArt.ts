import type { PathMark, PathPiece, PathRole } from "../sim/pathModel";
import type { Point, ViewTransform } from "./transform";

/** Drawing constants for simulated paths. The svg viewBox is in metres, so these are metres. */
export const STRONG_WIDTH_M = 0.007;
export const FAINT_WIDTH_M = 0.003;
export const STRONG_OPACITY = 0.95;
export const FAINT_OPACITY = 0.45;
/** Dash pattern (dash, gap) for sliding pieces on emphasised paths. */
export const SLIDING_DASH_M: readonly [number, number] = [0.018, 0.014];
export const CUE_PATH_COLOUR = "#ffffff";
/** Used instead of the ball colour when that colour is too dark to see on the cloth. */
export const DARK_BALL_PATH_COLOUR = "#d4d4d4";
/** Colours with a relative luminance below this are drawn in the light grey. */
export const DARK_LUMINANCE = 0.12;

export const FIRST_CONTACT_RADIUS_M = 0.02;
export const FIRST_CONTACT_WIDTH_M = 0.006;
export const CONTACT_DOT_RADIUS_M = 0.007;
export const CUSHION_DOT_RADIUS_M = 0.005;
export const POCKET_RING_RADIUS_M = 0.035;
export const POCKET_RING_WIDTH_M = 0.006;
export const FINAL_OUTLINE_WIDTH_M = 0.004;
export const FINAL_OUTLINE_DASH_M: readonly [number, number] = [0.012, 0.01];
export const MARK_COLOUR = "#ffffff";

export interface PathStyle {
  /** False when the path is not drawn at all. */
  visible: boolean;
  widthM: number;
  opacity: number;
  /** Strong paths show sliding and rolling; faint ones are plain. */
  emphasised: boolean;
}

export function pathStyle(role: PathRole, showAll: boolean): PathStyle {
  const strong = showAll || role === "cue" || role === "first-object";
  return strong
    ? { visible: true, widthM: STRONG_WIDTH_M, opacity: STRONG_OPACITY, emphasised: true }
    : { visible: true, widthM: FAINT_WIDTH_M, opacity: FAINT_OPACITY, emphasised: false };
}

/** Rounds to 0.1 mm, which keeps the markup short. */
function r(n: number): string {
  const v = Math.round(n * 10000) / 10000;
  return String(Object.is(v, -0) ? 0 : v);
}

function pt(p: Point): string {
  return `${r(p.x)} ${r(p.y)}`;
}

const JOIN_TOLERANCE_M = 1e-9;

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < JOIN_TOLERANCE_M && Math.abs(a.y - b.y) < JOIN_TOLERANCE_M;
}

/**
 * SVG path data for pieces in screen space. Both orientations are rotations, so each quadratic
 * Bezier stays an exact quadratic Bezier with transformed control points.
 */
export function pathData(pieces: readonly PathPiece[], transform: ViewTransform): string {
  const parts: string[] = [];
  let end: Point | undefined;
  for (const p of pieces) {
    if (!end || !samePoint(end, p.from)) parts.push(`M${pt(transform.toScreen(p.from))}`);
    parts.push(`Q${pt(transform.toScreen(p.control))} ${pt(transform.toScreen(p.to))}`);
    end = p.to;
  }
  return parts.join(" ");
}

/** Pieces grouped into runs of equal state, for drawing sliding and rolling differently. */
export function pieceRuns(pieces: readonly PathPiece[]): PathPiece[][] {
  const runs: PathPiece[][] = [];
  for (const p of pieces) {
    const last = runs[runs.length - 1];
    if (last && last[0]?.sliding === p.sliding) last.push(p);
    else runs.push([p]);
  }
  return runs;
}

function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) return 1;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The stroke colour for a ball's path, given its ball colour. */
export function pathColour(role: PathRole, ballColour: string): string {
  if (role === "cue") return CUE_PATH_COLOUR;
  return luminance(ballColour) < DARK_LUMINANCE ? DARK_BALL_PATH_COLOUR : ballColour;
}

export function dashArray(dash: readonly [number, number]): string {
  return `${dash[0]} ${dash[1]}`;
}

/** Whether a mark is drawn, given the roles of the balls involved. */
export function markVisible(
  mark: PathMark,
  roleOf: (ballId: string) => PathRole | undefined,
): boolean {
  if (mark.kind === "cushion") {
    const role = roleOf(mark.ballIds[0] ?? "");
    return role === "cue" || role === "first-object";
  }
  return true;
}

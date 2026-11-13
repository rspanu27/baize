import { pointOnPiece } from "../sim/pathModel";
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

/** Largest distance between the drawn polyline and the true curve: 0.1 mm. */
const FLATNESS_M = 1e-4;
const MAX_STEPS = 64;

function finitePiece(p: PathPiece): boolean {
  return [p.from, p.control, p.to].every((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
}

/**
 * SVG path data for pieces in screen space, as straight line steps.
 *
 * Each piece is an exact parabola, but it is drawn as a polyline that stays within 0.1 mm of
 * it. Curve strokers in browsers can misdraw degenerate quadratics (a ball rolling to rest has
 * its control point on its end point; a ball that spins back on itself makes a hairpin), and a
 * polyline of distinct points has no such cases. Steps too short to see are dropped.
 */
export function pathData(pieces: readonly PathPiece[], transform: ViewTransform): string {
  const parts: string[] = [];
  let end: Point | undefined;
  let last: string | undefined;
  const emit = (command: "M" | "L", p: Point): void => {
    const s = pt(transform.toScreen(p));
    if (s === last) return;
    parts.push(`${command}${s}`);
    last = s;
  };
  for (const p of pieces) {
    if (!finitePiece(p)) continue;
    if (!end || !samePoint(end, p.from)) {
      last = undefined;
      emit("M", p.from);
    }
    // For a quadratic, n equal steps stay within |from - 2 control + to| / (4 n^2) of it.
    const bx = p.from.x - 2 * p.control.x + p.to.x;
    const by = p.from.y - 2 * p.control.y + p.to.y;
    const bend = Math.sqrt(bx * bx + by * by);
    const n = Math.min(MAX_STEPS, Math.max(1, Math.ceil(Math.sqrt(bend / (4 * FLATNESS_M)))));
    for (let i = 1; i <= n; i++) emit("L", pointOnPiece(p, i / n));
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

import { sampleAt } from "@baize/physics";
import type { BallSample } from "@baize/physics";
import type { BallKind } from "@baize/tables";
import { ballLook } from "../../view/ballLook";
import { pathColour } from "../../view/pathArt";
import { THEMES } from "../../view/theme";
import type { ThemeColours } from "../../view/theme";
import { formatSpeed } from "../../units/units";
import type { UnitSystem } from "../../units/units";
import type { ClipAnalysis, OverlayOptions } from "../types";
import { haloFor, overlayUnit, tracePolyline, traceRoundRect } from "./canvas";
import type { Ctx2D, PxPoint } from "./canvas";
import { drawBall, drawMinimapBackground } from "./minimap";
import { EDGE_MARGIN } from "./minimapLayout";
import { pathUpTo, prepare, radiusOf, toPicture } from "./prepare";
import type { BallTrail, Prepared, PreparedShot } from "./prepare";
import { SLOW_RATE } from "./timeline";

/**
 * The overlays of one frame of the video (task 7.8, SPEC section 11), drawn on top of the
 * clip's frame at its display size: the paths so far, the ghost ball, the speed, the minimap
 * and a slow-motion mark. Colours follow the editor's themes. Pure apart from drawing: what
 * is worked out once per analysis is kept in a `WeakMap` (see prepare.ts), nothing else.
 *
 * Sizes are in overlay units, pixels on a 1080p frame, scaled with the frame (see
 * `overlayUnit`), so a clip of any size gets the same look.
 */

/** Line widths of the paths in the picture and on the minimap, overlay units. */
const CUE_WIDTH = 4;
const BALL_WIDTH = 3;
const HALO = 1.5;
const MINI_WIDTH = 2;
const MINI_HALO = 1;
const GHOST_WIDTH = 2.5;
const GHOST_DASH: readonly [number, number] = [7, 5];

const LABEL_HEIGHT = 46;
const LABEL_PAD = 14;
const LABEL_GAP = 10;
const SMALL_FONT = 20;
const BIG_FONT = 28;
const FONT_FAMILY = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/**
 * The shot the overlays describe at `clipTimeS`: the last one that has started (so a finished
 * shot stays on screen until the next starts), or undefined before the first.
 */
export function currentShotIndex(analysis: ClipAnalysis, clipTimeS: number): number {
  let best = -1;
  analysis.shots.forEach((s, i) => {
    if (s.startS <= clipTimeS && (best < 0 || s.startS >= (analysis.shots[best]?.startS ?? 0))) {
      best = i;
    }
  });
  return best;
}

/** The speed readout: "4.2 m/s" in metric, "9.4 mph" in imperial. */
export function speedText(speedMps: number, units: UnitSystem): string {
  return formatSpeed(speedMps, units);
}

/** The slow-motion mark, e.g. "Slow motion ¼×". */
export function slowText(rate: number = SLOW_RATE): string {
  const names: Record<string, string> = { "0.5": "½", "0.25": "¼", "0.125": "⅛" };
  return `Slow motion ${names[String(rate)] ?? String(rate)}×`;
}

/** The paths the options ask for, the cue ball's last so it is drawn on top. */
export function trailsShown(ps: PreparedShot, options: OverlayOptions): BallTrail[] {
  const out = ps.trails.filter(
    (t) => t.moved && (options.allTrails || (options.cueTrail && t.role === "cue")),
  );
  return [...out.filter((t) => t.role !== "cue"), ...out.filter((t) => t.role === "cue")];
}

interface Line {
  points: PxPoint[];
  colour: string;
  width: number;
  halo: number;
}

function strokeLines(ctx: Ctx2D, lines: readonly Line[]): void {
  // Every halo first, then every line, so that crossing paths do not cut each other.
  for (const pass of ["halo", "line"] as const) {
    for (const l of lines) {
      if (l.points.length < 2) continue;
      ctx.beginPath();
      tracePolyline(ctx, l.points);
      ctx.strokeStyle = pass === "halo" ? haloFor(l.colour) : l.colour;
      ctx.lineWidth = pass === "halo" ? l.width + 2 * l.halo : l.width;
      ctx.stroke();
    }
  }
}

function trailColour(trail: BallTrail, colours: ThemeColours): string {
  return pathColour(trail.role, ballLook(trail.kind).colour, colours);
}

/** The lines of the paths so far, mapped into the picture or the minimap. */
function trailLines(
  trails: readonly BallTrail[],
  simT: number,
  samples: readonly BallSample[],
  colours: ThemeColours,
  place: (trail: BallTrail, x: number, y: number) => PxPoint | undefined,
  space: "picture" | "table",
  width: (trail: BallTrail) => number,
  halo: number,
): Line[] {
  return trails.map((trail) => {
    const s = samples[trail.track];
    const current =
      s && s.state !== "pocketed" ? place(trail, s.position.x, s.position.y) : undefined;
    const points =
      space === "picture"
        ? pathUpTo(trail.picture, simT, current, (x, y) => ({ x, y }))
        : pathUpTo(trail.table, simT, current, (x, y) => place(trail, x, y) as PxPoint);
    return { points, colour: trailColour(trail, colours), width: width(trail), halo };
  });
}

function drawGhost(
  ctx: Ctx2D,
  x: number,
  y: number,
  r: number,
  colours: ThemeColours,
  width: number,
  dash: readonly number[],
): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fillStyle = colours.css?.ghostFill ?? "rgba(255, 255, 255, 0.18)";
  ctx.fill();
  ctx.strokeStyle = haloFor(colours.cuePath);
  ctx.lineWidth = width * 2;
  ctx.stroke();
  ctx.setLineDash(dash);
  ctx.strokeStyle = colours.cuePath;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.setLineDash([]);
}

interface TextPart {
  text: string;
  font: string;
  alpha: number;
}

/** A label on a rounded plate in the theme's caption colours; returns its bottom edge. */
function drawPlate(
  ctx: Ctx2D,
  x: number,
  y: number,
  parts: readonly TextPart[],
  colours: ThemeColours,
  u: number,
): number {
  const pad = LABEL_PAD * u;
  const gap = LABEL_GAP * u;
  const h = LABEL_HEIGHT * u;
  const widths = parts.map((p) => {
    ctx.font = p.font;
    return ctx.measureText(p.text).width;
  });
  const w = pad * 2 + widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
  ctx.beginPath();
  traceRoundRect(ctx, x, y, w, h, 10 * u);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = colours.captionBackground;
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = colours.captionText;
  let at = x + pad;
  parts.forEach((p, i) => {
    ctx.font = p.font;
    ctx.globalAlpha = p.alpha;
    ctx.fillText(p.text, at, y + h / 2);
    at += (widths[i] ?? 0) + gap;
  });
  ctx.globalAlpha = 1;
  return y + h;
}

/** The tracked frame nearest `t`, by binary search on the frame times. */
function nearestFrame(analysis: ClipAnalysis, t: number) {
  const frames = analysis.frames;
  if (frames.length === 0) return undefined;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((frames[mid]?.timeS ?? 0) < t) lo = mid + 1;
    else hi = mid;
  }
  const after = frames[lo];
  const before = frames[lo - 1];
  if (before && after && Math.abs(before.timeS - t) <= Math.abs(after.timeS - t)) return before;
  return after;
}

/** The balls on the minimap: from the fit during a shot, else from the nearest tracked frame. */
export function minimapBalls(
  analysis: ClipAnalysis,
  ps: PreparedShot | undefined,
  clipTimeS: number,
  samples: readonly BallSample[] | undefined,
): { kind: BallKind; x: number; y: number }[] {
  if (ps && samples && clipTimeS <= ps.shot.endS) {
    return samples
      .filter((s) => s.state !== "pocketed")
      .map((s) => ({ kind: ps.kindOf.get(s.id) ?? "cue", x: s.position.x, y: s.position.y }));
  }
  const frame = nearestFrame(analysis, clipTimeS);
  if (!frame) return [];
  return frame.balls
    .filter((b) => b.state !== "pocketed" && b.state !== "lost")
    .map((b) => ({ kind: b.kind, x: b.x, y: b.y }));
}

function drawMinimap(
  ctx: Ctx2D,
  analysis: ClipAnalysis,
  prepared: Prepared,
  options: OverlayOptions,
  ps: PreparedShot | undefined,
  clipTimeS: number,
  simT: number,
  samples: readonly BallSample[] | undefined,
  u: number,
): void {
  const layout = prepared.minimap;
  const colours = THEMES[options.theme];
  drawMinimapBackground(ctx, analysis, prepared, options.theme);
  const toPx = (_: unknown, x: number, y: number): PxPoint => layout.toPx({ x, y });

  if (ps && samples && simT > 0) {
    const width = Math.max(1.25, MINI_WIDTH * u);
    const lines = trailLines(
      trailsShown(ps, options),
      simT,
      samples,
      colours,
      toPx,
      "table",
      () => width,
      Math.max(0.75, MINI_HALO * u),
    );
    strokeLines(ctx, lines);
  }
  if (options.ghostBall && ps?.ghost && simT >= ps.ghost.simS) {
    const g = layout.toPx(ps.ghost);
    const w = Math.max(1, 1.25 * u);
    drawGhost(ctx, g.x, g.y, ps.ghost.radiusM * layout.scale, colours, w, [3 * w, 2 * w]);
  }

  const balls = minimapBalls(analysis, ps, clipTimeS, samples);
  for (const b of balls) {
    const p = layout.toPx(b);
    drawBall(
      ctx,
      b.kind,
      p.x,
      p.y,
      Math.max(2, radiusOf(analysis, b.kind) * layout.scale),
      colours,
    );
  }
  if (options.labels) {
    ctx.font = `700 ${String(Math.max(9, 13 * u))}px ${FONT_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(2, 3 * u);
    for (const b of balls) {
      const label = ballLook(b.kind).label;
      if (!label) continue;
      const p = layout.toPx(b);
      const r = Math.max(2, radiusOf(analysis, b.kind) * layout.scale);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(label, p.x, p.y - r - u);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, p.x, p.y - r - u);
    }
  }
}

/**
 * Draws the overlays for the moment `clipTimeS` of the clip onto `ctx`, which already holds
 * that frame at the clip's display size (`analysis.widthPx` x `analysis.heightPx`). `slow`
 * says whether the frame is part of a slow-motion stretch (see `buildTimeline`).
 */
export function drawOverlay(
  ctx: Ctx2D,
  analysis: ClipAnalysis,
  options: OverlayOptions,
  clipTimeS: number,
  slow: boolean,
): void {
  const W = analysis.widthPx;
  const H = analysis.heightPx;
  const u = overlayUnit(W, H);
  const prepared = prepare(analysis);
  const colours = THEMES[options.theme];
  const index = currentShotIndex(analysis, clipTimeS);
  const ps = index >= 0 ? prepared.shots[index] : undefined;
  const simT = ps ? clipTimeS - ps.shot.strikeS : 0;
  const samples = ps ? sampleAt(ps.shot.result, simT) : undefined;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = 1;

  if (ps && samples && simT > 0) {
    const lines = trailLines(
      trailsShown(ps, options),
      simT,
      samples,
      colours,
      (trail, x, y) => toPicture(analysis, x, y, trail.radiusM),
      "picture",
      (trail) => (trail.role === "cue" ? CUE_WIDTH : BALL_WIDTH) * u,
      HALO * u,
    );
    strokeLines(ctx, lines);
  }

  const ghost = ps?.ghost;
  if (options.ghostBall && ghost?.picture && simT >= ghost.simS) {
    const { x, y, r } = ghost.picture;
    drawGhost(
      ctx,
      x,
      y,
      r,
      colours,
      GHOST_WIDTH * u,
      GHOST_DASH.map((d) => d * u),
    );
  }

  if (options.minimap)
    drawMinimap(ctx, analysis, prepared, options, ps, clipTimeS, simT, samples, u);

  const margin = Math.round(EDGE_MARGIN * u);
  let y = margin;
  if (options.speed && ps) {
    y =
      drawPlate(
        ctx,
        margin,
        y,
        [
          { text: "Cue ball", font: `500 ${String(SMALL_FONT * u)}px ${FONT_FAMILY}`, alpha: 0.8 },
          {
            text: speedText(ps.shot.shot.speedMps, options.units),
            font: `700 ${String(BIG_FONT * u)}px ${FONT_FAMILY}`,
            alpha: 1,
          },
        ],
        colours,
        u,
      ) +
      LABEL_GAP * u;
  }
  if (slow) {
    drawPlate(
      ctx,
      margin,
      y,
      [{ text: slowText(), font: `600 ${String(SMALL_FONT * u)}px ${FONT_FAMILY}`, alpha: 1 }],
      colours,
      u,
    );
  }
  ctx.restore();
}

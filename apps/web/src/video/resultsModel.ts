import { loadLayout, setShot } from "../doc/ops";
import type { DiagramDoc } from "../doc/types";
import { useEditor } from "../store/store";
import { formatDistance, formatSpeed } from "../units/units";
import type { UnitSystem } from "../units/units";
import type { ClipSpan } from "./overlay/timeline";
import { buildTimeline } from "./overlay/timeline";
import type { ClipAnalysis, ClipShot, OverlayOptions, TimelineFrame } from "./types";

/**
 * The video screen's results (task 7.10) as plain functions: words for the shots found, the
 * stretch of the clip the video covers, the frames to write, the size and frame rate of the
 * video, and the document "Open in editor" makes. No React, no browser APIs.
 */

/** Seconds of clip kept before a chosen shot starts and after it ends. */
export const SHOT_MARGIN_S = 1;
/** The longer side of the video written and previewed, pixels at most. */
export const MAX_OUTPUT_SIDE_PX = 1920;
/** Frame rate used when the clip's own cannot be told. */
export const DEFAULT_FPS = 30;
/** Fit quality bounds: root-mean-square distance between the fit and the tracks, metres. */
export const GOOD_FIT_M = 0.01;
export const ROUGH_FIT_M = 0.03;

/** What the video covers: the whole clip, or one shot (its index in `analysis.shots`). */
export type ShotChoice = "whole" | number;

export const NO_SHOTS = "No shot was found in this clip.";
export const NO_SHOTS_HINT =
  "Check that the camera was still, that the whole table is in view, and that the cue ball can be seen on the first frame. Adjusting the corners and tracking again can help.";

export const MESSAGE_STOPPED = "Tracking stopped. Nothing was kept.";
export const MESSAGE_PICK_SHOT = "Pick a shot to open it in the editor.";

/** A clip time as people read it: "0:02.3", "1:05.0". */
export function clipTimeText(seconds: number): string {
  const s = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const tenths = Math.round(s * 10);
  const min = Math.floor(tenths / 600);
  const rest = (tenths - min * 600) / 10;
  return `${String(min)}:${rest.toFixed(1).padStart(4, "0")}`;
}

export type FitWord = "good" | "rough" | "poor";

/** How well the physics fit matches the tracked balls, from the root-mean-square distance. */
export function fitWord(rmsM: number): FitWord {
  if (rmsM < GOOD_FIT_M) return "good";
  if (rmsM < ROUGH_FIT_M) return "rough";
  return "poor";
}

/** "good fit (0.6 cm)", "poor fit (4.2 cm)", in the units preference. */
export function fitText(rmsM: number, units: UnitSystem): string {
  const size =
    units === "metric"
      ? `${(rmsM * 100).toFixed(1)} cm`
      : formatDistance(rmsM, units).replace(/^-/, "");
  return `${fitWord(rmsM)} fit (${size})`;
}

/** The shot's name in the results: "Shot 1 at 0:02.3". */
export function shotLabel(shot: ClipShot): string {
  return `Shot ${String(shot.index + 1)} at ${clipTimeText(shot.startS)}`;
}

/** What the fit found: "cue ball 2.4 m/s, good fit (0.6 cm)". */
export function shotDetails(shot: ClipShot, units: UnitSystem): string {
  return `cue ball ${formatSpeed(shot.shot.speedMps, units)}, ${fitText(shot.rmsM, units)}`;
}

/** Where the results start: the first shot when there is one, else the whole clip. */
export function initialChoice(analysis: ClipAnalysis): ShotChoice {
  return analysis.shots.length > 0 ? 0 : "whole";
}

/** The shot a choice names, if any. */
export function chosenShot(analysis: ClipAnalysis, choice: ShotChoice): ClipShot | undefined {
  return choice === "whole" ? undefined : analysis.shots[choice];
}

/**
 * The stretch of the clip the video covers: all of it, or a shot from `SHOT_MARGIN_S` before
 * it starts to `SHOT_MARGIN_S` after it ends, cut to the clip.
 */
export function coveredSpan(analysis: ClipAnalysis, choice: ShotChoice): ClipSpan {
  const end = Math.max(0, analysis.durationS);
  const shot = chosenShot(analysis, choice);
  if (!shot) return { startS: 0, endS: end };
  return {
    startS: Math.min(end, Math.max(0, shot.startS - SHOT_MARGIN_S)),
    endS: Math.max(0, Math.min(end, shot.endS + SHOT_MARGIN_S)),
  };
}

/** Clip times this close outside the stretch still count as inside it (time-scale rounding). */
const SPAN_EPS_S = 1e-6;

/**
 * The frames of the video: `buildTimeline` over the whole clip, keeping only those whose clip
 * time is inside the covered stretch, re-timed so the video starts at 0 (frame j at j / fps).
 */
export function outputTimeline(
  analysis: ClipAnalysis,
  options: OverlayOptions,
  fps: number,
  choice: ShotChoice,
): TimelineFrame[] {
  const span = coveredSpan(analysis, choice);
  return buildTimeline(analysis, options, fps)
    .filter((f) => f.clipTimeS >= span.startS - SPAN_EPS_S && f.clipTimeS <= span.endS + SPAN_EPS_S)
    .map((f, j) => ({ ...f, outTimeS: j / fps }));
}

/** The clip's frame rate, from the spacing of the analysed frames (median), rounded. */
export function clipFps(analysis: Pick<ClipAnalysis, "frames">): number {
  const gaps: number[] = [];
  const { frames } = analysis;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a && b && b.timeS > a.timeS) gaps.push(b.timeS - a.timeS);
  }
  if (gaps.length === 0) return DEFAULT_FPS;
  gaps.sort((x, y) => x - y);
  const median = gaps[Math.floor(gaps.length / 2)] as number;
  const fps = Math.round(1 / median);
  return Number.isFinite(fps) && fps >= 1 && fps <= 1000 ? fps : DEFAULT_FPS;
}

/** The video's size: the clip's, scaled down so the longer side is at most 1920, even numbers. */
export function outputSize(
  widthPx: number,
  heightPx: number,
  maxSide: number = MAX_OUTPUT_SIDE_PX,
): { widthPx: number; heightPx: number } {
  const k = Math.min(1, maxSide / Math.max(widthPx, heightPx, 1));
  const even = (n: number) => Math.max(2, 2 * Math.round((n * k) / 2));
  return { widthPx: even(widthPx), heightPx: even(heightPx) };
}

/**
 * The document with a clip's shot in it: the balls at rest before the shot replace those on the
 * table (ids are the document's own), and the shot the physics fit found is set on the cue ball.
 * One document, so the store applies it as one undo step. The layout is marked as coming from
 * a camera picture (`source: "photo"`): the document format has no "video" source.
 */
export function docWithClipShot(doc: DiagramDoc, shot: ClipShot): DiagramDoc {
  const layout = { balls: shot.balls.map((b) => ({ kind: b.kind, x: b.x, y: b.y })) };
  const placed = loadLayout(doc, layout, { source: "photo", mode: "replace" });
  const cue = shot.balls.find((b) => b.id === shot.cueBallId);
  // The document's id for the cue ball: the ball of the same kind nearest where it was put
  // (placing can nudge a ball out of a pocket or off another ball, or drop it).
  let cueId: string | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const b of placed.balls) {
    if (!cue || b.kind !== cue.kind) continue;
    const d = (b.x - cue.x) ** 2 + (b.y - cue.y) ** 2;
    if (d < best) {
      best = d;
      cueId = b.id;
    }
  }
  if (cueId === undefined) return placed;
  return setShot(placed, {
    cueBallId: cueId,
    aimAngleRad: shot.shot.aimAngleRad,
    speedMps: shot.shot.speedMps,
    tipOffset: { ...shot.shot.tipOffset },
  });
}

/** Puts a clip's shot into the editor's document as one undo step (see `docWithClipShot`). */
export function openShotInEditor(shot: ClipShot): void {
  const { history, replaceDoc } = useEditor.getState();
  replaceDoc(docWithClipShot(history.present, shot));
}

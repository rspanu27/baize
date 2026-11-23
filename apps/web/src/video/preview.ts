import type { Clip } from "./media";
import type { Ctx2D } from "./overlay/canvas";
import { drawOverlay } from "./overlay/draw";
import type { ClipAnalysis, OverlayOptions, TimelineFrame } from "./types";

/**
 * Drawing the video screen's preview and the saved video's overlays (task 7.10): a clip frame
 * scaled to fill the canvas with the overlays on top, and playing a timeline frame by frame on
 * the page. The clip's frames are only drawn onto canvases in this page.
 */

/**
 * Draws the overlays for `frame` on a canvas of any size that already holds the clip's frame:
 * the overlays are worked out at the clip's display size and scaled to the canvas.
 */
export function overlayDrawer(
  analysis: ClipAnalysis,
  options: OverlayOptions,
  widthPx: number,
  heightPx: number,
): (ctx: Ctx2D, frame: TimelineFrame) => void {
  return (ctx, frame) => {
    ctx.save();
    ctx.scale(widthPx / analysis.widthPx, heightPx / analysis.heightPx);
    drawOverlay(ctx, analysis, options, frame.clipTimeS, frame.slow);
    ctx.restore();
  };
}

/** Draws a clip frame scaled to fill the canvas, then the overlays for `frame`. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  analysis: ClipAnalysis,
  options: OverlayOptions,
  frame: TimelineFrame,
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);
  overlayDrawer(analysis, options, width, height)(ctx, frame);
}

/** A frame time in a file can be this much after the time asked for (time-scale rounding). */
const TIME_EPS_S = 1e-4;

/** The clip frame to show at `clipTimeS` (the last one if the time is at the very end). */
export async function frameNear(clip: Clip, clipTimeS: number) {
  const latest = Math.max(0, Math.min(clipTimeS, clip.info.durationS - 1e-3));
  return (await clip.frameAt(clipTimeS)) ?? (await clip.frameAt(latest));
}

export interface PlayRequest {
  clip: Clip;
  timeline: readonly TimelineFrame[];
  /** Index of the first frame to show. */
  from: number;
  fps: number;
  /** Draws a frame: `source` holds the clip's picture for it. */
  show(source: CanvasImageSource, index: number): void;
  /** Called once when the preview falls more than a frame behind real time. */
  onBehind(): void;
  signal: AbortSignal;
  /** Milliseconds now; for tests. */
  now?(): number;
  /** Waits; for tests. */
  wait?(ms: number): Promise<void>;
  /** A blank canvas element; for tests. */
  createCanvas?(): HTMLCanvasElement;
}

const waitMs = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

/**
 * Plays `timeline` from `from` to the end, decoding the clip's frames once and in order: each
 * output frame shows the latest clip frame at or before its clip time (a slow-motion stretch
 * shows a frame several times). Waits between frames to keep to `fps`; a slow device plays
 * slower than real time and `onBehind` says so. Returns the index of the last frame shown.
 */
export async function playTimeline(req: PlayRequest): Promise<number> {
  const { clip, timeline, fps, signal } = req;
  const now = req.now ?? (() => performance.now());
  const wait = req.wait ?? waitMs;
  const first = timeline[req.from];
  if (!first) return req.from;
  const decoded = clip.frames(first.clipTimeS);
  // A copy of the latest frame shown: a frame's canvas may be reused by the next one.
  const hold: { canvas?: HTMLCanvasElement; ctx?: CanvasRenderingContext2D | null } = {};
  const keep = (source: HTMLCanvasElement | OffscreenCanvas) => {
    if (!hold.canvas) {
      hold.canvas = req.createCanvas ? req.createCanvas() : document.createElement("canvas");
      hold.canvas.width = source.width;
      hold.canvas.height = source.height;
      hold.ctx = hold.canvas.getContext("2d");
    }
    hold.ctx?.drawImage(source, 0, 0, hold.canvas.width, hold.canvas.height);
  };
  let shown = req.from;
  let behind = false;
  try {
    let pending = (await decoded.next()).value ?? undefined;
    const start = now();
    for (let i = req.from; i < timeline.length; i++) {
      if (signal.aborted) break;
      const frame = timeline[i] as TimelineFrame;
      while (pending && pending.timestampS <= frame.clipTimeS + TIME_EPS_S) {
        keep(pending.canvas);
        pending = (await decoded.next()).value ?? undefined;
      }
      if (!hold.canvas && pending) keep(pending.canvas);
      if (signal.aborted) break;
      const due = start + (frame.outTimeS - first.outTimeS) * 1000;
      const late = now() - due;
      if (late > 1000 / fps && !behind) {
        behind = true;
        req.onBehind();
      }
      if (late < 0) await wait(-late);
      if (signal.aborted) break;
      if (hold.canvas) req.show(hold.canvas, i);
      shown = i;
    }
  } finally {
    await decoded.return(undefined);
  }
  return shown;
}

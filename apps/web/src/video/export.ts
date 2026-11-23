import { ClipError, createClipWriter } from "./media";
import type { Clip, ClipFormat, ClipFrame, ClipWriter } from "./media";
import type { TimelineFrame } from "./types";

/**
 * Writing the finished video (Phase 7, task 7.9): the clip's frames chosen by a timeline, each
 * drawn onto a canvas with the overlays on top, encoded and muxed by `media.ts`. Everything
 * happens on this device: the file is kept in memory until the person saves it, and nothing is
 * uploaded or stored.
 */

type Canvas = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ExportRequest {
  clip: Clip;
  /** Size of the video written (the clip's display size, or smaller keeping its shape; even numbers). */
  widthPx: number;
  heightPx: number;
  fps: number;
  /** The frames to write, in order: output times increasing, clip times never going back. */
  timeline: readonly TimelineFrame[];
  /** Draws the overlays for one output frame, after the clip's frame has been drawn to fill the canvas. */
  draw(ctx: Context2D, frame: TimelineFrame): void;
  onProgress?(done: number, total: number): void;
  signal?: AbortSignal;
  preferred?: ClipFormat;
  /** For tests: the writer (default `createClipWriter`). */
  createWriter?(canvas: Canvas, preferred: ClipFormat): Promise<ClipWriter>;
  /** For tests: a blank canvas of this size (default an OffscreenCanvas, or a canvas element). */
  createCanvas?(widthPx: number, heightPx: number): Canvas;
}

export interface ExportResult {
  blob: Blob;
  format: ClipFormat;
  codec: string;
  frames: number;
  seconds: number;
}

export const MESSAGE_CANCELLED = "The video was not written: it was cancelled.";
export const MESSAGE_NOT_WRITTEN = "The video could not be written.";

/** Output frames between two pauses that let the page draw and handle input. */
const FRAMES_PER_YIELD = 4;
/**
 * A decoded frame this close after a clip time still counts as at or before it: frame times in a
 * file are rounded to its time scale. Well below the gap between frames even at 1000 fps.
 */
const TIME_EPS_S = 1e-4;

/**
 * Writes the video described by `req` and returns the file. The clip is decoded once, in order;
 * each output frame shows the latest clip frame at or before its clip time (a slow-motion
 * stretch shows the same clip frame several times), scaled to the output size, with `draw`'s
 * overlays on top. Throws an "AbortError" DOMException if `signal` is aborted, a `ClipError`
 * if the browser cannot write video, and otherwise an Error with a plain message.
 */
export async function exportVideo(req: ExportRequest): Promise<ExportResult> {
  const { clip, widthPx, heightPx, fps, timeline, signal } = req;
  checkRequest(req);
  throwIfAborted(signal);

  const createCanvas = req.createCanvas ?? blankCanvas;
  const out = createCanvas(widthPx, heightPx);
  const held = createCanvas(widthPx, heightPx);
  const ctx = context2d(out);
  const heldCtx = context2d(held);
  heldCtx.imageSmoothingEnabled = true;
  heldCtx.imageSmoothingQuality = "high";

  const total = timeline.length;
  const first = timeline[0];
  if (!first) throw new Error(MESSAGE_NOT_WRITTEN);
  const writer = await (req.createWriter ?? createClipWriter)(out, req.preferred ?? "mp4");
  const decoded = clip.frames(first.clipTimeS);
  try {
    req.onProgress?.(0, total);
    // `pending` is the next decoded frame, not yet copied; `held` holds a copy (at the output
    // size) of the latest one at or before the current clip time. A frame's canvas may be
    // reused by the next one, so each is copied before the next is asked for.
    let pending = await nextFrame(decoded);
    let hasHeld = false;
    for (let i = 0; i < total; i++) {
      throwIfAborted(signal);
      const frame = timeline[i];
      if (!frame) break;
      while (pending && pending.timestampS <= frame.clipTimeS + TIME_EPS_S) {
        copyFrame(heldCtx, pending, widthPx, heightPx);
        hasHeld = true;
        pending = await nextFrame(decoded);
      }
      if (!hasHeld) {
        // The clip time is before the first frame the clip has: show that first frame.
        if (!pending) throw new Error(`${MESSAGE_NOT_WRITTEN} The clip has no frames to show.`);
        copyFrame(heldCtx, pending, widthPx, heightPx);
        hasHeld = true;
      }
      ctx.clearRect(0, 0, widthPx, heightPx);
      ctx.drawImage(held, 0, 0);
      ctx.save();
      try {
        req.draw(ctx, frame);
      } finally {
        ctx.restore();
      }
      await writer.add(frame.outTimeS, 1 / fps);
      req.onProgress?.(i + 1, total);
      if ((i + 1) % FRAMES_PER_YIELD === 0) {
        await nextTask();
        throwIfAborted(signal);
      }
    }
    await decoded.return(undefined);
    throwIfAborted(signal);
    const blob = await writer.finish();
    const last = timeline[total - 1] ?? first;
    return {
      blob,
      format: writer.format,
      codec: writer.codec,
      frames: total,
      seconds: last.outTimeS + 1 / fps,
    };
  } catch (e) {
    await Promise.allSettled([writer.cancel(), decoded.return(undefined)]);
    if (isAbort(e) || e instanceof ClipError) throw e;
    throw new Error(`${MESSAGE_NOT_WRITTEN} ${reason(e)}`, { cause: e });
  }
}

/** A file name for the saved video, from the clip's name: "<name>-baize.mp4". */
export function exportFileName(clipName: string, format: ClipFormat): string {
  const base = clipName
    .replace(/^.*[\\/]/, "")
    .replace(/\.[^.]*$/, "")
    // Characters some systems refuse in file names, and control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .trim();
  return `${base === "" ? "video" : base}-baize.${format}`;
}

/** Hands the file to the person (an <a download> click with an object URL, revoked after). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.style.display = "none";
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
    // Some browsers start the download after the click returns: give them time to read it.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, REVOKE_AFTER_MS);
  }
}

const REVOKE_AFTER_MS = 10_000;

function checkRequest(req: ExportRequest): void {
  const { widthPx, heightPx, fps, timeline } = req;
  const evenSize = (n: number) => Number.isInteger(n) && n > 0 && n % 2 === 0;
  if (!evenSize(widthPx) || !evenSize(heightPx)) {
    throw new Error(
      `${MESSAGE_NOT_WRITTEN} Its size must be whole, even numbers of pixels (asked for ${String(widthPx)} x ${String(heightPx)}).`,
    );
  }
  if (!(Number.isFinite(fps) && fps > 0)) {
    throw new Error(`${MESSAGE_NOT_WRITTEN} Its frame rate must be above zero.`);
  }
  if (timeline.length === 0) {
    throw new Error(`${MESSAGE_NOT_WRITTEN} There are no frames to write.`);
  }
  let prev: TimelineFrame | undefined;
  for (const f of timeline) {
    if (!Number.isFinite(f.outTimeS) || !Number.isFinite(f.clipTimeS) || f.outTimeS < 0) {
      throw new Error(`${MESSAGE_NOT_WRITTEN} A frame has no valid time.`);
    }
    if (prev && f.outTimeS <= prev.outTimeS) {
      throw new Error(`${MESSAGE_NOT_WRITTEN} The frames are not in order.`);
    }
    if (prev && f.clipTimeS < prev.clipTimeS) {
      throw new Error(`${MESSAGE_NOT_WRITTEN} The timeline goes back in the clip.`);
    }
    prev = f;
  }
}

function blankCanvas(widthPx: number, heightPx: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(widthPx, heightPx);
  const c = document.createElement("canvas");
  c.width = widthPx;
  c.height = heightPx;
  return c;
}

function context2d(canvas: Canvas): Context2D {
  const ctx = canvas.getContext("2d") as Context2D | null;
  if (!ctx) throw new Error(`${MESSAGE_NOT_WRITTEN} This browser cannot draw on a canvas.`);
  return ctx;
}

function copyFrame(ctx: Context2D, frame: ClipFrame, widthPx: number, heightPx: number): void {
  ctx.clearRect(0, 0, widthPx, heightPx);
  ctx.drawImage(frame.canvas, 0, 0, widthPx, heightPx);
}

async function nextFrame(
  frames: AsyncGenerator<ClipFrame, void, unknown>,
): Promise<ClipFrame | undefined> {
  const r = await frames.next();
  return r.done ? undefined : r.value;
}

/** Waits for a macrotask, so the page can draw and handle input between frames. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException(MESSAGE_CANCELLED, "AbortError");
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

function reason(e: unknown): string {
  return e instanceof Error && e.message !== "" ? e.message : String(e);
}

import type { BallSetSpec, TableSpec } from "@baize/tables";
import type { Camera, PhotoImage, TableCorners } from "@baize/vision";
import type { PhotoAnalyser } from "../photo/analyser";
import { reviewInitial } from "../photo/reviewModel";
import type { ReviewBall, ReviewInitial } from "../photo/reviewModel";
import type { Clip, ClipFrame, ClipInfo } from "./media";

/**
 * An open clip on the video screen, and what it holds: the decoder, the first frame as a
 * picture (an object URL, for showing it) and the table finder working on that frame's pixels
 * in a worker. All of it lives in memory on this device until `close()`; nothing is stored,
 * put in the document or sent anywhere.
 *
 * Free of React and of the browser's media APIs, which come in through `ClipSessionDeps`, so
 * that opening, failing and closing can be tested with stand-ins.
 */
export interface ClipSession {
  readonly clip: Clip;
  readonly fileName: string;
  /** The first frame, for showing it. Revoked by `close()`. */
  readonly frameUrl: string;
  /** Size of the picture the table was found on (the first frame, scaled down if very large). */
  readonly frameSize: { readonly widthPx: number; readonly heightPx: number };
  /** The table finder on the first frame; ended by `close()`. */
  readonly analyser: PhotoAnalyser;
  /** The first result of the table finder, where the calibration starts. */
  readonly initial: ReviewInitial;
  /** Ends everything: the worker, the frame's URL and the decoder. Safe to call twice. */
  close(): void;
}

/** A clip whose table has been placed: what the next step (tracking) starts from. */
export interface CalibratedClip {
  readonly clip: Clip;
  /** Corners of the playing area, in the pixels of `frameSize`. */
  readonly corners: TableCorners;
  readonly camera: Camera;
  readonly frameSize: { readonly widthPx: number; readonly heightPx: number };
  readonly table: TableSpec;
  readonly ballSet: BallSetSpec;
  /** Balls found on the first frame: a first guess, which tracking redoes. */
  readonly balls: readonly ReviewBall[];
}

/** The browser's side of opening a clip; stand-ins in tests. */
export interface ClipSessionDeps {
  openClip(file: Blob): Promise<Clip>;
  /** Copies a decoded frame into pixels and a picture URL (the frame's canvas may be reused). */
  readFrame(frame: ClipFrame): Promise<{ image: PhotoImage; url: string }>;
  /** Starts the table finder; it takes the image's pixels. */
  createAnalyser(image: PhotoImage): PhotoAnalyser;
  revokeUrl(url: string): void;
}

export const MESSAGE_NO_FRAME = "This clip has no picture that can be shown.";
export const MESSAGE_UNREADABLE = "The clip could not be read.";

/** The first frame of a clip: the one at 0 s, or the first there is if the clip starts later. */
export async function firstFrame(clip: Clip): Promise<ClipFrame | undefined> {
  const atStart = await clip.frameAt(0);
  if (atStart) return atStart;
  for await (const frame of clip.frames()) return frame;
  return undefined;
}

/**
 * Opens a clip and starts calibrating on its first frame. If `signal` is aborted on the way
 * (the screen was closed), everything made so far is disposed and the abort reason thrown.
 */
export async function openClipSession(
  file: File,
  table: TableSpec,
  ballSet: BallSetSpec,
  deps: ClipSessionDeps,
  signal: AbortSignal,
): Promise<ClipSession> {
  let clip: Clip | undefined;
  let url: string | undefined;
  let analyser: PhotoAnalyser | undefined;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    analyser?.dispose();
    if (url !== undefined) deps.revokeUrl(url);
    clip?.close();
  };
  const stopIfAborted = () => {
    if (signal.aborted) {
      close();
      throw signal.reason;
    }
  };
  try {
    clip = await deps.openClip(file);
    stopIfAborted();
    const frame = await firstFrame(clip);
    stopIfAborted();
    if (!frame) throw new Error(MESSAGE_NO_FRAME);
    const picture = await deps.readFrame(frame);
    url = picture.url;
    stopIfAborted();
    const frameSize = { widthPx: picture.image.widthPx, heightPx: picture.image.heightPx };
    analyser = deps.createAnalyser(picture.image);
    const result = await analyser.run(table, ballSet);
    stopIfAborted();
    return {
      clip,
      fileName: file.name,
      frameUrl: url,
      frameSize,
      analyser,
      initial: reviewInitial(result),
      close,
    };
  } catch (e) {
    close();
    throw e;
  }
}

/** The message to show for a clip that could not be opened. */
export function openingMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : MESSAGE_UNREADABLE;
}

/** "1920 × 1080". */
export function sizeText(info: Pick<ClipInfo, "widthPx" | "heightPx">): string {
  return `${String(info.widthPx)} × ${String(info.heightPx)}`;
}

/** "8.4 s", "1 min 05 s". */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown length";
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const whole = Math.round(seconds);
  const min = Math.floor(whole / 60);
  const s = whole % 60;
  return `${String(min)} min ${String(s).padStart(2, "0")} s`;
}

const CODEC_NAMES: Record<string, string> = {
  avc: "H.264",
  hevc: "HEVC (H.265)",
  vp8: "VP8",
  vp9: "VP9",
  av1: "AV1",
};

/** The codec as people know it: "avc" is "H.264". */
export function codecText(codec: string): string {
  return CODEC_NAMES[codec] ?? codec;
}

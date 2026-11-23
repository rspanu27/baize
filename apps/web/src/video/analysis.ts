import { cameraFromCorners, homographyFromCorners } from "@baize/vision";
import type { Camera, PhotoImage, TableCorners } from "@baize/vision";
import type { Scene } from "../doc/resolve";
import type { Tuning } from "../sim/tuning";
import { createAnalysis } from "./analysisCore";
import type { AnalysisInit, AnalysisOutput } from "./analysisCore";
import type { CalibratedClip } from "./clipSession";
import type { ClipFrame } from "./media";
import type { ClipAnalysis } from "./types";

/**
 * The page's side of analysing a clip (task 7.10): decode the frames in order, scale each to
 * the size the tracking works at, and hand its pixels to the analysis (in a worker when one can
 * start, else on the page with pauses), then collect the shots. Everything stays on this
 * device; the clip's pixels are handed over, never copied anywhere else.
 */

/** Messages to the analysis worker. */
export type AnalysisRequest =
  | { type: "init"; init: AnalysisInit }
  | { type: "frame"; image: PhotoImage; timeS: number }
  | { type: "finish" };

/** Replies from the analysis worker. */
export type AnalysisReply =
  | { type: "ready" }
  | { type: "ack" }
  | { type: "fitting"; done: number; total: number }
  | { type: "done"; output: AnalysisOutput }
  | { type: "error"; message: string };

/** The longer side of the frames the tracking works on, pixels (smaller clips are kept). */
export const TRACK_SIDE_PX = 1280;

export interface AnalyseProgress {
  readonly stage: "tracking" | "fitting";
  /** 0 to 1. */
  readonly share: number;
}

export interface AnalyseOptions {
  onProgress?(p: AnalyseProgress): void;
  signal?: AbortSignal;
  /** For tests: where the analysis runs (default: a worker, or the page if none can start). */
  backend?: AnalysisBackend;
  /** For tests: copies a decoded frame into pixels at a size (default: through a canvas). */
  readPixels?(frame: ClipFrame, widthPx: number, heightPx: number): PhotoImage;
}

/** Where the analysis runs: an object that takes the requests and answers like the worker. */
export interface AnalysisBackend {
  send(message: AnalysisRequest, transfer?: Transferable[]): void;
  onReply(handler: (reply: AnalysisReply) => void): void;
  close(): void;
}

export const MESSAGE_CANCELLED = "The analysis was stopped.";
export const MESSAGE_NO_CAMERA = "The table's corners do not give a camera. Adjust the corners.";

function scaleCorners(corners: TableCorners, k: number): TableCorners {
  return corners.map((c) => ({ u: c.u * k, v: c.v * k })) as unknown as TableCorners;
}

/** The camera for corners given in pixels of one size, used at another (same shape). */
export function cameraAt(
  corners: TableCorners,
  scale: number,
  widthPx: number,
  heightPx: number,
  calibrated: Pick<CalibratedClip, "table">,
): Camera | undefined {
  const { widthM, lengthM } = calibrated.table.playingArea;
  const h = homographyFromCorners(scaleCorners(corners, scale), widthM, lengthM);
  return h
    ? cameraFromCorners(h, widthPx, heightPx, calibrated.table.cushion.noseHeightM)
    : undefined;
}

function canvasPixels(frame: ClipFrame, widthPx: number, heightPx: number): PhotoImage {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot read video frames into memory.");
  ctx.drawImage(frame.canvas, 0, 0, widthPx, heightPx);
  return { widthPx, heightPx, data: ctx.getImageData(0, 0, widthPx, heightPx).data };
}

/** The analysis on the page, answering like the worker (used where a worker cannot start). */
export function pageBackend(): AnalysisBackend {
  let handler: ((reply: AnalysisReply) => void) | undefined;
  let session: ReturnType<typeof createAnalysis> | undefined;
  const reply = (r: AnalysisReply) => {
    // Answer after a macrotask, as a worker would, so the page can breathe between frames.
    setTimeout(() => handler?.(r), 0);
  };
  return {
    send(m) {
      try {
        if (m.type === "init") {
          session = createAnalysis(m.init);
          reply({ type: "ready" });
        } else if (m.type === "frame") {
          session?.push(m.image, m.timeS);
          reply({ type: "ack" });
        } else {
          const output = (session as ReturnType<typeof createAnalysis>).finish((done, total) => {
            reply({ type: "fitting", done, total });
          });
          reply({ type: "done", output });
        }
      } catch (e) {
        reply({
          type: "error",
          message: e instanceof Error ? e.message : "The clip could not be analysed.",
        });
      }
    },
    onReply(h) {
      handler = h;
    },
    close() {
      handler = undefined;
      session = undefined;
    },
  };
}

function workerBackend(): AnalysisBackend {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./analysisWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return pageBackend();
  }
  return {
    send(m, transfer) {
      worker.postMessage(m, transfer ?? []);
    },
    onReply(h) {
      worker.onmessage = (e: MessageEvent<AnalysisReply>) => {
        h(e.data);
      };
      worker.onerror = () => {
        h({ type: "error", message: "The clip analysis could not run in the background." });
      };
    },
    close() {
      worker.terminate();
    },
  };
}

/**
 * Analyses a calibrated clip: tracking, shots and their physics fit. `scene` and `tuning` are
 * the editor's, so the fitted shots are what the editor would draw.
 */
export async function analyseClip(
  calibrated: CalibratedClip,
  scene: Scene,
  tuning: Tuning,
  options: AnalyseOptions = {},
): Promise<ClipAnalysis> {
  const { clip } = calibrated;
  const display = { widthPx: clip.info.widthPx, heightPx: clip.info.heightPx };
  const longest = Math.max(calibrated.frameSize.widthPx, calibrated.frameSize.heightPx);
  const toTrack = Math.min(1, TRACK_SIDE_PX / longest);
  const track = {
    widthPx: Math.max(1, Math.round(calibrated.frameSize.widthPx * toTrack)),
    heightPx: Math.max(1, Math.round(calibrated.frameSize.heightPx * toTrack)),
  };
  const trackCamera = cameraAt(
    calibrated.corners,
    toTrack,
    track.widthPx,
    track.heightPx,
    calibrated,
  );
  const displayCamera = cameraAt(
    calibrated.corners,
    display.widthPx / calibrated.frameSize.widthPx,
    display.widthPx,
    display.heightPx,
    calibrated,
  );
  if (!trackCamera || !displayCamera) throw new Error(MESSAGE_NO_CAMERA);

  const init: AnalysisInit = {
    table: calibrated.table,
    ballSet: calibrated.ballSet,
    scene,
    tuning,
    camera: trackCamera,
    toDisplay: display.widthPx / track.widthPx,
    balls: calibrated.balls.map((b) => ({ id: `b${String(b.id)}`, kind: b.kind, x: b.x, y: b.y })),
  };
  const backend = options.backend ?? workerBackend();
  const readPixels = options.readPixels ?? canvasPixels;
  const durationS = Math.max(1e-6, clip.info.durationS);

  // One reply at a time: each request waits for its answer before the next is sent.
  let waiting: ((r: AnalysisReply) => void) | undefined;
  let fitting: ((done: number, total: number) => void) | undefined;
  backend.onReply((r) => {
    if (r.type === "fitting") {
      fitting?.(r.done, r.total);
      return;
    }
    const w = waiting;
    waiting = undefined;
    w?.(r);
  });
  const ask = (m: AnalysisRequest, transfer?: Transferable[]) =>
    new Promise<AnalysisReply>((resolve) => {
      waiting = resolve;
      backend.send(m, transfer);
    });
  const expect = (r: AnalysisReply, type: AnalysisReply["type"]) => {
    if (r.type === "error") throw new Error(r.message);
    if (r.type !== type) throw new Error("The clip could not be analysed.");
    return r;
  };
  const check = () => {
    if (options.signal?.aborted) throw new Error(MESSAGE_CANCELLED);
  };

  try {
    expect(await ask({ type: "init", init }), "ready");
    for await (const frame of clip.frames()) {
      check();
      const image = readPixels(frame, track.widthPx, track.heightPx);
      expect(
        await ask({ type: "frame", image, timeS: frame.timestampS }, [image.data.buffer]),
        "ack",
      );
      options.onProgress?.({ stage: "tracking", share: Math.min(1, frame.timestampS / durationS) });
    }
    check();
    fitting = (done, total) => {
      options.onProgress?.({ stage: "fitting", share: total > 0 ? done / total : 1 });
    };
    const done = expect(await ask({ type: "finish" }), "done");
    if (done.type !== "done") throw new Error("The clip could not be analysed.");
    check();
    return {
      widthPx: display.widthPx,
      heightPx: display.heightPx,
      camera: displayCamera,
      table: calibrated.table,
      ballSet: calibrated.ballSet,
      durationS: clip.info.durationS,
      frames: done.output.frames,
      shots: done.output.shots,
      clothColour: scene.cloth.colour,
    };
  } finally {
    backend.close();
  }
}

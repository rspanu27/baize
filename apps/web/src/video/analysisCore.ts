import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import { createTracker, findShots, fitShot } from "@baize/vision";
import type { Camera, PhotoImage, TrackedFrame, Tracker } from "@baize/vision";
import type { Scene } from "../doc/resolve";
import { editorRunner } from "../sim/simulator";
import type { Tuning } from "../sim/tuning";
import type { ClipShot } from "./types";

/**
 * The analysis of a clip, free of the page (task 7.10): frames go in one by one, already
 * scaled to the size the tracking works at; at the end the shots are found and each is
 * explained by the physics fit, with the editor's own physics. Runs in a worker
 * (`analysisWorker.ts`) or, where workers are missing, on the page.
 */

export interface AnalysisInit {
  readonly table: TableSpec;
  readonly ballSet: BallSetSpec;
  /** The editor's scene and debug-panel numbers: the fit simulates with exactly this physics. */
  readonly scene: Scene;
  readonly tuning: Tuning;
  /** Maps table metres to the pixels of the frames pushed. */
  readonly camera: Camera;
  /** Pushed-frame pixels times this are the clip's display pixels. */
  readonly toDisplay: number;
  /** The balls on the first frame. */
  readonly balls: readonly {
    readonly id: string;
    readonly kind: BallKind;
    readonly x: number;
    readonly y: number;
  }[];
}

export interface AnalysisOutput {
  readonly frames: TrackedFrame[];
  readonly shots: ClipShot[];
}

export interface AnalysisSession {
  push(image: PhotoImage, timeS: number): void;
  /** Finds the shots and fits each; `onShot` reports each fit as it finishes. */
  finish(onShot?: (done: number, total: number) => void): AnalysisOutput;
}

export const MESSAGE_NO_CUE_BALL =
  "No cue ball was found on the first frame. Check the balls before tracking.";

export function createAnalysis(init: AnalysisInit): AnalysisSession {
  const tracker: Tracker = createTracker(init.table, init.ballSet, init.camera, init.balls);
  const frames: TrackedFrame[] = [];
  const k = init.toDisplay;
  return {
    push(image, timeS) {
      const f = tracker.push(image, timeS);
      // Where balls were seen, in the clip's display pixels (the overlays draw at that size).
      frames.push({
        timeS: f.timeS,
        balls: f.balls.map((b) =>
          b.seen ? { ...b, seen: { u: b.seen.u * k, v: b.seen.v * k } } : b,
        ),
      });
    },
    finish(onShot) {
      const cue = init.balls.find((b) => b.kind === "cue");
      if (!cue) throw new Error(MESSAGE_NO_CUE_BALL);
      const spans = findShots(frames, cue.id);
      const run = editorRunner(init.scene, init.tuning);
      const shots: ClipShot[] = [];
      spans.forEach((span, n) => {
        onShot?.(n, spans.length);
        const before = frames[Math.max(0, span.startIndex - 1)] as TrackedFrame;
        const balls = before.balls
          .filter((b) => b.state !== "pocketed" && b.state !== "lost")
          .map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y }));
        const fit = fitShot({
          ballSet: init.ballSet,
          balls,
          cueBallId: cue.id,
          frames: frames.slice(Math.max(0, span.startIndex - 1), span.endIndex + 1),
          run,
        });
        if (!fit) return;
        shots.push({
          index: shots.length,
          startS: span.startS,
          endS: span.endS,
          strikeS: fit.strikeS,
          cueBallId: cue.id,
          balls,
          shot: fit.shot,
          result: fit.result,
          rmsM: fit.rmsM,
        });
      });
      onShot?.(spans.length, spans.length);
      return { frames, shots };
    },
  };
}

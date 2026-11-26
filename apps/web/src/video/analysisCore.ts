import { sanitizeLayout } from "@baize/tables";
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

type ShotBall = ClipShot["balls"][number];

/**
 * The balls at rest before a shot made placeable for the simulator: tracked positions can
 * overlap by more than the physics allows or sit over a pocket, and then every simulation of
 * the fit would fail. The cue ball goes first so that it keeps its place when two balls
 * overlap; balls that cannot be placed at all are left out. Deterministic.
 */
export function placeableBalls(
  balls: readonly ShotBall[],
  cueBallId: string,
  table: TableSpec,
  ballSet: BallSetSpec,
): ShotBall[] {
  const ordered = [
    ...balls.filter((b) => b.id === cueBallId),
    ...balls.filter((b) => b.id !== cueBallId),
  ];
  const { layout, removed } = sanitizeLayout(
    { balls: ordered.map((b) => ({ kind: b.kind, x: b.x, y: b.y })) },
    table,
    ballSet,
  );
  const gone = new Set(removed);
  const kept = ordered.filter((_, i) => !gone.has(i));
  return kept.flatMap((b, i) => {
    const placed = layout.balls[i];
    return placed ? [{ id: b.id, kind: b.kind, x: placed.x, y: placed.y }] : [];
  });
}

/** The vision steps the analysis uses; stand-ins in tests. */
export interface AnalysisSteps {
  readonly createTracker: typeof createTracker;
  readonly findShots: typeof findShots;
  readonly fitShot: typeof fitShot;
}

const VISION: AnalysisSteps = { createTracker, findShots, fitShot };

export function createAnalysis(init: AnalysisInit, steps: AnalysisSteps = VISION): AnalysisSession {
  const tracker: Tracker = steps.createTracker(init.table, init.ballSet, init.camera, init.balls);
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
      const spans = steps.findShots(frames, cue.id);
      const run = editorRunner(init.scene, init.tuning);
      const shots: ClipShot[] = [];
      spans.forEach((span, n) => {
        onShot?.(n, spans.length);
        const before = frames[Math.max(0, span.startIndex - 1)] as TrackedFrame;
        const balls = placeableBalls(
          before.balls
            .filter((b) => b.state !== "pocketed" && b.state !== "lost")
            .map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y })),
          cue.id,
          init.table,
          init.ballSet,
        );
        const found = {
          index: n,
          startS: span.startS,
          endS: span.endS,
          cueBallId: cue.id,
          balls,
        };
        let fit: ReturnType<typeof fitShot>;
        try {
          fit = steps.fitShot({
            ballSet: init.ballSet,
            balls,
            cueBallId: cue.id,
            frames: frames.slice(Math.max(0, span.startIndex - 1), span.endIndex + 1),
            run,
          });
        } catch {
          // A layout the simulator refuses: the shot is still listed, as not fitted.
          fit = undefined;
        }
        // Every shot found is kept: one the fit cannot explain is listed as not fitted.
        shots.push(
          fit
            ? {
                ...found,
                fitted: true,
                strikeS: fit.strikeS,
                shot: fit.shot,
                result: fit.result,
                rmsM: fit.rmsM,
              }
            : { ...found, fitted: false },
        );
      });
      onShot?.(spans.length, spans.length);
      return { frames, shots };
    },
  };
}

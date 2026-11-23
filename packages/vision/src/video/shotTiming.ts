import type { TrackedFrame } from "./track";

/**
 * When each shot starts and ends, from the tracked frames (task 7.6, SPEC section 11).
 *
 * A shot starts at the first frame in which the cue ball is seen moving after a stretch with
 * every ball at rest; it ends at the first frame after which every ball stays at rest or off the
 * table (the tracker calls a ball at rest only after a few slow frames, so the end is taken back
 * to the first of those). Between shots every ball is at rest.
 */

export interface ShotSpan {
  /** Index and time of the first frame in which the cue ball moves. */
  readonly startIndex: number;
  readonly startS: number;
  /** Index and time of the frame from which every ball is still. */
  readonly endIndex: number;
  readonly endS: number;
}

const still = (f: TrackedFrame): boolean =>
  f.balls.every((b) => b.state === "rest" || b.state === "pocketed" || b.state === "lost");

/** Frames from which slow balls are counted back to find when they stopped. */
const SLOW_MPS = 0.03;

export function findShots(frames: readonly TrackedFrame[], cueBallId: string): ShotSpan[] {
  const shots: ShotSpan[] = [];
  let i = 0;
  while (i < frames.length) {
    // The start: the cue ball leaves rest after a still stretch.
    while (i < frames.length) {
      const f = frames[i] as TrackedFrame;
      const prev = frames[i - 1];
      const cue = f.balls.find((b) => b.id === cueBallId);
      if (prev && still(prev) && cue && cue.state !== "rest" && cue.state !== "pocketed") break;
      i++;
    }
    if (i >= frames.length) break;
    const start = i;
    // The end: the first frame of the still stretch that follows.
    while (i < frames.length && !still(frames[i] as TrackedFrame)) i++;
    if (i >= frames.length) break; // the clip ends before the balls stop: no complete shot
    let end = i;
    // The balls were slow for a few frames before the tracker called them at rest.
    while (end - 1 > start) {
      const f = frames[end - 1] as TrackedFrame;
      const slow = f.balls.every((b) => b.state !== "moving" || Math.hypot(b.vx, b.vy) < SLOW_MPS);
      if (!slow) break;
      end--;
    }
    shots.push({
      startIndex: start,
      startS: (frames[start] as TrackedFrame).timeS,
      endIndex: end,
      endS: (frames[end] as TrackedFrame).timeS,
    });
    i++;
  }
  return shots;
}

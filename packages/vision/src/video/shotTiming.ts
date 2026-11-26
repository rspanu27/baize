import type { TrackedFrame } from "./track";

/**
 * When each shot starts and ends, from the tracked frames (task 7.6, SPEC section 11).
 *
 * A shot starts at the first frame in which the cue ball is seen moving after a frame with
 * every ball at rest; it ends at the first frame after which every ball stays at rest or off the
 * table. The tracker calls a ball at rest only after it has stayed still for a while, and says
 * when it stopped (`stoppedAtS`), so the end is taken back to the latest of those times.
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

export function findShots(frames: readonly TrackedFrame[], cueBallId: string): ShotSpan[] {
  const shots: ShotSpan[] = [];
  let i = 0;
  while (i < frames.length) {
    // The start: the cue ball is seen moving right after a still frame.
    while (i < frames.length) {
      const f = frames[i] as TrackedFrame;
      const prev = frames[i - 1];
      const cue = f.balls.find((b) => b.id === cueBallId);
      if (prev && still(prev) && cue?.state === "moving") break;
      i++;
    }
    if (i >= frames.length) break;
    const start = i;
    // The end: the first frame of the still stretch that follows.
    while (i < frames.length && !still(frames[i] as TrackedFrame)) i++;
    if (i >= frames.length) break; // the clip ends before the balls stop: no complete shot
    const stillFrame = frames[i] as TrackedFrame;
    // When the last ball actually stopped.
    let stoppedS = (frames[start] as TrackedFrame).timeS;
    for (const b of stillFrame.balls) {
      if (b.stoppedAtS !== undefined && b.stoppedAtS > stoppedS) stoppedS = b.stoppedAtS;
    }
    let end = i;
    while (end - 1 > start && (frames[end - 1] as TrackedFrame).timeS >= stoppedS) end--;
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

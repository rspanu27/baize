import { kineticEnergy as ballEnergy, positionAt, spinAt, velocityAt } from "./motion";
import type { BallSample, BallTrack, Segment, SimResult } from "./types";

/** The segment of a track that is active at time t (the last one that has started). */
function segmentAt(track: BallTrack, t: number): Segment {
  const segs = track.segments;
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((segs[mid] as Segment).t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return segs[lo] as Segment;
}

function sampleTrack(track: BallTrack, t: number): BallSample {
  const s = segmentAt(track, t);
  let tau = t - s.t0;
  if (tau < 0) tau = 0;
  // Past the end of the last segment (only possible when a cap stopped the simulation).
  if (tau > s.duration) tau = s.duration;
  return {
    id: track.id,
    state: s.state,
    position: positionAt(s, tau),
    velocity: velocityAt(s, tau),
    spin: spinAt(s, tau),
  };
}

/**
 * State of every ball at time `t` (seconds from the start), in input order. Times before 0
 * give the initial state; times after the end give the final state.
 */
export function sampleAt(result: SimResult, t: number): BallSample[] {
  return result.tracks.map((track) => sampleTrack(track, t));
}

/** Total kinetic energy (translation plus rotation) of all balls still on the table at `t`. */
export function kineticEnergy(result: SimResult, t: number): number {
  let total = 0;
  for (const track of result.tracks) {
    const b = sampleTrack(track, t);
    if (b.state === "pocketed") continue;
    total += ballEnergy(track.massKg, track.radiusM, b.velocity, b.spin);
  }
  return total;
}

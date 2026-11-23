import type { ClipAnalysis, ClipShot, OverlayOptions, TimelineFrame } from "../types";

/**
 * The frames of the video to write (task 7.8, SPEC section 11): the clip in real time, except
 * a stretch around each shot's first contact between balls, shown in slow motion so that the
 * traced paths can be followed. Pure: the analysis and the options in, a list of frames out.
 */

/** How much of the clip before a shot's first contact is slowed down, seconds of clip time. */
export const SLOW_BEFORE_S = 0.3;
/** How much of the clip after a shot's first contact is slowed down, seconds of clip time. */
export const SLOW_AFTER_S = 0.7;
/** Clip seconds shown per second of video while slowed down: quarter speed. */
export const SLOW_RATE = 0.25;

/** A stretch of clip time, start and end in clip seconds. */
export interface ClipSpan {
  readonly startS: number;
  readonly endS: number;
}

/**
 * Time of the cue ball's first contact with another ball in a shot, in simulation seconds (0
 * is the strike), or undefined when the cue ball touches no ball.
 */
export function firstContactSimS(shot: ClipShot): number | undefined {
  for (const e of shot.result.events) {
    if (e.type !== "ball-ball") continue;
    if (e.ballId === shot.cueBallId || e.otherBallId === shot.cueBallId) return e.t;
  }
  return undefined;
}

/**
 * The stretches shown slowed down: from `SLOW_BEFORE_S` before each shot's first contact to
 * `SLOW_AFTER_S` after it, cut to the clip and merged where they overlap, in time order.
 */
export function slowSpans(analysis: ClipAnalysis): ClipSpan[] {
  const end = analysis.durationS;
  const raw: ClipSpan[] = [];
  for (const shot of analysis.shots) {
    const t = firstContactSimS(shot);
    if (t === undefined) continue;
    const contact = shot.strikeS + t;
    const s = Math.max(0, contact - SLOW_BEFORE_S);
    const e = Math.min(end, contact + SLOW_AFTER_S);
    if (e > s) raw.push({ startS: s, endS: e });
  }
  raw.sort((a, b) => a.startS - b.startS);
  const merged: ClipSpan[] = [];
  for (const span of raw) {
    const last = merged[merged.length - 1];
    if (last && span.startS <= last.endS) {
      merged[merged.length - 1] = { startS: last.startS, endS: Math.max(last.endS, span.endS) };
    } else merged.push(span);
  }
  return merged;
}

/** A piece of the clip played at one rate, with the video time at which it starts. */
interface Piece {
  readonly clipStartS: number;
  readonly clipEndS: number;
  readonly outStartS: number;
  /** Clip seconds per video second. */
  readonly rate: number;
}

function pieces(durationS: number, slow: readonly ClipSpan[]): Piece[] {
  const out: Piece[] = [];
  let clip = 0;
  let outT = 0;
  const add = (to: number, rate: number): void => {
    if (to <= clip) return;
    out.push({ clipStartS: clip, clipEndS: to, outStartS: outT, rate });
    outT += (to - clip) / rate;
    clip = to;
  };
  for (const span of slow) {
    add(span.startS, 1);
    add(span.endS, SLOW_RATE);
  }
  add(durationS, 1);
  return out;
}

/**
 * The frames of the output video at `fps` frames per second. Frame i is shown at i / fps; the
 * clip time it shows never decreases, starts at 0 and ends within one frame of the clip's end.
 * Without `slowMotion`, or when no shot has a contact, the clip plays in real time throughout.
 */
export function buildTimeline(
  analysis: ClipAnalysis,
  options: OverlayOptions,
  fps: number,
): TimelineFrame[] {
  if (!(fps > 0) || !Number.isFinite(fps)) throw new RangeError("fps must be a positive number");
  const duration = analysis.durationS;
  if (!(duration > 0) || !Number.isFinite(duration)) return [];
  const slow = options.slowMotion ? slowSpans(analysis) : [];
  const ps = pieces(duration, slow);
  const last = ps[ps.length - 1] as Piece;
  const outDuration = last.outStartS + (last.clipEndS - last.clipStartS) / last.rate;
  // Frames whose time is inside the video; a frame a rounding error short of the end is not.
  const count = Math.max(1, Math.ceil(outDuration * fps - 1e-9));
  const frames: TimelineFrame[] = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const outTimeS = i / fps;
    while (k < ps.length - 1) {
      const p = ps[k] as Piece;
      if (outTimeS < p.outStartS + (p.clipEndS - p.clipStartS) / p.rate) break;
      k++;
    }
    const p = ps[k] as Piece;
    const clipTimeS = Math.min(p.clipEndS, p.clipStartS + (outTimeS - p.outStartS) * p.rate);
    frames.push({ outTimeS, clipTimeS, slow: p.rate !== 1 });
  }
  return frames;
}

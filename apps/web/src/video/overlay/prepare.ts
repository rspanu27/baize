import { sampleAt } from "@baize/physics";
import type { BallSample } from "@baize/physics";
import { ballSizeOf } from "@baize/tables";
import type { BallKind } from "@baize/tables";
import { apparentRadiusPx, projectPoint } from "@baize/vision";
import type { PathRole } from "../../sim/pathModel";
import type { ClipAnalysis, FittedClipShot } from "../types";
import type { PxPoint } from "./canvas";
import { minimapLayout } from "./minimapLayout";
import type { MinimapLayout } from "./minimapLayout";
import { firstContactSimS } from "./timeline";

/**
 * What the overlays need from an analysis, worked out once and kept for every frame: each
 * ball's path sampled from the fit and projected into the picture, the ghost ball, and where
 * the minimap goes. Kept in a `WeakMap` keyed by the analysis, so it goes when the analysis
 * does; nothing is stored anywhere else.
 */

/** Step of the dense sampling of a path, seconds of shot time. */
export const SAMPLE_STEP_S = 0.005;
/** Picture points closer than this to the previous one are dropped, pixels. */
const MIN_STEP_PX = 0.75;
/** Table points closer than this to the previous one are dropped (minimap), metres. */
const MIN_STEP_M = 0.001;

/** Samples of one ball's path, in shot time order, up to the moment it drops (if it does). */
export interface PathSamples {
  readonly t: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly n: number;
}

export interface BallTrail {
  readonly id: string;
  readonly kind: BallKind;
  readonly role: PathRole;
  readonly radiusM: number;
  /** Index into `result.tracks` (and so into `sampleAt`'s output). */
  readonly track: number;
  /** True if the ball moves at all in the shot. */
  readonly moved: boolean;
  /** In picture pixels, at ball-centre height; `NaN` marks a point the camera cannot see. */
  readonly picture: PathSamples;
  /** In table metres, for the minimap. */
  readonly table: PathSamples;
}

/** Where the cue ball's centre was when it first met another ball. */
export interface GhostBall {
  readonly simS: number;
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
  /** In the picture, when the camera sees it. */
  readonly picture: { readonly x: number; readonly y: number; readonly r: number } | undefined;
}

export interface PreparedShot {
  readonly shot: FittedClipShot;
  readonly trails: readonly BallTrail[];
  readonly ghost: GhostBall | undefined;
  readonly kindOf: ReadonlyMap<string, BallKind>;
}

export interface Prepared {
  /** One per shot of the analysis, in the same order; undefined for a shot not fitted. */
  readonly shots: readonly (PreparedShot | undefined)[];
  readonly minimap: MinimapLayout;
  /** Static minimap pictures, per theme (see minimap.ts). */
  readonly statics: Map<string, unknown>;
}

const cache = new WeakMap<ClipAnalysis, Prepared>();

/** The prepared overlays of an analysis, worked out on first use. */
export function prepare(analysis: ClipAnalysis): Prepared {
  let p = cache.get(analysis);
  if (!p) {
    p = {
      shots: analysis.shots.map((s) => (s.fitted ? prepareShot(analysis, s) : undefined)),
      minimap: minimapLayout(analysis),
      statics: new Map(),
    };
    cache.set(analysis, p);
  }
  return p;
}

/** A ball centre in the picture, or undefined where the camera does not see it. */
export function toPicture(
  analysis: ClipAnalysis,
  x: number,
  y: number,
  radiusM: number,
): PxPoint | undefined {
  const q = projectPoint(analysis.camera, { x, y, z: radiusM });
  return q && Number.isFinite(q.u) && Number.isFinite(q.v) ? { x: q.u, y: q.v } : undefined;
}

class Builder {
  t: number[] = [];
  x: number[] = [];
  y: number[] = [];
  constructor(private readonly minStep: number) {}
  add(t: number, x: number, y: number): void {
    const n = this.t.length;
    const lx = this.x[n - 1];
    const ly = this.y[n - 1];
    if (lx !== undefined && ly !== undefined) {
      if (Number.isNaN(x) && Number.isNaN(lx)) return;
      if (!Number.isNaN(x) && !Number.isNaN(lx)) {
        const dx = x - lx;
        const dy = y - ly;
        // Too close to the last point to show; the line still ends at the ball's exact place.
        if (dx * dx + dy * dy < this.minStep * this.minStep) return;
      }
    }
    this.t.push(t);
    this.x.push(x);
    this.y.push(y);
  }
  done(): PathSamples {
    return {
      t: Float64Array.from(this.t),
      x: Float64Array.from(this.x),
      y: Float64Array.from(this.y),
      n: this.t.length,
    };
  }
}

function sampleTimes(shot: FittedClipShot): number[] {
  const end = shot.result.durationS;
  const times: number[] = [];
  const steps = Math.ceil(end / SAMPLE_STEP_S);
  for (let k = 0; k <= steps; k++) times.push(Math.min(end, k * SAMPLE_STEP_S));
  // Every event too, so that a path turns exactly where a collision turns it.
  for (const e of shot.result.events) if (e.t >= 0 && e.t <= end) times.push(e.t);
  times.sort((a, b) => a - b);
  return times.filter((t, i) => i === 0 || t !== times[i - 1]);
}

function prepareShot(analysis: ClipAnalysis, shot: FittedClipShot): PreparedShot {
  const { result, cueBallId } = shot;
  const kindOf = new Map<string, BallKind>(shot.balls.map((b) => [b.id, b.kind]));

  let firstObject: string | undefined;
  for (const e of result.events) {
    if (e.type !== "ball-ball") continue;
    if (e.ballId === cueBallId) firstObject = e.otherBallId;
    else if (e.otherBallId === cueBallId) firstObject = e.ballId;
    if (firstObject) break;
  }

  const n = result.tracks.length;
  const pictures = result.tracks.map(() => new Builder(MIN_STEP_PX));
  const tables = result.tracks.map(() => new Builder(MIN_STEP_M));
  const dropped = new Array<boolean>(n).fill(false);
  const first: (BallSample | undefined)[] = new Array<BallSample | undefined>(n).fill(undefined);
  const moved = new Array<boolean>(n).fill(false);
  for (const t of sampleTimes(shot)) {
    const samples = sampleAt(result, t);
    for (let i = 0; i < n; i++) {
      const s = samples[i];
      if (!s || dropped[i]) continue;
      if (s.state === "pocketed") {
        dropped[i] = true;
        continue;
      }
      const f = first[i];
      if (!f) first[i] = s;
      else if (s.position.x !== f.position.x || s.position.y !== f.position.y) moved[i] = true;
      const r = result.tracks[i]?.radiusM ?? 0;
      const q = toPicture(analysis, s.position.x, s.position.y, r);
      pictures[i]?.add(t, q ? q.x : NaN, q ? q.y : NaN);
      tables[i]?.add(t, s.position.x, s.position.y);
    }
  }

  const trails: BallTrail[] = result.tracks.map((track, i) => ({
    id: track.id,
    kind: kindOf.get(track.id) ?? "cue",
    role: track.id === cueBallId ? "cue" : track.id === firstObject ? "first-object" : "other",
    radiusM: track.radiusM,
    track: i,
    moved: moved[i] === true,
    picture: (pictures[i] as Builder).done(),
    table: (tables[i] as Builder).done(),
  }));

  let ghost: GhostBall | undefined;
  const contact = firstContactSimS(shot);
  const cueIndex = result.tracks.findIndex((t) => t.id === cueBallId);
  const cueTrack = result.tracks[cueIndex];
  if (contact !== undefined && cueTrack) {
    const at = sampleAt(result, contact)[cueIndex];
    if (at) {
      const { x, y } = at.position;
      const r = cueTrack.radiusM;
      const centre = toPicture(analysis, x, y, r);
      const rPx = apparentRadiusPx(analysis.camera, { x, y, z: r }, r);
      ghost = {
        simS: contact,
        x,
        y,
        radiusM: r,
        picture: centre && rPx !== undefined ? { ...centre, r: rPx } : undefined,
      };
    }
  }
  return { shot, trails, ghost, kindOf };
}

/** Index of the last sample at or before `t`, or -1 if none. */
export function lastIndexAt(s: PathSamples, t: number): number {
  let lo = 0;
  let hi = s.n - 1;
  if (hi < 0 || (s.t[0] as number) > t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((s.t[mid] as number) <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The points of a path from the strike up to shot time `simT`, mapped by `map`, ending at
 * `current` (the ball's exact place at `simT`, or undefined once it has dropped).
 */
export function pathUpTo(
  s: PathSamples,
  simT: number,
  current: PxPoint | undefined,
  map: (x: number, y: number) => PxPoint,
): PxPoint[] {
  const k = lastIndexAt(s, simT);
  const out: PxPoint[] = [];
  for (let i = 0; i <= k; i++) {
    const x = s.x[i] as number;
    const y = s.y[i] as number;
    out.push(Number.isNaN(x) ? { x: NaN, y: NaN } : map(x, y));
  }
  if (current) out.push(current);
  return out;
}

/** The ball size of a kind in this analysis's ball set, radius in metres. */
export function radiusOf(analysis: ClipAnalysis, kind: BallKind): number {
  return ballSizeOf(analysis.ballSet, kind).diameterM / 2;
}

import { sampleAt } from "@baize/physics";
import type { BallInput, ShotInput, SimResult } from "@baize/physics";
import { ballSizeOf } from "@baize/tables";
import type { BallKind, BallSetSpec } from "@baize/tables";
import type { TrackedFrame } from "./track";

/**
 * The strike that best explains a tracked shot (task 7.7, SPEC section 11): the cue ball's
 * direction, speed and tip position, and the moment it was hit, found so that the simulated
 * shot passes as close as possible to where the balls were seen. The fit gives clean paths for
 * the overlays (through the frames where a ball was hidden or blurred), the shot's speed, and
 * a shot the editor can open.
 *
 * The physics is the caller's: `run` simulates a shot with the editor's own models and cloth,
 * as the planner's runner does, so the fitted shot is exactly what the editor will draw.
 */

export type FitRunner = (
  balls: readonly BallInput[],
  shot: Pick<ShotInput, "ballId" | "aimAngleRad" | "speedMps" | "tipOffset">,
) => SimResult;

export interface FitInput {
  readonly ballSet: BallSetSpec;
  /** The balls at rest before the shot, where the tracker had them. */
  readonly balls: readonly {
    readonly id: string;
    readonly kind: BallKind;
    readonly x: number;
    readonly y: number;
  }[];
  readonly cueBallId: string;
  /** The tracked frames of the shot, from its start to its end. */
  readonly frames: readonly TrackedFrame[];
  readonly run: FitRunner;
}

export interface FitResult {
  readonly shot: {
    readonly aimAngleRad: number;
    readonly speedMps: number;
    readonly tipOffset: { readonly side: number; readonly vertical: number };
  };
  /** Clip time of the strike, seconds (positions seen in a frame are compared at frame time minus this). */
  readonly strikeS: number;
  readonly result: SimResult;
  /** Root-mean-square distance between the simulated and the seen positions, metres. */
  readonly rmsM: number;
  readonly evaluations: number;
}

/** The tip stays inside the miscue limit. */
const MAX_TIP = 0.5;
/** A seen position further than this many radii from the simulation counts only this far. */
const CAP_RADII = 4;
const MAX_EVALUATIONS = 600;
/** How steeply a strike time outside its frames is pushed back, metres of error per second. */
const STRIKE_WALL = 10;

interface Params {
  aim: number;
  speed: number;
  vertical: number;
  side: number;
  strike: number;
}

const toVec = (p: Params): number[] => [p.aim, p.speed, p.vertical, p.side, p.strike];
const fromVec = (v: readonly number[]): Params => ({
  aim: v[0] as number,
  speed: v[1] as number,
  vertical: v[2] as number,
  side: v[3] as number,
  strike: v[4] as number,
});

/** Nelder-Mead minimisation from a start point and step sizes. */
function minimise(
  f: (v: number[]) => number,
  start: number[],
  steps: number[],
  maxEvals: number,
): { best: number[]; value: number; evals: number } {
  const n = start.length;
  let evals = 0;
  const value = (v: number[]) => {
    evals++;
    return f(v);
  };
  let simplex = [start, ...steps.map((s, i) => start.map((x, j) => (j === i ? x + s : x)))].map(
    (v) => ({ v, y: value(v) }),
  );
  while (evals < maxEvals) {
    simplex.sort((a, b) => a.y - b.y);
    const best = simplex[0] as { v: number[]; y: number };
    const worst = simplex[n] as { v: number[]; y: number };
    const second = simplex[n - 1] as { v: number[]; y: number };
    if (Math.abs(worst.y - best.y) <= 1e-12 * (1 + Math.abs(best.y))) break;
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const p = (simplex[i] as { v: number[] }).v;
      for (let j = 0; j < n; j++) centroid[j] = (centroid[j] as number) + (p[j] as number) / n;
    }
    const along = (t: number) => centroid.map((c, j) => c + t * ((worst.v[j] as number) - c));
    const reflected = along(-1);
    const yr = value(reflected);
    if (yr < best.y) {
      const expanded = along(-2);
      const ye = value(expanded);
      simplex[n] = ye < yr ? { v: expanded, y: ye } : { v: reflected, y: yr };
    } else if (yr < second.y) {
      simplex[n] = { v: reflected, y: yr };
    } else {
      const contracted = yr < worst.y ? along(-0.5) : along(0.5);
      const yc = value(contracted);
      if (yc < Math.min(yr, worst.y)) {
        simplex[n] = { v: contracted, y: yc };
      } else {
        simplex = simplex.map((p, i) =>
          i === 0
            ? p
            : {
                v: p.v.map((x, j) => (best.v[j] as number) + 0.5 * (x - (best.v[j] as number))),
                y: 0,
              },
        );
        for (let i = 1; i <= n; i++) {
          const p = simplex[i] as { v: number[]; y: number };
          p.y = value(p.v);
        }
      }
    }
  }
  simplex.sort((a, b) => a.y - b.y);
  const best = simplex[0] as { v: number[]; y: number };
  return { best: best.v, value: best.y, evals };
}

export function fitShot(input: FitInput): FitResult | undefined {
  const { frames, cueBallId } = input;
  const cueStart = input.balls.find((b) => b.id === cueBallId);
  if (!cueStart || frames.length < 3) return undefined;
  const balls: BallInput[] = input.balls.map((b) => {
    const size = ballSizeOf(input.ballSet, b.kind);
    return { id: b.id, x: b.x, y: b.y, radiusM: size.diameterM / 2, massKg: size.massKg };
  });
  const R = input.ballSet.object.diameterM / 2;
  const cap = CAP_RADII * R;

  // Where each ball was seen, frame by frame.
  const seen: { t: number; index: number; x: number; y: number }[] = [];
  const cueIndex = balls.findIndex((b) => b.id === cueBallId);
  // The first moment another ball moves: before it, only the cue ball's own run matters.
  const firstOther = frames.find((f) =>
    f.balls.some((b) => b.id !== cueBallId && b.state === "moving"),
  );
  const contactS = firstOther ? firstOther.timeS : Number.POSITIVE_INFINITY;
  for (const f of frames) {
    f.balls.forEach((b) => {
      if (!b.seen && b.state !== "rest") return;
      if (b.state === "pocketed" || b.state === "lost" || b.state === "hidden") return;
      const index = balls.findIndex((x) => x.id === b.id);
      if (index >= 0) seen.push({ t: f.timeS, index, x: b.x, y: b.y });
    });
  }

  // A first guess from the cue ball's first moves: its direction, and its speed back-dated to
  // the strike (a struck ball slides, losing speed quickly at first).
  const cueTrack = frames
    .map((f) => ({ t: f.timeS, b: f.balls.find((b) => b.id === cueBallId) }))
    .filter((p) => p.b && p.b.seen && p.b.state === "moving");
  const a = cueTrack[0];
  const c = cueTrack[Math.min(2, cueTrack.length - 1)];
  if (!a?.b || !c?.b || c === a) return undefined;
  const dx = c.b.x - cueStart.x;
  const dy = c.b.y - cueStart.y;
  const step = Math.hypot(c.b.x - a.b.x, c.b.y - a.b.y) / Math.max(1e-6, c.t - a.t);
  const fps =
    1 / Math.max(1e-6, (frames[1] as TrackedFrame).timeS - (frames[0] as TrackedFrame).timeS);
  const strike0 = a.t - Math.hypot(a.b.x - cueStart.x, a.b.y - cueStart.y) / Math.max(0.05, step);
  // The cue ball was last seen at rest in the frame before `a`.
  const restFrame = [...frames].reverse().find((f) => {
    if (f.timeS >= a.t) return false;
    return f.balls.find((b) => b.id === cueBallId)?.state === "rest";
  });
  const strikeFrom = (restFrame ? restFrame.timeS : a.t - 1 / fps) - 0.5 / fps;
  const strikeTo = a.t + 0.5 / fps;
  const guess: Params = {
    aim: Math.atan2(dy, dx),
    speed: Math.max(0.1, step * 1.1),
    vertical: 0,
    side: 0,
    strike: Math.min(strikeTo, Math.max(strikeFrom, strike0)),
  };

  let lastResult: SimResult | undefined;
  // Stage 1 compares only the cue ball before it reaches another ball, with no side: a smooth
  // problem in the aim, the speed, the moment of the strike and the tip's height (follow or
  // draw changes how a struck ball slides at first). Stage 2 uses everything.
  let firstStage = true;
  const cost = (v: number[]): number => {
    const p = firstStage
      ? fromVec([v[0] as number, v[1] as number, v[3] as number, 0, v[2] as number])
      : fromVec(v);
    const tipR = Math.hypot(p.vertical, p.side);
    // Outside the tip limit or with no speed: a steep wall that keeps the search inside.
    let penalty = 0;
    // The strike is between the last frame with the cue ball at rest and the first with it
    // moving: outside that, a steep wall (a later strike with more speed and less follow
    // could otherwise pass close to the same positions).
    const early = strikeFrom - p.strike;
    const late = p.strike - strikeTo;
    if (early > 0) penalty += (early * STRIKE_WALL) ** 2;
    if (late > 0) penalty += (late * STRIKE_WALL) ** 2;
    if (tipR > MAX_TIP) penalty += (tipR - MAX_TIP) * 1e3;
    if (p.speed <= 0.05) penalty += (0.05 - p.speed) * 1e3;
    const k = tipR > MAX_TIP ? MAX_TIP / tipR : 1;
    let result: SimResult;
    try {
      result = input.run(balls, {
        ballId: cueBallId,
        aimAngleRad: p.aim,
        speedMps: Math.max(0.05, p.speed),
        tipOffset: { side: p.side * k * 0.999, vertical: p.vertical * k * 0.999 },
      });
    } catch {
      return 1e6 + penalty;
    }
    lastResult = result;
    let sum = 0;
    // Positions are compared at each frame's time from the strike; one sampling per frame.
    let cachedT = Number.NaN;
    let samples = sampleAt(result, 0);
    let used = 0;
    for (const s of seen) {
      if (firstStage && (s.index !== cueIndex || s.t >= contactS)) continue;
      used++;
      const t = s.t - p.strike;
      if (t !== cachedT) {
        samples = sampleAt(result, t);
        cachedT = t;
      }
      const at = samples[s.index];
      if (!at) continue;
      const d = Math.min(cap, Math.hypot(at.position.x - s.x, at.position.y - s.y));
      sum += d * d;
    }
    return sum / Math.max(1, used) + penalty;
  };

  // Two ways in, keeping the better: (a) everything at once from the first guess; (b) stage 1,
  // aim, speed and strike time from the cue ball's run to its first contact, then everything.
  firstStage = false;
  const allSteps = [0.01, guess.speed * 0.1, 0.15, 0.1, 0.5 / fps];
  let direct = minimise(cost, toVec(guess), allSteps, MAX_EVALUATIONS / 4);
  const directAgain = minimise(
    cost,
    direct.best,
    allSteps.map((s) => s * 0.3),
    MAX_EVALUATIONS / 4,
  );
  if (directAgain.value <= direct.value) direct = directAgain;
  firstStage = true;
  const first = minimise(
    cost,
    [guess.aim, guess.speed, guess.strike, 0],
    [0.01, guess.speed * 0.1, 0.5 / fps, 0.15],
    MAX_EVALUATIONS / 6,
  );
  firstStage = false;
  const fromFirst = fromVec([
    first.best[0] as number,
    first.best[1] as number,
    first.best[3] as number,
    0,
    first.best[2] as number,
  ]);
  // Stage 2: everything, from stage 1's answer; a second start with smaller steps escapes a
  // collapsed simplex.
  const steps = [0.004, fromFirst.speed * 0.05, 0.15, 0.1, 0.25 / fps];
  let fit = minimise(cost, toVec(fromFirst), steps, MAX_EVALUATIONS / 6);
  const again = minimise(
    cost,
    fit.best,
    steps.map((s) => s * 0.3),
    MAX_EVALUATIONS / 6,
  );
  const evaluations = direct.evals + directAgain.evals + first.evals + fit.evals + again.evals;
  if (again.value <= fit.value) fit = again;
  if (direct.value < fit.value) fit = direct;
  const best = fromVec(fit.best);
  const final = cost(fit.best);
  const result = lastResult;
  if (!result) return undefined;
  const k = Math.min(1, MAX_TIP / Math.max(1e-12, Math.hypot(best.vertical, best.side)));
  return {
    shot: {
      aimAngleRad: best.aim,
      speedMps: Math.max(0.05, best.speed),
      tipOffset: { side: best.side * k * 0.999, vertical: best.vertical * k * 0.999 },
    },
    strikeS: best.strike,
    result,
    rmsM: Math.sqrt(final),
    evaluations: evaluations + 1,
  };
}

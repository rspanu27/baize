import { STANDARD_GRAVITY } from "@baize/physics";
import type { SimResult, Vec2 } from "@baize/physics";
import { chanceInWindow, estimatePot, pathClear, pocketTargets } from "./geometry";
import type { PocketTarget, PotEstimate } from "./geometry";
import { atan2 } from "./math";
import { ballsLeftFor, ballsOn, judgeShot, potValue } from "./rules";
import type { ShotJudgement } from "./rules";
import type { GameState, PlanBall, PlanInput, PlayerLevel, ShotParams, ShotRunner } from "./types";

/**
 * Pot shots for one position, played through the simulator (task 6.4).
 *
 * For each ball on and each pocket it can reach, ranked by the geometric estimate, the aim is
 * refined with the simulator until the object ball leaves along the pocket line (so throw and
 * squirt are allowed for), the window of aims that still pot is found by searching each side,
 * and the aim is moved to the window's middle. Variants of speed and tip are then re-aimed
 * and played at three speeds standing for the player's speed error.
 */

/** A position: where the balls are and what the player is on. */
export interface Position {
  readonly balls: readonly PlanBall[];
  readonly cueBallId: string;
  readonly state: GameState;
}

/** What every step of a planning run shares. `calls` counts runner calls (the budget). */
export interface PlanContext {
  readonly table: PlanInput["table"];
  readonly pockets: readonly PocketTarget[];
  readonly level: PlayerLevel;
  readonly cloth: PlanInput["cloth"];
  readonly run: ShotRunner;
  calls: number;
}

export function makeContext(input: PlanInput): PlanContext {
  const ctx: PlanContext = {
    table: input.table,
    pockets: pocketTargets(input.table),
    level: input.level,
    cloth: input.cloth,
    calls: 0,
    run: (balls, shot) => {
      ctx.calls++;
      return input.run(balls, shot);
    },
  };
  return ctx;
}

/** A ball on, a pocket, and the straight-line picture of the pot. */
export interface PotPair {
  readonly target: PlanBall;
  readonly pocket: PocketTarget;
  readonly estimate: PotEstimate;
  /** Geometric pot chance for the player's level, with no throw, squirt or speed error. */
  readonly geometricChance: number;
  readonly value: number;
}

function cueOf(pos: Position): PlanBall {
  const cue = pos.balls.find((b) => b.id === pos.cueBallId);
  if (!cue) throw new Error(`no cue ball ${pos.cueBallId}`);
  return cue;
}

/** cos(80 degrees): thinner cuts are not tried (ARCHITECTURE section 10). */
const MIN_CUT_COS = 0.17364817766693033;

/**
 * Every pot that is on in straight lines: lines to the contact and to the pocket clear, a cut
 * of at most 80 degrees, a lane the ball fits. Best first (geometric chance times value), ties in
 * ball order then pocket order.
 */
export function potPairs(ctx: PlanContext, pos: Position): PotPair[] {
  const cue = cueOf(pos);
  const on = ballsOn(pos.balls, pos.cueBallId, pos.state);
  const objectBallsLeft = ballsLeftFor(pos.balls, pos.cueBallId, pos.state);
  const pairs: PotPair[] = [];
  for (const target of on) {
    const value = potValue(target.kind, pos.state, objectBallsLeft);
    for (const pocket of ctx.pockets) {
      const estimate = estimatePot({
        cue,
        target,
        cueRadiusM: cue.radiusM,
        targetRadiusM: target.radiusM,
        pocket,
      });
      if (estimate.aimHalfWindowRad <= 0 || estimate.cutCos < MIN_CUT_COS) continue;
      const ids = [cue.id, target.id];
      if (!pathClear(cue, estimate.ghost, cue.radiusM, pos.balls, ids)) continue;
      if (!pathClear(target, pocket.aim, target.radiusM, pos.balls, ids)) continue;
      const w = estimate.aimHalfWindowRad;
      pairs.push({
        target,
        pocket,
        estimate,
        geometricChance: chanceInWindow(w, w, ctx.level.aimErrorRad),
        value,
      });
    }
  }
  // Stable sort keeps ball order then pocket order among equals.
  return pairs
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.geometricChance * b.p.value - a.p.geometricChance * a.p.value || a.i - b.i)
    .map(({ p }) => p);
}

const SPEED_NODE_Z = Math.sqrt(3);

/** Directions from the player's speed error: 3-point Gauss-Hermite nodes and weights. */
export const SPEED_NODES: readonly { readonly z: number; readonly weight: number }[] = [
  { z: -SPEED_NODE_Z, weight: 1 / 6 },
  { z: 0, weight: 2 / 3 },
  { z: SPEED_NODE_Z, weight: 1 / 6 },
];

/** One way of playing a pot, with what happens at the three speeds. */
export interface PotCandidate {
  readonly targetId: string;
  readonly pocketId: PocketTarget["id"];
  readonly shot: ShotParams;
  /** Chance of the pot: inside the aim window, and dropping at the speeds the player may hit. */
  readonly chance: number;
  /** Points or balls the pot is worth. */
  readonly value: number;
  /** Half-width of the aim window that pots, radians. */
  readonly halfWindowRad: number;
  /** The shot at the planned speed, then at the slower and faster speed nodes. */
  readonly outcomes: readonly ShotOutcome[];
}

export interface ShotOutcome {
  readonly weight: number;
  readonly speedMps: number;
  readonly result: SimResult;
  readonly judgement: ShotJudgement;
  /** The intended ball dropped and there was no foul. */
  readonly success: boolean;
}

/** The ways of playing each pot that the generator tries. Defaults are set in `DEFAULT_SHOT_OPTIONS`. */
export interface ShotOptions {
  /** How many pots (ball and pocket) go on to the simulator. */
  readonly maxPairs: number;
  /** Speeds tried, as multiples of the least speed that reaches the pocket. */
  readonly speedFactors: readonly number[];
  /** Tip heights tried with no side (fractions of the radius; negative is draw). */
  readonly verticals: readonly number[];
  /** Side tried, at the `sideVerticals` heights and the middle speed factors. */
  readonly sides: readonly number[];
  readonly sideVerticals: readonly number[];
  /** No shot faster than this. */
  readonly maxSpeedMps: number;
}

export const DEFAULT_SHOT_OPTIONS: ShotOptions = {
  maxPairs: 6,
  speedFactors: [1.3, 1.8, 2.6, 3.8],
  verticals: [-0.4, -0.2, 0, 0.2, 0.4],
  sides: [-0.25, 0.25],
  sideVerticals: [-0.2, 0.2],
  maxSpeedMps: 8,
};

/** The pot's aim, refined and centred in its window. */
interface CentredPot {
  /** Aim at which the object ball leaves along the pocket line. */
  readonly aimRad: number;
  /** Middle of the window that pots. */
  readonly centreRad: number;
  readonly halfWindowRad: number;
  /** Change in the object ball's direction per radian of aim. */
  readonly slope: number;
  readonly desired: Vec2;
}

/** The object ball's departure direction against the wanted one, radians (signed). */
export function departureError(
  result: SimResult,
  cueId: string,
  targetId: string,
  desired: Vec2,
): number | undefined {
  const first = result.events.find(
    (e) => e.type === "ball-ball" && (e.ballId === cueId || e.otherBallId === cueId),
  );
  if (!first || first.type !== "ball-ball") return undefined;
  const other = first.ballId === cueId ? first.otherBallId : first.ballId;
  if (other !== targetId) return undefined;
  const track = result.tracks.find((t) => t.id === targetId);
  const seg = track?.segments.find((s) => s.t0 >= first.t - 1e-12);
  if (!seg) return undefined;
  const v = seg.v0;
  return atan2(desired.x * v.y - desired.y * v.x, desired.x * v.x + desired.y * v.y);
}

const AIM_TOLERANCE_RAD = 2e-5;
/** Tips tried in turn for the shot the window is measured on: stun, follow, draw. */
const BASE_VERTICALS = [0, 0.3, -0.3] as const;
const MAX_REFINE = 5;
const EDGE_BISECTIONS = 6;
const MAX_EDGE_RAD = 0.1;

/** The least cue ball speed that sends the object ball to the pocket with a little pace left. */
export function leastSpeedMps(
  estimate: PotEstimate,
  cloth: PlanInput["cloth"],
  arrivalMps = 0.25,
): number {
  const a = cloth.rollingResistance * STANDARD_GRAVITY;
  // A ball that starts sliding rolls on at 5/7 of its speed, so it needs 7/5 of the rolling
  // speed that carries it the distance.
  const objectSpeed = 1.4 * Math.sqrt(arrivalMps * arrivalMps + 2 * a * estimate.targetDistanceM);
  const atContact = objectSpeed / (0.975 * Math.max(0.2, estimate.cutCos));
  return 1.2 * Math.sqrt(atContact * atContact + 2 * a * estimate.cueDistanceM);
}

function aimAt(from: Vec2, to: Vec2): number {
  return atan2(to.y - from.y, to.x - from.x);
}

function play(
  ctx: PlanContext,
  pos: Position,
  pair: PotPair,
  aimRad: number,
  speedMps: number,
  tip: ShotParams["tipOffset"],
): { result: SimResult; judgement: ShotJudgement; success: boolean } {
  return playPot(ctx, pos, pair.target.id, pair.pocket.id, aimRad, speedMps, tip);
}

function playPot(
  ctx: PlanContext,
  pos: Position,
  targetId: string,
  pocketId: PocketTarget["id"],
  aimRad: number,
  speedMps: number,
  tip: ShotParams["tipOffset"],
): { result: SimResult; judgement: ShotJudgement; success: boolean } {
  const result = ctx.run(pos.balls, {
    ballId: pos.cueBallId,
    aimAngleRad: aimRad,
    speedMps,
    tipOffset: tip,
  });
  const judgement = judgeShot(result, pos.balls, pos.cueBallId, pos.state, {
    targetId,
    pocketId,
  });
  return { result, judgement, success: judgement.intendedPotted && !judgement.foul };
}

/**
 * The candidate's chance with its own window: the aim window is searched again with the
 * candidate's own speed and tip, around its own aim (which may sit off the window's middle).
 * The generator measures one window per pot and shares it among that pot's variants, which can
 * overstate a variant's chance; the search calls this for the shots it keeps.
 */
export function remeasureChance(ctx: PlanContext, pos: Position, c: PotCandidate): PotCandidate {
  const { aimAngleRad, speedMps, tipOffset } = c.shot;
  const w = windowAround(
    (a) => playPot(ctx, pos, c.targetId, c.pocketId, a, speedMps, tipOffset).success,
    aimAngleRad,
    Math.max(2e-4, c.halfWindowRad / 2),
  );
  let speedShare = 0;
  for (const o of c.outcomes) if (o.success) speedShare += o.weight;
  return {
    ...c,
    chance: chanceInWindow(w.low, w.high, ctx.level.aimErrorRad) * speedShare,
    halfWindowRad: (w.low + w.high) / 2,
  };
}

/**
 * Refines the aim for one way of playing the pot, then finds the window of aims that pot and
 * its middle. Undefined when the pot does not drop even at the refined aim.
 */
function centrePot(
  ctx: PlanContext,
  pos: Position,
  pair: PotPair,
  speedMps: number,
  tip: ShotParams["tipOffset"],
): CentredPot | undefined {
  const cue = cueOf(pos);
  const dx = pair.pocket.aim.x - pair.target.x;
  const dy = pair.pocket.aim.y - pair.target.y;
  const l = Math.sqrt(dx * dx + dy * dy);
  const desired = { x: dx / l, y: dy / l };
  const err = (aim: number): number | undefined =>
    departureError(
      play(ctx, pos, pair, aim, speedMps, tip).result,
      pos.cueBallId,
      pair.target.id,
      desired,
    );

  // Secant steps on the departure error, starting from the ghost-ball line.
  let a0 = aimAt(cue, pair.estimate.ghost);
  let f0 = err(a0);
  if (f0 === undefined) return undefined;
  let a1 = a0 + 1e-4;
  let f1 = err(a1);
  if (f1 === undefined) return undefined;
  let slope = (f1 - f0) / (a1 - a0);
  for (let i = 0; i < MAX_REFINE && Math.abs(f1) > AIM_TOLERANCE_RAD; i++) {
    if (f1 === f0 || slope === 0) break;
    const a2 = a1 - f1 / slope;
    const f2 = err(a2);
    if (f2 === undefined) break;
    a0 = a1;
    f0 = f1;
    a1 = a2;
    f1 = f2;
    slope = (f1 - f0) / (a1 - a0);
  }
  if (!Number.isFinite(slope) || slope === 0) return undefined;
  const aimRad = a1;
  if (!play(ctx, pos, pair, aimRad, speedMps, tip).success) return undefined;

  const { low, high } = windowAround(
    (aim) => play(ctx, pos, pair, aim, speedMps, tip).success,
    aimRad,
    Math.max(2e-4, pair.estimate.aimHalfWindowRad / 2),
  );
  return {
    aimRad,
    centreRad: aimRad + (high - low) / 2,
    halfWindowRad: (high + low) / 2,
    slope,
    desired,
  };
}

/**
 * The window of aims around `aimRad` at which `success` holds (it must hold at `aimRad`): each
 * edge is found by stepping out from `startRad` (at most half of `MAX_EDGE_RAD`), doubling,
 * until it fails, then bisecting. Returns how far each edge is from `aimRad` (both positive or
 * zero), at most `MAX_EDGE_RAD`.
 */
export function windowAround(
  success: (aimRad: number) => boolean,
  aimRad: number,
  startRad: number,
): { low: number; high: number } {
  const edge = (sign: number): number => {
    let inside = 0;
    let outside = Math.min(startRad, MAX_EDGE_RAD / 2);
    while (success(aimRad + sign * outside)) {
      inside = outside;
      // A window this wide is as good as certain for any player: report the cap.
      if (outside >= MAX_EDGE_RAD) return MAX_EDGE_RAD;
      outside = Math.min(MAX_EDGE_RAD, outside * 2);
    }
    for (let i = 0; i < EDGE_BISECTIONS; i++) {
      const mid = (inside + outside) / 2;
      if (success(aimRad + sign * mid)) inside = mid;
      else outside = mid;
    }
    return (inside + outside) / 2;
  };
  return { high: edge(1), low: edge(-1) };
}

/** The speeds and tips tried for a pot, in a fixed order. */
function variants(
  least: number,
  topSpeed: number,
  options: ShotOptions,
): { speedMps: number; tip: ShotParams["tipOffset"] }[] {
  const out: { speedMps: number; tip: ShotParams["tipOffset"] }[] = [];
  const speeds = options.speedFactors.map((f) => Math.min(topSpeed, f * least));
  for (const speedMps of speeds) {
    for (const vertical of options.verticals) out.push({ speedMps, tip: { side: 0, vertical } });
  }
  const middle = speeds.slice(1, -1);
  for (const speedMps of middle) {
    for (const vertical of options.sideVerticals) {
      for (const side of options.sides) out.push({ speedMps, tip: { side, vertical } });
    }
  }
  return out;
}

/**
 * Pot candidates for a position: for the best `maxPairs` pots, every variant of speed and tip
 * that drops at the planned speed, with its chance. Best chance-times-value first.
 */
export function potCandidates(
  ctx: PlanContext,
  pos: Position,
  options: ShotOptions = DEFAULT_SHOT_OPTIONS,
): PotCandidate[] {
  const it = potCandidateSteps(ctx, pos, options);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** `potCandidates` one pot at a time: yields before each pot, so a caller can pause between. */
export function* potCandidateSteps(
  ctx: PlanContext,
  pos: Position,
  options: ShotOptions = DEFAULT_SHOT_OPTIONS,
): Generator<undefined, PotCandidate[], undefined> {
  const out: PotCandidate[] = [];
  for (const pair of potPairs(ctx, pos).slice(0, options.maxPairs)) {
    yield;
    const least = leastSpeedMps(pair.estimate, ctx.cloth);
    // The fastest planned speed leaves room for the player hitting it harder by mistake.
    const topSpeed = options.maxSpeedMps / (1 + SPEED_NODE_Z * ctx.level.speedError);
    const baseSpeed = Math.min(topSpeed, least * (options.speedFactors[1] ?? 1.8));
    // The window is measured on a stun shot; if that scratches or misses, on follow, then draw.
    let base: CentredPot | undefined;
    for (const vertical of BASE_VERTICALS) {
      base = centrePot(ctx, pos, pair, baseSpeed, { side: 0, vertical });
      if (base) break;
    }
    if (!base) continue;
    // The direction the object ball leaves in at the middle of the base window.
    const wanted = base.slope * (base.centreRad - base.aimRad);
    for (const v of variants(least, topSpeed, options)) {
      // Re-aim the variant so its object ball leaves where the base window's middle sends it.
      const probe = play(ctx, pos, pair, base.centreRad, v.speedMps, v.tip);
      const f = departureError(probe.result, pos.cueBallId, pair.target.id, base.desired);
      if (f === undefined) continue;
      const aimRad = base.centreRad + (wanted - f) / base.slope;
      const outcomes: ShotOutcome[] = SPEED_NODES.map((node) => {
        const speedMps = v.speedMps * (1 + node.z * ctx.level.speedError);
        const r =
          node.z === 0 && Math.abs(aimRad - base.centreRad) < 1e-9
            ? probe
            : play(ctx, pos, pair, aimRad, speedMps, v.tip);
        return { weight: node.weight, speedMps, ...r };
      });
      // Planned speed first.
      outcomes.sort((a, b) =>
        a.weight === b.weight ? a.speedMps - b.speedMps : b.weight - a.weight,
      );
      const centre = outcomes[0];
      if (!centre?.success) continue;
      let speedShare = 0;
      for (const o of outcomes) if (o.success) speedShare += o.weight;
      const w = base.halfWindowRad;
      out.push({
        targetId: pair.target.id,
        pocketId: pair.pocket.id,
        shot: { aimAngleRad: aimRad, speedMps: v.speedMps, tipOffset: v.tip },
        chance: chanceInWindow(w, w, ctx.level.aimErrorRad) * speedShare,
        value: pair.value,
        halfWindowRad: w,
        outcomes,
      });
    }
  }
  return out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.chance * b.c.value - a.c.chance * a.c.value || a.i - b.i)
    .map(({ c }) => c);
}

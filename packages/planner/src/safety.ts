import { STANDARD_GRAVITY, sampleAt } from "@baize/physics";
import { pathClear } from "./geometry";
import { atan2 } from "./math";
import { positionAfter, positionValue } from "./position";
import { ballsLeftFor, ballsOn, judgeShot, potValue } from "./rules";
import { SPEED_NODES } from "./shots";
import type { PlanContext, Position, ShotOutcome } from "./shots";
import type { GameState, PlanBall, PlannedShot, ShotParams } from "./types";

/**
 * Safety shots (task 6.7): when no pot is reasonable, shots that hit a ball on legally and leave
 * the opponent as little as possible. A safety is scored by the value of the best pot the
 * opponent would have afterwards (the widened geometric estimate, chance times value),
 * averaged over the player's aim and speed errors; an outcome that fouls counts as giving the
 * opponent their best ball for certain.
 */

/** What the opponent is on after a safety: the same ball for snooker reds and nine-ball, the other group for eight-ball. */
export function opponentState(
  state: GameState,
  balls: readonly PlanBall[],
  cueBallId: string,
): GameState {
  switch (state.game) {
    case "snooker": {
      const reds = balls.some((b) => b.id !== cueBallId && b.kind === "red");
      if (reds) return { game: "snooker", phase: "red" };
      return { game: "snooker", phase: "colours" };
    }
    case "eight-ball": {
      const other = {
        solids: "stripes",
        stripes: "solids",
        reds: "yellows",
        yellows: "reds",
      } as const;
      return { game: "eight-ball", group: other[state.group] };
    }
    default:
      return state;
  }
}

export interface SafetyOptions {
  /** Contact as a share of a full ball's offset: 0 is full ball, +-0.9 very thin. */
  readonly contacts: readonly number[];
  /** Speeds as shares of the speed that rolls a ball one table length. */
  readonly speedShares: readonly number[];
  /** How many balls on are tried (nearest first). */
  readonly maxTargets: number;
  /** How many safeties are returned. */
  readonly keep: number;
}

export const DEFAULT_SAFETY_OPTIONS: SafetyOptions = {
  contacts: [-0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85],
  speedShares: [0.35, 0.55, 0.8, 1.1],
  maxTargets: 4,
  keep: 3,
};

/** Aim from `from` that passes the target's centre at a signed offset `offsetM` (a contact). */
function aimWithOffset(from: PlanBall, target: PlanBall, offsetM: number): number | undefined {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  const s = offsetM / d;
  if (Math.abs(s) >= 1) return undefined;
  const c = Math.sqrt(1 - s * s);
  // Turn the line to the target by the small angle whose sine is s.
  const ux = (dx / d) * c + (dy / d) * s;
  const uy = (dy / d) * c - (dx / d) * s;
  return atan2(uy, ux);
}

/** The opponent's best ball for certain: what a foul is taken to give away. */
function foulCost(pos: Position): number {
  const opp = opponentState(pos.state, pos.balls, pos.cueBallId);
  let best = 0;
  for (const b of ballsOn(pos.balls, pos.cueBallId, opp)) {
    best = Math.max(best, potValue(b.kind, opp, ballsLeftFor(pos.balls, pos.cueBallId, opp)));
  }
  return best;
}

/** What the opponent has after one outcome (lower is a better safety). */
function leftFor(ctx: PlanContext, pos: Position, o: ShotOutcome, cost: number): number {
  if (o.judgement.foul || o.judgement.potted.length > 0) return cost;
  const after = positionAfter(ctx, pos, o);
  const opp = opponentState(pos.state, after.balls, pos.cueBallId);
  return positionValue(ctx, { balls: after.balls, cueBallId: pos.cueBallId, state: opp });
}

/** The value the opponent would have if it were their turn in this position, as it stands. */
export function opponentValueNow(ctx: PlanContext, pos: Position): number {
  const opp = opponentState(pos.state, pos.balls, pos.cueBallId);
  return positionValue(ctx, { balls: pos.balls, cueBallId: pos.cueBallId, state: opp });
}

/** A safety, with what it leaves the opponent. */
export interface SafetyShot extends PlannedShot {
  readonly kind: "safety";
  /** Expected value of the opponent's best pot afterwards (0 is nothing on). */
  readonly leaves: number;
}

/** The best safeties for a position, least left for the opponent first. */
export function safetyShots(
  ctx: PlanContext,
  pos: Position,
  options: SafetyOptions = DEFAULT_SAFETY_OPTIONS,
): SafetyShot[] {
  const it = safetyShotSteps(ctx, pos, options);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** `safetyShots` one ball at a time: yields before each ball, so a caller can pause between. */
export function* safetyShotSteps(
  ctx: PlanContext,
  pos: Position,
  options: SafetyOptions = DEFAULT_SAFETY_OPTIONS,
): Generator<undefined, SafetyShot[], undefined> {
  const cue = pos.balls.find((b) => b.id === pos.cueBallId);
  if (!cue) return [];
  const cost = foulCost(pos);
  const lengthM = ctx.table.playingArea.lengthM;
  const lag = 1.4 * Math.sqrt(2 * ctx.cloth.rollingResistance * STANDARD_GRAVITY * lengthM);
  const dist = (b: PlanBall) => (b.x - cue.x) * (b.x - cue.x) + (b.y - cue.y) * (b.y - cue.y);
  const targets = ballsOn(pos.balls, pos.cueBallId, pos.state)
    .map((b, i) => ({ b, i }))
    .sort((p, q) => dist(p.b) - dist(q.b) || p.i - q.i)
    .map(({ b }) => b)
    .filter((b) => pathClear(cue, b, cue.radiusM, pos.balls, [cue.id, b.id]))
    .slice(0, options.maxTargets);

  const aimNodes = [
    { z: -Math.sqrt(3), weight: 1 / 6 },
    { z: Math.sqrt(3), weight: 1 / 6 },
  ];
  const out: { s: SafetyShot; i: number }[] = [];
  for (const target of targets) {
    yield;
    const sumR = cue.radiusM + target.radiusM;
    for (const contact of options.contacts) {
      const aim = aimWithOffset(cue, target, contact * sumR);
      if (aim === undefined) continue;
      for (const share of options.speedShares) {
        const speedMps = share * lag;
        const shot: ShotParams = {
          aimAngleRad: aim,
          speedMps,
          tipOffset: { side: 0, vertical: 0 },
        };
        const play = (aimRad: number, speed: number, weight: number): ShotOutcome => {
          const result = ctx.run(pos.balls, {
            ballId: pos.cueBallId,
            aimAngleRad: aimRad,
            speedMps: speed,
            tipOffset: shot.tipOffset,
          });
          const judgement = judgeShot(result, pos.balls, pos.cueBallId, pos.state, {
            targetId: target.id,
          });
          return { weight, speedMps: speed, result, judgement, success: !judgement.foul };
        };
        const planned = play(aim, speedMps, 1 / 3);
        if (planned.judgement.foul || planned.judgement.potted.length > 0) continue;
        // The planned shot, the aim errors and the speed errors: a star of five shots.
        const outcomes: ShotOutcome[] = [planned];
        for (const n of aimNodes) {
          outcomes.push(play(aim + n.z * ctx.level.aimErrorRad, speedMps, n.weight));
        }
        for (const n of SPEED_NODES) {
          if (n.z === 0) continue;
          outcomes.push(play(aim, speedMps * (1 + n.z * ctx.level.speedError), n.weight));
        }
        let leaves = 0;
        let legal = 0;
        for (const o of outcomes) {
          leaves += o.weight * leftFor(ctx, pos, o, cost);
          if (o.success) legal += o.weight;
        }
        const finals = sampleAt(planned.result, planned.result.durationS);
        const stop = finals.find((b) => b.id === pos.cueBallId)?.position ?? {
          x: Number.NaN,
          y: Number.NaN,
        };
        out.push({
          s: {
            kind: "safety",
            targetId: target.id,
            shot,
            chance: legal,
            value: 0,
            result: planned.result,
            cueStop: { x: stop.x, y: stop.y },
            leaves,
          },
          i: out.length,
        });
      }
    }
  }
  return out
    .sort((a, b) => a.s.leaves - b.s.leaves || a.i - b.i)
    .slice(0, options.keep)
    .map(({ s }) => s);
}

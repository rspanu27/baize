import { chanceInWindow } from "./geometry";
import { afterShot } from "./rules";
import { potPairs } from "./shots";
import type { PlanContext, PotCandidate, Position, ShotOutcome } from "./shots";

/**
 * How good a position is for the next shot (task 6.5), without the simulator: the best pot by
 * the geometric estimate, chance times value.
 *
 * The straight-line window leaves out how the jaws funnel a ball in and how much of the drop
 * circle a ball may cross; against the simulator's own windows it is too narrow by a factor of
 * 1.5 to 2.2 at the median (test/calibration.test.ts measures this on the smallest and largest
 * presets and a custom table). It is widened by this factor so that the end-of-route estimate
 * and the simulated pot chances are on the same scale.
 */
export const GEOMETRIC_WINDOW_SCALE = 1.8;

/** The best next pot from a position, by the widened geometric estimate: chance times value. */
export function positionValue(ctx: PlanContext, pos: Position): number {
  let best = 0;
  for (const pair of potPairs(ctx, pos)) {
    const w = pair.estimate.aimHalfWindowRad * GEOMETRIC_WINDOW_SCALE;
    const v = chanceInWindow(w, w, ctx.level.aimErrorRad) * pair.value;
    if (v > best) best = v;
  }
  return best;
}

/** The position after one outcome of a shot (balls moved, potted ones off, state moved on). */
export function positionAfter(ctx: PlanContext, pos: Position, outcome: ShotOutcome): Position {
  const next = afterShot(
    outcome.result,
    pos.balls,
    pos.cueBallId,
    pos.state,
    ctx.table,
    outcome.judgement,
  );
  return { balls: next.balls, cueBallId: pos.cueBallId, state: next.state };
}

/**
 * The value of the position a pot leaves, given that it drops: the next shot's value averaged
 * over the speeds the player may hit, counting only the speeds at which it drops. 0 when the
 * shot ends the rack.
 */
export function leaveValue(ctx: PlanContext, pos: Position, candidate: PotCandidate): number {
  let total = 0;
  let weight = 0;
  for (const o of candidate.outcomes) {
    if (!o.success) continue;
    weight += o.weight;
    if (o.judgement.finished) continue;
    total += o.weight * positionValue(ctx, positionAfter(ctx, pos, o));
  }
  return weight > 0 ? total / weight : 0;
}

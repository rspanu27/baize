import type { PocketId, SimResult } from "@baize/physics";
import { chanceInWindow } from "./geometry";
import { positionAfter, positionValue } from "./position";
import { judgeShot } from "./rules";
import type { ShotJudgement } from "./rules";
import { SPEED_NODES, makeContext, windowAround } from "./shots";
import type { Position } from "./shots";
import type { PlanInput, ShotParams } from "./types";

/**
 * Rating of a shot the user set up by hand (task 6.10), so that "my shot" can be compared with
 * the planner's: what it pots, how likely that is for the player's level, and how good the
 * position it leaves is. The shot is judged as played: the ball it pots first is taken as the
 * one meant, and the window of aims that still pot that ball in that pocket is searched around
 * the user's own aim (which need not be its middle).
 */
export interface ShotRating {
  /** The shot as set up. */
  readonly result: SimResult;
  readonly judgement: ShotJudgement;
  /** The ball meant and its pocket: the first ball potted legally, if any. */
  readonly potted?: { readonly targetId: string; readonly pocketId: PocketId };
  /** Chance of the pot for the player's level (0 when nothing is potted legally). */
  readonly chance: number;
  /** How far the aim can go each way and still pot, radians. */
  readonly window?: { readonly low: number; readonly high: number };
  /** Value of the next shot from where the balls stop (the geometric estimate), if it pots. */
  readonly leaves: number;
  /** Simulator calls used. */
  readonly runnerCalls: number;
}

export function rateShot(input: PlanInput, shot: ShotParams): ShotRating {
  const ctx = makeContext(input);
  const pos: Position = { balls: input.balls, cueBallId: input.cueBallId, state: input.state };
  const run = (aimRad: number, speedMps: number) =>
    ctx.run(input.balls, {
      ballId: input.cueBallId,
      aimAngleRad: aimRad,
      speedMps,
      tipOffset: shot.tipOffset,
    });
  const result = run(shot.aimAngleRad, shot.speedMps);
  const judgement = judgeShot(result, input.balls, input.cueBallId, input.state);
  const firstPot = result.events.find((e) => e.type === "pocket" && e.ballId !== input.cueBallId);
  if (judgement.foul || !firstPot || firstPot.type !== "pocket") {
    return { result, judgement, chance: 0, leaves: 0, runnerCalls: ctx.calls };
  }
  const intended = { targetId: firstPot.ballId, pocketId: firstPot.pocketId };
  const pots = (aimRad: number, speedMps: number): boolean => {
    const j = judgeShot(run(aimRad, speedMps), input.balls, input.cueBallId, input.state, intended);
    return j.intendedPotted && !j.foul;
  };
  const window = windowAround((a) => pots(a, shot.speedMps), shot.aimAngleRad, 2e-4);
  let speedShare = 0;
  let leaves = 0;
  for (const node of SPEED_NODES) {
    const speedMps = shot.speedMps * (1 + node.z * ctx.level.speedError);
    const r = node.z === 0 ? result : run(shot.aimAngleRad, speedMps);
    const j =
      node.z === 0 ? judgement : judgeShot(r, input.balls, input.cueBallId, input.state, intended);
    const ok = node.z === 0 ? true : j.intendedPotted && !j.foul;
    if (!ok) continue;
    speedShare += node.weight;
    if (!j.finished) {
      const outcome = { weight: node.weight, speedMps, result: r, judgement: j, success: true };
      leaves += node.weight * positionValue(ctx, positionAfter(ctx, pos, outcome));
    }
  }
  return {
    result,
    judgement,
    potted: intended,
    chance: chanceInWindow(window.low, window.high, ctx.level.aimErrorRad) * speedShare,
    window,
    leaves: speedShare > 0 ? leaves / speedShare : 0,
    runnerCalls: ctx.calls,
  };
}

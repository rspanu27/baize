import type { SimInput } from "../src/index";
import { FAST, POOL_9, POOL_BALLS, SNOOKER_12, SNOOKER_BALLS, rackInput, spot } from "./helpers";

/** Break shots shared by the golden tests, the performance test and the benchmark. */

export function nineBallBreak(): SimInput {
  return {
    ...rackInput(POOL_9, POOL_BALLS, "pool-9ball"),
    shot: {
      ballId: "cue-0",
      aimAngleRad: Math.PI / 2 + 0.004,
      speedMps: 8.5,
      tipOffset: { side: -0.05, vertical: 0.15 },
    },
  };
}

export function snookerBreakOff(): SimInput {
  const input = rackInput(SNOOKER_12, SNOOKER_BALLS, "snooker-15");
  const cue = input.balls[0];
  if (!cue) throw new Error("no cue ball");
  const pink = spot(SNOOKER_12, "pink");
  // Into the back right of the pack with running side, as in a normal break-off.
  const aim = Math.atan2(pink.y + 0.2 - cue.y, pink.x + 0.1 - cue.x);
  return {
    ...input,
    shot: {
      ballId: "cue-0",
      aimAngleRad: aim,
      speedMps: 3.5,
      tipOffset: { side: 0.25, vertical: 0.1 },
    },
  };
}

export function snookerPackSplit(): SimInput {
  const input = rackInput(SNOOKER_12, SNOOKER_BALLS, "snooker-15", FAST);
  const cue = input.balls[0];
  if (!cue) throw new Error("no cue ball");
  const pink = spot(SNOOKER_12, "pink");
  // Hard into the middle of the pack: the busiest shot there is.
  const aim = Math.atan2(pink.y + 0.12 - cue.y, pink.x + 0.02 - cue.x);
  return {
    ...input,
    shot: { ballId: "cue-0", aimAngleRad: aim, speedMps: 7, tipOffset: { side: 0, vertical: 0.2 } },
  };
}

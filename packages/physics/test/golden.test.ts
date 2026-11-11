import { expect, test } from "vitest";
import { sampleAt, simulate } from "../src/index";
import type { SimInput, SimResult } from "../src/index";
import {
  BLACKBALL_6,
  BLACKBALL_BALLS,
  MEDIUM,
  POOL_9,
  POOL_BALLS,
  poolBall,
  rackInput,
} from "./helpers";
import { nineBallBreak, snookerBreakOff, snookerPackSplit } from "./scenes";

/**
 * Golden tests: the complete event list and final positions of a few saved shots.
 *
 * The simulator must be bit-for-bit deterministic, so these snapshots only change when the
 * physics changes. If one fails, check that the change was intended, then update with
 * `pnpm --filter @baize/physics exec vitest run test/golden.test.ts -u` and say why in the
 * commit message.
 */

function summary(result: SimResult): unknown {
  return {
    status: result.status,
    durationS: result.durationS,
    events: result.events,
    finalPositions: sampleAt(result, result.durationS + 1).map((b) => ({
      id: b.id,
      state: b.state,
      x: b.position.x,
      y: b.position.y,
    })),
  };
}

test("golden: 9-ball break", () => {
  expect(summary(simulate(nineBallBreak()))).toMatchSnapshot();
});

test("golden: snooker break-off", () => {
  expect(summary(simulate(snookerBreakOff()))).toMatchSnapshot();
});

test("golden: snooker pack split on fast cloth", () => {
  expect(summary(simulate(snookerPackSplit()))).toMatchSnapshot();
});

test("golden: blackball break with a small cue ball", () => {
  const input: SimInput = {
    ...rackInput(BLACKBALL_6, BLACKBALL_BALLS, "blackball"),
    shot: {
      ballId: "cue-0",
      aimAngleRad: Math.PI / 2 - 0.01,
      speedMps: 6,
      tipOffset: { side: 0.1, vertical: -0.1 },
    },
  };
  expect(summary(simulate(input))).toMatchSnapshot();
});

test("golden: two-cushion position shot with side spin", () => {
  const W = POOL_9.playingArea.widthM;
  const input: SimInput = {
    table: POOL_9,
    cloth: MEDIUM,
    ballRestitution: POOL_BALLS.restitution,
    balls: [
      poolBall("cue", W * 0.35, 0.6),
      poolBall("one", W * 0.62, 1.9),
      poolBall("two", W * 0.2, 1.3),
    ],
    shot: {
      ballId: "cue",
      aimAngleRad: 1.33,
      speedMps: 3,
      tipOffset: { side: 0.3, vertical: 0.2 },
    },
  };
  expect(summary(simulate(input))).toMatchSnapshot();
});

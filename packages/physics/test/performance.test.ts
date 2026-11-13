import { expect, test } from "vitest";
import { BALL_BALL_FRICTION } from "@baize/tables";
import { frictionalBallBall, mathavanCushion, prepareTable, simulate } from "../src/index";
import type { SimInput } from "../src/index";
import { nineBallBreak, snookerBreakOff, snookerPackSplit } from "./scenes";

/**
 * SPEC 5.7: a full break must simulate in well under 50 ms so the editor can re-simulate on
 * every drag. The table is prepared once, as the editor does. The limit here is the spec's
 * 50 ms; typical times are a small fraction of that, so this only fails on a real regression.
 */

function medianMs(input: SimInput, runs: number): number {
  const prepared: SimInput = {
    ...input,
    table: prepareTable("kind" in input.table ? input.table.table : input.table),
  };
  for (let i = 0; i < 5; i++) simulate(prepared);
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    simulate(prepared);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
}

test.each([
  ["9-ball break", nineBallBreak],
  ["snooker break-off", snookerBreakOff],
  ["snooker pack split", snookerPackSplit],
])("%s simulates in under 50 ms", (_name, make) => {
  const input = make();
  const result = simulate(input);
  expect(result.status).toBe("complete");
  expect(medianMs(input, 15)).toBeLessThan(50);
});

test.each([
  ["9-ball break", nineBallBreak],
  ["snooker break-off", snookerBreakOff],
  ["snooker pack split", snookerPackSplit],
])("%s with the version 2 models simulates in under 50 ms", (_name, make) => {
  const input: SimInput = {
    ...make(),
    models: { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion },
  };
  const result = simulate(input);
  expect(result.status).toBe("complete");
  // Measured on 2026-11-13: 1 to 3 ms.
  expect(medianMs(input, 15)).toBeLessThan(50);
});

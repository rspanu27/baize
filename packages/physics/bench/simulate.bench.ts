import { test } from "vitest";
import { prepareTable, simulate } from "../src/index";
import type { SimInput } from "../src/index";
import { nineBallBreak, snookerBreakOff, snookerPackSplit } from "../test/scenes";

function prepared(input: SimInput): SimInput {
  return { ...input, table: prepareTable("kind" in input.table ? input.table.table : input.table) };
}

test("break shots", async ({ bench }) => {
  const nine = prepared(nineBallBreak());
  const breakOff = prepared(snookerBreakOff());
  const split = prepared(snookerPackSplit());
  await bench("9-ball break", () => {
    simulate(nine);
  }).run();
  await bench("snooker break-off", () => {
    simulate(breakOff);
  }).run();
  await bench("snooker pack split", () => {
    simulate(split);
  }).run();
});

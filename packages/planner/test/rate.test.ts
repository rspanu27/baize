import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { rateShot } from "../src/rate";
import { makeContext, potCandidates } from "../src/shots";
import type { PlanInput } from "../src/types";
import { MEDIUM, TABLES, ball, must, runnerFor } from "./helpers";

const STRONG = must(getPlayerLevel("strong"), "strong");
const table = must(TABLES[2], "custom pool table");
const W = table.playingArea.widthM;
const L = table.playingArea.lengthM;

const input: PlanInput = {
  table,
  balls: [
    ball(table, "cue", "cue", W * 0.4, L * 0.35),
    ball(table, "1", "1", W * 0.3, L * 0.7),
    ball(table, "9", "9", W * 0.7, L * 0.2),
  ],
  cueBallId: "cue",
  state: { game: "nine-ball" },
  level: STRONG,
  cloth: MEDIUM,
  run: runnerFor(table),
};

describe("rating a shot set up by hand", () => {
  test("the planner's own shot rates about as the planner says", () => {
    const ctx = makeContext(input);
    const best = must(
      potCandidates(ctx, { balls: input.balls, cueBallId: "cue", state: input.state })[0],
      "a candidate",
    );
    const r = rateShot(input, best.shot);
    expect(r.potted).toEqual({ targetId: best.targetId, pocketId: best.pocketId });
    expect(r.judgement.foul).toBe(false);
    // Aimed at the middle of its window, the rating's window is about symmetric and its
    // chance is close to the planner's.
    const w = must(r.window, "window");
    expect(Math.abs(w.high - w.low)).toBeLessThan(0.25 * (w.high + w.low));
    expect(Math.abs(r.chance - best.chance)).toBeLessThan(0.1);
    expect(r.leaves).toBeGreaterThanOrEqual(0);
    expect(r.runnerCalls).toBeGreaterThan(3);
  });

  test("an aim off the middle of the window rates lower", () => {
    const ctx = makeContext(input);
    const best = must(
      potCandidates(ctx, { balls: input.balls, cueBallId: "cue", state: input.state })[0],
      "a candidate",
    );
    const centred = rateShot(input, best.shot);
    const w = must(centred.window, "window");
    const off = rateShot(input, {
      ...best.shot,
      aimAngleRad: best.shot.aimAngleRad + 0.7 * w.high,
    });
    expect(off.potted).toEqual(centred.potted);
    expect(off.chance).toBeLessThan(centred.chance);
  });

  test("a miss rates zero", () => {
    const r = rateShot(input, {
      aimAngleRad: -Math.PI / 2,
      speedMps: 1,
      tipOffset: { side: 0, vertical: 0 },
    });
    expect(r.chance).toBe(0);
    expect(r.potted).toBeUndefined();
    expect(r.leaves).toBe(0);
  });
});

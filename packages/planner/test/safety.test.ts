import { getTablePreset } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { judgeShot } from "../src/rules";
import { opponentState, opponentValueNow, safetyShots } from "../src/safety";
import { DEFAULT_SEARCH_OPTIONS, planRoute } from "../src/search";
import { makeContext } from "../src/shots";
import type { GameState, PlanBall, PlanInput } from "../src/types";
import { MEDIUM, TABLES, ball, must, runnerFor } from "./helpers";

const STRONG = must(getPlayerLevel("strong"), "strong");

function inputOf(
  table: PlanInput["table"],
  balls: PlanBall[],
  state: GameState,
  level = STRONG,
): PlanInput {
  return { table, balls, cueBallId: "cue", state, level, cloth: MEDIUM, run: runnerFor(table) };
}

const pool = must(TABLES[2], "custom pool table");
const snooker = must(getTablePreset("snooker-12@1"), "snooker 12 ft");

const fixtures: { name: string; input: PlanInput }[] = [
  {
    name: "nine-ball: the 1 near the top, the opponent would have it easily",
    input: (() => {
      const W = pool.playingArea.widthM;
      const L = pool.playingArea.lengthM;
      return inputOf(
        pool,
        [
          ball(pool, "cue", "cue", W * 0.5, L * 0.55),
          ball(pool, "1", "1", W * 0.35, L * 0.8),
          ball(pool, "2", "2", W * 0.7, L * 0.3),
          ball(pool, "9", "9", W * 0.2, L * 0.15),
        ],
        { game: "nine-ball" },
      );
    })(),
  },
  {
    name: "snooker: reds at the top, the cue ball near them",
    input: (() => {
      const W = snooker.playingArea.widthM;
      const L = snooker.playingArea.lengthM;
      return inputOf(
        snooker,
        [
          ball(snooker, "cue", "cue", W * 0.5, L * 0.62),
          ball(snooker, "r1", "red", W * 0.45, L * 0.8),
          ball(snooker, "r2", "red", W * 0.58, L * 0.84),
          ball(snooker, "r3", "red", W * 0.3, L * 0.7),
          ball(snooker, "black", "black", W * 0.5, L * 0.909),
        ],
        { game: "snooker", phase: "red" },
      );
    })(),
  },
];

describe.each(fixtures.map((f) => [f.name, f.input] as const))("%s", (_name, input) => {
  test("the best safety is legal and leaves the opponent less than the position as it stands", () => {
    const ctx = makeContext(input);
    const pos = { balls: input.balls, cueBallId: "cue", state: input.state };
    const now = opponentValueNow(ctx, pos);
    const safeties = safetyShots(ctx, pos);
    const best = must(safeties[0], "a safety");
    expect(now).toBeGreaterThan(0);
    expect(best.leaves).toBeLessThan(now);
    expect(best.kind).toBe("safety");
    const sim = input.run(input.balls, { ballId: "cue", ...best.shot });
    const j = judgeShot(sim, input.balls, "cue", input.state, { targetId: best.targetId });
    expect(j.foul).toBe(false);
    expect(j.potted).toEqual([]);
    // Sorted: least left first.
    for (let i = 1; i < safeties.length; i++) {
      expect(must(safeties[i], "s").leaves).toBeGreaterThanOrEqual(
        must(safeties[i - 1], "s").leaves,
      );
    }
  });
});

describe("in the search", () => {
  test("a beginner facing a long thin cut is offered safeties", () => {
    const W = pool.playingArea.widthM;
    const L = pool.playingArea.lengthM;
    const beginner = must(getPlayerLevel("beginner"), "beginner");
    const input = inputOf(
      pool,
      [
        ball(pool, "cue", "cue", W * 0.15, L * 0.1),
        ball(pool, "1", "1", W * 0.8, L * 0.75),
        ball(pool, "9", "9", W * 0.3, L * 0.5),
      ],
      { game: "nine-ball" },
      beginner,
    );
    const r = planRoute(input, { ...DEFAULT_SEARCH_OPTIONS, budget: 5_000 });
    const first = r.best?.steps[0];
    if (!first || first.chance < DEFAULT_SEARCH_OPTIONS.safetyBelow) {
      expect(must(r.safeties, "safeties").length).toBeGreaterThan(0);
    } else {
      expect(r.safeties).toBeUndefined();
    }
  });

  test("an easy pot is not offered safeties", () => {
    const W = pool.playingArea.widthM;
    const L = pool.playingArea.lengthM;
    const input = inputOf(
      pool,
      [
        ball(pool, "cue", "cue", W * 0.5, L * 0.6),
        ball(pool, "1", "1", W * 0.5, L * 0.75),
        ball(pool, "9", "9", W * 0.3, L * 0.3),
      ],
      { game: "nine-ball" },
    );
    const r = planRoute(input, { ...DEFAULT_SEARCH_OPTIONS, budget: 5_000 });
    expect(must(r.best?.steps[0], "first step").chance).toBeGreaterThan(0.4);
    expect(r.safeties).toBeUndefined();
  });
});

describe("opponent state", () => {
  test("eight-ball swaps groups; snooker stays on reds while reds remain", () => {
    expect(opponentState({ game: "eight-ball", group: "solids" }, [], "cue")).toEqual({
      game: "eight-ball",
      group: "stripes",
    });
    expect(opponentState({ game: "eight-ball", group: "reds" }, [], "cue")).toEqual({
      game: "eight-ball",
      group: "yellows",
    });
    const red = ball(snooker, "r", "red", 1, 1);
    expect(opponentState({ game: "snooker", phase: "colour" }, [red], "cue")).toEqual({
      game: "snooker",
      phase: "red",
    });
    expect(opponentState({ game: "snooker", phase: "colour" }, [], "cue")).toEqual({
      game: "snooker",
      phase: "colours",
    });
    expect(opponentState({ game: "nine-ball" }, [], "cue")).toEqual({ game: "nine-ball" });
  });
});

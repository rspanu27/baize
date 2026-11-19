import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { afterShot, judgeShot } from "../src/rules";
import { DEFAULT_SEARCH_OPTIONS, planRoute, planRoutes } from "../src/search";
import type { SearchOptions } from "../src/search";
import type { PlanInput } from "../src/types";
import { BENCHMARKS } from "./fixtures";
import type { Benchmark } from "./fixtures";
import { MEDIUM, must, runnerFor } from "./helpers";

const STRONG = must(getPlayerLevel("strong"), "strong");
const OPTIONS: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS, budget: 10_000 };

function inputOf(b: Benchmark): PlanInput {
  return {
    table: b.table,
    balls: b.balls,
    cueBallId: "cue",
    state: b.state,
    level: STRONG,
    cloth: MEDIUM,
    run: runnerFor(b.table),
  };
}

describe.each(BENCHMARKS.map((b) => [b.name, b] as const))("benchmark: %s", (_name, b) => {
  test("a route is found and every step pots its ball without a foul when replayed", () => {
    const input = inputOf(b);
    const result = planRoute(input, OPTIONS);
    const route = must(result.best, "a route");
    expect(result.done).toBe(true);
    expect(result.runnerCalls).toBeLessThanOrEqual(OPTIONS.budget + 2_000);
    // Three shots, or fewer only if the rack was finished.
    let balls = input.balls;
    let state = input.state;
    for (const step of route.steps) {
      const sim = input.run(balls, { ballId: "cue", ...step.shot });
      const j = judgeShot(sim, balls, "cue", state, {
        targetId: step.targetId,
        ...(step.pocketId ? { pocketId: step.pocketId } : {}),
      });
      expect(j.foul).toBe(false);
      expect(j.intendedPotted).toBe(true);
      expect(step.chance).toBeGreaterThan(0);
      const next = afterShot(sim, balls, "cue", state, b.table, j);
      balls = next.balls;
      state = next.state;
      if (j.finished) break;
    }
    const finishedEarly = route.steps.length < OPTIONS.maxDepth;
    if (finishedEarly) {
      const last = must(route.steps[route.steps.length - 1], "last step");
      const sim = last.result;
      expect(sim.events.some((e) => e.type === "pocket")).toBe(true);
    }
    expect(route.steps.length).toBeGreaterThanOrEqual(Math.min(2, OPTIONS.maxDepth));
    expect(route.expectedValue).toBeGreaterThan(0);
  });
});

describe("search", () => {
  const b = must(BENCHMARKS[0], "first benchmark");

  test("the same input gives the same route", () => {
    const one = planRoute(inputOf(b), OPTIONS);
    const two = planRoute(inputOf(b), OPTIONS);
    expect(two.runnerCalls).toBe(one.runnerCalls);
    expect(two.best?.expectedValue).toBe(one.best?.expectedValue);
    expect(two.best?.steps.map((s) => s.shot)).toEqual(one.best?.steps.map((s) => s.shot));
  });

  test("reports progress with a route early, and the route only improves", () => {
    const seen: number[] = [];
    const it = planRoutes(inputOf(b), OPTIONS);
    let firstWithRoute = -1;
    for (let i = 0; ; i++) {
      const r = it.next();
      const p = r.value;
      if (p.best) {
        if (firstWithRoute < 0) firstWithRoute = i;
        seen.push(p.best.expectedValue);
      }
      if (r.done) break;
    }
    expect(firstWithRoute).toBe(0);
    for (let i = 1; i < seen.length; i++) {
      expect(must(seen[i], "value")).toBeGreaterThanOrEqual(must(seen[i - 1], "value"));
    }
  });

  test("a small budget stops the search early, with a route", () => {
    const r = planRoute(inputOf(b), { ...OPTIONS, budget: 500 });
    expect(r.done).toBe(true);
    expect(r.best).toBeDefined();
    expect(r.depth).toBeLessThan(OPTIONS.maxDepth);
  });

  test("no pot on: no route", () => {
    // Only the cue ball and the 9, with the 9 frozen behind a wall it cannot be reached past.
    const input = inputOf(b);
    const r = planRoute({ ...input, balls: input.balls.filter((x) => x.id === "cue") }, OPTIONS);
    expect(r.best).toBeUndefined();
    expect(r.done).toBe(true);
  });
});

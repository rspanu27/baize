import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { rateShot } from "../src/rate";
import { afterShot, ballsLeftFor, judgeShot } from "../src/rules";
import { DEFAULT_SEARCH_OPTIONS, planRoute, planRoutes } from "../src/search";
import type { SearchOptions } from "../src/search";
import type { PlanInput } from "../src/types";
import { BENCHMARKS } from "./fixtures";
import type { Benchmark } from "./fixtures";
import { FAST, MEDIUM, SLOW, must, runnerFor } from "./helpers";

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
    let depthAtFirstRoute = -1;
    let reports = 0;
    for (;;) {
      const r = it.next();
      const p = r.value;
      reports++;
      if (p.best) {
        if (depthAtFirstRoute < 0) depthAtFirstRoute = p.depth;
        seen.push(p.best.expectedValue);
      }
      if (r.done) break;
    }
    // A route is reported as soon as the first position is expanded, before depth 1 is done;
    // the search reports between pots, so there are many reports.
    expect(depthAtFirstRoute).toBe(0);
    expect(reports).toBeGreaterThan(OPTIONS.maxDepth * 3);
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
    // Only the cue ball: nothing to pot.
    const input = inputOf(b);
    const r = planRoute({ ...input, balls: input.balls.filter((x) => x.id === "cue") }, OPTIONS);
    expect(r.best).toBeUndefined();
    expect(r.done).toBe(true);
  });
});

describe("review fixes", () => {
  test("the route's chances match a rating of the same shots", () => {
    for (const b of BENCHMARKS.slice(0, 3)) {
      const input = inputOf(b);
      const route = must(planRoute(input, OPTIONS).best, "a route");
      const first = must(route.steps[0], "step 1");
      const rated = rateShot(input, first.shot);
      expect(rated.potted?.targetId).toBe(first.targetId);
      expect(Math.abs(rated.chance - first.chance)).toBeLessThan(0.03);
    }
  });

  test("a pool route is worth no more than the balls the player can pot", () => {
    for (const b of BENCHMARKS.filter((x) => x.state.game !== "snooker")) {
      const r = must(planRoute(inputOf(b), OPTIONS).best, "a route");
      expect(r.expectedValue).toBeLessThanOrEqual(ballsLeftFor(b.balls, "cue", b.state) + 1e-9);
    }
  });

  test.each([
    ["slow", SLOW],
    ["fast", FAST],
  ] as const)("routes are found and replay on %s cloth", (_name, cloth) => {
    for (const b of [BENCHMARKS[0], BENCHMARKS[3]].map((x) => must(x, "benchmark"))) {
      const input = { ...inputOf(b), cloth, run: runnerFor(b.table, cloth) };
      const route = must(planRoute(input, OPTIONS).best, "a route");
      const step = must(route.steps[0], "step 1");
      const sim = input.run(input.balls, { ballId: "cue", ...step.shot });
      const j = judgeShot(sim, input.balls, "cue", input.state, {
        targetId: step.targetId,
        ...(step.pocketId ? { pocketId: step.pocketId } : {}),
      });
      expect(j.intendedPotted && !j.foul).toBe(true);
    }
  });
});

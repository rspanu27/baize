import type { PlanProgress } from "@baize/planner";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene, SceneBall } from "../doc/resolve";
import { NO_TUNING } from "../sim/tuning";
import type { PlanRequest } from "./planInput";
import { createPlanner, mainThreadPlanner } from "./plannerClient";

/** A nine-ball ending on a 9 ft table: the cue ball and two object balls in open positions. */
function openScene(): Scene {
  const base = newDoc("pool-9@1");
  const blank = resolveDoc(base);
  if (!blank.ok) throw new Error("the 9 ft table does not resolve");
  const { widthM: W, lengthM: L } = blank.scene.table.playingArea;
  const r = resolveDoc({
    ...base,
    balls: [
      { id: "cue", kind: "cue", x: W * 0.5, y: L * 0.3 },
      { id: "8", kind: "8", x: W * 0.3, y: L * 0.6 },
      { id: "9", kind: "9", x: W * 0.6, y: L * 0.8 },
    ],
  });
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

function request(scene: Scene = openScene()): PlanRequest {
  return {
    scene,
    tuning: NO_TUNING,
    state: { game: "nine-ball" },
    levelId: "strong",
    options: { maxDepth: 2, budget: 1_500 },
  };
}

describe("the planner on the main thread", () => {
  test("progress arrives in order and ends with a route", async () => {
    const planner = mainThreadPlanner();
    const seen: PlanProgress[] = [];
    const last = await planner.plan(request(), (p) => seen.push(p));
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(last);
    expect(last.done).toBe(true);
    expect(seen.slice(0, -1).every((p) => !p.done)).toBe(true);
    for (let i = 1; i < seen.length; i++) {
      const [a, b] = [seen[i - 1] as PlanProgress, seen[i] as PlanProgress];
      expect(b.runnerCalls).toBeGreaterThanOrEqual(a.runnerCalls);
      expect(b.depth).toBeGreaterThanOrEqual(a.depth);
    }
    expect(last.best?.steps.length).toBeGreaterThan(0);
    expect(last.best?.steps[0]?.kind).toBe("pot");
    expect(last.best?.expectedValue).toBeGreaterThan(0);
  });

  test("a second plan cancels the first", async () => {
    const planner = mainThreadPlanner();
    const firstSeen: PlanProgress[] = [];
    const first = planner.plan(request(), (p) => firstSeen.push(p));
    const second = planner.plan(request(), () => undefined);
    await expect(first).rejects.toThrow(/^cancelled$/);
    expect((await second).done).toBe(true);
    // The first stopped before it took a step.
    expect(firstSeen).toEqual([]);
  });

  test("cancel stops the running plan; nothing more is reported", async () => {
    const planner = mainThreadPlanner();
    const seen: PlanProgress[] = [];
    const running = planner.plan(request(), (p) => {
      seen.push(p);
      if (seen.length === 1) planner.cancel();
    });
    await expect(running).rejects.toThrow(/^cancelled$/);
    // Give the slices a chance to run if they were not stopped.
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toHaveLength(1);
    planner.cancel();
  });

  test("a layout the physics refuses rejects in plain words", async () => {
    const scene = openScene();
    const [cue] = scene.balls;
    if (!cue) throw new Error("no cue ball");
    const onTop: SceneBall = { ...cue, id: "7", kind: "7" };
    const overlapping: Scene = { ...scene, balls: [...scene.balls, onTop] };
    const planner = mainThreadPlanner();
    await expect(planner.plan(request(overlapping), () => undefined)).rejects.toThrow(
      "Two balls overlap. Move one of them.",
    );
  });

  test("an unknown level rejects", async () => {
    const planner = mainThreadPlanner();
    await expect(
      planner.plan({ ...request(), levelId: "wizard" }, () => undefined),
    ).rejects.toThrow("The player level is not known: wizard.");
  });

  test("once disposed, the running plan is cancelled and later plans are refused", async () => {
    const planner = mainThreadPlanner();
    const running = planner.plan(request(), () => undefined);
    planner.dispose();
    await expect(running).rejects.toThrow(/^cancelled$/);
    await expect(planner.plan(request(), () => undefined)).rejects.toThrow("closed");
  });

  test("where workers are not available it runs on the main thread", async () => {
    // The unit tests run without a browser, so there is no Worker.
    expect(typeof Worker).toBe("undefined");
    const planner = createPlanner();
    const last = await planner.plan(request(), () => undefined);
    expect(last.done).toBe(true);
    planner.dispose();
  });
});

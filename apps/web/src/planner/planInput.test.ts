import { SimInputError } from "@baize/physics";
import { DEFAULT_SEARCH_OPTIONS, getPlayerLevel } from "@baize/planner";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc, DocBall, DocShot } from "../doc/types";
import { mainThreadSimulator } from "../sim/simulator";
import { NO_TUNING } from "../sim/tuning";
import {
  cueBallIdOf,
  planErrorMessage,
  planInputOf,
  runPlanInSlices,
  searchOptionsOf,
} from "./planInput";
import type { PlanRequest } from "./planInput";

/** A scene on a 9 ft pool table, with balls at shares of the playing area. */
function poolScene(
  balls: readonly (readonly [string, DocBall["kind"], number, number])[],
  shot?: DocShot,
): Scene {
  const base = newDoc("pool-9@1");
  const resolved = resolveDoc(base);
  if (!resolved.ok) throw new Error("the 9 ft table does not resolve");
  const { widthM, lengthM } = resolved.scene.table.playingArea;
  const doc: DiagramDoc = {
    ...base,
    balls: balls.map(([id, kind, fx, fy]) => ({ id, kind, x: widthM * fx, y: lengthM * fy })),
    ...(shot ? { shot } : {}),
  };
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

/** Cue ball and two object balls in open positions: a nine-ball ending. */
const OPEN_LAYOUT = [
  ["cue", "cue", 0.5, 0.3],
  ["8", "8", 0.3, 0.6],
  ["9", "9", 0.6, 0.8],
] as const;

function request(scene: Scene, more: Partial<PlanRequest> = {}): PlanRequest {
  return {
    scene,
    tuning: NO_TUNING,
    state: { game: "nine-ball" },
    levelId: "strong",
    options: { maxDepth: 2, budget: 1_500 },
    ...more,
  };
}

const SHOT: DocShot = {
  cueBallId: "cue",
  aimAngleRad: 2.0,
  speedMps: 2.5,
  tipOffset: { side: 0.2, vertical: -0.3 },
};

describe("the cue ball the planner plays", () => {
  test("is the ball of kind cue, even when the shot strikes another ball", () => {
    const scene = poolScene(OPEN_LAYOUT, { ...SHOT, cueBallId: "8" });
    expect(cueBallIdOf(scene)).toBe("cue");
  });

  test("is the shot's ball only when no ball is of kind cue", () => {
    const scene = poolScene([["9", "9", 0.6, 0.8]], { ...SHOT, cueBallId: "9" });
    expect(cueBallIdOf(scene)).toBe("9");
  });

  test("is the first ball of kind cue when there is no shot", () => {
    const scene = poolScene([
      ["9", "9", 0.6, 0.8],
      ["white", "cue", 0.5, 0.3],
      ["other", "cue", 0.2, 0.2],
    ]);
    expect(cueBallIdOf(scene)).toBe("white");
  });

  test("is the first ball of kind cue when the shot's ball is not on the table", () => {
    const scene = poolScene(OPEN_LAYOUT, { ...SHOT, cueBallId: "gone" });
    expect(cueBallIdOf(scene)).toBe("cue");
  });

  test("is undefined when there is no cue ball", () => {
    expect(cueBallIdOf(poolScene([["9", "9", 0.6, 0.8]]))).toBeUndefined();
  });
});

describe("the planner's input", () => {
  test("its runner gives exactly the editor's simulation of the shot", () => {
    const scene = poolScene(OPEN_LAYOUT, SHOT);
    const tuning = { cushionRestitution: 0.8, cueEndMassRatio: 40 };
    const input = planInputOf(request(scene, { tuning }));
    const fromPlanner = input.run(input.balls, {
      ballId: SHOT.cueBallId,
      aimAngleRad: SHOT.aimAngleRad,
      speedMps: SHOT.speedMps,
      tipOffset: SHOT.tipOffset,
    });
    const fromEditor = mainThreadSimulator.run(scene, tuning).result;
    expect(fromEditor).toBeDefined();
    expect(fromPlanner).toEqual(fromEditor);
  });

  test("carries the scene's table, balls, cloth, the state and the level", () => {
    const scene = poolScene(OPEN_LAYOUT);
    const input = planInputOf(request(scene, { levelId: "club" }));
    expect(input.table).toBe(scene.table);
    expect(input.balls).toBe(scene.balls);
    expect(input.cloth).toBe(scene.cloth);
    expect(input.cueBallId).toBe("cue");
    expect(input.state).toEqual({ game: "nine-ball" });
    expect(input.level).toBe(getPlayerLevel("club"));
  });

  test("is refused without a cue ball or with an unknown level", () => {
    expect(() => planInputOf(request(poolScene([["9", "9", 0.6, 0.8]])))).toThrow(
      "There is no cue ball on the table.",
    );
    expect(() => planInputOf(request(poolScene(OPEN_LAYOUT), { levelId: "wizard" }))).toThrow(
      "The player level is not known: wizard.",
    );
  });

  test("search options are the planner's defaults with the request's changes", () => {
    const scene = poolScene(OPEN_LAYOUT);
    expect(searchOptionsOf(request(scene, { options: undefined }))).toEqual(DEFAULT_SEARCH_OPTIONS);
    expect(searchOptionsOf(request(scene, { options: { beamWidth: 2 } }))).toEqual({
      ...DEFAULT_SEARCH_OPTIONS,
      beamWidth: 2,
    });
  });
});

describe("errors in plain words", () => {
  test("a layout the physics refuses, an Error and anything else", () => {
    expect(planErrorMessage(new SimInputError("balls-overlap", "balls a and b overlap"))).toBe(
      "Two balls overlap. Move one of them.",
    );
    expect(planErrorMessage(new SimInputError("no-balls", "no balls"))).toBe(
      "The layout cannot be planned: no balls",
    );
    expect(planErrorMessage(new Error("Something specific."))).toBe("Something specific.");
    expect(planErrorMessage("odd")).toBe("The route could not be planned.");
  });
});

describe("running the search in slices", () => {
  test("stops as soon as it is cancelled", async () => {
    const seen: number[] = [];
    let steps = 0;
    const last = await runPlanInSlices(
      request(poolScene(OPEN_LAYOUT)),
      () => steps >= 1,
      (p) => {
        steps++;
        seen.push(p.runnerCalls);
      },
    );
    expect(last).toBeUndefined();
    expect(seen).toHaveLength(1);
  });

  test("an overlapping layout is refused by the physics", async () => {
    const scene = poolScene([
      ["cue", "cue", 0.5, 0.3],
      ["8", "8", 0.5, 0.3],
      ["9", "9", 0.6, 0.8],
    ]);
    await expect(
      runPlanInSlices(
        request(scene),
        () => false,
        () => undefined,
      ),
    ).rejects.toBeInstanceOf(SimInputError);
  });
});

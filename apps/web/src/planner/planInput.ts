import { SimInputError } from "@baize/physics";
import { DEFAULT_SEARCH_OPTIONS, getPlayerLevel, planRoutes } from "@baize/planner";
import type { GameState, PlanInput, PlanProgress, SearchOptions } from "@baize/planner";
import type { Scene } from "../doc/resolve";
import { editorRunner } from "../sim/simulator";
import type { Tuning } from "../sim/tuning";

/**
 * What the planner is asked, and how the editor's scene becomes the planner's input. The same
 * code runs in the planner worker and, where there is no worker, on the page. Nothing here is
 * stored anywhere: the request lives only as long as the plan.
 */

/** What the panel asks for. Plain data: it is posted to the worker. */
export interface PlanRequest {
  /** From `resolveDoc`; plain data. */
  scene: Scene;
  /** Debug-panel numbers, `NO_TUNING` if none. */
  tuning: Tuning;
  state: GameState;
  /** A `PLAYER_LEVELS` id from `@baize/planner`. */
  levelId: string;
  options?: Partial<Pick<SearchOptions, "maxDepth" | "beamWidth" | "branching" | "budget">>;
}

/**
 * The cue ball the planner plays: the shot's cue ball if there is a shot (and that ball is on
 * the table), else the first ball of kind "cue". Undefined if there is none.
 */
export function cueBallIdOf(scene: Scene): string | undefined {
  const shotBall = scene.shot?.cueBallId;
  if (shotBall !== undefined && scene.balls.some((b) => b.id === shotBall)) return shotBall;
  return scene.balls.find((b) => b.kind === "cue")?.id;
}

/**
 * The planner input, with the editor's own physics (`editorRunner`), so that a planned shot is
 * exactly what the editor draws when it is used. Throws a plain Error if there is no cue ball
 * or the player level is not known.
 */
export function planInputOf(req: PlanRequest): PlanInput {
  const { scene } = req;
  const cueBallId = cueBallIdOf(scene);
  if (cueBallId === undefined) throw new Error("There is no cue ball on the table.");
  const level = getPlayerLevel(req.levelId);
  if (!level) throw new Error(`The player level is not known: ${req.levelId}.`);
  return {
    table: scene.table,
    balls: scene.balls,
    cueBallId,
    state: req.state,
    level,
    cloth: scene.cloth,
    run: editorRunner(scene, req.tuning),
  };
}

/** The search options for a request: the planner's defaults with any the request changes. */
export function searchOptionsOf(req: PlanRequest): SearchOptions {
  return { ...DEFAULT_SEARCH_OPTIONS, ...req.options };
}

const LAYOUT_PROBLEMS: Partial<Record<SimInputError["code"], string>> = {
  "balls-overlap": "Two balls overlap. Move one of them.",
  "ball-outside-table": "A ball is outside the cushions. Move it back onto the table.",
  "ball-in-pocket": "A ball is over a pocket. Move it back onto the table.",
  "invalid-table": "This table cannot be built from its measurements.",
};

/** A plain-words message for anything a plan throws. */
export function planErrorMessage(e: unknown): string {
  if (e instanceof SimInputError) {
    return LAYOUT_PROBLEMS[e.code] ?? `The layout cannot be planned: ${e.message}`;
  }
  if (e instanceof Error && e.message !== "") return e.message;
  return "The route could not be planned.";
}

/** Waits for a macrotask, so that messages, clicks and paints can come in between slices. */
export function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Runs the search in slices: one step of `planRoutes` at a time, each passed to `onProgress`
 * (the final one, `done: true`, too), with a macrotask before each step. Stops, resolving with
 * undefined, as soon as `cancelled()` says so. Errors (an unknown level, a layout the physics
 * refuses) reject the promise as thrown; `planErrorMessage` turns them into plain words.
 */
export async function runPlanInSlices(
  req: PlanRequest,
  cancelled: () => boolean,
  onProgress: (p: PlanProgress) => void,
): Promise<PlanProgress | undefined> {
  await nextMacrotask();
  if (cancelled()) return undefined;
  const steps = planRoutes(planInputOf(req), searchOptionsOf(req));
  for (;;) {
    const step = steps.next();
    onProgress(step.value);
    if (step.done) return step.value;
    await nextMacrotask();
    if (cancelled()) return undefined;
  }
}

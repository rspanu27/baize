import { sampleAt } from "@baize/physics";
import { rateShot } from "@baize/planner";
import type { GameState, PlannedShot, Route, ShotRating } from "@baize/planner";
import { create } from "zustand";
import { continueFromShot, restoreBall, setShot } from "../doc/ops";
import { resolveDoc } from "../doc/resolve";
import { sameExceptStyle } from "../doc/types";
import type { DiagramDoc } from "../doc/types";
import { simulationFor } from "../sim/useSimulation";
import { currentTuning, useTuningStore } from "../sim/tuning";
import type { Tuning } from "../sim/tuning";
import { useEditor } from "../store/store";
import { cueBallIdOf, planErrorMessage, planInputOf } from "./planInput";
import type { PlanRequest } from "./planInput";
import type { PlannerClient } from "./plannerClient";
import {
  DEFAULT_DEPTH,
  DEFAULT_LEVEL_ID,
  appliedAt,
  gameStateFor,
  isSnookerColour,
  ownsDoc,
  sameLayout,
  sameTuning,
  shotPatch,
} from "./plannerModel";
import type { AppliedShot } from "./plannerModel";

/**
 * The planner panel's state: its settings, the plan it found and the rating of the user's shot.
 * Transient like the selection: nothing here goes into the document, the link, the undo history
 * or storage. A plan belongs to the document it was planned for (and to the documents its own
 * "Use this shot" and "Next shot" made) and to the settings and debug-panel tuning it was planned
 * with; the panel drops it as soon as any of them is anything else.
 */

export interface Plan {
  /** Changes with every search, so replies from an older one are dropped. */
  runId: number;
  planDoc: DiagramDoc;
  /** The cue ball the plan plays. */
  cueBallId: string;
  state: GameState;
  /** The debug-panel tuning the search was asked with. */
  tuning: Tuning;
  /** True while progress from the search is taken in; a stopped search changes nothing more. */
  running: boolean;
  /** Shots deep the search has finished. */
  depth: number;
  route?: Route;
  safeties?: readonly PlannedShot[];
  error?: string;
  applied: readonly AppliedShot[];
  /** The step highlighted on the table. */
  selected?: number;
}

export interface Rating {
  doc: DiagramDoc;
  levelId: string;
  state: GameState;
  tuning: Tuning;
  rating?: ShotRating;
  error?: string;
}

export interface PlannerState {
  /** The game the user picked; undefined while it is inferred from the balls. */
  chosenState: GameState | undefined;
  levelId: string;
  maxDepth: number;
  plan: Plan | undefined;
  rating: Rating | undefined;

  /** The settings: a change drops the plan (and stops its search), as it no longer fits them. */
  setChosenState: (state: GameState) => void;
  setLevel: (levelId: string) => void;
  setDepth: (depth: number) => void;
  /** Drops the plan and the rating if they were made with other debug-panel tuning. */
  tuningChanged: (tuning: Tuning) => void;
  /** Starts a search for the current document. */
  findRoute: (client: PlannerClient) => Promise<void>;
  /** Stops a running search; the best route so far stays. */
  stop: (client: PlannerClient | undefined) => void;
  /** Drops the plan and the rating if they belong to another document. */
  docChanged: (doc: DiagramDoc, client: PlannerClient | undefined) => void;
  select: (index: number | undefined) => void;
  /**
   * Puts a route step or a safety into the document as its shot (one undo step). A running
   * search is stopped, so the route stays the one the shot came from.
   */
  useShot: (kind: "route" | "safety", index: number) => void;
  /** Plays the route's current step on (continue from its result) and sets the next one. */
  nextShot: () => void;
  /** Rates the document's own shot (on this thread: a few dozen simulations). */
  rateCurrentShot: () => void;
  reset: () => void;
}

let runs = 0;
/** The client of the latest search, so that a settings change or a used shot can stop it. */
let searching: PlannerClient | undefined;

const INITIAL = {
  chosenState: undefined,
  levelId: DEFAULT_LEVEL_ID,
  maxDepth: DEFAULT_DEPTH,
  plan: undefined,
  rating: undefined,
} as const;

function presentDoc(): DiagramDoc {
  return useEditor.getState().history.present;
}

/** The step after the one this document holds, if the panel can go on to it. */
export function nextStepOf(plan: Plan, doc: DiagramDoc): number | undefined {
  const at = appliedAt(plan, doc);
  if (!at || at.kind !== "route") return undefined;
  const steps = plan.route?.steps ?? [];
  // Only on from the route the shot came from.
  if (steps[at.index] !== at.shot) return undefined;
  return at.index + 1 < steps.length ? at.index + 1 : undefined;
}

/** Whether "Use this shot" can put a shot of the plan into this document (same layout). */
export function canUseShots(plan: Plan, doc: DiagramDoc): boolean {
  return sameLayout(plan.planDoc, doc);
}

/** The plan, if it belongs to this document. */
export function planFor(plan: Plan | undefined, doc: DiagramDoc): Plan | undefined {
  return plan && ownsDoc(plan, doc) ? plan : undefined;
}

/** The rating, if it is of this document. */
export function ratingFor(rating: Rating | undefined, doc: DiagramDoc): Rating | undefined {
  return rating && sameExceptStyle(rating.doc, doc) ? rating : undefined;
}

/**
 * The document after the current step is played and before `next`: every ball where the
 * editor's own simulation leaves it (`continueFromShot`), then each snooker colour the planner
 * put back on the table (respotted while reds remain, or after a foul) at the planner's spot,
 * with its own id, then the next shot. No other ball is ever added.
 */
function docForNextStep(doc: DiagramDoc, plan: Plan, next: PlannedShot): DiagramDoc | undefined {
  const paths = simulationFor(doc, plan.tuning).paths;
  if (!paths) return undefined;
  let out = continueFromShot(doc, paths.finals);
  if (plan.state.game === "snooker") {
    for (const planned of sampleAt(next.result, 0)) {
      if (out.balls.some((b) => b.id === planned.id)) continue;
      const i = doc.balls.findIndex((b) => b.id === planned.id);
      const ball = doc.balls[i];
      if (!ball || !isSnookerColour(ball.kind)) continue;
      // Back where it was in the list, as the planner keeps the balls' order.
      const index = doc.balls
        .slice(0, i)
        .filter((b) => out.balls.some((o) => o.id === b.id)).length;
      out = restoreBall(out, { ...ball, x: planned.position.x, y: planned.position.y }, index);
    }
  }
  return setShot(out, shotPatch(plan.cueBallId, next));
}

export const usePlanner = create<PlannerState>((set, get) => {
  /** Applies a change to the plan only while the search `runId` is current and still running. */
  const patchRun = (runId: number, patch: Partial<Plan>): void => {
    set((s) => (s.plan?.runId === runId && s.plan.running ? { plan: { ...s.plan, ...patch } } : s));
  };

  /** Drops the plan, stopping its search if it is still running. */
  const dropPlan = (): void => {
    if (get().plan?.running) searching?.cancel();
    set({ plan: undefined });
  };

  return {
    ...INITIAL,

    setChosenState: (state) => {
      if (JSON.stringify(state) === JSON.stringify(get().chosenState)) return;
      dropPlan();
      set({ chosenState: state });
    },
    setLevel: (levelId) => {
      if (levelId === get().levelId) return;
      dropPlan();
      set({ levelId });
    },
    setDepth: (depth) => {
      if (depth === get().maxDepth) return;
      dropPlan();
      set({ maxDepth: depth });
    },
    tuningChanged: (tuning) => {
      const { plan, rating } = get();
      if (plan && !sameTuning(plan.tuning, tuning)) dropPlan();
      if (rating && !sameTuning(rating.tuning, tuning)) set({ rating: undefined });
    },

    findRoute: async (client) => {
      const doc = presentDoc();
      const resolved = resolveDoc(doc);
      const runId = ++runs;
      const tuning = currentTuning();
      searching = client;
      if (!resolved.ok) {
        client.cancel();
        set({
          plan: {
            runId,
            planDoc: doc,
            cueBallId: "",
            state: { game: "straight" },
            tuning,
            running: false,
            depth: 0,
            error: resolved.problems.join(" "),
            applied: [],
          },
        });
        return;
      }
      const { scene } = resolved;
      const { chosenState, levelId, maxDepth } = get();
      const state = gameStateFor(scene, chosenState);
      const cueBallId = cueBallIdOf(scene) ?? "";
      const request: PlanRequest = {
        scene,
        tuning,
        state,
        levelId,
        options: { maxDepth },
      };
      set({
        plan: {
          runId,
          planDoc: doc,
          cueBallId,
          state,
          tuning,
          running: true,
          depth: 0,
          applied: [],
        },
      });
      if (cueBallId === "") {
        client.cancel();
        patchRun(runId, { running: false, error: "There is no cue ball on the table." });
        return;
      }
      try {
        const last = await client.plan(request, (p) => {
          patchRun(runId, {
            depth: p.depth,
            ...(p.best ? { route: p.best } : {}),
            ...(p.safeties ? { safeties: p.safeties } : {}),
          });
        });
        patchRun(runId, {
          running: false,
          depth: last.depth,
          ...(last.best ? { route: last.best } : {}),
          ...(last.safeties ? { safeties: last.safeties } : {}),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "";
        // A cancelled search keeps what it found; the panel already shows it stopped.
        if (message === "cancelled") return;
        patchRun(runId, { running: false, error: planErrorMessage(e) });
      }
    },

    stop: (client) => {
      (client ?? searching)?.cancel();
      set((s) => (s.plan?.running ? { plan: { ...s.plan, running: false } } : s));
    },

    docChanged: (doc, client) => {
      const { plan, rating } = get();
      const keepPlan = planFor(plan, doc) !== undefined;
      const keepRating = ratingFor(rating, doc) !== undefined;
      if (keepPlan && keepRating) return;
      if (!keepPlan && plan?.running) client?.cancel();
      set({ plan: keepPlan ? plan : undefined, rating: keepRating ? rating : undefined });
    },

    select: (index) => {
      set((s) => (s.plan ? { plan: { ...s.plan, selected: index } } : s));
    },

    useShot: (kind, index) => {
      const plan = planFor(get().plan, presentDoc());
      if (!plan || !canUseShots(plan, presentDoc())) return;
      const step = kind === "route" ? plan.route?.steps[index] : plan.safeties?.[index];
      if (!step) return;
      // The route is frozen at the one this shot came from.
      if (plan.running) searching?.cancel();
      useEditor.getState().setShot(shotPatch(plan.cueBallId, step));
      const doc = presentDoc();
      set((s) =>
        s.plan?.runId === plan.runId
          ? {
              plan: {
                ...s.plan,
                running: false,
                applied: [...s.plan.applied, { doc, kind, index, shot: step }],
                ...(kind === "route" ? { selected: index } : {}),
              },
            }
          : s,
      );
    },

    nextShot: () => {
      const current = presentDoc();
      const plan = planFor(get().plan, current);
      if (!plan) return;
      const k = nextStepOf(plan, current);
      const next = k === undefined ? undefined : plan.route?.steps[k];
      if (k === undefined || !next) return;
      const doc = docForNextStep(current, plan, next);
      if (!doc) return;
      // One undo step for the whole move: the balls moved on and the next shot set.
      useEditor.getState().replaceDoc(doc);
      const made = presentDoc();
      set((s) =>
        s.plan?.runId === plan.runId
          ? {
              plan: {
                ...s.plan,
                applied: [...s.plan.applied, { doc: made, kind: "route", index: k, shot: next }],
                selected: k,
              },
            }
          : s,
      );
    },

    rateCurrentShot: () => {
      const doc = presentDoc();
      const { chosenState, levelId } = get();
      const tuning = currentTuning();
      const resolved = resolveDoc(doc);
      if (!resolved.ok) {
        const state: GameState = { game: "straight" };
        set({ rating: { doc, levelId, state, tuning, error: resolved.problems.join(" ") } });
        return;
      }
      const { scene } = resolved;
      const state = gameStateFor(scene, chosenState);
      const shot = scene.shot;
      if (!shot) {
        set({ rating: { doc, levelId, state, tuning, error: "There is no shot to rate." } });
        return;
      }
      try {
        const input = planInputOf({ scene, tuning, state, levelId });
        const rating = rateShot(input, {
          aimAngleRad: shot.aimAngleRad,
          speedMps: shot.speedMps,
          tipOffset: shot.tipOffset,
        });
        set({ rating: { doc, levelId, state, tuning, rating } });
      } catch (e) {
        set({ rating: { doc, levelId, state, tuning, error: planErrorMessage(e) } });
      }
    },

    reset: () => {
      searching = undefined;
      set({ ...INITIAL });
    },
  };
});

// A plan made with other debug-panel numbers no longer matches what the editor draws.
useTuningStore.subscribe((s) => {
  usePlanner.getState().tuningChanged(s.tuning);
});

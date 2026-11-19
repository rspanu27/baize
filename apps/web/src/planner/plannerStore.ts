import { sampleAt } from "@baize/physics";
import { rateShot } from "@baize/planner";
import type { GameState, PlannedShot, Route, ShotRating } from "@baize/planner";
import { create } from "zustand";
import { addBall, continueFromShot, setShot } from "../doc/ops";
import { resolveDoc } from "../doc/resolve";
import { sameExceptStyle } from "../doc/types";
import type { DiagramDoc } from "../doc/types";
import { simulationFor } from "../sim/useSimulation";
import { currentTuning } from "../sim/tuning";
import { useEditor } from "../store/store";
import { cueBallIdOf, planErrorMessage, planInputOf } from "./planInput";
import type { PlanRequest } from "./planInput";
import type { PlannerClient } from "./plannerClient";
import {
  DEFAULT_DEPTH,
  DEFAULT_LEVEL_ID,
  appliedAt,
  gameStateFor,
  ownsDoc,
  sameLayout,
  shotPatch,
} from "./plannerModel";
import type { AppliedShot } from "./plannerModel";

/**
 * The planner panel's state: its settings, the plan it found and the rating of the user's shot.
 * Transient like the selection: nothing here goes into the document, the link, the undo history
 * or storage. A plan belongs to the document it was planned for (and to the documents its own
 * "Use this shot" and "Next shot" made); the panel drops it as soon as the document is anything
 * else.
 */

export interface Plan {
  /** Changes with every search, so replies from an older one are dropped. */
  runId: number;
  planDoc: DiagramDoc;
  /** The cue ball the plan plays. */
  cueBallId: string;
  state: GameState;
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

  setChosenState: (state: GameState) => void;
  setLevel: (levelId: string) => void;
  setDepth: (depth: number) => void;
  /** Starts a search for the current document. */
  findRoute: (client: PlannerClient) => Promise<void>;
  /** Stops a running search; the best route so far stays. */
  stop: (client: PlannerClient | undefined) => void;
  /** Drops the plan and the rating if they belong to another document. */
  docChanged: (doc: DiagramDoc, client: PlannerClient | undefined) => void;
  select: (index: number | undefined) => void;
  /** Puts a route step or a safety into the document as its shot (one undo step). */
  useShot: (kind: "route" | "safety", index: number) => void;
  /** Plays the route's current step on (continue from its result) and sets the next one. */
  nextShot: () => void;
  /** Rates the document's own shot (on this thread: a few dozen simulations). */
  rateCurrentShot: () => void;
  reset: () => void;
}

let runs = 0;

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

/** Same position within a micrometre: a ball the editor already has. */
const SAME_PLACE_M = 1e-6;

/**
 * The document after `step` is played and before `next`: every ball where the editor's own
 * simulation leaves it (`continueFromShot`), then any ball the planner put back that the editor
 * does not (a snooker colour respotted while reds remain), then the next shot.
 */
function docForNextStep(doc: DiagramDoc, plan: Plan, next: PlannedShot): DiagramDoc | undefined {
  const paths = simulationFor(doc, currentTuning()).paths;
  if (!paths) return undefined;
  let out = continueFromShot(doc, paths.finals);
  const kindOf = new Map(plan.planDoc.balls.map((b) => [b.id, b.kind] as const));
  for (const planned of sampleAt(next.result, 0)) {
    const kind = kindOf.get(planned.id);
    if (kind === undefined) continue;
    const there = out.balls.some(
      (b) =>
        b.kind === kind &&
        Math.abs(b.x - planned.position.x) < SAME_PLACE_M &&
        Math.abs(b.y - planned.position.y) < SAME_PLACE_M,
    );
    if (!there) out = addBall(out, kind, planned.position);
  }
  return setShot(out, shotPatch(plan.cueBallId, next));
}

export const usePlanner = create<PlannerState>((set, get) => {
  /** Applies a change to the plan only while the search `runId` is still the current one. */
  const patchRun = (runId: number, patch: Partial<Plan>): void => {
    set((s) => (s.plan?.runId === runId ? { plan: { ...s.plan, ...patch } } : s));
  };

  return {
    ...INITIAL,

    setChosenState: (state) => {
      set({ chosenState: state });
    },
    setLevel: (levelId) => {
      set({ levelId });
    },
    setDepth: (depth) => {
      set({ maxDepth: depth });
    },

    findRoute: async (client) => {
      const doc = presentDoc();
      const resolved = resolveDoc(doc);
      const runId = ++runs;
      if (!resolved.ok) {
        client.cancel();
        set({
          plan: {
            runId,
            planDoc: doc,
            cueBallId: "",
            state: { game: "straight" },
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
        tuning: currentTuning(),
        state,
        levelId,
        options: { maxDepth },
      };
      set({
        plan: { runId, planDoc: doc, cueBallId, state, running: true, depth: 0, applied: [] },
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
      client?.cancel();
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
      useEditor.getState().setShot(shotPatch(plan.cueBallId, step));
      const doc = presentDoc();
      set((s) =>
        s.plan?.runId === plan.runId
          ? {
              plan: {
                ...s.plan,
                applied: [...s.plan.applied, { doc, kind, index }],
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
                applied: [...s.plan.applied, { doc: made, kind: "route", index: k }],
                selected: k,
              },
            }
          : s,
      );
    },

    rateCurrentShot: () => {
      const doc = presentDoc();
      const { chosenState, levelId } = get();
      const resolved = resolveDoc(doc);
      if (!resolved.ok) {
        set({
          rating: { doc, levelId, state: { game: "straight" }, error: resolved.problems.join(" ") },
        });
        return;
      }
      const { scene } = resolved;
      const state = gameStateFor(scene, chosenState);
      const shot = scene.shot;
      if (!shot) {
        set({ rating: { doc, levelId, state, error: "There is no shot to rate." } });
        return;
      }
      try {
        const input = planInputOf({ scene, tuning: currentTuning(), state, levelId });
        const rating = rateShot(input, {
          aimAngleRad: shot.aimAngleRad,
          speedMps: shot.speedMps,
          tipOffset: shot.tipOffset,
        });
        set({ rating: { doc, levelId, state, rating } });
      } catch (e) {
        set({ rating: { doc, levelId, state, error: planErrorMessage(e) } });
      }
    },

    reset: () => {
      set({ ...INITIAL });
    },
  };
});

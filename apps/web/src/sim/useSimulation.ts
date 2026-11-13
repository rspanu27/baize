import { useMemo } from "react";
import { resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { buildPathModel } from "./pathModel";
import type { PathModel } from "./pathModel";
import { mainThreadSimulator } from "./simulator";
import type { SimOutcome, Simulator } from "./simulator";
import { NO_TUNING, currentTuning, useTuning } from "./tuning";
import type { Tuning } from "./tuning";

export interface Simulation {
  /** The resolved scene, or undefined if the document cannot be resolved. */
  scene: Scene | undefined;
  /** Plain-words problems with the document or the shot; empty when all is well. */
  problems: string[];
  /** The simulated shot, when there is one. */
  outcome: SimOutcome;
  /** Drawable paths for the shot, when there is one. */
  paths: PathModel | undefined;
}

/** Everything derived from a document: scene, simulation and paths. Pure. */
export function simulateDoc(
  doc: DiagramDoc,
  simulator: Simulator = mainThreadSimulator,
  tuning: Tuning = NO_TUNING,
): Simulation {
  const resolved = resolveDoc(doc);
  if (!resolved.ok) {
    return { scene: undefined, problems: resolved.problems, outcome: { ms: 0 }, paths: undefined };
  }
  const outcome = simulator.run(resolved.scene, tuning);
  return {
    scene: resolved.scene,
    problems: outcome.problem ? [outcome.problem] : [],
    outcome,
    paths: outcome.result ? buildPathModel(outcome.result, resolved.scene) : undefined,
  };
}

/**
 * The simulation for the current document, recomputed whenever the document changes.
 *
 * Documents are immutable, so the result is cached on the document object: every component
 * that asks for the simulation of the same document gets the same one, computed once. The
 * debug panel's tuning is part of the key; it is read from its store, so callers that are
 * not hooks get the current one too.
 */
const cache = new WeakMap<DiagramDoc, { tuning: Tuning; simulation: Simulation }>();

export function simulationFor(doc: DiagramDoc, tuning: Tuning = currentTuning()): Simulation {
  const hit = cache.get(doc);
  if (hit && hit.tuning === tuning) return hit.simulation;
  const simulation = simulateDoc(doc, mainThreadSimulator, tuning);
  cache.set(doc, { tuning, simulation });
  return simulation;
}

/** Re-renders the caller when the document or the tuning changes. */
export function useSimulation(doc: DiagramDoc): Simulation {
  const tuning = useTuning();
  return useMemo(() => simulationFor(doc, tuning), [doc, tuning]);
}

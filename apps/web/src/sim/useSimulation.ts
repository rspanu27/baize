import { useMemo } from "react";
import { resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { buildPathModel } from "./pathModel";
import type { PathModel } from "./pathModel";
import { mainThreadSimulator } from "./simulator";
import type { SimOutcome, Simulator } from "./simulator";

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
): Simulation {
  const resolved = resolveDoc(doc);
  if (!resolved.ok) {
    return { scene: undefined, problems: resolved.problems, outcome: { ms: 0 }, paths: undefined };
  }
  const outcome = simulator.run(resolved.scene);
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
 * that asks for the simulation of the same document gets the same one, computed once.
 */
const cache = new WeakMap<DiagramDoc, Simulation>();

export function simulationFor(doc: DiagramDoc): Simulation {
  let s = cache.get(doc);
  if (!s) {
    s = simulateDoc(doc);
    cache.set(doc, s);
  }
  return s;
}

export function useSimulation(doc: DiagramDoc): Simulation {
  return useMemo(() => simulationFor(doc), [doc]);
}

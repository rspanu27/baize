import { defaultGameState, getPlayerLevel } from "@baize/planner";
import type { GameState, PlannedShot } from "@baize/planner";
import type { PocketId } from "@baize/physics";
import type { GameType } from "@baize/tables";
import type { Scene } from "../doc/resolve";
import { sameExceptStyle } from "../doc/types";
import type { DiagramDoc, DocShot } from "../doc/types";
import { makeViewTransform } from "../view/transform";
import type { Orientation } from "../view/transform";

/**
 * Pure helpers for the planner panel and the route layer: which games fit a ball set, the words
 * for pockets and values, and which document a plan belongs to. No React, no store.
 */

/** Player level the panel starts on. */
export const DEFAULT_LEVEL_ID = "club";
/** Shots deep the search goes by default, and the range the panel offers. */
export const DEFAULT_DEPTH = 3;
export const DEPTHS = [1, 2, 3, 4] as const;

/** Whether a game state can be played with a ball set of this game. */
export function fitsBallSet(state: GameState, game: GameType): boolean {
  switch (game) {
    case "snooker":
      return state.game === "snooker";
    case "blackball":
      return state.game === "eight-ball" && (state.group === "reds" || state.group === "yellows");
    case "pool":
      return (
        state.game === "nine-ball" ||
        state.game === "straight" ||
        (state.game === "eight-ball" && (state.group === "solids" || state.group === "stripes"))
      );
  }
}

/** The game the planner plays: the user's choice if it fits the ball set, else the inferred one. */
export function gameStateFor(scene: Scene, chosen: GameState | undefined): GameState {
  if (chosen && fitsBallSet(chosen, scene.ballSet.game)) return chosen;
  return defaultGameState(scene.ballSet, scene.balls);
}

/** Where a pocket is, as the table is drawn: "top-left corner", "bottom middle". */
export function pocketWords(id: PocketId, orientation: Orientation): string {
  // Any proportions do: only which side of the middle each pocket lands on matters.
  const view = makeViewTransform({ widthM: 1, lengthM: 2 }, orientation);
  const at: Record<PocketId, { x: number; y: number }> = {
    "corner-bl": { x: 0, y: 0 },
    "corner-br": { x: 1, y: 0 },
    "corner-tl": { x: 0, y: 2 },
    "corner-tr": { x: 1, y: 2 },
    "middle-l": { x: 0, y: 1 },
    "middle-r": { x: 1, y: 1 },
  };
  const centre = view.toScreen({ x: 0.5, y: 1 });
  const p = view.toScreen(at[id]);
  const vertical = p.y < centre.y ? "top" : p.y > centre.y ? "bottom" : "";
  const horizontal = p.x < centre.x ? "left" : p.x > centre.x ? "right" : "";
  if (id.startsWith("corner")) return `${vertical}-${horizontal} corner`;
  return `${vertical || horizontal} middle`;
}

/** A chance as a whole percentage. */
export function percent(chance: number): string {
  return `${String(Math.round(chance * 100))}%`;
}

/**
 * A planner value in words: points for snooker; for pool a chance (as a percentage) when it is
 * at most one ball, else balls.
 */
export function valueWords(value: number, state: GameState): string {
  if (state.game === "snooker") {
    const v = Math.round(value * 10) / 10;
    return `${v.toFixed(1)} ${v === 1 ? "point" : "points"}`;
  }
  if (value <= 1) return percent(value);
  return `${value.toFixed(1)} balls`;
}

/** The level's name in lower case, for sentences: "a club player". */
export function levelPhrase(levelId: string): string {
  const name = getPlayerLevel(levelId)?.name ?? levelId;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  return /^[aeiou]/i.test(lower) ? `an ${lower}` : `a ${lower}`;
}

/** The document shot a planned shot stands for. */
export function shotPatch(cueBallId: string, step: PlannedShot): DocShot {
  return {
    cueBallId,
    aimAngleRad: step.shot.aimAngleRad,
    speedMps: step.shot.speedMps,
    tipOffset: { side: step.shot.tipOffset.side, vertical: step.shot.tipOffset.vertical },
  };
}

/** Same table, balls and cloth: the shot may differ. */
export function sameLayout(a: DiagramDoc, b: DiagramDoc): boolean {
  return (
    a.table === b.table && a.ballSet === b.ballSet && a.cloth === b.cloth && a.balls === b.balls
  );
}

/** A document the panel put a planned shot into. */
export interface AppliedShot {
  doc: DiagramDoc;
  kind: "route" | "safety";
  /** Index into the route's steps or the safeties. */
  index: number;
}

/** Which documents a plan belongs to: the one it was planned for and those its shots made. */
export interface PlanOwnership {
  planDoc: DiagramDoc;
  applied: readonly AppliedShot[];
}

/** Whether a plan still belongs to this document (style changes do not count). */
export function ownsDoc(plan: PlanOwnership, doc: DiagramDoc): boolean {
  return (
    sameExceptStyle(plan.planDoc, doc) || plan.applied.some((a) => sameExceptStyle(a.doc, doc))
  );
}

/** The planned shot this document holds, if the panel put it there. */
export function appliedAt(plan: PlanOwnership, doc: DiagramDoc): AppliedShot | undefined {
  return plan.applied.find((a) => sameExceptStyle(a.doc, doc));
}

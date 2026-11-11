import type { BallKind, BallSetSpec, BallSize, Layout, SanitizeResult, TableSpec } from "./types";

/** Size of one ball of a set: the cue ball may differ from the object balls. */
export function ballSizeOf(ballSet: BallSetSpec, kind: BallKind): BallSize {
  return kind === "cue" && ballSet.cue ? ballSet.cue : ballSet.object;
}

/**
 * Horizontal distance from the cushion nose line to the centre of a ball touching it.
 * The nose sits at `noseHeightM`, usually above the ball's centre, so this is slightly less
 * than the radius.
 */
export function noseContactDistanceM(radiusM: number, noseHeightM: number): number {
  const d = noseHeightM - radiusM;
  return Math.sqrt(radiusM * radiusM - d * d);
}

/**
 * Makes a layout physically placeable: balls inside the cushions, no overlaps, and no more
 * balls of a kind than the set has (lowest confidence dropped first). Deterministic.
 * Implemented by task 1.6.
 */
export const sanitizeLayout: (
  layout: Layout,
  table: TableSpec,
  ballSet: BallSetSpec,
) => SanitizeResult = () => {
  throw new Error("not implemented");
};

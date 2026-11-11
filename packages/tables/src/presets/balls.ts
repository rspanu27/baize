import type { BallSetSpec } from "../types";

/** All ball sets. Every number carries a source comment. Filled in by task 1.3. */
export const BALL_SETS: readonly BallSetSpec[] = [];

export function getBallSet(id: string): BallSetSpec | undefined {
  return BALL_SETS.find((b) => b.id === id);
}

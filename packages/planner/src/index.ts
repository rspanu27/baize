export type * from "./types";
export { atan2, erf, normalCdf, wrapAngle } from "./math";
export { afterShot, ballsOn, defaultGameState, judgeShot, potValue } from "./rules";
export type { FoulReason, ShotJudgement } from "./rules";
export {
  chanceInWindow,
  distanceToSegment,
  estimatePot,
  ghostBall,
  laneHalfWidthM,
  pathClear,
  pocketTargets,
} from "./geometry";
export type { Obstacle, PocketTarget, PotEstimate, PotGeometry } from "./geometry";
export { PLAYER_LEVELS, getPlayerLevel } from "./levels";
export {
  DEFAULT_SHOT_OPTIONS,
  SPEED_NODES,
  departureError,
  leastSpeedMps,
  makeContext,
  potCandidates,
  potPairs,
} from "./shots";
export type {
  PlanContext,
  PotCandidate,
  PotPair,
  Position,
  ShotOptions,
  ShotOutcome,
} from "./shots";
export { GEOMETRIC_WINDOW_SCALE, leaveValue, positionAfter, positionValue } from "./position";

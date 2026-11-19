/** Kept until the web placeholder page is replaced. */
export const PHYSICS_PLACEHOLDER = "baize-physics";

export type * from "./types";
export { SimInputError } from "./types";
export { buildTableGeometry, cushionContactDistance, prepareTable } from "./geometry";
export {
  DEFAULT_SIM_PARAMS,
  INPUT_OVERLAP_TOL_M,
  NAP_LIMIT,
  STANDARD_GRAVITY,
  simulate,
} from "./simulate";
export { kineticEnergy, sampleAt } from "./sample";
export { MAX_TIP_OFFSET, strike } from "./strike";
export { frictionlessBallBall } from "./models/ballBall";
export { noseImpulseCushion } from "./models/cushion";
export { mathavanCushion } from "./models/cushionMathavan";
export { frictionalBallBall } from "./models/ballBallFriction";
export type { BallBallFriction } from "./models/ballBallFriction";
// Deterministic maths, for packages that must give the same answer on every machine too.
export { sinCos } from "./math/trig";
export type { SinCos } from "./math/trig";
export { expNeg } from "./math/exp";

/** Kept until the web placeholder page is replaced. */
export const TABLES_PLACEHOLDER = "baize-tables";

export type * from "./types";
export { PRESET_BALL_DIAMETER_M, TABLE_PRESETS, getTablePreset } from "./presets/tables";
export { BALL_SETS, getBallSet } from "./presets/balls";
export { CUE_BALL_COLOUR, UNKNOWN_BALL_COLOUR, ballAppearance } from "./presets/ballColours";
export type { BallAppearance } from "./presets/ballColours";
export { BALL_BALL_FRICTION, BALL_TO_CUE_END_MASS_RATIO, cueEndMassKg } from "./presets/contact";
export {
  CLOTH_COLOURS,
  CLOTH_SPEEDS,
  NAP_FULL_DRIFT_RATIO,
  makeCloth,
  napDrift,
} from "./presets/cloth";
export type { ClothColour, ClothCoefficients } from "./presets/cloth";
export {
  TABLE_DEFAULTS,
  pocketCutBackM,
  pocketDropCircles,
  resolveCustomTable,
  validateTable,
} from "./validate";
export type { DropCircle } from "./validate";
export { markingsFor, spotsFor } from "./markings";
export { rackFits, rackLayout, racksFor } from "./racks";
export { DRILL_TEMPLATES, drillFits, drillLayout, drillsFor } from "./drills";
export { TOUCH_TOLERANCE_M, ballSizeOf, noseContactDistanceM, sanitizeLayout } from "./layout";

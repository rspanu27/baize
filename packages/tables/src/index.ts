/** Kept until the web placeholder page is replaced. */
export const TABLES_PLACEHOLDER = "baize-tables";

export type * from "./types";
export { TABLE_PRESETS, getTablePreset } from "./presets/tables";
export { BALL_SETS, getBallSet } from "./presets/balls";
export { CLOTH_COLOURS, CLOTH_SPEEDS, makeCloth } from "./presets/cloth";
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
export { TOUCH_TOLERANCE_M, ballSizeOf, noseContactDistanceM, sanitizeLayout } from "./layout";

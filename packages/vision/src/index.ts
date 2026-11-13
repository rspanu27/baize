/**
 * @baize/vision: one photo of a table to a layout of balls, in the browser only.
 */
export type * from "./types";
export {
  homographyFromCorners,
  imageToTable,
  invertHomography,
  tableToImage,
} from "./geometry/homography";
export { ballInPhoto, findBalls } from "./balls/findBalls";
export type { FoundBall } from "./balls/findBalls";
export { findTable } from "./table/findTable";
export type { FoundTable } from "./table/findTable";
export type { ClothModel } from "./table/clothModel";
export {
  ASSUMED_FOCAL_PER_LONG_SIDE,
  apparentRadiusPx,
  cameraFromHomography,
  imageToTableAtHeight,
  projectPoint,
} from "./geometry/camera";

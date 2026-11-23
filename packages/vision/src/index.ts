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
export { importPhoto } from "./importPhoto";
export { describeSummary, quantile, scorePhoto, summarise } from "./evaluate";
export type { PhotoScore, PlacedBall, SetSummary } from "./evaluate";
export { ballInPhoto, findBalls } from "./balls/findBalls";
export type { FoundBall } from "./balls/findBalls";
export { CORNER_OUTSIDE_SHARE, findTable } from "./table/findTable";
export type { FoundTable } from "./table/findTable";
export type { ClothModel } from "./table/clothModel";
export {
  ASSUMED_FOCAL_PER_LONG_SIDE,
  apparentRadiusPx,
  cameraFromCorners,
  cameraFromHomography,
  imageToTableAtHeight,
  projectPoint,
} from "./geometry/camera";
export { DEFAULT_TRACK_OPTIONS, createTracker } from "./video/track";
export type {
  TrackOptions,
  TrackStart,
  TrackState,
  TrackedBall,
  TrackedFrame,
  Tracker,
} from "./video/track";
export { findShots } from "./video/shotTiming";
export type { ShotSpan } from "./video/shotTiming";

import { ballAppearance, ballSizeOf, sanitizeLayout } from "@baize/tables";
import type { BallKind, BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { CORNER_OUTSIDE_SHARE, apparentRadiusPx, ballInPhoto } from "@baize/vision";
import type { Camera, ImagePoint, ImportProblem, ImportResult, TableCorners } from "@baize/vision";
import { ballName, isLowConfidence } from "../view/ballLook";

/**
 * The review of a photo import: the model behind the screen, free of React and of the photo
 * itself. Everything here works on corner positions in photo pixels and balls in table metres.
 */

/**
 * Room left around the photo on every side, as a share of its size, so that corners can lie
 * outside it: the same room the table finder allows a corner it found outside the photo.
 */
export const PAD_FRACTION = CORNER_OUTSIDE_SHARE;

/** The default corner rectangle is this far in from the photo's edges, as a share of its size. */
export const DEFAULT_INSET = 0.2;

/** Arrow-key steps for a corner, in photo pixels. */
export const NUDGE_PX = 1;
export const NUDGE_BIG_PX = 10;

/** The corner names, in the order of `TableCorners`. */
export const CORNER_LABELS = ["Baulk left", "Baulk right", "Top right", "Top left"] as const;

/** A ball in the review: found by the importer or edited by hand. Ids are local to one review. */
export interface ReviewBall {
  id: number;
  kind: BallKind;
  x: number;
  y: number;
  confidence: number;
}

/** A ball as drawn over the photo. */
export interface BallMarker {
  id: number;
  kind: BallKind;
  name: string;
  u: number;
  v: number;
  radiusPx: number;
  uncertain: boolean;
  colour: string;
}

/** The area the overlay covers: the photo plus its padding, in photo pixels. */
export function paddedArea(
  widthPx: number,
  heightPx: number,
): { x: number; y: number; w: number; h: number } {
  const px = widthPx * PAD_FRACTION;
  const py = heightPx * PAD_FRACTION;
  return { x: -px, y: -py, w: widthPx + 2 * px, h: heightPx + 2 * py };
}

/**
 * Corners on a rectangle inset from the photo's edges, for when no table was found. The
 * baulk end is the lower edge of the picture, where the camera usually is.
 */
export function defaultCorners(widthPx: number, heightPx: number): TableCorners {
  const left = widthPx * DEFAULT_INSET;
  const right = widthPx * (1 - DEFAULT_INSET);
  const top = heightPx * DEFAULT_INSET;
  const bottom = heightPx * (1 - DEFAULT_INSET);
  return [
    { u: left, v: bottom },
    { u: right, v: bottom },
    { u: right, v: top },
    { u: left, v: top },
  ];
}

/** The same table with its other end taken as the baulk end: corners [c, d, a, b]. */
export function turnCorners(corners: TableCorners): TableCorners {
  return [corners[2], corners[3], corners[0], corners[1]];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Moves one corner to a point, kept within the padded area. */
export function moveCorner(
  corners: TableCorners,
  index: number,
  to: ImagePoint,
  widthPx: number,
  heightPx: number,
): TableCorners {
  const area = paddedArea(widthPx, heightPx);
  const point = {
    u: clamp(to.u, area.x, area.x + area.w),
    v: clamp(to.v, area.y, area.y + area.h),
  };
  const next = corners.map((c, i) => (i === index ? point : c));
  return next as unknown as TableCorners;
}

/** Moves one corner by a step, kept within the padded area. */
export function nudgeCorner(
  corners: TableCorners,
  index: number,
  du: number,
  dv: number,
  widthPx: number,
  heightPx: number,
): TableCorners {
  const c = corners[index];
  if (!c) return corners;
  return moveCorner(corners, index, { u: c.u + du, v: c.v + dv }, widthPx, heightPx);
}

/** The step of an arrow key, or undefined for any other key. */
export function arrowStep(key: string, shift: boolean): { du: number; dv: number } | undefined {
  const n = shift ? NUDGE_BIG_PX : NUDGE_PX;
  switch (key) {
    case "ArrowLeft":
      return { du: -n, dv: 0 };
    case "ArrowRight":
      return { du: n, dv: 0 };
    case "ArrowUp":
      return { du: 0, dv: -n };
    case "ArrowDown":
      return { du: 0, dv: n };
    default:
      return undefined;
  }
}

/** "3 balls found, 1 uncertain". */
export function summaryText(balls: readonly ReviewBall[]): string {
  const uncertain = balls.filter((b) => isLowConfidence(b.confidence)).length;
  const found = `${String(balls.length)} ${balls.length === 1 ? "ball" : "balls"} found`;
  return `${found}, ${String(uncertain)} uncertain`;
}

export const MESSAGE_NOT_FOUND =
  "The table could not be found. Drag the four corners onto the corners of the playing area, where the cushions meet.";
export const MESSAGE_INVALID =
  "These corners do not make a table seen from above. Check that each handle is on the corner its label names.";
export const MESSAGE_BAULK_END = "The end nearer the camera is taken as the baulk end.";
export const MESSAGE_RUN_FAILED =
  "The photo could not be checked again. Cancel and import it once more.";

/**
 * What the review shows and whether its balls may be used. After a run that failed, the
 * corners on screen are newer than the balls, so the balls must not be used.
 */
export function reviewStatus(state: {
  failed: boolean;
  problem: ImportProblem | undefined;
  hasCamera: boolean;
  cornersDetected: boolean;
}): { messages: string[]; canConfirm: boolean } {
  if (state.failed) return { messages: [MESSAGE_RUN_FAILED], canConfirm: false };
  return {
    messages: reviewMessages(state.problem, state.cornersDetected),
    canConfirm: state.problem === undefined && state.hasCamera,
  };
}
export const NOTE_EDITS_LOST =
  "Moving a corner finds the balls again, so changes you made to balls by hand are lost.";

/** The messages to show for the state of the import. */
export function reviewMessages(
  problem: ImportProblem | undefined,
  cornersDetected: boolean,
): string[] {
  if (problem === "table-not-found") return [MESSAGE_NOT_FOUND];
  if (problem === "corners-invalid") return [MESSAGE_INVALID];
  return cornersDetected ? [MESSAGE_BAULK_END] : [];
}

/** Balls of an import result, numbered for this review. */
export function reviewBalls(layout: Layout): ReviewBall[] {
  return layout.balls.map((b, i) => ({
    id: i + 1,
    kind: b.kind,
    x: b.x,
    y: b.y,
    confidence: b.confidence ?? 1,
  }));
}

/** Where a review starts: the import's first result on the photo or frame. */
export interface ReviewInitial {
  problem?: ImportProblem;
  corners?: TableCorners;
  camera?: Camera;
  cornersDetected: boolean;
  balls: ReviewBall[];
}

/** The review's starting point from an import result. */
export function reviewInitial(result: ImportResult): ReviewInitial {
  return {
    ...(result.problem ? { problem: result.problem } : {}),
    ...(result.corners ? { corners: result.corners } : {}),
    ...(result.diagnostics.camera ? { camera: result.diagnostics.camera } : {}),
    cornersDetected: result.diagnostics.cornersDetected,
    balls: reviewBalls(result.layout),
  };
}

export const CALIBRATION_PLACED = "The table is placed. Check that each handle is on its corner.";
export const CALIBRATION_NOT_PLACED = "The table is not placed yet.";
export const CALIBRATION_ONE_CUE = "Tracking needs exactly one cue ball.";

/**
 * The summary line of a calibration: whether the corners give a table and camera and, once they
 * do, the balls found (tracking follows them, and needs exactly one cue ball).
 */
export function calibrationSummary(placed: boolean, balls?: readonly ReviewBall[]): string {
  if (!placed) return CALIBRATION_NOT_PLACED;
  if (!balls) return CALIBRATION_PLACED;
  const cues = balls.filter((b) => b.kind === "cue").length;
  const found = `${CALIBRATION_PLACED} ${summaryText(balls)}.`;
  return cues === 1 ? found : `${found} ${CALIBRATION_ONE_CUE}`;
}

function nextId(balls: readonly ReviewBall[]): number {
  return balls.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

/** A ball whose kind was chosen by hand is certain of its kind. */
export function setBallKind(
  balls: readonly ReviewBall[],
  id: number,
  kind: BallKind,
): ReviewBall[] {
  return balls.map((b) => (b.id === id ? { ...b, kind, confidence: 1 } : b));
}

export function removeReviewBall(balls: readonly ReviewBall[], id: number): ReviewBall[] {
  return balls.filter((b) => b.id !== id);
}

/** Adds a ball placed by hand, with confidence 1. */
export function addReviewBall(
  balls: readonly ReviewBall[],
  kind: BallKind,
  at: { x: number; y: number },
): { balls: ReviewBall[]; id: number } {
  const id = nextId(balls);
  return { balls: [...balls, { id, kind, x: at.x, y: at.y, confidence: 1 }], id };
}

/** Where each ball and its outline appear in the photo; balls that cannot be placed are left out. */
export function ballMarkers(
  camera: Camera | undefined,
  balls: readonly ReviewBall[],
  ballSet: BallSetSpec,
): BallMarker[] {
  if (!camera) return [];
  const out: BallMarker[] = [];
  for (const b of balls) {
    const centre = ballInPhoto(camera, b, ballSet, b.kind);
    const r = ballSizeOf(ballSet, b.kind).diameterM / 2;
    const radiusPx = apparentRadiusPx(camera, { x: b.x, y: b.y, z: r }, r);
    if (!centre || radiusPx === undefined) continue;
    out.push({
      id: b.id,
      kind: b.kind,
      name: ballName(b.kind),
      u: centre.u,
      v: centre.v,
      radiusPx,
      uncertain: isLowConfidence(b.confidence),
      colour: ballAppearance(b.kind).colour,
    });
  }
  return out;
}

/** The kinds the ball set has, with names, for the pickers. */
export function kindChoices(ballSet: BallSetSpec): { kind: BallKind; name: string }[] {
  return ballSet.kinds.map((k) => ({ kind: k.kind, name: ballName(k.kind) }));
}

/** The layout to put on the table: the reviewed balls, made placeable, confidences kept. */
export function confirmedLayout(
  balls: readonly ReviewBall[],
  table: TableSpec,
  ballSet: BallSetSpec,
): Layout {
  const layout: Layout = {
    balls: balls.map((b) => ({ kind: b.kind, x: b.x, y: b.y, confidence: b.confidence })),
  };
  return sanitizeLayout(layout, table, ballSet).layout;
}

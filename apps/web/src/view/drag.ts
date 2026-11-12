import type { Point, ViewTransform } from "./transform";

/**
 * Pure logic for moving a ball by pointer or keyboard. Pointer positions are screen points
 * (the SVG's own coordinates, in metres); results are table points.
 */

/** Table-space offset from the pointer to the ball centre at the moment of grabbing. */
export function grabOffset(view: ViewTransform, ball: Point, pointerScreen: Point): Point {
  const p = view.toTable(pointerScreen);
  return { x: ball.x - p.x, y: ball.y - p.y };
}

/** Where the ball goes when the pointer is at `pointerScreen`, keeping the grab offset. */
export function dragTarget(view: ViewTransform, offset: Point, pointerScreen: Point): Point {
  const p = view.toTable(pointerScreen);
  return { x: p.x + offset.x, y: p.y + offset.y };
}

/** One arrow-key step, in metres. */
export const STEP_M = 0.001;
/** One Shift+arrow step, in metres. */
export const BIG_STEP_M = 0.01;

const ARROWS: Record<string, Point> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  // Screen y points down.
  ArrowDown: { x: 0, y: 1 },
  ArrowUp: { x: 0, y: -1 },
};

/**
 * The table point a ball moves to when an arrow key is pressed, so that "right" is right on
 * the screen in either orientation. Undefined for other keys.
 */
export function arrowTarget(
  view: ViewTransform,
  ball: Point,
  key: string,
  big: boolean,
): Point | undefined {
  const dir = ARROWS[key];
  if (!dir) return undefined;
  const step = big ? BIG_STEP_M : STEP_M;
  const origin = view.toTable({ x: 0, y: 0 });
  const moved = view.toTable({ x: dir.x * step, y: dir.y * step });
  return { x: ball.x + (moved.x - origin.x), y: ball.y + (moved.y - origin.y) };
}

/** Delete and Backspace remove the focused ball. */
export function isRemoveKey(key: string): boolean {
  return key === "Delete" || key === "Backspace";
}

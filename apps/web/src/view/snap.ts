import type { Point } from "./transform";

/**
 * Spots a dragged ball snaps to when it is within this fraction of a ball radius of one.
 * Design choice: half a radius is strong enough to land on a spot without a steady hand, and
 * small enough not to fight a deliberate placement next to it.
 */
export const SNAP_RADIUS_FRACTION = 0.5;

/** Snap distance in metres for balls of the given radius. */
export function snapDistanceFor(ballRadiusM: number): number {
  return ballRadiusM * SNAP_RADIUS_FRACTION;
}

/**
 * The nearest spot within `snapDistanceM` of the point, or the very same point object when
 * there is none.
 */
export function snapPoint(point: Point, spots: readonly Point[], snapDistanceM: number): Point {
  let best: Point | undefined;
  let bestDistance = snapDistanceM;
  for (const spot of spots) {
    const d = Math.hypot(spot.x - point.x, spot.y - point.y);
    if (d <= bestDistance) {
      best = spot;
      bestDistance = d;
    }
  }
  return best ? { x: best.x, y: best.y } : point;
}

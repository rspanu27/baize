import { NO_CROSSING, firstDownCrossing } from "./math/roots";
import type { CushionArc, CushionSegment, PocketZone } from "./types";

/**
 * Event time functions: when does a moving ball next touch another ball, a cushion segment,
 * a jaw arc, or fall into a pocket?
 *
 * Every function takes the kinematics of the ball(s) at the current instant ("now", local
 * time 0) with their constant accelerations, and a window T that must not extend past the
 * end of any involved ball's current motion segment. They return the local time of the event
 * in [0, T], or NO_CROSSING.
 *
 * All of them reduce to `firstDownCrossing` on a gap polynomial, so they share its contact
 * rule (see math/roots.ts): approaching contact counts, separating contact does not, and
 * resting contact only counts once it has pressed in by `PENETRATION_TOL_M`.
 */

/** Position, velocity and (constant) acceleration of a ball at local time 0. */
export interface Kinematics {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly ax: number;
  readonly ay: number;
}

/** How far two touching things may press into each other before it counts as a new contact. */
export const PENETRATION_TOL_M = 1e-7;
/** Closing speed above which things that start in contact collide at once. */
export const CLOSING_SPEED_TOL = 1e-6;
/** Slack, as a fraction, on "is the contact point within this segment / arc". */
const EXTENT_TOL = 1e-9;

export { NO_CROSSING };

/** Time at which two balls touch (centre distance = sumRadii) while closing. */
export function ballBallTime(a: Kinematics, b: Kinematics, sumRadii: number, T: number): number {
  const cx = b.x - a.x;
  const cy = b.y - a.y;
  const bx = b.vx - a.vx;
  const by = b.vy - a.vy;
  const hx = 0.5 * (b.ax - a.ax);
  const hy = 0.5 * (b.ay - a.ay);
  // |c + b t + h t^2|^2 - D^2, a gap function in squared-distance units: about 2 D * gap.
  const scale = 2 * sumRadii;
  return firstDownCrossing(
    cx * cx + cy * cy - sumRadii * sumRadii,
    2 * (cx * bx + cy * by),
    bx * bx + by * by + 2 * (cx * hx + cy * hy),
    2 * (bx * hx + by * hy),
    hx * hx + hy * hy,
    T,
    { closingTol: scale * CLOSING_SPEED_TOL, penetrationTol: scale * PENETRATION_TOL_M },
  );
}

/**
 * Time at which a ball touches a straight cushion segment. `contactDist` is the distance from
 * the nose line to the ball's centre at contact (see `cushionContactDistance`).
 */
export function ballSegmentTime(
  ball: Kinematics,
  seg: CushionSegment,
  contactDist: number,
  T: number,
): number {
  const nx = seg.normal.x;
  const ny = seg.normal.y;
  const rx = ball.x - seg.a.x;
  const ry = ball.y - seg.a.y;
  const height = nx * rx + ny * ry;
  // A centre behind the nose line is inside the cushion or beyond a pocket: not this segment's.
  if (height < 0) return NO_CROSSING;
  const ex = seg.b.x - seg.a.x;
  const ey = seg.b.y - seg.a.y;
  const len2 = ex * ex + ey * ey;
  const slack = EXTENT_TOL * len2;
  const accept = (t: number): boolean => {
    const px = rx + t * (ball.vx + 0.5 * ball.ax * t);
    const py = ry + t * (ball.vy + 0.5 * ball.ay * t);
    const along = px * ex + py * ey; // times |e|
    return along >= -slack && along <= len2 + slack;
  };
  return firstDownCrossing(
    height - contactDist,
    nx * ball.vx + ny * ball.vy,
    0.5 * (nx * ball.ax + ny * ball.ay),
    0,
    0,
    T,
    { closingTol: CLOSING_SPEED_TOL, penetrationTol: PENETRATION_TOL_M, accept },
  );
}

/** Time at which a ball touches a convex jaw arc (or sharp point when the radius is 0). */
export function ballArcTime(
  ball: Kinematics,
  arc: CushionArc,
  contactDist: number,
  T: number,
): number {
  const D = arc.radiusM + contactDist;
  const cx = ball.x - arc.centre.x;
  const cy = ball.y - arc.centre.y;
  const hx = 0.5 * ball.ax;
  const hy = 0.5 * ball.ay;
  const accept = (t: number): boolean => {
    const ux = cx + t * (ball.vx + hx * t);
    const uy = cy + t * (ball.vy + hy * t);
    const slack = EXTENT_TOL * D;
    return arc.from.x * uy - arc.from.y * ux >= -slack && ux * arc.to.y - uy * arc.to.x >= -slack;
  };
  const scale = 2 * D;
  return firstDownCrossing(
    cx * cx + cy * cy - D * D,
    2 * (cx * ball.vx + cy * ball.vy),
    ball.vx * ball.vx + ball.vy * ball.vy + 2 * (cx * hx + cy * hy),
    2 * (ball.vx * hx + ball.vy * hy),
    hx * hx + hy * hy,
    T,
    { closingTol: scale * CLOSING_SPEED_TOL, penetrationTol: scale * PENETRATION_TOL_M, accept },
  );
}

const POCKET_OPTIONS = { closingTol: Number.NEGATIVE_INFINITY, penetrationTol: 0 };

/** Time at which a ball's centre enters a pocket's drop circle (0 if it is already inside). */
export function ballPocketTime(ball: Kinematics, pocket: PocketZone, T: number): number {
  const cx = ball.x - pocket.centre.x;
  const cy = ball.y - pocket.centre.y;
  const hx = 0.5 * ball.ax;
  const hy = 0.5 * ball.ay;
  return firstDownCrossing(
    cx * cx + cy * cy - pocket.radiusM * pocket.radiusM,
    2 * (cx * ball.vx + cy * ball.vy),
    ball.vx * ball.vx + ball.vy * ball.vy + 2 * (cx * hx + cy * hy),
    2 * (ball.vx * hx + ball.vy * hy),
    hx * hx + hy * hy,
    T,
    POCKET_OPTIONS,
  );
}

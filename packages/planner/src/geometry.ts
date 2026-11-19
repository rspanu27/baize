import { buildTableGeometry } from "@baize/physics";
import type { PocketId, Vec2 } from "@baize/physics";
import type { TableSpec } from "@baize/tables";
import { normalCdf } from "./math";

/**
 * Shot geometry without the simulator: pocket targets, the ghost ball, blocked lines, the cut,
 * and a fast estimate of how hard a pot is. The simulator decides what is played (task 6.4);
 * this ranks candidates and scores the shot left at the end of a route.
 */

/** A pocket as a target. */
export interface PocketTarget {
  readonly id: PocketId;
  /** Where an object ball is aimed: the centre of the pocket's drop circle. */
  readonly aim: Vec2;
  /** Unit vector pointing into the pocket, out of the table (a corner's diagonal, or square to the rail). */
  readonly axis: Vec2;
  /** Width of the opening at the jaws. */
  readonly mouthM: number;
}

const INV_SQRT2 = Math.SQRT1_2;

const AXES: Record<PocketId, Vec2> = {
  "corner-bl": { x: -INV_SQRT2, y: -INV_SQRT2 },
  "corner-br": { x: INV_SQRT2, y: -INV_SQRT2 },
  "corner-tl": { x: -INV_SQRT2, y: INV_SQRT2 },
  "corner-tr": { x: INV_SQRT2, y: INV_SQRT2 },
  "middle-l": { x: -1, y: 0 },
  "middle-r": { x: 1, y: 0 },
};

/** The six pockets of a table as targets, in the physics' fixed pocket order. */
export function pocketTargets(table: TableSpec): PocketTarget[] {
  return buildTableGeometry(table).pockets.map((p) => ({
    id: p.id,
    aim: p.centre,
    axis: AXES[p.id],
    mouthM: p.id.startsWith("corner") ? table.pockets.corner.mouthM : table.pockets.middle.mouthM,
  }));
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

function len(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

function unit(a: Vec2): Vec2 {
  const l = len(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Where the cue ball's centre must be at contact to send the target along `target -> towards`:
 * `sumRadiiM` behind the target on that line.
 */
export function ghostBall(target: Vec2, towards: Vec2, sumRadiiM: number): Vec2 {
  const d = unit(sub(towards, target));
  return { x: target.x - d.x * sumRadiiM, y: target.y - d.y * sumRadiiM };
}

/** Distance from point p to the segment a-b. */
export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? Math.min(1, Math.max(0, dot(sub(p, a), ab) / l2)) : 0;
  return len(sub(p, { x: a.x + ab.x * t, y: a.y + ab.y * t }));
}

/** A ball that may stand in the way. */
export interface Obstacle {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radiusM: number;
}

/**
 * Whether a ball of radius `radiusM` can travel in a straight line from `from` to `to` without
 * touching any of `others` (the moving ball and the ball it is meant to hit are left out by id).
 * `clearanceM` adds a margin: balls that would pass closer than that count as in the way.
 */
export function pathClear(
  from: Vec2,
  to: Vec2,
  radiusM: number,
  others: readonly Obstacle[],
  ignoreIds: readonly string[],
  clearanceM = 0,
): boolean {
  for (const o of others) {
    if (ignoreIds.includes(o.id)) continue;
    if (distanceToSegment(o, from, to) < radiusM + o.radiusM + clearanceM) return false;
  }
  return true;
}

/**
 * Cosine of the cut angle: the angle between the cue ball's travel (cue -> ghost) and the
 * object ball's departure (target -> pocket aim). 1 is a straight pot; 0 is a 90 degree cut.
 */
export function cutCos(cue: Vec2, ghost: Vec2, target: Vec2, aim: Vec2): number {
  return dot(unit(sub(ghost, cue)), unit(sub(aim, target)));
}

/**
 * Half the width of the lane an object ball's centre can take into a pocket when it arrives at
 * angle alpha to the pocket's axis: the mouth seen square to the ball's path, less one radius
 * at each jaw. Zero when the ball cannot fit (the jaw takes it).
 */
export function laneHalfWidthM(pocket: PocketTarget, travel: Vec2, ballRadiusM: number): number {
  const cosAlpha = dot(unit(travel), pocket.axis);
  if (cosAlpha <= 0) return 0;
  return Math.max(0, (pocket.mouthM * cosAlpha) / 2 - ballRadiusM);
}

/** The largest aim window the estimate reports, radians (about 29 degrees). */
const MAX_WINDOW_RAD = 0.5;

/** What the geometric estimate needs to know about one pot. */
export interface PotGeometry {
  readonly cue: Vec2;
  readonly target: Vec2;
  readonly targetRadiusM: number;
  readonly cueRadiusM: number;
  readonly pocket: PocketTarget;
}

/** The pot's geometry and how much aim error it forgives. */
export interface PotEstimate {
  readonly ghost: Vec2;
  /** Cosine of the cut angle. */
  readonly cutCos: number;
  /** Cue ball travel to the contact. */
  readonly cueDistanceM: number;
  /** Object ball travel to the pocket. */
  readonly targetDistanceM: number;
  /**
   * Half-width of the window of cue-ball directions that still pot, radians, with no throw or
   * squirt. 0 when the pot is not on (a cut of 90 degrees or more, or a lane too narrow).
   */
  readonly aimHalfWindowRad: number;
}

/**
 * The pot as straight lines. A small change e in the cue ball's direction turns the object
 * ball's direction by e * d1 / (s cos(theta)), with d1 the cue ball's travel to the contact,
 * s the sum of the radii and theta the cut: the farther the cue ball and the thinner the cut,
 * the more an aim error is magnified. The object ball's lane into the pocket allows a turn of
 * w / d2 (lane half-width over its travel), so the cue-ball window is that divided by the
 * magnification.
 */
export function estimatePot(g: PotGeometry): PotEstimate {
  const s = g.cueRadiusM + g.targetRadiusM;
  const ghost = ghostBall(g.target, g.pocket.aim, s);
  const c = cutCos(g.cue, ghost, g.target, g.pocket.aim);
  const d1 = len(sub(ghost, g.cue));
  const d2 = len(sub(g.pocket.aim, g.target));
  const lane = laneHalfWidthM(g.pocket, sub(g.pocket.aim, g.target), g.targetRadiusM);
  let window = 0;
  if (c > 0 && lane > 0 && d2 > 0) {
    const turn = lane / d2;
    // A cue ball very near the ghost position hardly turns the object ball by its aim; the
    // window is capped where the straight-line picture stops meaning anything.
    window = d1 > 1e-9 ? Math.min(MAX_WINDOW_RAD, (turn * s * c) / d1) : MAX_WINDOW_RAD;
  }
  return { ghost, cutCos: c, cueDistanceM: d1, targetDistanceM: d2, aimHalfWindowRad: window };
}

/**
 * Chance that a direction error with standard deviation `aimErrorRad` falls inside the window
 * from `-lowRad` to `+highRad` around the aim (both positive): Phi(high/sigma) - Phi(-low/sigma).
 */
export function chanceInWindow(lowRad: number, highRad: number, aimErrorRad: number): number {
  if (lowRad <= 0 && highRad <= 0) return 0;
  if (aimErrorRad <= 0) return lowRad > 0 && highRad > 0 ? 1 : 0;
  return Math.max(0, normalCdf(highRad / aimErrorRad) - normalCdf(-lowRad / aimErrorRad));
}

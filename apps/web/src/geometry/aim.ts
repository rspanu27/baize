// Pure 2D aiming geometry in table coordinates: metres, x across, y along, angles counter-clockwise
// from +x in radians.

export interface Point {
  x: number;
  y: number;
}

const TWO_PI = 2 * Math.PI;

/** Direction from one point to another, in (-pi, pi]. */
export function angleOf(from: Point, to: Point): number {
  // "+ 0" turns a -0 component into +0 so that a leftward direction is pi, not -pi.
  return Math.atan2(to.y - from.y + 0, to.x - from.x);
}

/** Wrap an angle into [0, 2 pi). */
export function normalizeAngle(rad: number): number {
  let r = rad % TWO_PI;
  if (r < 0) r += TWO_PI;
  return r >= TWO_PI ? 0 : r + 0;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Smallest angle between two lines (each by two points), ignoring direction: in [0, pi/2]. */
export function angleBetween(a1: Point, a2: Point, b1: Point, b2: Point): number {
  let d = normalizeAngle(angleOf(a1, a2) - angleOf(b1, b2));
  if (d > Math.PI) d = TWO_PI - d;
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** The angle p-vertex-q, in [0, pi]. */
export function angleAt(vertex: Point, p: Point, q: Point): number {
  const ax = p.x - vertex.x;
  const ay = p.y - vertex.y;
  const bx = q.x - vertex.x;
  const by = q.y - vertex.y;
  return Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);
}

/**
 * Where the cue ball's centre must be at contact to send the object ball towards `target`
 * (ignoring throw). Undefined if the target coincides with the object ball.
 */
export function ghostBall(
  objectBall: Point,
  target: Point,
  cueRadius: number,
  objectRadius: number,
): Point | undefined {
  const d = distance(target, objectBall);
  if (d === 0) return undefined;
  const k = (cueRadius + objectRadius) / d;
  return {
    x: objectBall.x + (objectBall.x - target.x) * k,
    y: objectBall.y + (objectBall.y - target.y) * k,
  };
}

/** Aim angle from the cue ball to the ghost ball. */
export function aimAtGhost(cue: Point, ghost: Point): number {
  return angleOf(cue, ghost);
}

/**
 * The cut angle in [0, pi/2]: between the cue ball's path to the ghost-ball position and the line
 * of centres at contact (ghost to object ball). Undefined for impossible or degenerate shots.
 */
export function cutAngle(
  cue: Point,
  objectBall: Point,
  target: Point,
  cueRadius: number,
  objectRadius: number,
): number | undefined {
  const ghost = ghostBall(objectBall, target, cueRadius, objectRadius);
  if (!ghost) return undefined;
  if (distance(cue, objectBall) < cueRadius + objectRadius) return undefined;
  if (distance(cue, ghost) === 0) return undefined;
  // Path direction is cue -> ghost; centres direction is ghost -> object ball.
  const tx = ghost.x - cue.x;
  const ty = ghost.y - cue.y;
  const cx = objectBall.x - ghost.x;
  const cy = objectBall.y - ghost.y;
  const dot = tx * cx + ty * cy;
  if (dot < 0) return undefined;
  return Math.atan2(Math.abs(tx * cy - ty * cx), dot);
}

/** Fraction of the object ball covered by the cue ball: 1 at a full-ball hit, 0.5 at 30 degrees. */
export function contactFraction(cutAngleRad: number): number {
  return 1 - Math.sin(cutAngleRad);
}

export interface LineBall {
  id: string;
  x: number;
  y: number;
  radiusM: number;
}

/**
 * First ball the cue ball touches travelling straight along the aim (cushions ignored). Returns
 * the cue ball's centre at contact and the distance travelled. Balls behind, or already
 * overlapping the cue ball, are ignored; a ball exactly touching ahead counts (distance 0).
 */
export function firstBallOnLine(
  cue: Point,
  aimAngleRad: number,
  cueRadius: number,
  others: LineBall[],
): { id: string; ghost: Point; distance: number } | undefined {
  const dx = Math.cos(aimAngleRad);
  const dy = Math.sin(aimAngleRad);
  let best: { id: string; t: number } | undefined;
  for (const o of others) {
    const r = cueRadius + o.radiusM;
    const fx = o.x - cue.x;
    const fy = o.y - cue.y;
    const tca = fx * dx + fy * dy;
    const d2 = fx * fx + fy * fy - tca * tca;
    if (d2 > r * r) continue;
    const t = tca - Math.sqrt(r * r - d2);
    if (t < 0) continue;
    if (!best || t < best.t) best = { id: o.id, t };
  }
  if (!best) return undefined;
  return {
    id: best.id,
    ghost: { x: cue.x + dx * best.t, y: cue.y + dy * best.t },
    distance: best.t,
  };
}

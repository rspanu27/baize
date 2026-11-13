import type { MotionState, Segment, Vec2, Vec3 } from "./types";

/**
 * Ball motion between events.
 *
 * Every state has a constant acceleration vector for the life of a segment, so position is
 * quadratic in time. That single property is what the event maths relies on.
 *
 * Conventions: z is up. The ball touches the cloth at -R z. The slip velocity of that contact
 * point over the cloth is u = v + R (z x omega) = (vx - R wy, vy + R wx).
 *
 *  - sliding:  friction acts against u, whose direction stays fixed for the whole slide.
 *              a = -mu_s g u_hat, slip shrinks at 7/2 |a|, ends when u = 0 (then rolling).
 *  - rolling:  u = 0. a = -mu_r g v_hat, ends when v = 0.
 *  - spinning: no translation, only vertical spin left.
 *  - Vertical spin decays at 5 mu_sp g / (2R) in every state and stops at zero. It does not
 *    affect translation in this model.
 *
 * Nap (optional). A rolling ball also gets a constant push b along the nap, so its true motion
 * is v' = -mu_r g v_hat + b, which has no solution that is a polynomial in time: the drag
 * turns with the ball. It is followed in pieces instead. Each rolling segment still has one
 * constant acceleration, -mu_r g h + b, where h is the heading the ball is predicted to have
 * half-way through the piece (a midpoint rule), and the piece ends when the heading has
 * turned by `NAP_TURN_TAN` or the speed has fallen to `NAP_SPEED_KEEP` of what it was,
 * whichever is first; the next piece starts from the velocity actually reached. The error of
 * one piece is of second order in those bounds. Because the drag stays within the turn bound
 * of the true heading and b is smaller than the drag, speed falls throughout every piece.
 * When the ball has less than `NAP_END_DISTANCE_M` left to roll, the last piece is straight.
 */

export interface MotionParams {
  readonly slidingFriction: number;
  readonly rollingResistance: number;
  readonly spinningFriction: number;
  readonly gravity: number;
  /** Acceleration (m/s^2) that the nap gives every rolling ball. Absent: no nap. */
  readonly nap?: Vec2;
}

/** Largest turn of heading within one rolling piece on a napped cloth (tangent of the angle). */
export const NAP_TURN_TAN = 0.03;
/** A rolling piece on a napped cloth ends when the speed has fallen to this fraction. */
export const NAP_SPEED_KEEP = 0.85;
/** A ball with less than this left to roll finishes in a straight line (nap ignored), m. */
export const NAP_END_DISTANCE_M = 1e-5;

/** Speeds (m/s, and rad/s for vertical spin) below this are treated as zero when classifying. */
export const REST_TOL = 1e-10;

const ZERO2: Vec2 = { x: 0, y: 0 };
const ZERO3: Vec3 = { x: 0, y: 0, z: 0 };

/** Slip velocity of the contact point over the cloth. */
export function slipVelocity(v: Vec2, w: Vec3, radiusM: number): Vec2 {
  return { x: v.x - radiusM * w.y, y: v.y + radiusM * w.x };
}

/** Motion state implied by a velocity and spin, used after any impulse. */
export function classify(v: Vec2, w: Vec3, radiusM: number): MotionState {
  const ux = v.x - radiusM * w.y;
  const uy = v.y + radiusM * w.x;
  if (ux * ux + uy * uy > REST_TOL * REST_TOL) return "sliding";
  if (v.x * v.x + v.y * v.y > REST_TOL * REST_TOL) return "rolling";
  if (w.z > REST_TOL || w.z < -REST_TOL) return "spinning";
  return "stationary";
}

function spinDecay(wz: number, radiusM: number, p: MotionParams): number {
  if (wz === 0) return 0;
  const rate = (5 * p.spinningFriction * p.gravity) / (2 * radiusM);
  return wz > 0 ? -rate : rate;
}

/**
 * Builds the segment that starts at time `t0` from the given kinematics.
 * `state` forces a state (used at transitions, where rounding would otherwise leave a
 * microscopic slip or speed); otherwise the state is classified from v and w.
 */
export function makeSegment(
  t0: number,
  r: Vec2,
  v: Vec2,
  w: Vec3,
  radiusM: number,
  p: MotionParams,
  state: MotionState = classify(v, w, radiusM),
): Segment {
  const g = p.gravity;
  if (state === "sliding") {
    const ux = v.x - radiusM * w.y;
    const uy = v.y + radiusM * w.x;
    const un = Math.sqrt(ux * ux + uy * uy);
    const k = (p.slidingFriction * g) / un;
    const ax = -k * ux;
    const ay = -k * uy;
    const c = 5 / (2 * radiusM);
    return {
      t0,
      duration: (2 * un) / (7 * p.slidingFriction * g),
      state,
      r0: r,
      v0: v,
      a: { x: ax, y: ay },
      omega0: w,
      alpha: { x: c * ay, y: -c * ax, z: spinDecay(w.z, radiusM, p) },
    };
  }
  if (state === "rolling") {
    const vn = Math.sqrt(v.x * v.x + v.y * v.y);
    const k = (p.rollingResistance * g) / vn;
    let ax = -k * v.x;
    let ay = -k * v.y;
    let duration = vn / (p.rollingResistance * g);
    if (p.nap) {
      const drag = p.rollingResistance * g;
      const hx = v.x / vn;
      const hy = v.y / vn;
      // The nap's push, along the heading and across it.
      const along = p.nap.x * hx + p.nap.y * hy;
      const acrossSigned = p.nap.y * hx - p.nap.x * hy;
      const across = acrossSigned < 0 ? -acrossSigned : acrossSigned;
      // Deceleration along the heading; positive because the push is smaller than the drag.
      const slowing = drag - along;
      if (across === 0 || vn * vn <= 2 * slowing * NAP_END_DISTANCE_M) {
        // Straight to rest: exact when the ball runs along the nap, and the last few
        // micrometres otherwise.
        ax = -slowing * hx;
        ay = -slowing * hy;
        duration = vn / slowing;
      } else {
        // First estimate with the drag along the present heading, to find how long the piece
        // may last; then the drag along the heading predicted for the middle of the piece.
        const ax1 = ax + p.nap.x;
        const ay1 = ay + p.nap.y;
        const turnTime = (NAP_TURN_TAN * vn) / (across + NAP_TURN_TAN * slowing);
        const speedTime = ((1 - NAP_SPEED_KEEP) * vn) / slowing;
        duration = turnTime < speedTime ? turnTime : speedTime;
        const mx = v.x + 0.5 * duration * ax1;
        const my = v.y + 0.5 * duration * ay1;
        const mn = Math.sqrt(mx * mx + my * my);
        ax = (-drag * mx) / mn + p.nap.x;
        ay = (-drag * my) / mn + p.nap.y;
      }
    }
    // Rolling constraint u = 0 fixes the horizontal spin exactly.
    const omega0: Vec3 = { x: -v.y / radiusM, y: v.x / radiusM, z: w.z };
    return {
      t0,
      duration,
      state,
      r0: r,
      v0: v,
      a: { x: ax, y: ay },
      omega0,
      alpha: { x: -ay / radiusM, y: ax / radiusM, z: spinDecay(w.z, radiusM, p) },
    };
  }
  if (state === "spinning") {
    const az = spinDecay(w.z, radiusM, p);
    return {
      t0,
      duration: az === 0 ? Number.POSITIVE_INFINITY : -w.z / az,
      state,
      r0: r,
      v0: ZERO2,
      a: ZERO2,
      omega0: { x: 0, y: 0, z: w.z },
      alpha: { x: 0, y: 0, z: az },
    };
  }
  // stationary or pocketed
  return {
    t0,
    duration: Number.POSITIVE_INFINITY,
    state,
    r0: r,
    v0: ZERO2,
    a: ZERO2,
    omega0: ZERO3,
    alpha: ZERO3,
  };
}

export function positionAt(s: Segment, tau: number): Vec2 {
  return {
    x: s.r0.x + tau * (s.v0.x + 0.5 * s.a.x * tau),
    y: s.r0.y + tau * (s.v0.y + 0.5 * s.a.y * tau),
  };
}

export function velocityAt(s: Segment, tau: number): Vec2 {
  return { x: s.v0.x + s.a.x * tau, y: s.v0.y + s.a.y * tau };
}

export function spinAt(s: Segment, tau: number): Vec3 {
  const wz0 = s.omega0.z;
  let wz = wz0 + s.alpha.z * tau;
  // Vertical spin stops at zero; it never reverses.
  if ((wz0 > 0 && wz < 0) || (wz0 < 0 && wz > 0)) wz = 0;
  return { x: s.omega0.x + s.alpha.x * tau, y: s.omega0.y + s.alpha.y * tau, z: wz };
}

/**
 * The segment that follows `s` when it runs to its natural end (no collision):
 * sliding -> rolling, rolling -> spinning or stationary (or, on a napped cloth, the next piece
 * of the same roll), spinning -> stationary.
 * Values that are zero by definition at the transition are set to exactly zero.
 */
export function nextSegment(s: Segment, radiusM: number, p: MotionParams): Segment {
  const tau = s.duration;
  const t = s.t0 + tau;
  const r = positionAt(s, tau);
  if (s.state === "sliding") {
    const v = velocityAt(s, tau);
    const w = spinAt(s, tau);
    if (v.x * v.x + v.y * v.y > REST_TOL * REST_TOL) {
      return makeSegment(t, r, v, w, radiusM, p, "rolling");
    }
    // The slide ended with the ball at rest (for example pure backspin spent exactly).
    return makeSegment(t, r, ZERO2, { x: 0, y: 0, z: w.z }, radiusM, p, restState(w.z));
  }
  if (s.state === "rolling") {
    if (p.nap) {
      // On a napped cloth a rolling segment may be one piece of a longer roll.
      const v = velocityAt(s, tau);
      if (v.x * v.x + v.y * v.y > REST_TOL * REST_TOL) {
        return makeSegment(t, r, v, spinAt(s, tau), radiusM, p, "rolling");
      }
    }
    const wz = spinAt(s, tau).z;
    return makeSegment(t, r, ZERO2, { x: 0, y: 0, z: wz }, radiusM, p, restState(wz));
  }
  return makeSegment(t, r, ZERO2, ZERO3, radiusM, p, "stationary");
}

function restState(wz: number): MotionState {
  return wz > REST_TOL || wz < -REST_TOL ? "spinning" : "stationary";
}

/** Kinetic energy (translation plus rotation) of a solid ball. */
export function kineticEnergy(massKg: number, radiusM: number, v: Vec2, w: Vec3): number {
  const inertia = 0.4 * massKg * radiusM * radiusM;
  return (
    0.5 * massKg * (v.x * v.x + v.y * v.y) + 0.5 * inertia * (w.x * w.x + w.y * w.y + w.z * w.z)
  );
}

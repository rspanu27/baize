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
 */

export interface MotionParams {
  readonly slidingFriction: number;
  readonly rollingResistance: number;
  readonly spinningFriction: number;
  readonly gravity: number;
}

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
    const ax = -k * v.x;
    const ay = -k * v.y;
    // Rolling constraint u = 0 fixes the horizontal spin exactly.
    const omega0: Vec3 = { x: -v.y / radiusM, y: v.x / radiusM, z: w.z };
    return {
      t0,
      duration: vn / (p.rollingResistance * g),
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
 * sliding -> rolling, rolling -> spinning or stationary, spinning -> stationary.
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

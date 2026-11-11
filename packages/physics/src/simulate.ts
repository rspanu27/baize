import { NO_CROSSING, ballArcTime, ballBallTime, ballPocketTime, ballSegmentTime } from "./detect";
import type { Kinematics } from "./detect";
import { buildTableGeometry, cushionContactDistance, isPreparedTable } from "./geometry";
import { frictionlessBallBall } from "./models/ballBall";
import { noseImpulseCushion } from "./models/cushion";
import { classify, makeSegment, nextSegment, positionAt, spinAt, velocityAt } from "./motion";
import type { MotionParams } from "./motion";
import { strike } from "./strike";
import { SimInputError } from "./types";
import type {
  BallInput,
  BallTrack,
  CushionInput,
  MotionState,
  Segment,
  SimEvent,
  SimInput,
  SimParams,
  SimResult,
  SimStatus,
  TableGeometry,
  Vec2,
  Vec3,
} from "./types";

/**
 * The event loop.
 *
 * Each ball has one current motion segment (constant acceleration). The loop repeatedly finds
 * the earliest next event (a collision with a ball, cushion or pocket, or the natural end of a
 * segment), resolves it, and gives only the balls involved a new segment. Nothing else is
 * touched, so no error accumulates in balls that are not part of an event.
 *
 * Event times are cached per ball and per pair and recomputed only for balls whose segment
 * changed. Everything is scanned in input order with strict comparisons, so ties are always
 * broken the same way and the result is deterministic.
 *
 * Touching balls and simultaneous contacts need no special machinery: after a collision the
 * affected balls' events are recomputed, any touching neighbour that is now being closed on
 * reports an event at the same instant, and that is resolved next. Closing speeds below
 * `INELASTIC_SPEED` are resolved without rebound, which is what makes such chains end.
 *
 * Pressing contact. Two balls left touching with no relative speed can be pushed together by
 * their different friction decelerations (for example a rolling ball behind a sliding one).
 * Resolved by impulses alone, that becomes an endless stream of microscopic collisions. So
 * when a slow collision leaves a pair pressing, the pair is given the contact force that
 * keeps them from closing: both get the mass-weighted mean of their accelerations along the
 * line of centres. That keeps every segment a constant-acceleration segment, conserves
 * momentum, and cannot add energy (the weighted mean of squares is never below the square of
 * the weighted mean). The shared segments last until either ball's motion segment would have
 * ended, or until anything else happens to either ball; then the balls are released and
 * re-classified from their actual velocity and spin.
 */

/** Relative acceleration (m/s^2) along the line of centres above which a pair is pressing. */
const PRESSING_ACCEL_TOL = 1e-9;

/** Standard gravity (CGPM 1901 conventional value), m/s^2. */
export const STANDARD_GRAVITY = 9.80665;

export const DEFAULT_SIM_PARAMS: SimParams = {
  gravity: STANDARD_GRAVITY,
  maxEvents: 20000,
  maxTimeS: 120,
};

/** Closing speeds below this (m/s) are resolved with no rebound. Design tolerance. */
export const INELASTIC_SPEED = 1e-2;

/**
 * A ball that comes out of a collision with both its speed and its slip speed below this
 * (m/s) is put to rest. Design tolerance: at 1 mm/s a rolling ball would travel only a few
 * micrometres more, but without this, balls nudged inside a tight pack keep trading
 * microscopic collisions (thousands of events for no visible motion). It only removes energy.
 */
export const REST_SPEED = 1e-2;

/**
 * Overlap between two input balls, or between an input ball and a cushion, that still counts
 * as touching. Matches the 0.01 mm quantisation of shared links with some margin.
 */
export const INPUT_OVERLAP_TOL_M = 2e-5;

const INF = Number.POSITIVE_INFINITY;

const CushionKind = { None: 0, Segment: 1, Arc: 2, Pocket: 3 } as const;
type CushionKind = (typeof CushionKind)[keyof typeof CushionKind];

interface Body {
  readonly index: number;
  readonly id: string;
  readonly radiusM: number;
  readonly massKg: number;
  /** Centre-to-nose distance when touching a cushion. */
  readonly contactDist: number;
  seg: Segment;
  /** Absolute time at which the current segment ends naturally. */
  end: number;
  /** Whether the current segment has any translation. */
  moving: boolean;
  pocketed: boolean;
  readonly track: Segment[];
  /** Next cushion or pocket event. */
  cushionTime: number;
  cushionKind: CushionKind;
  cushionIndex: number;
  /**
   * Indices of balls this one is currently pressing against (see "pressing contact" in the
   * loop). While the list is not empty the current segment's acceleration includes contact
   * forces and the segment must not be continued with `nextSegment`.
   */
  partners: number[];
  /**
   * True while the current segment's acceleration has been altered by a contact force (a
   * pressing ball or a cushion the ball is running along). Such a segment is ended by
   * re-classifying the ball from its actual state, never with `nextSegment`.
   */
  forced: boolean;
}

function fail(code: SimInputError["code"], message: string): never {
  throw new SimInputError(code, message);
}

function finite(...values: number[]): boolean {
  for (const v of values) if (!Number.isFinite(v)) return false;
  return true;
}

function validate(input: SimInput, geometry: TableGeometry, cushion: CushionInput): void {
  const { cloth, balls } = input;
  if (balls.length === 0) fail("no-balls", "at least one ball is required");
  if (
    !finite(cloth.slidingFriction, cloth.rollingResistance, cloth.spinningFriction) ||
    !(cloth.slidingFriction > 0) ||
    !(cloth.rollingResistance > 0) ||
    !(cloth.spinningFriction > 0)
  ) {
    fail("invalid-cloth", "cloth friction coefficients must be positive numbers");
  }
  if (!(input.ballRestitution >= 0 && input.ballRestitution <= 1)) {
    fail("invalid-ball", "ball restitution must be between 0 and 1");
  }
  const ids = new Set<string>();
  for (const b of balls) {
    if (ids.has(b.id)) fail("duplicate-ball-id", `ball id "${b.id}" is used more than once`);
    ids.add(b.id);
    const v = b.velocity ?? { x: 0, y: 0 };
    const w = b.spin ?? { x: 0, y: 0, z: 0 };
    if (!finite(b.x, b.y, b.radiusM, b.massKg, v.x, v.y, w.x, w.y, w.z)) {
      fail("non-finite", `ball "${b.id}" has a non-finite value`);
    }
    if (!(b.radiusM > 0) || !(b.massKg > 0)) {
      fail("invalid-ball", `ball "${b.id}" must have a positive radius and mass`);
    }
    if (!(cushion.noseHeightM < 2 * b.radiusM)) {
      fail("invalid-table", `the cushion nose is higher than ball "${b.id}"`);
    }
    const d = cushionContactDistance(b.radiusM, cushion.noseHeightM) - INPUT_OVERLAP_TOL_M;
    if (b.x < d || b.x > geometry.widthM - d || b.y < d || b.y > geometry.lengthM - d) {
      fail("ball-outside-table", `ball "${b.id}" is not inside the cushions`);
    }
  }
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i] as BallInput;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j] as BallInput;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.radiusM + b.radiusM - INPUT_OVERLAP_TOL_M;
      if (dx * dx + dy * dy < min * min) {
        fail("balls-overlap", `balls "${a.id}" and "${b.id}" overlap`);
      }
    }
  }
  if (input.shot && !ids.has(input.shot.ballId)) {
    fail(
      "unknown-shot-ball",
      `the shot refers to ball "${input.shot.ballId}", which does not exist`,
    );
  }
}

/** How far the pocket drop circles reach into the playing rectangle. */
function pocketIntrusion(g: TableGeometry): number {
  let worst = 0;
  for (const p of g.pockets) {
    const cx = Math.min(Math.max(p.centre.x, 0), g.widthM);
    const cy = Math.min(Math.max(p.centre.y, 0), g.lengthM);
    const dx = p.centre.x - cx;
    const dy = p.centre.y - cy;
    const outside = Math.sqrt(dx * dx + dy * dy);
    let reach = p.radiusM - outside;
    if (outside === 0) {
      // Centre inside the rectangle: reach is the radius plus the depth of the centre.
      const depth = Math.min(p.centre.x, g.widthM - p.centre.x, p.centre.y, g.lengthM - p.centre.y);
      reach = p.radiusM + depth;
    }
    if (reach > worst) worst = reach;
  }
  return worst;
}

/** Smallest and largest value of p + v t + a t^2 / 2 on [0, T]. Results in `rangeOut`. */
const rangeOut = { min: 0, max: 0 };
function range(p: number, v: number, a: number, T: number): void {
  const end = p + T * (v + 0.5 * a * T);
  let min = p < end ? p : end;
  let max = p < end ? end : p;
  if (a !== 0) {
    const turn = -v / a;
    if (turn > 0 && turn < T) {
      const at = p + turn * (v + 0.5 * a * turn);
      if (at < min) min = at;
      if (at > max) max = at;
    }
  }
  rangeOut.min = min;
  rangeOut.max = max;
}

/**
 * Simulates a shot until every ball is at rest or pocketed, or a cap is reached.
 *
 * Throws `SimInputError` for invalid input. Reaching `maxEvents` or `maxTimeS` does not throw:
 * the result holds what was simulated and `status` says why it stopped.
 */
export function simulate(input: SimInput, params?: Partial<SimParams>): SimResult {
  const p: SimParams = { ...DEFAULT_SIM_PARAMS, ...params };
  if (!(p.gravity > 0) || !(p.maxEvents > 0) || !(p.maxTimeS > 0)) {
    throw new RangeError("simulation parameters must be positive");
  }
  const tableInput = isPreparedTable(input.table) ? input.table.table : input.table;
  const geometry = isPreparedTable(input.table)
    ? input.table.geometry
    : buildTableGeometry(input.table);
  const cushion = tableInput.cushion;
  validate(input, geometry, cushion);

  const motion: MotionParams = {
    slidingFriction: input.cloth.slidingFriction,
    rollingResistance: input.cloth.rollingResistance,
    spinningFriction: input.cloth.spinningFriction,
    gravity: p.gravity,
  };
  const ballBall = input.models?.ballBall ?? frictionlessBallBall;
  const cushionModel = input.models?.cushion ?? noseImpulseCushion;
  const restitution = input.ballRestitution;
  const { segments, arcs, pockets } = geometry;
  const W = geometry.widthM;
  const L = geometry.lengthM;
  const intrusion = pocketIntrusion(geometry);

  const events: SimEvent[] = [];
  let rootSearches = 0;

  // --- set up bodies -----------------------------------------------------------------------
  const n = input.balls.length;
  const bodies: Body[] = [];
  for (let i = 0; i < n; i++) {
    const b = input.balls[i] as BallInput;
    let v: Vec2 = b.velocity ?? { x: 0, y: 0 };
    let w: Vec3 = b.spin ?? { x: 0, y: 0, z: 0 };
    if (input.shot && input.shot.ballId === b.id) {
      const struck = strike(b.radiusM, input.shot);
      v = struck.velocity;
      w = struck.spin;
      events.push({ type: "strike", t: 0, ballId: b.id });
    }
    const seg = makeSegment(0, { x: b.x, y: b.y }, v, w, b.radiusM, motion);
    bodies.push({
      index: i,
      id: b.id,
      radiusM: b.radiusM,
      massKg: b.massKg,
      contactDist: cushionContactDistance(b.radiusM, cushion.noseHeightM),
      seg,
      end: seg.duration,
      moving: seg.state === "sliding" || seg.state === "rolling",
      pocketed: false,
      track: [seg],
      cushionTime: INF,
      cushionKind: CushionKind.None,
      cushionIndex: -1,
      partners: [],
      forced: false,
    });
  }
  // pairTime[i * n + j] for i < j: absolute time of the next collision between i and j.
  const pairTime = new Float64Array(n * n).fill(INF);

  const kinAt = (b: Body, now: number): Kinematics => {
    const s = b.seg;
    if (!b.moving) return { x: s.r0.x, y: s.r0.y, vx: 0, vy: 0, ax: 0, ay: 0 };
    const tau = now - s.t0;
    return {
      x: s.r0.x + tau * (s.v0.x + 0.5 * s.a.x * tau),
      y: s.r0.y + tau * (s.v0.y + 0.5 * s.a.y * tau),
      vx: s.v0.x + s.a.x * tau,
      vy: s.v0.y + s.a.y * tau,
      ax: s.a.x,
      ay: s.a.y,
    };
  };

  /** Finds the next cushion or pocket event of a ball. */
  const scanCushions = (b: Body, k: Kinematics, now: number): void => {
    b.cushionTime = INF;
    b.cushionKind = CushionKind.None;
    b.cushionIndex = -1;
    if (!b.moving || b.pocketed) return;
    let T = b.end - now;
    if (!(T >= 0)) T = 0;
    // Broad phase: a ball that stays well inside the rectangle cannot reach anything.
    const reach = b.radiusM > intrusion ? b.radiusM : intrusion;
    range(k.x, k.vx, k.ax, T);
    const minX = rangeOut.min;
    const maxX = rangeOut.max;
    range(k.y, k.vy, k.ay, T);
    if (minX > reach && maxX < W - reach && rangeOut.min > reach && rangeOut.max < L - reach)
      return;

    let best = INF;
    let window = T;
    for (let i = 0; i < pockets.length; i++) {
      rootSearches++;
      const t = ballPocketTime(k, pockets[i] as (typeof pockets)[number], window);
      if (t !== NO_CROSSING && t < best) {
        best = t;
        window = t;
        b.cushionKind = CushionKind.Pocket;
        b.cushionIndex = i;
      }
    }
    for (let i = 0; i < segments.length; i++) {
      rootSearches++;
      const t = ballSegmentTime(k, segments[i] as (typeof segments)[number], b.contactDist, window);
      if (t !== NO_CROSSING && t < best) {
        best = t;
        window = t;
        b.cushionKind = CushionKind.Segment;
        b.cushionIndex = i;
      }
    }
    for (let i = 0; i < arcs.length; i++) {
      rootSearches++;
      const t = ballArcTime(k, arcs[i] as (typeof arcs)[number], b.contactDist, window);
      if (t !== NO_CROSSING && t < best) {
        best = t;
        window = t;
        b.cushionKind = CushionKind.Arc;
        b.cushionIndex = i;
      }
    }
    if (best !== INF) {
      // Never later than the end of the segment the time was computed on.
      const at = now + best;
      b.cushionTime = at > b.end ? b.end : at;
    }
  };

  /** Recomputes the collision time between two balls (lo.index < hi.index). */
  const scanPair = (lo: Body, hi: Body, kLo: Kinematics, kHi: Kinematics, now: number): void => {
    const slot = lo.index * n + hi.index;
    pairTime[slot] = INF;
    if (lo.pocketed || hi.pocketed) return;
    if (!lo.moving && !hi.moving) return;
    let T = (lo.end < hi.end ? lo.end : hi.end) - now;
    if (!(T >= 0)) T = 0;
    // Broad phase: bounding boxes of the two paths over the window.
    const D = lo.radiusM + hi.radiusM;
    range(kLo.x, kLo.vx, kLo.ax, T);
    const loMinX = rangeOut.min;
    const loMaxX = rangeOut.max;
    range(kHi.x, kHi.vx, kHi.ax, T);
    if (loMinX - rangeOut.max > D || rangeOut.min - loMaxX > D) return;
    range(kLo.y, kLo.vy, kLo.ay, T);
    const loMinY = rangeOut.min;
    const loMaxY = rangeOut.max;
    range(kHi.y, kHi.vy, kHi.ay, T);
    if (loMinY - rangeOut.max > D || rangeOut.min - loMaxY > D) return;
    rootSearches++;
    const t = ballBallTime(kLo, kHi, D, T);
    if (t !== NO_CROSSING) {
      // Never later than the end of the segments the time was computed on.
      const at = now + t;
      const limit = lo.end < hi.end ? lo.end : hi.end;
      pairTime[slot] = at > limit ? limit : at;
    }
  };

  /** Recomputes every cached event that involves ball `b` after its segment changed. */
  const refresh = (b: Body, now: number): void => {
    const k = kinAt(b, now);
    scanCushions(b, k, now);
    for (let j = 0; j < n; j++) {
      if (j === b.index) continue;
      const other = bodies[j] as Body;
      const kOther = kinAt(other, now);
      if (j < b.index) scanPair(other, b, kOther, k, now);
      else scanPair(b, other, k, kOther, now);
    }
  };

  /** Gives a ball a new segment starting at `now`. */
  const setSegment = (b: Body, seg: Segment): void => {
    // Several events at the same instant: keep only the last segment for that instant.
    if (b.seg.t0 === seg.t0) b.track[b.track.length - 1] = seg;
    else b.track.push(seg);
    b.seg = seg;
    b.end = seg.t0 + seg.duration;
    b.moving = seg.state === "sliding" || seg.state === "rolling";
    b.forced = false;
  };

  /**
   * Applies the rest threshold to a ball coming out of a collision: below `REST_SPEED` in both
   * speed and slip it is put to rest (vertical spin is kept). Returns true if it was.
   */
  const settled = { v: { x: 0, y: 0 } as Vec2, w: { x: 0, y: 0, z: 0 } as Vec3, atRest: false };
  const settle = (b: Body, v: Vec2, w: Vec3): void => {
    const ux = v.x - b.radiusM * w.y;
    const uy = v.y + b.radiusM * w.x;
    const limit = REST_SPEED * REST_SPEED;
    if (v.x * v.x + v.y * v.y < limit && ux * ux + uy * uy < limit) {
      settled.v = { x: 0, y: 0 };
      settled.w = { x: 0, y: 0, z: w.z };
      settled.atRest = true;
    } else {
      settled.v = v;
      settled.w = w;
      settled.atRest = false;
    }
  };

  /** New segment for a ball that has just been through a collision. */
  const restart = (b: Body, now: number, r: Vec2, v: Vec2, w: Vec3): void => {
    setSegment(b, makeSegment(now, r, v, w, b.radiusM, motion, classify(v, w, b.radiusM)));
  };

  /**
   * Ends every pressing contact in the group of balls connected to `root`: each ball gets a
   * fresh, force-free segment from its actual state at `now`. Emits a transition event for
   * balls whose state changes. Does nothing for a ball with no partners.
   */
  const releaseGroup = (root: Body, now: number): void => {
    if (root.partners.length === 0) {
      if (!root.forced) return;
      // Held only by a cushion: re-classify this ball alone.
      const tau = now - root.seg.t0;
      const from = root.seg.state;
      settle(root, velocityAt(root.seg, tau), spinAt(root.seg, tau));
      restart(root, now, positionAt(root.seg, tau), settled.v, settled.w);
      if (root.seg.state !== from) {
        events.push({ type: "transition", t: now, ballId: root.id, from, to: root.seg.state });
      }
      refresh(root, now);
      return;
    }
    const group: Body[] = [];
    const stack: Body[] = [root];
    const seen = new Set<number>();
    while (stack.length > 0) {
      const b = stack.pop() as Body;
      if (seen.has(b.index)) continue;
      seen.add(b.index);
      group.push(b);
      for (const j of b.partners) stack.push(bodies[j] as Body);
      b.partners = [];
    }
    group.sort((x, y) => x.index - y.index);
    for (const b of group) {
      const tau = now - b.seg.t0;
      const from = b.seg.state;
      settle(b, velocityAt(b.seg, tau), spinAt(b.seg, tau));
      restart(b, now, positionAt(b.seg, tau), settled.v, settled.w);
      if (b.seg.state !== from) {
        events.push({ type: "transition", t: now, ballId: b.id, from, to: b.seg.state });
      }
    }
    for (const b of group) refresh(b, now);
  };

  /**
   * Segment for a ball coming out of a slow (no-rebound) collision. A ball already in a
   * pressing contact keeps the acceleration, spin rates and end time of its current segment;
   * any other ball gets a fresh segment.
   */
  const slowSegment = (b: Body, now: number, r: Vec2, v: Vec2, w: Vec3): Segment => {
    if (b.partners.length === 0) {
      return makeSegment(now, r, v, w, b.radiusM, motion, classify(v, w, b.radiusM));
    }
    const s = b.seg;
    return {
      t0: now,
      duration: b.end - now,
      state: s.state,
      r0: r,
      v0: v,
      a: s.a,
      omega0: w,
      alpha: s.alpha,
    };
  };

  /** Time until a ball that starts with velocity v and acceleration a stops moving along v. */
  const timeToReverse = (v: Vec2, a: Vec2): number => {
    const along = a.x * v.x + a.y * v.y;
    return along < 0 ? -(v.x * v.x + v.y * v.y) / along : INF;
  };

  const checkInBounds = (b: Body, r: Vec2): void => {
    const m = b.radiusM;
    const g = geometry.bounds;
    if (r.x < g.minX - m || r.x > g.maxX + m || r.y < g.minY - m || r.y > g.maxY + m) {
      throw new Error(`internal error: ball "${b.id}" left the table at (${r.x}, ${r.y})`);
    }
  };

  // --- initial event times -------------------------------------------------------------------
  const k0: Kinematics[] = bodies.map((b) => kinAt(b, 0));
  for (let i = 0; i < n; i++) {
    const b = bodies[i] as Body;
    scanCushions(b, k0[i] as Kinematics, 0);
    for (let j = i + 1; j < n; j++) {
      scanPair(b, bodies[j] as Body, k0[i] as Kinematics, k0[j] as Kinematics, 0);
    }
  }

  // --- main loop -----------------------------------------------------------------------------
  let now = 0;
  let status: SimStatus = "complete";
  let eventCount = 0;
  for (;;) {
    // Earliest event. Scan order (cushions and pockets, then pairs, then transitions, each in
    // ball order) with strict comparison fixes how ties are broken.
    let best = INF;
    let kind = 0; // 1 cushion/pocket, 2 pair, 3 transition
    let ia = -1;
    let ib = -1;
    for (let i = 0; i < n; i++) {
      const t = (bodies[i] as Body).cushionTime;
      if (t < best) {
        best = t;
        kind = 1;
        ia = i;
      }
    }
    for (let i = 0; i < n; i++) {
      const row = i * n;
      for (let j = i + 1; j < n; j++) {
        const t = pairTime[row + j] as number;
        if (t < best) {
          best = t;
          kind = 2;
          ia = i;
          ib = j;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const b = bodies[i] as Body;
      if (!b.pocketed && b.end < best) {
        best = b.end;
        kind = 3;
        ia = i;
      }
    }

    if (kind === 0) break;
    if (best > p.maxTimeS) {
      status = "timeLimit";
      break;
    }
    if (eventCount >= p.maxEvents) {
      status = "eventLimit";
      break;
    }
    eventCount++;
    // Time never runs backwards, even by a rounding error.
    if (best > now) now = best;
    const a = bodies[ia] as Body;

    if (kind === 3 && a.forced) {
      // The shared segment of a pressing contact has run out: release the group. Each ball
      // is re-classified from its actual state, and events are emitted for state changes.
      releaseGroup(a, now);
      continue;
    }
    if (kind === 3) {
      const from = a.seg.state;
      setSegment(a, nextSegment(a.seg, a.radiusM, motion));
      // The transition is stamped with the segment's own end time; keep the loop clock in step.
      now = a.seg.t0;
      events.push({ type: "transition", t: now, ballId: a.id, from, to: a.seg.state });
      refresh(a, now);
      continue;
    }

    // Anything other than a slow ball-ball contact ends the pressing contacts of the balls
    // involved, so they are released first (which re-starts them at `now`).
    if (kind === 1) releaseGroup(a, now);
    let tauA = now - a.seg.t0;
    let ra = positionAt(a.seg, tauA);
    let va = velocityAt(a.seg, tauA);
    let wa = spinAt(a.seg, tauA);
    checkInBounds(a, ra);

    if (kind === 2) {
      const b = bodies[ib] as Body;
      let tauB = now - b.seg.t0;
      let rb = positionAt(b.seg, tauB);
      let vb = velocityAt(b.seg, tauB);
      let wb = spinAt(b.seg, tauB);
      const dx = rb.x - ra.x;
      const dy = rb.y - ra.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const normal: Vec2 = { x: dx / dist, y: dy / dist };
      const closing = (va.x - vb.x) * normal.x + (va.y - vb.y) * normal.y;
      const slow = closing < INELASTIC_SPEED;
      if (!slow && (a.partners.length > 0 || b.partners.length > 0)) {
        // A real collision: release both balls from any pressing contact and re-read them.
        releaseGroup(a, now);
        releaseGroup(b, now);
        tauA = now - a.seg.t0;
        ra = positionAt(a.seg, tauA);
        va = velocityAt(a.seg, tauA);
        wa = spinAt(a.seg, tauA);
        tauB = now - b.seg.t0;
        rb = positionAt(b.seg, tauB);
        vb = velocityAt(b.seg, tauB);
        wb = spinAt(b.seg, tauB);
      }
      const out = ballBall.resolve(
        { radiusM: a.radiusM, massKg: a.massKg, velocity: va, spin: wa },
        { radiusM: b.radiusM, massKg: b.massKg, velocity: vb, spin: wb },
        normal,
        slow ? 0 : restitution,
      );
      settle(a, out.a.velocity, out.a.spin);
      let vA = settled.v;
      let wA = settled.w;
      let restA = settled.atRest;
      settle(b, out.b.velocity, out.b.spin);
      let vB = settled.v;
      let wB = settled.w;
      let restB = settled.atRest;
      // Putting one ball to rest can leave the other still closing on it. Take that remaining
      // closing speed out of the ball that is still moving, so the pair cannot collide again
      // at this instant.
      for (let pass = 0; pass < 2; pass++) {
        const left = (vA.x - vB.x) * normal.x + (vA.y - vB.y) * normal.y;
        if (!(left > 0)) break;
        if (!restA) {
          settle(a, { x: vA.x - left * normal.x, y: vA.y - left * normal.y }, wA);
          vA = settled.v;
          wA = settled.w;
          restA = settled.atRest;
        } else if (!restB) {
          settle(b, { x: vB.x + left * normal.x, y: vB.y + left * normal.y }, wB);
          vB = settled.v;
          wB = settled.w;
          restB = settled.atRest;
        }
      }
      if (!slow) {
        restart(a, now, ra, vA, wA);
        restart(b, now, rb, vB, wB);
      } else {
        // Slow contact: the pair now has no closing speed. If their accelerations would push
        // them together, give both the mean acceleration along the line of centres.
        let sA = slowSegment(a, now, ra, vA, wA);
        let sB = slowSegment(b, now, rb, vB, wB);
        const aAn = sA.a.x * normal.x + sA.a.y * normal.y;
        const aBn = sB.a.x * normal.x + sB.a.y * normal.y;
        if (aBn - aAn < -PRESSING_ACCEL_TOL) {
          const mean = (a.massKg * aAn + b.massKg * aBn) / (a.massKg + b.massKg);
          const accA: Vec2 = {
            x: sA.a.x + (mean - aAn) * normal.x,
            y: sA.a.y + (mean - aAn) * normal.y,
          };
          const accB: Vec2 = {
            x: sB.a.x + (mean - aBn) * normal.x,
            y: sB.a.y + (mean - aBn) * normal.y,
          };
          let duration = sA.duration < sB.duration ? sA.duration : sB.duration;
          // Do not let a pushed-back ball run past the point where it would turn round.
          const revA = timeToReverse(vA, accA);
          const revB = timeToReverse(vB, accB);
          if (revA < duration) duration = revA;
          if (revB < duration) duration = revB;
          const moving = (st: MotionState): MotionState =>
            st === "stationary" || st === "spinning" ? "sliding" : st;
          sA = { ...sA, a: accA, duration, state: moving(sA.state) };
          sB = { ...sB, a: accB, duration, state: moving(sB.state) };
          if (!a.partners.includes(b.index)) a.partners.push(b.index);
          if (!b.partners.includes(a.index)) b.partners.push(a.index);
        }
        const forcedA = a.partners.length > 0;
        const forcedB = b.partners.length > 0;
        setSegment(a, sA);
        setSegment(b, sB);
        a.forced = forcedA;
        b.forced = forcedB;
      }
      events.push({
        type: "ball-ball",
        t: now,
        ballId: a.id,
        otherBallId: b.id,
        point: { x: ra.x + normal.x * a.radiusM, y: ra.y + normal.y * a.radiusM },
      });
      refresh(a, now);
      refresh(b, now);
      continue;
    }

    // Cushion or pocket.
    if (a.cushionKind === CushionKind.Pocket) {
      const pocket = pockets[a.cushionIndex] as (typeof pockets)[number];
      a.pocketed = true;
      setSegment(
        a,
        makeSegment(now, ra, { x: 0, y: 0 }, { x: 0, y: 0, z: 0 }, a.radiusM, motion, "pocketed"),
      );
      events.push({ type: "pocket", t: now, ballId: a.id, pocketId: pocket.id, point: ra });
      refresh(a, now);
      continue;
    }

    let normal: Vec2;
    let cushionId: string;
    if (a.cushionKind === CushionKind.Segment) {
      const seg = segments[a.cushionIndex] as (typeof segments)[number];
      normal = seg.normal;
      cushionId = seg.id;
    } else {
      const arc = arcs[a.cushionIndex] as (typeof arcs)[number];
      const dx = ra.x - arc.centre.x;
      const dy = ra.y - arc.centre.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      normal = { x: dx / dist, y: dy / dist };
      cushionId = arc.id;
    }
    const closing = -(va.x * normal.x + va.y * normal.y);
    if (closing < INELASTIC_SPEED) {
      // Too slow to rebound: just stop the motion into the cushion.
      const vn = va.x * normal.x + va.y * normal.y;
      const v: Vec2 = vn < 0 ? { x: va.x - vn * normal.x, y: va.y - vn * normal.y } : va;
      settle(a, v, wa);
      let seg = makeSegment(
        now,
        ra,
        settled.v,
        settled.w,
        a.radiusM,
        motion,
        classify(settled.v, settled.w, a.radiusM),
      );
      // The ball now has no speed into the cushion. If friction would push it into the
      // cushion, the cushion holds it: remove that part of the acceleration so the ball runs
      // along the nose instead of re-touching it endlessly.
      const an = seg.a.x * normal.x + seg.a.y * normal.y;
      const held = an < -PRESSING_ACCEL_TOL;
      if (held) {
        const acc: Vec2 = { x: seg.a.x - an * normal.x, y: seg.a.y - an * normal.y };
        const rev = timeToReverse(seg.v0, acc);
        seg = { ...seg, a: acc, duration: rev < seg.duration ? rev : seg.duration };
      }
      setSegment(a, seg);
      a.forced = held;
    } else {
      const out = cushionModel.resolve(
        { radiusM: a.radiusM, massKg: a.massKg, velocity: va, spin: wa },
        normal,
        cushion,
      );
      settle(a, out.velocity, out.spin);
      restart(a, now, ra, settled.v, settled.w);
    }
    events.push({ type: "ball-cushion", t: now, ballId: a.id, cushionId, point: ra });
    refresh(a, now);
  }

  // --- assemble the result -------------------------------------------------------------------
  const tracks: BallTrack[] = bodies.map((b) => {
    const out: Segment[] = [];
    for (let i = 0; i < b.track.length; i++) {
      const s = b.track[i] as Segment;
      const next = b.track[i + 1];
      // A segment cut short by an event lasts until the next one starts.
      out.push(next ? { ...s, duration: next.t0 - s.t0 } : s);
    }
    return { id: b.id, radiusM: b.radiusM, massKg: b.massKg, segments: out };
  });

  return { status, events, tracks, durationS: now, stats: { eventCount, rootSearches } };
}

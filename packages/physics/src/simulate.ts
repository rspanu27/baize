import { NO_CROSSING, ballArcTime, ballBallTime, ballPocketTime, ballSegmentTime } from "./detect";
import type { Kinematics } from "./detect";
import { buildTableGeometry, cushionContactDistance, isPreparedTable } from "./geometry";
import { frictionlessBallBall } from "./models/ballBall";
import { noseImpulseCushion } from "./models/cushion";
import {
  classify,
  makeSegment,
  nextSegment,
  positionAt,
  slipVelocity,
  spinAt,
  velocityAt,
} from "./motion";
import type { MotionParams } from "./motion";
import { strike } from "./strike";
import { SimInputError } from "./types";
import type {
  BallInput,
  BallTrack,
  CushionInput,
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

/** Balls whose surfaces are within this distance are in contact for the cluster solver. */
const CLUSTER_GAP_M = 1e-6;
/** The cluster solver stops when no touching pair closes faster than this (m/s). */
const CLUSTER_SPEED_TOL = 2.5e-7;
/** ... or presses harder than this (m/s^2). */
const CLUSTER_ACCEL_TOL = 1e-7;
/** Longest a set of pressing balls keeps one shared set of accelerations before re-solving. */
const FORCED_MAX_S = 0.05;
/** Upper bound on relaxation sweeps; a line of 22 balls converges well inside it. */
const CLUSTER_SWEEPS = 2000;

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
 * as touching. A sanitised layout may keep overlaps of up to 20 um, and the 0.01 mm
 * quantisation of shared links can add about 14 um more, so this allows 50 um.
 */
export const INPUT_OVERLAP_TOL_M = 5e-5;

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
    for (const pocket of geometry.pockets) {
      const px = b.x - pocket.centre.x;
      const py = b.y - pocket.centre.y;
      if (px * px + py * py < pocket.radiusM * pocket.radiusM) {
        fail("ball-in-pocket", `ball "${b.id}" is over the ${pocket.id} pocket and would drop`);
      }
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
      const struck = strike(b.radiusM, input.shot, b.massKg);
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
    checkInBounds(b, seg.r0);
  };

  /**
   * Applies the rest threshold to a ball coming out of a collision: below `REST_SPEED` in both
   * speed and slip it is put to rest (vertical spin is kept); with only the slip below it, the
   * ball is put into natural roll. The result is left in `settled`.
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
    } else if (ux * ux + uy * uy < limit) {
      // Moving, but with a slip so small that cloth friction would remove it within a
      // millisecond or two. Jump straight to the state that slide would end in (natural
      // roll at v - 2u/7), so a ball that is rolling in all but name is treated as rolling.
      const vx = v.x - (2 * ux) / 7;
      const vy = v.y - (2 * uy) / 7;
      settled.v = { x: vx, y: vy };
      settled.w = { x: -vy / b.radiusM, y: vx / b.radiusM, z: w.z };
      settled.atRest = false;
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

  /** Time until a ball that starts with velocity v and acceleration a stops moving along v. */
  const timeToReverse = (v: Vec2, a: Vec2): number => {
    const along = a.x * v.x + a.y * v.y;
    return along < 0 ? -(v.x * v.x + v.y * v.y) / along : INF;
  };

  /**
   * Resolves a slow (no-rebound) contact, together with every ball touching the pair.
   *
   * Balls in mutual contact that are barely closing cannot be settled one pair per event: a
   * line of touching balls would take hundreds of events to agree on a common speed. So the
   * whole touching cluster is solved here in one go, by relaxation in a fixed order:
   *   1. closing speeds between touching balls are removed (no rebound, momentum kept);
   *   2. balls left below the rest threshold are stopped, and treated as immovable;
   *   3. where friction would push touching balls together, they are given the mean
   *      acceleration along their line of centres (the pressing-contact rule).
   * Contacts closing faster than `INELASTIC_SPEED` are left alone; they come back from the
   * event loop as ordinary collisions.
   */
  const resolveCluster = (a: Body, b: Body, now: number): void => {
    // Positions now, and the cluster of balls in contact with a or b, directly or in a chain.
    const pos: Vec2[] = bodies.map((x) => positionAt(x.seg, x.moving ? now - x.seg.t0 : 0));
    const gapOf = (i: number, j: number): number => {
      const dx = (pos[j] as Vec2).x - (pos[i] as Vec2).x;
      const dy = (pos[j] as Vec2).y - (pos[i] as Vec2).y;
      return (
        Math.sqrt(dx * dx + dy * dy) - (bodies[i] as Body).radiusM - (bodies[j] as Body).radiusM
      );
    };
    const inCluster: boolean[] = new Array<boolean>(n).fill(false);
    const members: number[] = [a.index, b.index];
    inCluster[a.index] = true;
    inCluster[b.index] = true;
    for (let q = 0; q < members.length; q++) {
      const i = members[q] as number;
      for (let j = 0; j < n; j++) {
        if (inCluster[j] || (bodies[j] as Body).pocketed) continue;
        if (gapOf(i, j) <= CLUSTER_GAP_M) {
          inCluster[j] = true;
          members.push(j);
        }
      }
    }
    members.sort((x, y) => x - y);

    // Anything in the cluster that is in a pressing contact is released and solved afresh.
    for (const i of members) releaseGroup(bodies[i] as Body, now);

    const vel: Vec2[] = [];
    const spin: Vec3[] = [];
    for (const i of members) {
      const x = bodies[i] as Body;
      const tau = now - x.seg.t0;
      vel[i] = velocityAt(x.seg, x.moving ? tau : 0);
      // A ball spinning on the spot is not "moving", but its spin has been decaying since its
      // segment began: read it at the present time, not at the start of the segment.
      spin[i] = spinAt(x.seg, tau);
    }

    interface Contact {
      readonly i: number;
      readonly j: number;
      readonly nx: number;
      readonly ny: number;
    }
    const contacts: Contact[] = [];
    for (let p = 0; p < members.length; p++) {
      for (let q = p + 1; q < members.length; q++) {
        const i = members[p] as number;
        const j = members[q] as number;
        const isSeed = i === Math.min(a.index, b.index) && j === Math.max(a.index, b.index);
        if (!isSeed && gapOf(i, j) > CLUSTER_GAP_M) continue;
        const dx = (pos[j] as Vec2).x - (pos[i] as Vec2).x;
        const dy = (pos[j] as Vec2).y - (pos[i] as Vec2).y;
        const d = Math.sqrt(dx * dx + dy * dy);
        contacts.push({ i, j, nx: dx / d, ny: dy / d });
      }
    }

    // 1 and 2: remove slow closing speeds between touching balls, stop balls that end up
    // below the rest threshold (a stopped ball is immovable, so its neighbours must stop
    // closing on it), and put balls with a negligible slip into natural roll.
    //
    // A rolling ball keeps rolling through these small impulses, so part of each impulse goes
    // into its rotation: along the line of centres it behaves like a mass of 7/5 m, and its
    // spin follows its velocity. A sliding ball takes the impulse on its velocity alone.
    const fixed: boolean[] = new Array<boolean>(n).fill(false);
    const rolls: boolean[] = new Array<boolean>(n).fill(false);
    const restLimit = REST_SPEED * REST_SPEED;
    const slipSq = (i: number): number => {
      const u = slipVelocity(vel[i] as Vec2, spin[i] as Vec3, (bodies[i] as Body).radiusM);
      return u.x * u.x + u.y * u.y;
    };
    /** Applies the rest and natural-roll thresholds to one ball; true if its kind changed. */
    const classifyMember = (i: number): boolean => {
      if (fixed[i]) return false;
      const wasRolling = rolls[i] as boolean;
      const snaps = !wasRolling && slipSq(i) < restLimit;
      settle(bodies[i] as Body, vel[i] as Vec2, spin[i] as Vec3);
      vel[i] = settled.v;
      spin[i] = settled.w;
      if (settled.atRest) {
        fixed[i] = true;
        rolls[i] = true;
        return true;
      }
      if (snaps) {
        rolls[i] = true;
        return true;
      }
      return false;
    };
    for (const i of members) classifyMember(i);
    for (let round = 0; round < 6; round++) {
      for (let sweep = 0; sweep < CLUSTER_SWEEPS; sweep++) {
        let worst = 0;
        for (const c of contacts) {
          const vi = vel[c.i] as Vec2;
          const vj = vel[c.j] as Vec2;
          const closing = (vi.x - vj.x) * c.nx + (vi.y - vj.y) * c.ny;
          if (!(closing > 0) || closing >= INELASTIC_SPEED) continue;
          const fi = fixed[c.i] as boolean;
          const fj = fixed[c.j] as boolean;
          if (fi && fj) continue;
          if (closing > worst) worst = closing;
          const mi = (rolls[c.i] ? 1.4 : 1) * (bodies[c.i] as Body).massKg;
          const mj = (rolls[c.j] ? 1.4 : 1) * (bodies[c.j] as Body).massKg;
          // Share of the closing speed each ball gives up (all of it if the other is fixed).
          const si = fj ? 1 : fi ? 0 : mj / (mi + mj);
          const sj = 1 - si;
          vel[c.i] = { x: vi.x - si * closing * c.nx, y: vi.y - si * closing * c.ny };
          vel[c.j] = { x: vj.x + sj * closing * c.nx, y: vj.y + sj * closing * c.ny };
        }
        if (worst < CLUSTER_SPEED_TOL) break;
      }
      // Rolling balls: the spin follows the new velocity.
      for (const i of members) {
        if (!rolls[i] || fixed[i]) continue;
        const v = vel[i] as Vec2;
        const r = (bodies[i] as Body).radiusM;
        spin[i] = { x: -v.y / r, y: v.x / r, z: (spin[i] as Vec3).z };
      }
      let changed = false;
      for (const i of members) if (classifyMember(i)) changed = true;
      if (!changed) break;
    }

    // 3: fresh segments, then share accelerations across contacts that would press.
    // A sliding ball answers a push through its centre with F / m. A rolling ball (or one at
    // rest, which starts to roll) keeps rolling, so part of the push goes into rotation and
    // it answers with (5/7) F / m: its effective mass along the push is 7/5 m.
    const segs: Segment[] = [];
    const acc: Vec2[] = [];
    const effMass: number[] = [];
    const forced: boolean[] = new Array<boolean>(n).fill(false);
    for (const i of members) {
      const x = bodies[i] as Body;
      const v = vel[i] as Vec2;
      const w = spin[i] as Vec3;
      const seg = makeSegment(
        now,
        pos[i] as Vec2,
        v,
        w,
        x.radiusM,
        motion,
        classify(v, w, x.radiusM),
      );
      segs[i] = seg;
      acc[i] = seg.a;
      effMass[i] = seg.state === "sliding" ? x.massKg : 1.4 * x.massKg;
    }
    for (let sweep = 0; sweep < CLUSTER_SWEEPS; sweep++) {
      let worst = 0;
      for (const c of contacts) {
        const vi = vel[c.i] as Vec2;
        const vj = vel[c.j] as Vec2;
        const rel = (vi.x - vj.x) * c.nx + (vi.y - vj.y) * c.ny;
        // Only contacts with no relative speed along the line of centres can press.
        if (rel > CLUSTER_SPEED_TOL || rel < -CLUSTER_SPEED_TOL) continue;
        const ai = acc[c.i] as Vec2;
        const aj = acc[c.j] as Vec2;
        const ain = ai.x * c.nx + ai.y * c.ny;
        const ajn = aj.x * c.nx + aj.y * c.ny;
        const pressing = ain - ajn;
        if (!(pressing > PRESSING_ACCEL_TOL)) continue;
        if (pressing > worst) worst = pressing;
        const mi = effMass[c.i] as number;
        const mj = effMass[c.j] as number;
        const mean = (mi * ain + mj * ajn) / (mi + mj);
        acc[c.i] = { x: ai.x + (mean - ain) * c.nx, y: ai.y + (mean - ain) * c.ny };
        acc[c.j] = { x: aj.x + (mean - ajn) * c.nx, y: aj.y + (mean - ajn) * c.ny };
        forced[c.i] = true;
        forced[c.j] = true;
        const bi = bodies[c.i] as Body;
        const bj = bodies[c.j] as Body;
        if (!bi.partners.includes(c.j)) bi.partners.push(c.j);
        if (!bj.partners.includes(c.i)) bj.partners.push(c.i);
      }
      if (worst < CLUSTER_ACCEL_TOL) break;
    }

    // Shared segments all end together, at the earliest of: a rolling ball's natural stop, a
    // pushed-back ball turning round, a sliding ball's slip running out, and a fixed
    // re-evaluation interval (the lines of centres turn as the balls move).
    let shared = FORCED_MAX_S;
    for (const i of members) {
      if (!forced[i]) continue;
      const seg = segs[i] as Segment;
      const a2 = acc[i] as Vec2;
      const rev = timeToReverse(vel[i] as Vec2, a2);
      if (rev < shared) shared = rev;
      if (seg.state === "sliding") {
        // Slip changes at k = a' + (5/2) a_friction; it runs out when its component along the
        // starting slip direction reaches zero.
        const u = slipVelocity(seg.v0, seg.omega0, (bodies[i] as Body).radiusM);
        const kx = a2.x + 2.5 * seg.a.x;
        const ky = a2.y + 2.5 * seg.a.y;
        const rate = kx * u.x + ky * u.y;
        if (rate < 0) {
          const t = -(u.x * u.x + u.y * u.y) / rate;
          if (t < shared) shared = t;
        }
      } else if (seg.duration < shared) {
        shared = seg.duration;
      }
    }
    for (const i of members) {
      const x = bodies[i] as Body;
      let seg = segs[i] as Segment;
      const partners = x.partners;
      if (forced[i]) {
        const a2 = acc[i] as Vec2;
        if (seg.state === "sliding") {
          seg = { ...seg, a: a2, duration: shared };
        } else {
          // Rolling under the push: the spin follows the new acceleration.
          const v = vel[i] as Vec2;
          seg = {
            ...seg,
            state: "rolling",
            a: a2,
            duration: shared,
            omega0: { x: -v.y / x.radiusM, y: v.x / x.radiusM, z: seg.omega0.z },
            alpha: { x: -a2.y / x.radiusM, y: a2.x / x.radiusM, z: seg.alpha.z },
          };
        }
      }
      setSegment(x, seg);
      x.forced = forced[i] as boolean;
      x.partners = forced[i] ? partners : [];
    }
    for (const i of members) refresh(bodies[i] as Body, now);
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
      // Only spin decaying on the spot is left once nothing is translating: every ball is
      // already where it will stay, so that does not count against the time cap.
      let translating = false;
      for (let i = 0; i < n; i++) if ((bodies[i] as Body).moving) translating = true;
      if (translating) {
        status = "timeLimit";
        break;
      }
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
    // Releasing re-scans the ball, which overwrites its cached cushion event, so remember
    // what this event is about first.
    const hitKind = a.cushionKind;
    const hitIndex = a.cushionIndex;
    const wasForced = a.forced;
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
      const point: Vec2 = { x: ra.x + normal.x * a.radiusM, y: ra.y + normal.y * a.radiusM };
      if (closing < INELASTIC_SPEED) {
        // Slow contact: no rebound. Settle the pair and everything touching it together.
        events.push({ type: "ball-ball", t: now, ballId: a.id, otherBallId: b.id, point });
        resolveCluster(a, b, now);
        continue;
      }
      if (a.forced || b.forced) {
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
        restitution,
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
      restart(a, now, ra, vA, wA);
      restart(b, now, rb, vB, wB);
      events.push({ type: "ball-ball", t: now, ballId: a.id, otherBallId: b.id, point });
      refresh(a, now);
      refresh(b, now);
      continue;
    }

    // Cushion or pocket.
    if (hitKind === CushionKind.Pocket) {
      const pocket = pockets[hitIndex] as (typeof pockets)[number];
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
    if (hitKind === CushionKind.Segment) {
      const seg = segments[hitIndex] as (typeof segments)[number];
      normal = seg.normal;
      cushionId = seg.id;
    } else {
      const arc = arcs[hitIndex] as (typeof arcs)[number];
      const dx = ra.x - arc.centre.x;
      const dy = ra.y - arc.centre.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      normal = { x: dx / dist, y: dy / dist };
      cushionId = arc.id;
    }
    const closing = -(va.x * normal.x + va.y * normal.y);
    if (wasForced && !(closing > 0)) {
      // The release (rest threshold or natural-roll snap) left the ball no longer heading
      // into this cushion. It has already been re-started and re-scanned; nothing to resolve.
      continue;
    }
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
        input.cloth,
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

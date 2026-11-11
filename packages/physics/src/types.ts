/**
 * Public input and result types of the simulator.
 *
 * Units are SI: metres, seconds, kilograms, radians. Coordinates: origin at the baulk/head-end
 * left corner of the playing area (the cushion-nose rectangle), x across the width, y along the
 * length, z up. Angles are counter-clockwise from +x.
 *
 * The input interfaces are deliberately minimal. Richer specs (for example `TableSpec` from
 * `@baize/tables`) are structural supersets and can be passed directly.
 */

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

/**
 * One pocket type. The straight nose ends at two jaw points `mouthM` apart. Each jaw turns
 * into the pocket on an arc of radius `jawRadiusM` (0 = sharp point), then runs straight at
 * `facingAngleRad` to the rail (measured inside the cushion; pi/2 = square to the rail) until it
 * meets the drop circle. A ball is potted when its centre enters the drop circle, whose centre
 * is on the pocket axis `dropSetbackM` outside the mouth line.
 */
export interface PocketInput {
  readonly mouthM: number;
  readonly jawRadiusM: number;
  readonly facingAngleRad: number;
  readonly dropRadiusM: number;
  readonly dropSetbackM: number;
}

export interface CushionInput {
  readonly noseHeightM: number;
  readonly restitution: number;
  readonly friction: number;
}

export interface TableInput {
  readonly playingArea: { readonly lengthM: number; readonly widthM: number };
  readonly pockets: { readonly corner: PocketInput; readonly middle: PocketInput };
  readonly cushion: CushionInput;
}

export interface ClothInput {
  /** Ball-cloth sliding friction coefficient. */
  readonly slidingFriction: number;
  /** Rolling resistance coefficient. */
  readonly rollingResistance: number;
  /** Vertical-axis (spinning) friction coefficient. */
  readonly spinningFriction: number;
  /** Stored from v1; ignored by the engine until nap is modelled. */
  readonly nap?: { readonly directionRad: number; readonly strength: number };
}

export interface BallInput {
  /** Unique within one simulation. */
  readonly id: string;
  readonly radiusM: number;
  readonly massKg: number;
  readonly x: number;
  readonly y: number;
  /** Initial linear velocity. Default: at rest. */
  readonly velocity?: Vec2;
  /** Initial angular velocity. Default: none. */
  readonly spin?: Vec3;
}

export interface ShotInput {
  /** Id of the ball being struck. */
  readonly ballId: string;
  /** Aim direction, counter-clockwise from +x. */
  readonly aimAngleRad: number;
  /** Speed of the struck ball immediately after the strike. */
  readonly speedMps: number;
  /**
   * Tip contact point on the ball face as fractions of the ball radius. `side` > 0 is right
   * of centre as seen by the player; `vertical` > 0 is above centre.
   */
  readonly tipOffset: { readonly side: number; readonly vertical: number };
  /** Reserved. Must be 0 or absent in v1. */
  readonly elevationRad?: number;
}

/** Kinematic state of one ball at an instant. */
export interface BallKinematics {
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly spin: Vec3;
}

/** Ball-ball collision model: a pure function of the two states at contact. */
export interface BallBallModel {
  resolve(
    a: BallBallContact,
    b: BallBallContact,
    /** Unit vector from the centre of `a` to the centre of `b`. */
    normal: Vec2,
    restitution: number,
  ): { readonly a: Impulsed; readonly b: Impulsed };
}

export interface BallBallContact {
  readonly radiusM: number;
  readonly massKg: number;
  readonly velocity: Vec2;
  readonly spin: Vec3;
}

/** Velocity and spin after an impulse. */
export interface Impulsed {
  readonly velocity: Vec2;
  readonly spin: Vec3;
}

/** Ball-cushion collision model: a pure function of the ball state at contact. */
export interface CushionModel {
  resolve(
    ball: BallBallContact,
    /** Unit vector pointing from the cushion into the playing area. */
    normal: Vec2,
    cushion: CushionInput,
  ): Impulsed;
}

export interface SimInput {
  readonly table: TableInput | PreparedTable;
  readonly cloth: ClothInput;
  readonly balls: readonly BallInput[];
  /** Ball-ball normal restitution (0..1). */
  readonly ballRestitution: number;
  readonly shot?: ShotInput;
  readonly models?: { readonly ballBall?: BallBallModel; readonly cushion?: CushionModel };
}

export interface SimParams {
  /** Gravitational acceleration, m/s^2. */
  readonly gravity: number;
  /** Stop with status 'eventLimit' after this many events. */
  readonly maxEvents: number;
  /** Stop with status 'timeLimit' after this much simulated time. */
  readonly maxTimeS: number;
}

// ---------------------------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------------------------

/** A straight piece of cushion nose. Balls can only hit it from the `normal` side. */
export interface CushionSegment {
  readonly id: string;
  readonly a: Vec2;
  readonly b: Vec2;
  /** Unit normal pointing away from the cushion (towards where balls are). */
  readonly normal: Vec2;
}

/** A convex piece of cushion nose (jaw knuckle). `radiusM` may be 0 (a sharp point). */
export interface CushionArc {
  readonly id: string;
  readonly centre: Vec2;
  readonly radiusM: number;
  /** Unit vectors from the centre to the arc's two ends; the arc runs counter-clockwise from `from` to `to`. */
  readonly from: Vec2;
  readonly to: Vec2;
}

export type PocketId =
  "corner-bl" | "corner-br" | "corner-tl" | "corner-tr" | "middle-l" | "middle-r";

export interface PocketZone {
  readonly id: PocketId;
  /** Centre and radius of the drop circle. */
  readonly centre: Vec2;
  readonly radiusM: number;
}

export interface TableGeometry {
  readonly widthM: number;
  readonly lengthM: number;
  readonly segments: readonly CushionSegment[];
  readonly arcs: readonly CushionArc[];
  readonly pockets: readonly PocketZone[];
  /** Axis-aligned box that contains every primitive and drop circle. */
  readonly bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  };
}

/** A table with its geometry built once, reusable across many simulations. */
export interface PreparedTable {
  readonly kind: "prepared-table";
  readonly table: TableInput;
  readonly geometry: TableGeometry;
}

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export type MotionState = "stationary" | "spinning" | "sliding" | "rolling" | "pocketed";

/**
 * One piece of a ball's motion with constant acceleration.
 *
 * For local time tau = t - t0 (0 <= tau <= duration):
 *   position = r0 + v0 * tau + a * tau^2 / 2
 *   velocity = v0 + a * tau
 *   spin.x, spin.y = omega0 + alpha * tau
 *   spin.z = omega0.z + alpha.z * tau, clamped so it never crosses zero
 */
export interface Segment {
  readonly t0: number;
  /** Length of the segment in seconds; Infinity for a ball that stays put. */
  readonly duration: number;
  readonly state: MotionState;
  readonly r0: Vec2;
  readonly v0: Vec2;
  readonly a: Vec2;
  readonly omega0: Vec3;
  readonly alpha: Vec3;
}

export interface BallTrack {
  readonly id: string;
  readonly radiusM: number;
  readonly massKg: number;
  /** In time order, contiguous, starting at t = 0. */
  readonly segments: readonly Segment[];
}

export type SimEvent =
  | { readonly type: "strike"; readonly t: number; readonly ballId: string }
  | {
      readonly type: "transition";
      readonly t: number;
      readonly ballId: string;
      readonly from: MotionState;
      readonly to: MotionState;
    }
  | {
      readonly type: "ball-ball";
      readonly t: number;
      readonly ballId: string;
      readonly otherBallId: string;
      /** Contact point. */
      readonly point: Vec2;
    }
  | {
      readonly type: "ball-cushion";
      readonly t: number;
      readonly ballId: string;
      /** Id of the segment or arc that was hit. */
      readonly cushionId: string;
      /** Ball centre at contact. */
      readonly point: Vec2;
    }
  | {
      readonly type: "pocket";
      readonly t: number;
      readonly ballId: string;
      readonly pocketId: PocketId;
      /** Ball centre when it dropped. */
      readonly point: Vec2;
    };

export type SimStatus = "complete" | "eventLimit" | "timeLimit";

export interface SimStats {
  readonly eventCount: number;
  /** Number of polynomial root searches performed. */
  readonly rootSearches: number;
}

export interface SimResult {
  readonly status: SimStatus;
  /** In time order. Events at the same instant are in resolution order. */
  readonly events: readonly SimEvent[];
  /** One per input ball, in input order. */
  readonly tracks: readonly BallTrack[];
  /** Time of the last event; every ball is at rest or pocketed after this when status is 'complete'. */
  readonly durationS: number;
  readonly stats: SimStats;
}

export interface BallSample {
  readonly id: string;
  readonly state: MotionState;
  readonly position: Vec2;
  readonly velocity: Vec2;
  readonly spin: Vec3;
}

export type SimInputErrorCode =
  | "no-balls"
  | "duplicate-ball-id"
  | "non-finite"
  | "invalid-ball"
  | "invalid-table"
  | "invalid-cloth"
  | "ball-outside-table"
  | "balls-overlap"
  | "unknown-shot-ball"
  | "elevation-not-supported"
  | "tip-offset-too-large"
  | "invalid-shot";

export class SimInputError extends Error {
  readonly code: SimInputErrorCode;
  constructor(code: SimInputErrorCode, message: string) {
    super(message);
    this.name = "SimInputError";
    this.code = code;
  }
}

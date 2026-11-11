/**
 * Shared data types for tables, balls, cloth and layouts.
 *
 * Units are SI: metres, kilograms, radians. Coordinates: origin at the baulk/head-end left
 * corner of the playing area (the cushion-nose rectangle), x across the width (0..widthM),
 * y along the length (0..lengthM) towards the top/foot end.
 */

/** Drives markings, spots and the default ball set. Chinese 8-ball uses 'pool'. */
export type GameType = "snooker" | "pool" | "blackball";

/**
 * One pocket type (corner or middle).
 *
 * The straight cushion nose ends at two "jaw points", `mouthM` apart. From each point the
 * jaw turns into the pocket along an arc of radius `jawRadiusM` (0 = sharp point), then runs
 * straight (the facing). `facingAngleRad` is the angle between the rail nose line and the
 * facing, measured inside the cushion: pi/2 means the facing is square to the rail.
 *
 * A ball is potted when its centre enters the drop circle, which models the slate cut. The
 * circle's centre lies on the pocket axis, `dropSetbackM` outside the mouth line.
 */
export interface PocketSpec {
  mouthM: number;
  jawRadiusM: number;
  facingAngleRad: number;
  dropRadiusM: number;
  dropSetbackM: number;
}

export interface CushionSpec {
  /** Height of the cushion nose above the bed. */
  noseHeightM: number;
  /** Normal restitution of the cushion (0..1). */
  restitution: number;
  /** Ball-cushion sliding friction coefficient. */
  friction: number;
}

export interface TableSpec {
  /** Preset id with revision, e.g. 'snooker-12@1', or 'custom'. Immutable once public. */
  id: string;
  name: string;
  game: GameType;
  /** Cushion nose to cushion nose. */
  playingArea: { lengthM: number; widthM: number };
  pockets: { corner: PocketSpec; middle: PocketSpec };
  cushion: CushionSpec;
  defaultBallSetId: string;
}

export type JawStyle = "angled" | "rounded";

/** What a user enters for a custom table. Everything else is derived. */
export interface CustomTableFields {
  game: GameType;
  lengthM: number;
  widthM: number;
  cornerMouthM: number;
  middleMouthM: number;
  /** Advanced. Default: 'angled' for pool, 'rounded' for snooker and blackball. */
  jawStyle?: JawStyle;
}

export type PoolNumber =
  "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11" | "12" | "13" | "14" | "15";

/**
 * Ball identity. Snooker uses cue, red and the six colours; pool uses cue and 1-15;
 * blackball uses cue, red, yellow and black.
 */
export type BallKind =
  "cue" | "red" | "yellow" | "green" | "brown" | "blue" | "pink" | "black" | PoolNumber;

export interface BallSize {
  diameterM: number;
  massKg: number;
}

export interface BallSetSpec {
  id: string;
  name: string;
  game: GameType;
  /** Kinds that exist in this set, with how many of each. */
  kinds: { kind: BallKind; count: number }[];
  object: BallSize;
  /** Present only when the cue ball differs from the object balls. */
  cue?: BallSize;
  /** Ball-ball normal restitution (0..1). */
  restitution: number;
}

export type ClothSpeed = "slow" | "medium" | "fast";

export interface NapSpec {
  /** Direction the nap runs, counter-clockwise from +x. pi/2 = baulk to top. */
  directionRad: number;
  /** 0 = none. Not used by the physics until Phase 3. */
  strength: number;
}

export interface ClothSpec {
  /** Hex colour, visual only. */
  colour: string;
  speedPreset: ClothSpeed | "custom";
  slidingFriction: number;
  rollingResistance: number;
  spinningFriction: number;
  nap?: NapSpec;
}

/** A set of balls on a table: the exchange type for racks, templates, URLs and photo import. */
export interface Layout {
  balls: LayoutBall[];
}

export interface LayoutBall {
  kind: BallKind;
  x: number;
  y: number;
  /** 0..1, set by automatic sources such as photo import. Absent = certain. */
  confidence?: number;
}

export type RackKind =
  "snooker-15" | "snooker-10" | "snooker-6" | "pool-8ball" | "pool-9ball" | "pool-15" | "blackball";

export interface Spot {
  /** Stable name, e.g. 'black', 'pink', 'blue', 'brown', 'green', 'yellow', 'foot', 'head'. */
  name: string;
  x: number;
  y: number;
}

export type Marking =
  | { kind: "line"; name: string; from: { x: number; y: number }; to: { x: number; y: number } }
  | {
      kind: "arc";
      name: string;
      centre: { x: number; y: number };
      radiusM: number;
      /** Counter-clockwise from +x, start to end. */
      startRad: number;
      endRad: number;
    }
  | { kind: "spot"; name: string; at: { x: number; y: number } }
  /** Rail sight (diamond) on pool tables; drawn on the rail, outside the playing area. */
  | { kind: "sight"; name: string; at: { x: number; y: number } };

export type IssueSeverity = "error" | "warning";

export interface ValidationIssue {
  /** Field of CustomTableFields the issue is about, or 'ballDiameterM'. */
  field: keyof CustomTableFields | "ballDiameterM";
  severity: IssueSeverity;
  /** Stable machine-readable code, e.g. 'pocket-narrower-than-ball'. */
  code: string;
  /** Plain-words explanation for the UI, in metric; no jargon. */
  message: string;
}

/** Result of sanitising a layout: the cleaned layout plus what was changed. */
export interface SanitizeResult {
  layout: Layout;
  /** Indices (into the input) of balls that were moved. */
  moved: number[];
  /** Indices (into the input) of balls that were dropped. */
  removed: number[];
}

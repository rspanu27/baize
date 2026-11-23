import type { SimResult } from "@baize/physics";
import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import type { Camera, TrackedFrame } from "@baize/vision";
import type { DiagramTheme } from "../doc/types";
import type { UnitSystem } from "../units/units";

/**
 * What the video screen passes between its parts (Phase 7): the analysis of a clip (tracking,
 * shots and the physics fit), the overlays chosen, and the timeline of the video to write.
 * Plain data: none of it holds the clip's pixels.
 */

/** A shot found in the clip, explained by the physics fit. */
export interface ClipShot {
  /** 0 for the first shot in the clip. */
  readonly index: number;
  /** Clip time at which the cue ball starts to move and at which every ball is still again. */
  readonly startS: number;
  readonly endS: number;
  /** Clip time of the strike, from the fit (the simulation's time 0). */
  readonly strikeS: number;
  readonly cueBallId: string;
  /** The balls at rest before the shot, in table metres. */
  readonly balls: readonly {
    readonly id: string;
    readonly kind: BallKind;
    readonly x: number;
    readonly y: number;
  }[];
  /** The strike the fit found. */
  readonly shot: {
    readonly aimAngleRad: number;
    readonly speedMps: number;
    readonly tipOffset: { readonly side: number; readonly vertical: number };
  };
  /** The fitted shot simulated with the editor's physics; its time 0 is `strikeS`. */
  readonly result: SimResult;
  /** How well the fit matches the tracked balls: root-mean-square distance, metres. */
  readonly rmsM: number;
}

/** A clip after analysis. */
export interface ClipAnalysis {
  /** Size of the clip's frames as shown; `camera` maps table points into these pixels. */
  readonly widthPx: number;
  readonly heightPx: number;
  readonly camera: Camera;
  readonly table: TableSpec;
  readonly ballSet: BallSetSpec;
  readonly durationS: number;
  /** The tracked balls, one entry per decoded frame (clip time order). */
  readonly frames: readonly TrackedFrame[];
  readonly shots: readonly ClipShot[];
}

/** The overlays drawn on the video. */
export interface OverlayOptions {
  /** The cue ball's path so far. */
  readonly cueTrail: boolean;
  /** Every moving ball's path so far. */
  readonly allTrails: boolean;
  /** A ghost ball where the cue ball meets the first object ball. */
  readonly ghostBall: boolean;
  /** A top-down table in a corner, in sync with the clip. */
  readonly minimap: boolean;
  /** The cue ball's speed off the tip. */
  readonly speed: boolean;
  /** Slow motion around the first contact, with the paths traced. */
  readonly slowMotion: boolean;
  /** Ball labels on the minimap. */
  readonly labels: boolean;
  /** Colours, as in the editor's Look panel. */
  readonly theme: DiagramTheme;
  readonly units: UnitSystem;
}

export const DEFAULT_OVERLAYS: OverlayOptions = {
  cueTrail: true,
  allTrails: false,
  ghostBall: true,
  minimap: true,
  speed: true,
  slowMotion: true,
  labels: false,
  theme: "table",
  units: "metric",
};

/** One frame of the video to write: when it is shown, and which moment of the clip it shows. */
export interface TimelineFrame {
  readonly outTimeS: number;
  readonly clipTimeS: number;
  /** Shown slowed down (part of a slow-motion stretch). */
  readonly slow: boolean;
}

import type { BallInput, PocketId, ShotInput, SimResult, Vec2 } from "@baize/physics";
import type { BallKind, ClothSpec, TableSpec } from "@baize/tables";

/** A ball as the planner sees it: the physics input plus what it is. */
export interface PlanBall extends BallInput {
  readonly kind: BallKind;
}

/** How a shot is played: what the planner chooses. The struck ball is always the cue ball. */
export interface ShotParams {
  readonly aimAngleRad: number;
  readonly speedMps: number;
  readonly tipOffset: { readonly side: number; readonly vertical: number };
}

/**
 * Runs one shot. Built by the caller, with the same physics the editor draws with (models,
 * squirt, nap, debug-panel numbers), so that a planned shot is exactly what the editor shows
 * when it is used. Must be deterministic.
 */
export type ShotRunner = (
  balls: readonly BallInput[],
  shot: Pick<ShotInput, "ballId" | "aimAngleRad" | "speedMps" | "tipOffset">,
) => SimResult;

/** Which ball a player is on, per game. Not stored in the document. */
export type GameState =
  | {
      readonly game: "snooker";
      /** `red`: a red is on; `colour`: any colour after a red; `colours`: the colours in order. */
      readonly phase: "red" | "colour" | "colours";
    }
  | { readonly game: "nine-ball" }
  | {
      readonly game: "eight-ball";
      /** The player's group. Solids and stripes for pool, reds and yellows for blackball. */
      readonly group: "solids" | "stripes" | "reds" | "yellows";
    }
  | { readonly game: "straight" };

/**
 * How well the player hits the ball: the spread of their errors, used to turn a shot's margins
 * into a chance. Estimates, see `levels.ts`.
 */
export interface PlayerLevel {
  readonly id: string;
  readonly name: string;
  /** Standard deviation of the cue ball's starting direction, radians. */
  readonly aimErrorRad: number;
  /** Standard deviation of the cue ball's speed, as a share of the intended speed. */
  readonly speedError: number;
}

/** Everything one planning run needs. */
export interface PlanInput {
  readonly table: TableSpec;
  readonly balls: readonly PlanBall[];
  readonly cueBallId: string;
  readonly state: GameState;
  readonly level: PlayerLevel;
  /** The cloth's friction, used only to choose sensible speeds to try. */
  readonly cloth: Pick<ClothSpec, "slidingFriction" | "rollingResistance">;
  readonly run: ShotRunner;
}

/** One shot of a route. */
export interface PlannedShot {
  readonly kind: "pot" | "safety";
  /** The ball aimed at. */
  readonly targetId: string;
  /** The pocket aimed at (pots only). */
  readonly pocketId?: PocketId;
  readonly shot: ShotParams;
  /** Chance the shot does what it is meant to (pot: the ball drops and no foul). */
  readonly chance: number;
  /** What the shot is worth if it succeeds: points (snooker) or balls (pool). */
  readonly value: number;
  /** The shot played exactly as planned. */
  readonly result: SimResult;
  /** Where the cue ball stops. */
  readonly cueStop: Vec2;
}

export interface Route {
  readonly steps: readonly PlannedShot[];
  /** Expected value of the route: chances compounded along it, times the values. */
  readonly expectedValue: number;
}

/** Reported while a search runs and when it ends. */
export interface PlanProgress {
  /** Shots deep the search has finished. */
  readonly depth: number;
  /** Runner calls used so far. */
  readonly runnerCalls: number;
  readonly best?: Route;
  readonly done: boolean;
}

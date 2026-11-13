import {
  SimInputError,
  frictionalBallBall,
  mathavanCushion,
  prepareTable,
  simulate,
} from "@baize/physics";
import type { PreparedTable, SimResult } from "@baize/physics";
import { BALL_BALL_FRICTION, cueEndMassKg, napDrift } from "@baize/tables";
import type { TableSpec } from "@baize/tables";
import type { Scene } from "../doc/resolve";
import { NO_TUNING } from "./tuning";
import type { Tuning } from "./tuning";

/**
 * Runs the physics for a scene.
 *
 * The simulation is synchronous and runs on the main thread: a full break takes about a
 * millisecond (see docs/ARCHITECTURE.md), far inside one frame, so re-simulating on every
 * pointer move during a drag needs no worker and no throttling. The `Simulator` interface is
 * the seam where a worker could be put later without touching the callers.
 */

export interface SimOutcome {
  /** Present when there is a shot and it could be simulated. */
  result?: SimResult;
  /** Plain-words reason there is no result (no shot is not an error). */
  problem?: string;
  /** Wall-clock time the simulation took, in milliseconds. */
  ms: number;
}

export interface Simulator {
  /** `tuning` holds physics numbers changed in the debug panel; they are not in the scene. */
  run(scene: Scene, tuning?: Tuning): SimOutcome;
}

// Table geometry is built once per table object and reused while that table is in use.
const prepared = new WeakMap<TableSpec, PreparedTable>();

function preparedTable(table: TableSpec): PreparedTable {
  let p = prepared.get(table);
  if (!p) {
    p = prepareTable(table);
    prepared.set(table, p);
  }
  return p;
}

/**
 * The collision models the editor simulates with: version 2, with friction between balls and
 * the cushion impact integrated step by step.
 */
const PHYSICS_V2 = {
  ballBall: frictionalBallBall(BALL_BALL_FRICTION),
  cushion: mathavanCushion,
};

/** The prepared table with any changed cushion numbers; the geometry does not depend on them. */
function tunedTable(table: PreparedTable, tuning: Tuning): PreparedTable {
  const { cushionRestitution, cushionFriction } = tuning;
  if (cushionRestitution === undefined && cushionFriction === undefined) return table;
  const cushion = {
    ...table.table.cushion,
    ...(cushionRestitution === undefined ? {} : { restitution: cushionRestitution }),
    ...(cushionFriction === undefined ? {} : { friction: cushionFriction }),
  };
  return { ...table, table: { ...table.table, cushion } };
}

function tunedModels(tuning: Tuning): typeof PHYSICS_V2 {
  const { ballFrictionA: a, ballFrictionB: b, ballFrictionC: c } = tuning;
  if (a === undefined && b === undefined && c === undefined) return PHYSICS_V2;
  return {
    ...PHYSICS_V2,
    ballBall: frictionalBallBall({
      a: a ?? BALL_BALL_FRICTION.a,
      b: b ?? BALL_BALL_FRICTION.b,
      c: c ?? BALL_BALL_FRICTION.c,
    }),
  };
}

const PROBLEMS: Partial<Record<SimInputError["code"], string>> = {
  "balls-overlap": "Two balls overlap. Move one of them.",
  "ball-outside-table": "A ball is outside the cushions. Move it back onto the table.",
  "ball-in-pocket": "A ball is over a pocket. Move it back onto the table.",
  "tip-offset-too-large": "The tip is too far from the centre of the ball: it would miscue.",
  "invalid-table": "This table cannot be built from its measurements.",
};

export const mainThreadSimulator: Simulator = {
  run(scene: Scene, tuning: Tuning = NO_TUNING): SimOutcome {
    const shot = scene.shot;
    if (!shot || scene.balls.length === 0) return { ms: 0 };
    const cue = scene.balls.find((b) => b.id === shot.cueBallId);
    // Nap: the document stores a strength; the physics takes the push it stands for.
    const drift = napDrift(scene.cloth, tuning.napFullRatio);
    const endMassKg = cue
      ? tuning.cueEndMassRatio === undefined
        ? cueEndMassKg(cue.massKg)
        : cue.massKg / tuning.cueEndMassRatio
      : undefined;
    const started = performance.now();
    try {
      const result = simulate({
        table: tunedTable(preparedTable(scene.table), tuning),
        cloth: drift ? { ...scene.cloth, napDrift: drift } : scene.cloth,
        balls: scene.balls,
        ballRestitution: tuning.ballRestitution ?? scene.ballSet.restitution,
        shot: {
          ballId: shot.cueBallId,
          aimAngleRad: shot.aimAngleRad,
          speedMps: shot.speedMps,
          tipOffset: shot.tipOffset,
          // Squirt: the cue ball leaves a little off the aim line when hit with side.
          ...(endMassKg === undefined ? {} : { cueEndMassKg: endMassKg }),
        },
        // Throw: friction between the balls.
        models: tunedModels(tuning),
      });
      return { result, ms: performance.now() - started };
    } catch (e) {
      const ms = performance.now() - started;
      if (e instanceof SimInputError) return { problem: PROBLEMS[e.code] ?? e.message, ms };
      return { problem: "The shot could not be simulated.", ms };
    }
  },
};

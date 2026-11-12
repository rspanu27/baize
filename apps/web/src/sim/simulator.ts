import { SimInputError, prepareTable, simulate } from "@baize/physics";
import type { PreparedTable, SimResult } from "@baize/physics";
import type { TableSpec } from "@baize/tables";
import type { Scene } from "../doc/resolve";

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
  run(scene: Scene): SimOutcome;
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

const PROBLEMS: Partial<Record<SimInputError["code"], string>> = {
  "balls-overlap": "Two balls overlap. Move one of them.",
  "ball-outside-table": "A ball is outside the cushions. Move it back onto the table.",
  "ball-in-pocket": "A ball is over a pocket. Move it back onto the table.",
  "tip-offset-too-large": "The tip is too far from the centre of the ball: it would miscue.",
  "invalid-table": "This table cannot be built from its measurements.",
};

export const mainThreadSimulator: Simulator = {
  run(scene: Scene): SimOutcome {
    const shot = scene.shot;
    if (!shot || scene.balls.length === 0) return { ms: 0 };
    const started = performance.now();
    try {
      const result = simulate({
        table: preparedTable(scene.table),
        cloth: scene.cloth,
        balls: scene.balls,
        ballRestitution: scene.ballSet.restitution,
        shot: {
          ballId: shot.cueBallId,
          aimAngleRad: shot.aimAngleRad,
          speedMps: shot.speedMps,
          tipOffset: shot.tipOffset,
        },
      });
      return { result, ms: performance.now() - started };
    } catch (e) {
      const ms = performance.now() - started;
      if (e instanceof SimInputError) return { problem: PROBLEMS[e.code] ?? e.message, ms };
      return { problem: "The shot could not be simulated.", ms };
    }
  },
};

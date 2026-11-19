import { frictionalBallBall, mathavanCushion, prepareTable, simulate } from "@baize/physics";
import {
  BALL_BALL_FRICTION,
  TABLE_PRESETS,
  cueEndMassKg,
  getBallSet,
  makeCloth,
  resolveCustomTable,
} from "@baize/tables";
import type { BallKind, BallSetSpec, ClothSpec, TableSpec } from "@baize/tables";
import type { PlanBall, ShotRunner } from "../src/index";

export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const byArea = [...TABLE_PRESETS].sort(
  (a, b) =>
    a.playingArea.lengthM * a.playingArea.widthM - b.playingArea.lengthM * b.playingArea.widthM,
);

/** The smallest and largest presets and an odd-sized custom table, as SPEC 5.7 asks. */
export const TABLES: readonly TableSpec[] = [
  must(byArea[0], "smallest preset"),
  must(byArea[byArea.length - 1], "largest preset"),
  resolveCustomTable(
    { game: "pool", lengthM: 2.137, widthM: 1.093, cornerMouthM: 0.121, middleMouthM: 0.137 },
    0.05715,
  ),
];

export function ballSetFor(table: TableSpec): BallSetSpec {
  return must(getBallSet(table.defaultBallSetId), `ball set of ${table.id}`);
}

export const MEDIUM: ClothSpec = makeCloth("#1f7a4d", "medium");

/** A runner with the editor's physics (version 2 models and squirt), without nap. */
export function runnerFor(table: TableSpec, cloth: ClothSpec = MEDIUM): ShotRunner {
  const prepared = prepareTable(table);
  const set = ballSetFor(table);
  const models = { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion };
  return (balls, shot) => {
    const cue = must(
      balls.find((b) => b.id === shot.ballId),
      "cue ball",
    );
    return simulate({
      table: prepared,
      cloth,
      balls,
      ballRestitution: set.restitution,
      shot: { ...shot, cueEndMassKg: cueEndMassKg(cue.massKg) },
      models,
    });
  };
}

/** A ball of the table's default set at (x, y). */
export function ball(table: TableSpec, id: string, kind: BallKind, x: number, y: number): PlanBall {
  const set = ballSetFor(table);
  const size = kind === "cue" && set.cue ? set.cue : set.object;
  return { id, kind, x, y, radiusM: size.diameterM / 2, massKg: size.massKg };
}

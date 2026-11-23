import { frictionalBallBall, mathavanCushion, prepareTable, simulate } from "@baize/physics";
import {
  BALL_BALL_FRICTION,
  cueEndMassKg,
  getBallSet,
  getTablePreset,
  makeCloth,
} from "@baize/tables";
import type { BallSetSpec, ClothSpec, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import type { Camera } from "../src/index";
import { fitShot } from "../src/video/fit";
import type { FitRunner } from "../src/video/fit";
import { findShots } from "../src/video/shotTiming";
import { createTracker } from "../src/video/track";
import type { TrackedFrame } from "../src/video/track";
import { renderClip } from "./clip";
import type { ClipBall, ClipSpec } from "./clip";
import { cameraOf } from "./synthetic";

/**
 * The physics fit on synthetic clips (task 7.7): the strike found from the tracked balls is
 * the one that made the clip, speed within 5 % and direction within half a degree.
 */

const CLOTH = "#2e7d4f";

function phoneCamera(table: TableSpec): Camera {
  const { widthM: W, lengthM: L } = table.playingArea;
  return cameraOf({
    position: { x: -0.55 * W, y: L / 2, z: 0.75 * L },
    target: { x: W / 2, y: L / 2 },
    rollRad: 0,
    focalPx: 470,
    widthPx: 640,
    heightPx: 360,
  });
}

/** The editor's physics: version 2 models and squirt, as `editorRunner` builds it. */
function runnerFor(table: TableSpec, set: BallSetSpec, cloth: ClothSpec): FitRunner {
  const prepared = prepareTable(table);
  const models = { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion };
  return (balls, shot) => {
    const cue = balls.find((b) => b.id === shot.ballId);
    return simulate({
      table: prepared,
      cloth,
      balls,
      ballRestitution: set.restitution,
      shot: { ...shot, ...(cue ? { cueEndMassKg: cueEndMassKg(cue.massKg) } : {}) },
      models,
    });
  };
}

function spec(
  id: string,
  balls: ClipBall[],
  target: string,
  cutRad: number,
  speedMps: number,
  tip: { side: number; vertical: number },
  fps = 30,
): ClipSpec {
  const table = getTablePreset(id) as TableSpec;
  const ballSet = getBallSet(table.defaultBallSetId) as BallSetSpec;
  const cue = balls[0] as ClipBall;
  const aim = balls.find((b) => b.id === target) as ClipBall;
  return {
    table,
    ballSet,
    cloth: makeCloth(CLOTH, "medium"),
    balls,
    shot: {
      cueBallId: cue.id,
      aimAngleRad: Math.atan2(aim.y - cue.y, aim.x - cue.x) + cutRad,
      speedMps,
      tipOffset: tip,
    },
    camera: phoneCamera(table),
    look: { cloth: CLOTH },
    fps,
    leadInS: 0.4,
    tailS: 0.6,
  };
}

const POOL: ClipBall[] = [
  { id: "cue", kind: "cue", x: 0.635, y: 0.7 },
  { id: "one", kind: "1", x: 0.55, y: 1.5 },
  { id: "nine", kind: "9", x: 1.0, y: 2.2 },
];
const SNOOKER: ClipBall[] = [
  { id: "cue", kind: "cue", x: 0.9, y: 0.8 },
  { id: "red", kind: "red", x: 0.75, y: 2.0 },
  { id: "black", kind: "black", x: 0.889, y: 3.245 },
];

describe.each([
  ["pool, stun", () => spec("pool-9@1", POOL, "one", 0.03, 2.5, { side: 0, vertical: 0 })],
  ["pool, draw", () => spec("pool-9@1", POOL, "one", 0.02, 3, { side: 0, vertical: -0.3 })],
  [
    "snooker, follow, 60 fps",
    () => spec("snooker-12@1", SNOOKER, "red", 0.03, 2.2, { side: 0, vertical: 0.3 }, 60),
  ],
] as const)("fitting a %s shot", (name, make) => {
  test("speed within 5 %, direction within 0.5 degrees", () => {
    const s = make();
    const clip = renderClip(s);
    const first = clip.truth(0);
    const tracker = createTracker(
      s.table,
      s.ballSet,
      s.camera,
      first.balls.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y })),
    );
    const frames: TrackedFrame[] = [];
    for (let i = 0; i < clip.frameCount; i++) {
      const { image, truth } = clip.frame(i);
      frames.push(tracker.push(image, truth.timeS));
    }
    const shot = findShots(frames, "cue")[0];
    if (!shot) throw new Error("no shot found");
    const before = frames[shot.startIndex - 1] as TrackedFrame;
    const fit = fitShot({
      ballSet: s.ballSet,
      balls: before.balls.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y })),
      cueBallId: "cue",
      frames: frames.slice(shot.startIndex - 1, shot.endIndex + 1),
      run: runnerFor(s.table, s.ballSet, s.cloth),
    });
    if (!fit) throw new Error("no fit");
    const speedErr = Math.abs(fit.shot.speedMps - s.shot.speedMps) / s.shot.speedMps;
    const dirErrDeg = (Math.abs(fit.shot.aimAngleRad - s.shot.aimAngleRad) * 180) / Math.PI;
    console.log(
      `${name}: speed ${fit.shot.speedMps.toFixed(3)} (true ${s.shot.speedMps}), direction off ${dirErrDeg.toFixed(3)} deg, ` +
        `tip ${fit.shot.tipOffset.vertical.toFixed(2)}/${fit.shot.tipOffset.side.toFixed(2)} (true ${s.shot.tipOffset.vertical}/${s.shot.tipOffset.side}), ` +
        `strike ${fit.strikeS.toFixed(3)} s (true ${clip.strikeS.toFixed(3)}), rms ${(fit.rmsM * 1000).toFixed(1)} mm, ${String(fit.evaluations)} runs`,
    );
    expect(speedErr).toBeLessThan(0.05);
    expect(dirErrDeg).toBeLessThan(0.5);
  });
});

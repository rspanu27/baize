import { getBallSet, getTablePreset, makeCloth } from "@baize/tables";
import type { BallSetSpec, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import type { Camera } from "../src/index";
import { findShots } from "../src/video/shotTiming";
import type { ShotSpan } from "../src/video/shotTiming";
import { createTracker } from "../src/video/track";
import type { TrackedFrame } from "../src/video/track";
import { renderClip } from "./clip";
import type { ClipBall, ClipSpec, Occluder, RenderedClip } from "./clip";
import { cameraOf } from "./synthetic";

/**
 * Ball tracking on synthetic clips (task 7.5): every moving ball within two ball radii of the
 * truth in at least 95 % of the frames in which it can be seen (SPEC section 11).
 */

const CLOTH = "#2e7d4f";
const WIDTH = 640;
const HEIGHT = 360;

function phoneCamera(table: TableSpec): Camera {
  const { widthM: W, lengthM: L } = table.playingArea;
  return cameraOf({
    position: { x: -0.55 * W, y: L / 2, z: 0.75 * L },
    target: { x: W / 2, y: L / 2 },
    rollRad: 0,
    focalPx: 470,
    widthPx: WIDTH,
    heightPx: HEIGHT,
  });
}

function shotSpec(
  id: string,
  balls: ClipBall[],
  target: string,
  cutRad: number,
  speedMps: number,
  extra: Partial<ClipSpec> = {},
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
      tipOffset: { side: 0, vertical: 0 },
    },
    camera: phoneCamera(table),
    look: { cloth: CLOTH },
    fps: 30,
    leadInS: 0.2,
    tailS: 0.3,
    ...extra,
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

interface Score {
  visible: number;
  within: number;
  worstM: number;
  /** Errors of moving balls, metres. */
  moving: number[];
  frames: TrackedFrame[];
}

function q(a: number[], f: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(f * s.length))] ?? 0;
}

function describeScore(name: string, s: Score): string {
  const mm = (v: number) => (v * 1000).toFixed(1);
  return (
    `${name}: ${String(s.within)}/${String(s.visible)} within 2R; moving balls median ` +
    `${mm(q(s.moving, 0.5))} mm, 95th ${mm(q(s.moving, 0.95))} mm; worst ${mm(s.worstM)} mm`
  );
}

/** Runs the tracker through the clip and scores every ball in every frame where it can be seen. */
function track(spec: ClipSpec, clip: RenderedClip): Score {
  const first = clip.truth(0);
  const tracker = createTracker(
    spec.table,
    spec.ballSet,
    spec.camera,
    first.balls.map((b) => ({ id: b.id, kind: b.kind, x: b.x, y: b.y })),
  );
  const R = spec.ballSet.object.diameterM / 2;
  const score: Score = { visible: 0, within: 0, worstM: 0, moving: [], frames: [] };
  for (let i = 0; i < clip.frameCount; i++) {
    const { image, truth } = clip.frame(i);
    const out = tracker.push(image, truth.timeS);
    score.frames.push(out);
    for (const t of truth.balls) {
      if (t.pocketed || t.hidden > 0.5) continue;
      const got = out.balls.find((b) => b.id === t.id);
      if (!got) throw new Error(`no ${t.id}`);
      const d = Math.hypot(got.x - t.x, got.y - t.y);
      score.visible++;
      if (d <= 2 * R && got.state !== "lost" && got.state !== "pocketed") score.within++;
      if (d > score.worstM) score.worstM = d;
      if (t.moving) score.moving.push(d);
    }
  }
  return score;
}

describe.each([
  ["pool", () => shotSpec("pool-9@1", POOL, "one", 0.03, 2.5)],
  ["snooker", () => shotSpec("snooker-12@1", SNOOKER, "red", 0.03, 2.2)],
  ["pool, hard shot, 60 fps", () => shotSpec("pool-9@1", POOL, "one", 0.03, 5, { fps: 60 })],
  [
    "pool with camera noise and dimmer light",
    () =>
      shotSpec("pool-9@1", POOL, "one", 0.03, 2.5, {
        look: { cloth: CLOTH, noise: 5, brightness: 0.8, seed: 3 },
      }),
  ],
] as const)("tracking a %s shot", (_name, make) => {
  test("every ball is within two radii in at least 95 % of the frames where it is seen", () => {
    const spec = make();
    const clip = renderClip(spec);
    const s = track(spec, clip);
    console.log(describeScore(_name, s));
    expect(s.within / s.visible).toBeGreaterThanOrEqual(0.95);
    // Most of the time far better than the target: within a third of a radius at the median.
    const R = spec.ballSet.object.diameterM / 2;
    expect(q(s.moving, 0.5)).toBeLessThan(R / 3);
    // At the end every ball still on the table is at rest where the simulation left it.
    const last = s.frames[s.frames.length - 1] as TrackedFrame;
    const truth = clip.truth(clip.frameCount - 1);
    for (const t of truth.balls) {
      const got = last.balls.find((b) => b.id === t.id);
      expect(got?.state).toBe(t.pocketed ? "pocketed" : "rest");
    }
  });
});

describe("a player in the way", () => {
  test("a ball covered for a while is followed again once it shows", () => {
    // An arm sweeps across the middle of the picture while the balls run.
    const arm = (tS: number): Occluder | undefined => {
      if (tS < 0.35 || tS > 0.75) return undefined;
      const u = 120 + (tS - 0.35) * 900;
      return { u0: u, v0: -40, u1: u + 30, v1: 200, radiusPx: 26 };
    };
    const spec = shotSpec("pool-9@1", POOL, "one", 0.03, 2.5, { occluder: arm });
    const clip = renderClip(spec);
    const s = track(spec, clip);
    console.log(describeScore("occluded", s));
    expect(s.within / s.visible).toBeGreaterThanOrEqual(0.95);
    // Somebody was hidden at some point, and nobody is lost at the end.
    expect(s.frames.some((f) => f.balls.some((b) => b.state === "hidden"))).toBe(true);
    const last = s.frames[s.frames.length - 1] as TrackedFrame;
    expect(last.balls.every((b) => b.state !== "lost")).toBe(true);
  });
});

describe("shot start and end (task 7.6)", () => {
  test.each([
    ["pool", () => shotSpec("pool-9@1", POOL, "one", 0.03, 2.5, { leadInS: 0.5, tailS: 0.8 })],
    [
      "snooker, 60 fps",
      () =>
        shotSpec("snooker-12@1", SNOOKER, "red", 0.03, 2.2, { fps: 60, leadInS: 0.5, tailS: 0.8 }),
    ],
  ] as const)("%s: start within 2 frames, end within 0.5 s", (_name, make) => {
    const spec = make();
    const clip = renderClip(spec);
    const s = track(spec, clip);
    const shots = findShots(s.frames, "cue");
    expect(shots).toHaveLength(1);
    const shot = shots[0] as ShotSpan;
    // The first frame whose exposure sees the cue ball move.
    let truthStart = 0;
    while (!clip.truth(truthStart).balls.some((b) => b.id === "cue" && b.moving)) truthStart++;
    expect(Math.abs(shot.startIndex - truthStart)).toBeLessThanOrEqual(2);
    expect(Math.abs(shot.endS - clip.endS)).toBeLessThanOrEqual(0.5);
    console.log(
      `${_name}: start frame ${String(shot.startIndex)} (truth ${String(truthStart)}), end ${shot.endS.toFixed(2)} s (truth ${clip.endS.toFixed(2)} s)`,
    );
  });

  test("no shot in a clip where nothing moves, and none that is cut off before the balls stop", () => {
    const spec = shotSpec("pool-9@1", POOL, "one", 0.03, 2.5, { leadInS: 0.5, tailS: 0.5 });
    const clip = renderClip(spec);
    const s = track(spec, clip);
    const strike = s.frames.findIndex((f) => f.balls.some((b) => b.state === "moving"));
    expect(findShots(s.frames.slice(0, strike), "cue")).toEqual([]);
    expect(findShots(s.frames.slice(0, strike + 5), "cue")).toEqual([]);
  });
});

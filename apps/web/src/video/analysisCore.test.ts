import { ballSizeOf, pocketDropCircles } from "@baize/tables";
import type { BallKind } from "@baize/tables";
import type { Camera, ShotSpan, TrackedFrame } from "@baize/vision";
import { describe, expect, test, vi } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import { NO_TUNING } from "../sim/tuning";
import { createAnalysis, placeableBalls } from "./analysisCore";
import type { AnalysisInit, AnalysisSteps } from "./analysisCore";

/**
 * The analysis's own steps around the vision package (review findings 1 and 7): the balls the
 * fit starts from are made placeable first, and every shot found is kept, fitted or not.
 */

const resolved = resolveDoc(newDoc("pool-9@1"));
if (!resolved.ok) throw new Error("no scene");
const scene = resolved.scene;
const { table, ballSet } = scene;
const R = ballSizeOf(ballSet, "1").diameterM / 2;

type Ball = { id: string; kind: BallKind; x: number; y: number };
const dist = (a: Ball, b: Ball) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

describe("the balls a fit starts from", () => {
  test("overlapping balls are pushed apart, and the cue ball keeps its place", () => {
    const balls: Ball[] = [
      { id: "b1", kind: "1", x: 0.62, y: 1.0 },
      { id: "b0", kind: "cue", x: 0.6, y: 1.0 },
    ];
    const out = placeableBalls(balls, "b0", table, ballSet);
    expect(out.map((b) => b.id)).toEqual(["b0", "b1"]);
    const [cue, one] = out as [Ball, Ball];
    expect(cue).toEqual(balls[1]);
    expect(dist(cue, one)).toBeGreaterThanOrEqual(2 * R - 2e-5);
  });

  test("a ball over a pocket is moved off it", () => {
    const [pocket] = pocketDropCircles(table);
    if (!pocket) throw new Error("no pocket");
    const balls: Ball[] = [
      { id: "b0", kind: "cue", x: 0.6, y: 1.0 },
      { id: "b1", kind: "1", x: pocket.x, y: pocket.y },
    ];
    const one = placeableBalls(balls, "b0", table, ballSet)[1] as Ball;
    expect(dist(one, { ...one, x: pocket.x, y: pocket.y })).toBeGreaterThanOrEqual(pocket.radiusM);
  });

  test("balls already placeable are unchanged", () => {
    const balls: Ball[] = [
      { id: "b0", kind: "cue", x: 0.6, y: 1.0 },
      { id: "b1", kind: "1", x: 0.7, y: 1.5 },
    ];
    expect(placeableBalls(balls, "b0", table, ballSet)).toEqual(balls);
  });
});

describe("every shot found is kept", () => {
  const still = (timeS: number, cueX: number): TrackedFrame => ({
    timeS,
    balls: [
      { id: "b0", kind: "cue", state: "rest", x: cueX, y: 1.0, vx: 0, vy: 0 },
      // Overlapping the cue ball by far more than the physics allows.
      { id: "b1", kind: "1", state: "rest", x: cueX + 0.02, y: 1.0, vx: 0, vy: 0 },
    ],
  });
  const init: AnalysisInit = {
    table,
    ballSet,
    scene,
    tuning: NO_TUNING,
    camera: {} as Camera,
    toDisplay: 1,
    balls: [
      { id: "b0", kind: "cue", x: 0.6, y: 1.0 },
      { id: "b1", kind: "1", x: 0.62, y: 1.0 },
    ],
  };
  const spans: ShotSpan[] = [
    { startIndex: 1, startS: 0.1, endIndex: 2, endS: 0.2 },
    { startIndex: 3, startS: 0.3, endIndex: 4, endS: 0.4 },
    { startIndex: 5, startS: 0.5, endIndex: 6, endS: 0.6 },
  ];

  function run(fit: AnalysisSteps["fitShot"]) {
    const steps: AnalysisSteps = {
      createTracker: () => ({ push: (_image, timeS) => still(timeS, 0.6) }),
      findShots: () => spans,
      fitShot: fit,
    };
    const session = createAnalysis(init, steps);
    for (let i = 0; i < 8; i++)
      session.push({ widthPx: 1, heightPx: 1, data: new Uint8ClampedArray(4) }, i / 10);
    return session.finish();
  }

  test("a shot the fit cannot explain, or whose simulation fails, is listed as not fitted", () => {
    const result = { durationS: 1, tracks: [], events: [], status: "complete" };
    const fit = vi.fn<AnalysisSteps["fitShot"]>((input) => {
      if (input.frames[0]?.timeS === 0) throw new Error("balls overlap");
      if (input.frames[0]?.timeS === 0.2) return undefined;
      // Only the fields the analysis reads.
      const found = {
        shot: { aimAngleRad: 1, speedMps: 2, tipOffset: { side: 0, vertical: 0 } },
        strikeS: 0.5,
        result,
        rmsM: 0.004,
      };
      return found as unknown as NonNullable<ReturnType<AnalysisSteps["fitShot"]>>;
    });
    const out = run(fit);
    expect(out.shots.map((s) => [s.index, s.fitted, s.startS, s.endS])).toEqual([
      [0, false, 0.1, 0.2],
      [1, false, 0.3, 0.4],
      [2, true, 0.5, 0.6],
    ]);
    const fitted = out.shots[2];
    if (!fitted?.fitted) throw new Error("not fitted");
    expect(fitted.strikeS).toBe(0.5);
    expect(fitted.rmsM).toBe(0.004);
  });

  test("the fit gets the placeable balls, and the shot keeps exactly those", () => {
    const seen: Ball[][] = [];
    const out = run((input) => {
      seen.push(input.balls.map((b) => ({ ...b })));
      return undefined;
    });
    for (const [i, shot] of out.shots.entries()) {
      expect(shot.balls).toEqual(seen[i]);
      const [cue, one] = shot.balls as [Ball, Ball];
      expect(cue).toEqual({ id: "b0", kind: "cue", x: 0.6, y: 1.0 });
      expect(dist(cue, one)).toBeGreaterThanOrEqual(2 * R - 2e-5);
    }
  });
});

import {
  frictionalBallBall,
  mathavanCushion,
  prepareTable,
  sampleAt,
  simulate,
} from "@baize/physics";
import {
  BALL_BALL_FRICTION,
  ballSizeOf,
  cueEndMassKg,
  getBallSet,
  getTablePreset,
  makeCloth,
} from "@baize/tables";
import type { BallKind } from "@baize/tables";
import {
  apparentRadiusPx,
  cameraFromCorners,
  homographyFromCorners,
  projectPoint,
} from "@baize/vision";
import type { TrackedBall, TrackedFrame } from "@baize/vision";
import { ballLook } from "../../view/ballLook";
import type { ClipAnalysis, FittedClipShot } from "../types";
import type { Ctx2D } from "./canvas";

/**
 * A synthetic clip analysis for the overlay tests and the visual check: a real shot simulated
 * with the editor's models, a camera beside a long side of the table (head end on the right
 * of the picture), and tracked frames taken straight from the simulation. Not used by the app.
 */

export interface TestAnalysisOptions {
  widthPx?: number;
  heightPx?: number;
  fps?: number;
  tableId?: string;
  /** Seconds of still table before the strike and after every ball stops. */
  leadInS?: number;
  tailS?: number;
  speedMps?: number;
}

interface TestBall {
  id: string;
  kind: BallKind;
  x: number;
  y: number;
}

export function testAnalysis(o: TestAnalysisOptions = {}): ClipAnalysis {
  const widthPx = o.widthPx ?? 1920;
  const heightPx = o.heightPx ?? 1080;
  const fps = o.fps ?? 30;
  const leadInS = o.leadInS ?? 0.5;
  const tailS = o.tailS ?? 0.5;
  const table = getTablePreset(o.tableId ?? "pool-9@1");
  const ballSet = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !ballSet) throw new Error("missing preset");
  const { widthM: W, lengthM: L } = table.playingArea;
  const pool = table.game === "pool";

  const balls: TestBall[] = [
    { id: "cue", kind: "cue", x: 0.5 * W, y: 0.22 * L },
    { id: "a", kind: pool ? "1" : "red", x: 0.42 * W, y: 0.58 * L },
    { id: "b", kind: pool ? "9" : "black", x: 0.75 * W, y: 0.8 * L },
    { id: "c", kind: pool ? "12" : "blue", x: 0.2 * W, y: 0.4 * L },
  ];
  const cue = balls[0] as TestBall;
  const target = balls[1] as TestBall;
  const sizes = balls.map((b) => ballSizeOf(ballSet, b.kind));
  const shot = {
    aimAngleRad: Math.atan2(target.y - cue.y, target.x - cue.x) + 0.012,
    speedMps: o.speedMps ?? 3,
    tipOffset: { side: 0, vertical: -0.2 },
  };
  const result = simulate({
    table: prepareTable(table),
    cloth: makeCloth("#1f6b3a", "medium"),
    balls: balls.map((b, k) => ({
      id: b.id,
      x: b.x,
      y: b.y,
      radiusM: (sizes[k]?.diameterM ?? 0) / 2,
      massKg: sizes[k]?.massKg ?? 0,
    })),
    ballRestitution: ballSet.restitution,
    shot: {
      ballId: cue.id,
      ...shot,
      cueEndMassKg: cueEndMassKg(sizes[0]?.massKg ?? 0),
    },
    models: { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion },
  });

  // A camera beside the long side at x = 0, looking across: the near cushion along the bottom
  // of the picture, the head end on the right. Corners in the order (0,0), (W,0), (W,L), (0,L).
  const sx = widthPx / 1920;
  const sy = heightPx / 1080;
  const h = homographyFromCorners(
    [
      { u: 1700 * sx, v: 960 * sy },
      { u: 1460 * sx, v: 360 * sy },
      { u: 460 * sx, v: 360 * sy },
      { u: 220 * sx, v: 960 * sy },
    ],
    W,
    L,
  );
  const camera = h ? cameraFromCorners(h, widthPx, heightPx, table.cushion.noseHeightM) : undefined;
  if (!camera) throw new Error("no camera");

  const strikeS = leadInS;
  const endS = strikeS + result.durationS;
  const durationS = endS + tailS;
  const frames: TrackedFrame[] = [];
  const count = Math.floor(durationS * fps);
  for (let i = 0; i < count; i++) {
    const timeS = i / fps;
    const samples = sampleAt(result, timeS - strikeS);
    frames.push({
      timeS,
      balls: samples.map((s, k): TrackedBall => {
        const b = balls[k] as TestBall;
        const moving = s.state === "sliding" || s.state === "rolling";
        return {
          id: s.id,
          kind: b.kind,
          state: s.state === "pocketed" ? "pocketed" : moving ? "moving" : "rest",
          x: s.position.x,
          y: s.position.y,
          vx: s.velocity.x,
          vy: s.velocity.y,
        };
      }),
    });
  }

  const clipShot: FittedClipShot = {
    fitted: true,
    index: 0,
    startS: strikeS,
    endS,
    strikeS,
    cueBallId: cue.id,
    balls,
    shot,
    result,
    rmsM: 0,
  };
  return { widthPx, heightPx, camera, table, ballSet, durationS, frames, shots: [clipShot] };
}

/** Shot `index` of an analysis, which must have been fitted (for tests). */
export function fittedShot(analysis: ClipAnalysis, index = 0): FittedClipShot {
  const shot = analysis.shots[index];
  if (!shot?.fitted) throw new Error(`shot ${String(index)} is not fitted`);
  return shot;
}

/**
 * A stand-in for a frame of the clip, for the visual check: a dark room, the cloth seen
 * through the camera, and the tracked balls nearest `clipTimeS` as flat discs.
 */
export function drawTestFrame(ctx: Ctx2D, analysis: ClipAnalysis, clipTimeS: number): void {
  const { widthPx, heightPx, camera, table } = analysis;
  const { widthM: W, lengthM: L } = table.playingArea;
  ctx.fillStyle = "#2a2622";
  ctx.fillRect(0, 0, widthPx, heightPx);
  const quad = (m: number, z: number): void => {
    const corners = [
      { x: -m, y: -m },
      { x: W + m, y: -m },
      { x: W + m, y: L + m },
      { x: -m, y: L + m },
    ];
    ctx.beginPath();
    corners.forEach((c, i) => {
      const q = projectPoint(camera, { ...c, z });
      if (!q) return;
      if (i === 0) ctx.moveTo(q.u, q.v);
      else ctx.lineTo(q.u, q.v);
    });
    ctx.closePath();
    ctx.fill();
  };
  ctx.fillStyle = "#4a2f1c";
  quad(0.17, table.cushion.noseHeightM);
  ctx.fillStyle = "#2b7a47";
  quad(0, 0);
  let frame = analysis.frames[0];
  for (const f of analysis.frames) if (f.timeS <= clipTimeS) frame = f;
  for (const b of frame?.balls ?? []) {
    if (b.state === "pocketed") continue;
    const r = ballSizeOf(analysis.ballSet, b.kind).diameterM / 2;
    const p = { x: b.x, y: b.y, z: r };
    const q = projectPoint(camera, p);
    const rPx = apparentRadiusPx(camera, p, r);
    if (!q || rPx === undefined) continue;
    ctx.beginPath();
    ctx.arc(q.u, q.v, rPx, 0, 2 * Math.PI);
    ctx.fillStyle = ballLook(b.kind).colour;
    ctx.fill();
  }
}

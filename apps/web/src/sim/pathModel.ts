import { sampleAt } from "@baize/physics";
import type { BallTrack, PocketId, SimResult } from "@baize/physics";
import type { BallKind } from "@baize/tables";
import type { Scene } from "../doc/resolve";

/**
 * What the editor draws for a simulated shot, in table coordinates (metres).
 *
 * Pure data derived from a `SimResult`: no SVG and no view transform here, so the same model
 * serves the screen, the exports and the readouts.
 */

export interface Point {
  x: number;
  y: number;
}

/** One piece of a ball's path: an exact quadratic Bezier (constant acceleration). */
export interface PathPiece {
  from: Point;
  control: Point;
  to: Point;
  /** Seconds from the start of the shot at which this piece starts and ends. */
  t0: number;
  t1: number;
  /** Sliding pieces can be drawn differently from rolling ones. */
  sliding: boolean;
}

/** How prominent a ball's path is: the cue ball and the first ball it hits stand out. */
export type PathRole = "cue" | "first-object" | "other";

export interface BallPath {
  ballId: string;
  kind: BallKind;
  role: PathRole;
  pieces: PathPiece[];
  /** Total distance travelled, metres. */
  lengthM: number;
}

export type MarkKind = "ball-ball" | "cushion" | "pocket";

/** A point worth marking on the diagram. */
export interface PathMark {
  kind: MarkKind;
  t: number;
  point: Point;
  /** Balls involved: one for cushion and pocket marks, two for ball-ball. */
  ballIds: string[];
  /** True for the cue ball's first contact with another ball. */
  firstContact: boolean;
}

export interface FinalBall {
  ballId: string;
  kind: BallKind;
  /** Where the ball ends: its resting position, or where it dropped. */
  position: Point;
  pocketed: PocketId | undefined;
  /** True if the ball moved at all during the shot. */
  moved: boolean;
}

export interface PathModel {
  paths: BallPath[];
  marks: PathMark[];
  finals: FinalBall[];
  /** Id of the first ball the cue ball hits, if any. */
  firstObjectBallId: string | undefined;
  /** Distance the cue ball travels, metres. */
  cueTravelM: number;
  durationS: number;
  /** False if the simulation stopped at a cap, so the paths are incomplete. */
  complete: boolean;
}

/** Samples per piece when measuring its length. A parabola is smooth, so few are needed. */
const LENGTH_STEPS = 16;

function pieces(track: BallTrack): PathPiece[] {
  const out: PathPiece[] = [];
  for (const s of track.segments) {
    if (s.state !== "sliding" && s.state !== "rolling") continue;
    if (!Number.isFinite(s.duration) || s.duration <= 0) continue;
    const T = s.duration;
    out.push({
      from: { x: s.r0.x, y: s.r0.y },
      control: { x: s.r0.x + (s.v0.x * T) / 2, y: s.r0.y + (s.v0.y * T) / 2 },
      to: {
        x: s.r0.x + T * (s.v0.x + 0.5 * s.a.x * T),
        y: s.r0.y + T * (s.v0.y + 0.5 * s.a.y * T),
      },
      t0: s.t0,
      t1: s.t0 + T,
      sliding: s.state === "sliding",
    });
  }
  return out;
}

/** Point on a piece at parameter u in [0, 1] (time fraction, which is the Bezier parameter). */
export function pointOnPiece(p: PathPiece, u: number): Point {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return {
    x: a * p.from.x + b * p.control.x + c * p.to.x,
    y: a * p.from.y + b * p.control.y + c * p.to.y,
  };
}

function pieceLength(p: PathPiece): number {
  let total = 0;
  let prev = p.from;
  for (let i = 1; i <= LENGTH_STEPS; i++) {
    const q = pointOnPiece(p, i / LENGTH_STEPS);
    total += Math.sqrt((q.x - prev.x) * (q.x - prev.x) + (q.y - prev.y) * (q.y - prev.y));
    prev = q;
  }
  return total;
}

/** Builds the drawable model of a simulated shot. */
export function buildPathModel(result: SimResult, scene: Scene): PathModel {
  const kindOf = new Map(scene.balls.map((b) => [b.id, b.kind]));
  const cueId = scene.shot?.cueBallId;

  // First ball the cue ball touches.
  let firstObjectBallId: string | undefined;
  for (const e of result.events) {
    if (e.type !== "ball-ball") continue;
    if (e.ballId === cueId) firstObjectBallId = e.otherBallId;
    else if (e.otherBallId === cueId) firstObjectBallId = e.ballId;
    if (firstObjectBallId) break;
  }

  const paths: BallPath[] = [];
  for (const track of result.tracks) {
    const ps = pieces(track);
    if (ps.length === 0) continue;
    paths.push({
      ballId: track.id,
      kind: kindOf.get(track.id) ?? "cue",
      role: track.id === cueId ? "cue" : track.id === firstObjectBallId ? "first-object" : "other",
      pieces: ps,
      lengthM: ps.reduce((sum, p) => sum + pieceLength(p), 0),
    });
  }

  const marks: PathMark[] = [];
  let seenFirst = false;
  for (const e of result.events) {
    if (e.type === "ball-ball") {
      const involvesCue = e.ballId === cueId || e.otherBallId === cueId;
      const firstContact = involvesCue && !seenFirst;
      if (firstContact) seenFirst = true;
      marks.push({
        kind: "ball-ball",
        t: e.t,
        point: { x: e.point.x, y: e.point.y },
        ballIds: [e.ballId, e.otherBallId],
        firstContact,
      });
    } else if (e.type === "ball-cushion") {
      marks.push({
        kind: "cushion",
        t: e.t,
        point: { x: e.point.x, y: e.point.y },
        ballIds: [e.ballId],
        firstContact: false,
      });
    } else if (e.type === "pocket") {
      marks.push({
        kind: "pocket",
        t: e.t,
        point: { x: e.point.x, y: e.point.y },
        ballIds: [e.ballId],
        firstContact: false,
      });
    }
  }

  const pocketOf = new Map<string, PocketId>();
  for (const e of result.events) if (e.type === "pocket") pocketOf.set(e.ballId, e.pocketId);
  const moved = new Set(paths.map((p) => p.ballId));
  const finals: FinalBall[] = sampleAt(result, result.durationS + 1).map((b) => ({
    ballId: b.id,
    kind: kindOf.get(b.id) ?? "cue",
    position: { x: b.position.x, y: b.position.y },
    pocketed: pocketOf.get(b.id),
    moved: moved.has(b.id),
  }));

  return {
    paths,
    marks,
    finals,
    firstObjectBallId,
    cueTravelM: paths.find((p) => p.role === "cue")?.lengthM ?? 0,
    durationS: result.durationS,
    complete: result.status === "complete",
  };
}

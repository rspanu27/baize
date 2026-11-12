import { sampleAt } from "@baize/physics";
import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { loadLayout, placeBall, setShot } from "../doc/ops";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { pointOnPiece } from "./pathModel";
import { simulateDoc, simulationFor } from "./useSimulation";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-9@1"), "table");
const set = must(getBallSet(table.defaultBallSetId), "set");
const W = table.playingArea.widthM;
const L = table.playingArea.lengthM;
const G = 9.80665;

function racked(): DiagramDoc {
  return loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
}

function twoBalls(objectAt: { x: number; y: number }): DiagramDoc {
  return loadLayout(
    newDoc("pool-9@1"),
    {
      balls: [
        { kind: "cue", x: W / 2, y: 0.5 },
        { kind: "3", ...objectAt },
      ],
    },
    { source: "manual", mode: "replace" },
  );
}

describe("simulateDoc", () => {
  test("no shot: a scene, no result, no problems", () => {
    const s = simulateDoc(racked());
    expect(s.scene?.balls).toHaveLength(10);
    expect(s.outcome.result).toBeUndefined();
    expect(s.paths).toBeUndefined();
    expect(s.problems).toEqual([]);
  });

  test("a document that cannot be resolved reports its problems and does not simulate", () => {
    const s = simulateDoc({ ...racked(), table: { preset: "nope@1" } });
    expect(s.scene).toBeUndefined();
    expect(s.problems.length).toBeGreaterThan(0);
    expect(s.paths).toBeUndefined();
  });

  test("a break: paths for the balls that move, the cue ball and first object ball stand out", () => {
    const doc = setShot(racked(), { aimAngleRad: Math.PI / 2, speedMps: 7 });
    const s = simulateDoc(doc);
    const paths = must(s.paths, "paths");
    expect(paths.complete).toBe(true);
    expect(paths.paths[0]).toMatchObject({ ballId: "b1", kind: "cue", role: "cue" });
    // The 1 ball is at the apex of a 9-ball rack and is hit first.
    const first = must(paths.firstObjectBallId, "first object ball");
    expect(doc.balls.find((b) => b.id === first)?.kind).toBe("1");
    expect(paths.paths.filter((p) => p.role === "first-object")).toHaveLength(1);
    expect(paths.paths.filter((p) => p.role === "cue")).toHaveLength(1);
    expect(paths.paths.length).toBeGreaterThan(5);
    expect(paths.cueTravelM).toBeGreaterThan(1);
    // Exactly one mark is the cue ball's first contact, and it is the earliest ball-ball mark.
    const firsts = paths.marks.filter((m) => m.firstContact);
    expect(firsts).toHaveLength(1);
    expect(firsts[0]).toBe(paths.marks.find((m) => m.kind === "ball-ball"));
    expect(paths.finals).toHaveLength(10);
    expect(s.outcome.ms).toBeLessThan(50);
  });

  test("a single rolling ball: one exact piece, with the analytic length", () => {
    const base = loadLayout(
      newDoc("pool-9@1"),
      { balls: [{ kind: "cue", x: W / 2, y: 0.5 }] },
      {
        source: "manual",
        mode: "replace",
      },
    );
    const v = 0.6;
    const doc = setShot(base, {
      aimAngleRad: Math.PI / 2,
      speedMps: v,
      tipOffset: { side: 0, vertical: 0.4 },
    });
    const paths = must(simulateDoc(doc).paths, "paths");
    expect(paths.paths).toHaveLength(1);
    const cue = must(paths.paths[0], "cue path");
    expect(cue.pieces).toHaveLength(1);
    const travel = (v * v) / (2 * doc.cloth.rollingResistance * G);
    expect(cue.lengthM).toBeCloseTo(travel, 6);
    expect(paths.cueTravelM).toBe(cue.lengthM);
    const piece = must(cue.pieces[0], "piece");
    expect(piece.sliding).toBe(false);
    expect(piece.to.y).toBeCloseTo(0.5 + travel, 9);
    expect(paths.marks).toEqual([]);
    expect(paths.finals[0]).toMatchObject({ pocketed: undefined, moved: true });
    expect(paths.finals[0]?.position.y).toBeCloseTo(0.5 + travel, 9);
  });

  test("path pieces follow the simulated positions exactly", () => {
    const doc = setShot(twoBalls({ x: W / 2 + 0.02, y: 1.4 }), {
      aimAngleRad: Math.PI / 2,
      speedMps: 3,
      tipOffset: { side: 0.3, vertical: -0.2 },
    });
    const s = simulateDoc(doc);
    const result = must(s.outcome.result, "result");
    const paths = must(s.paths, "paths");
    for (const path of paths.paths) {
      for (const piece of path.pieces) {
        for (const u of [0, 0.25, 0.5, 0.75, 1]) {
          const t = piece.t0 + u * (piece.t1 - piece.t0);
          // Just inside the piece, so the sample is on this segment and not the next.
          const inside = Math.min(Math.max(t, piece.t0 + 1e-12), piece.t1 - 1e-12);
          const ball = must(
            sampleAt(result, inside).find((b) => b.id === path.ballId),
            "ball",
          );
          const p = pointOnPiece(piece, (inside - piece.t0) / (piece.t1 - piece.t0));
          expect(p.x).toBeCloseTo(ball.position.x, 9);
          expect(p.y).toBeCloseTo(ball.position.y, 9);
        }
      }
    }
  });

  test("a potted ball is marked, and ends where it dropped", () => {
    // Object ball in front of the top-right corner pocket, cue ball straight behind it.
    const base = loadLayout(
      newDoc("pool-9@1"),
      {
        balls: [
          { kind: "cue", x: W - 0.5, y: L - 0.5 },
          { kind: "9", x: W - 0.2, y: L - 0.2 },
        ],
      },
      { source: "manual", mode: "replace" },
    );
    const doc = setShot(base, { aimAngleRad: Math.PI / 4, speedMps: 1.2 });
    const paths = must(simulateDoc(doc).paths, "paths");
    const nine = must(
      paths.finals.find((f) => f.kind === "9"),
      "nine",
    );
    expect(nine.pocketed).toBe("corner-tr");
    const mark = must(
      paths.marks.find((m) => m.kind === "pocket"),
      "pocket mark",
    );
    expect(mark.ballIds).toEqual([nine.ballId]);
    expect(mark.point).toEqual(nine.position);
  });
});

describe("simulationFor", () => {
  test("the same document object is simulated once", () => {
    const doc = setShot(racked(), { speedMps: 5 });
    expect(simulationFor(doc)).toBe(simulationFor(doc));
  });

  test("re-simulating on every step of a drag is far faster than a frame", () => {
    let doc = setShot(racked(), { aimAngleRad: Math.PI / 2, speedMps: 6 });
    // Warm up, then drag the 9 ball across the table in 200 steps.
    for (let i = 0; i < 20; i++) simulationFor(placeBall(doc, "b6", { x: 0.3, y: 0.3 + i * 0.01 }));
    const started = performance.now();
    const steps = 200;
    for (let i = 0; i < steps; i++) {
      doc = placeBall(doc, "b6", { x: 0.2 + i * 0.004, y: 0.4 + i * 0.003 });
      const s = simulationFor(doc);
      expect(s.problems).toEqual([]);
    }
    const perStep = (performance.now() - started) / steps;
    // One frame at 60 Hz is 16.7 ms. This covers placing the ball, resolving the document,
    // simulating a full break and building the path model.
    expect(perStep).toBeLessThan(8);
    expect(resolveDoc(doc).ok).toBe(true);
  });
});

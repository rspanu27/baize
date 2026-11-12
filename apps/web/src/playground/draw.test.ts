import { buildTableGeometry, simulate } from "@baize/physics";
import { getBallSet, getTablePreset, makeCloth } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { ballLook, cushionPaths, toScreen, toTable, trackLength, trackPath } from "./draw";

const table = getTablePreset("pool-8-pro@1");
if (!table) throw new Error("missing preset");
const set = getBallSet(table.defaultBallSetId);
if (!set) throw new Error("missing ball set");
const R = set.object.diameterM / 2;

describe("screen mapping", () => {
  test("the table length runs across the screen and the mapping undoes itself", () => {
    expect(toScreen({ x: 0.3, y: 2 })).toEqual({ x: 2, y: 0.3 });
    expect(toTable(toScreen({ x: 0.3, y: 2 }))).toEqual({ x: 0.3, y: 2 });
  });

  test("the quarter turn does not mirror the table", () => {
    // On the table (y up), going from +x to +y is a counter-clockwise turn. On the screen
    // (y down), the same two directions must also read as counter-clockwise, which with y
    // down means a negative cross product.
    const a = toScreen({ x: 1, y: 0 });
    const b = toScreen({ x: 0, y: 1 });
    expect(a.x * b.y - a.y * b.x).toBeLessThan(0);
  });
});

describe("cushionPaths", () => {
  test("one closed outline per cushion, each reaching the given depth behind the nose", () => {
    const paths = cushionPaths(buildTableGeometry(table), 0.05);
    expect(paths).toHaveLength(6);
    for (const d of paths) {
      expect(d.startsWith("M ")).toBe(true);
      expect(d.endsWith(" Z")).toBe(true);
      expect(d).not.toContain("NaN");
    }
    // The bottom cushion (table y = 0) is drawn at the left: screen x from 0 down to -0.05.
    const xs = paths.flatMap((d) =>
      d
        .replace(/[MLZ]/g, " ")
        .trim()
        .split(/\s+/)
        .map(Number)
        .filter((_, i) => i % 2 === 0),
    );
    expect(Math.min(...xs)).toBeCloseTo(-0.05, 6);
    expect(Math.max(...xs)).toBeCloseTo(table.playingArea.lengthM + 0.05, 6);
  });
});

describe("trackPath and trackLength", () => {
  const result = simulate({
    table,
    cloth: makeCloth("#1d7a5f", "medium"),
    ballRestitution: set.restitution,
    balls: [
      { id: "cue", radiusM: R, massKg: set.object.massKg, x: 0.6, y: 0.5 },
      { id: "still", radiusM: R, massKg: set.object.massKg, x: 0.2, y: 2.0 },
    ],
    shot: {
      ballId: "cue",
      aimAngleRad: Math.PI / 2,
      speedMps: 0.5,
      tipOffset: { side: 0, vertical: 0.4 },
    },
  });

  test("a rolling ball gives one curve from its start to where it stops", () => {
    const cue = result.tracks[0];
    expect(cue).toBeDefined();
    if (!cue) return;
    const d = trackPath(cue);
    // Natural roll from the start: one segment, straight up the table, v^2 / (2 mu g) long.
    // For a ball that decelerates to rest the Bezier control point (start + v0 T / 2) is the
    // end point itself.
    const travel = (0.5 * 0.5) / (2 * 0.01 * 9.80665);
    const end = String(Math.round((0.5 + travel) * 1e4) / 1e4);
    expect(d).toBe(`M 0.5 0.6 Q ${end} 0.6 ${end} 0.6`);
    expect(trackLength(cue)).toBeCloseTo(travel, 9);
  });

  test("a ball that never moves has no path", () => {
    const still = result.tracks[1];
    expect(still).toBeDefined();
    if (!still) return;
    expect(trackPath(still)).toBe("");
    expect(trackLength(still)).toBe(0);
  });
});

describe("ballLook", () => {
  test("pool balls: solids 1 to 8, stripes 9 to 15 sharing colours, white cue ball", () => {
    expect(ballLook("cue")).toMatchObject({ striped: false, label: "" });
    expect(ballLook("8")).toMatchObject({ colour: "#141414", striped: false, label: "8" });
    expect(ballLook("9")).toMatchObject({
      colour: ballLook("1").colour,
      striped: true,
      label: "9",
    });
    expect(ballLook("15").colour).toBe(ballLook("7").colour);
  });
});

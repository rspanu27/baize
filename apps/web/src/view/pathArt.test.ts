import { describe, expect, test } from "vitest";
import { pointOnPiece } from "../sim/pathModel";
import type { PathPiece } from "../sim/pathModel";
import {
  CUE_PATH_COLOUR,
  DARK_BALL_PATH_COLOUR,
  FAINT_WIDTH_M,
  STRONG_WIDTH_M,
  pathColour,
  pathData,
  pathStyle,
  pieceRuns,
} from "./pathArt";
import { makeViewTransform } from "./transform";

const table = { widthM: 1.27, lengthM: 2.54 };
const landscape = makeViewTransform(table, "landscape");
const portrait = makeViewTransform(table, "portrait");

function piece(
  from: [number, number],
  control: [number, number],
  to: [number, number],
  sliding = false,
): PathPiece {
  return {
    from: { x: from[0], y: from[1] },
    control: { x: control[0], y: control[1] },
    to: { x: to[0], y: to[1] },
    t0: 0,
    t1: 1,
    sliding,
  };
}

describe("pathData", () => {
  test("one straight piece, landscape: screen = (y, x)", () => {
    const d = pathData([piece([0.5, 0.5], [0.5, 1], [0.5, 1.5])], landscape);
    expect(d).toBe("M0.5 0.5 L1.5 0.5");
  });

  test("one straight piece, portrait: screen = (x, length - y)", () => {
    const d = pathData([piece([0.5, 0.5], [0.5, 1], [0.5, 1.5])], portrait);
    expect(d).toBe("M0.5 2.04 L0.5 1.04");
  });

  test("contiguous pieces share one M; a gap starts a new one", () => {
    const a = piece([0.1, 0.1], [0.1, 0.3], [0.1, 0.5]);
    const b = piece([0.1, 0.5], [0.1, 0.6], [0.1, 0.7]);
    const c = piece([0.4, 0.4], [0.4, 0.5], [0.4, 0.6]);
    expect(pathData([a, b], landscape).match(/M/g)).toHaveLength(1);
    expect(pathData([a, b, c], landscape).match(/M/g)).toHaveLength(2);
    expect(pathData([a, b], landscape).match(/L/g)).toHaveLength(2);
  });

  test("no NaN, and coordinates are rounded to 0.1 mm", () => {
    const d = pathData(
      [piece([0.123456789, 0.987654321], [0.2, 0.3], [0.31415926, 0.2718])],
      landscape,
    );
    expect(d).not.toContain("NaN");
    for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
      expect(n.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
    }
  });

  test("empty input gives empty data", () => {
    expect(pathData([], landscape)).toBe("");
  });

  test("a curved piece is drawn as line steps that stay on the curve", () => {
    for (const view of [landscape, portrait]) {
      const p = piece([0.2, 0.2], [0.9, 0.4], [0.3, 1.8]);
      const d = pathData([p], view);
      expect(d).not.toContain("Q");
      const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      }));
      const n = points.length - 1;
      expect(n).toBeGreaterThan(8);
      points.forEach((q, i) => {
        const want = view.toScreen(pointOnPiece(p, i / n));
        expect(q.x).toBeCloseTo(want.x, 3);
        expect(q.y).toBeCloseTo(want.y, 3);
      });
    }
  });

  test("degenerate pieces draw nothing odd: no curves, no repeated points, no NaN", () => {
    // A ball rolling to rest (control on the end), a piece too short to see, a hairpin that
    // comes straight back, and a broken piece.
    const rest = piece([0.5, 0.5], [0.5, 0.9], [0.5, 0.9]);
    const tiny = piece([0.5, 0.9], [0.50001, 0.9], [0.5, 0.90001]);
    const hairpin = piece([0.5, 0.9], [0.5, 1.4], [0.5, 0.9]);
    const broken = piece([0.5, 0.9], [Number.NaN, 1], [0.6, 1]);
    const d = pathData([rest, tiny, hairpin, broken], landscape);
    expect(d).not.toMatch(/Q|NaN|Infinity/);
    const points = d.split(" ");
    for (let i = 1; i < points.length; i++) {
      expect(points[i]?.slice(1)).not.toBe(points[i - 1]?.slice(1));
    }
    // The hairpin goes out a quarter of a metre and comes back.
    expect(d).toContain("L1.15 0.5");
    expect(d.endsWith("L0.9 0.5")).toBe(true);
  });
});

describe("pathStyle", () => {
  test("cue and first-object are strong, others faint", () => {
    expect(pathStyle("cue", false).widthM).toBe(STRONG_WIDTH_M);
    expect(pathStyle("first-object", false).widthM).toBe(STRONG_WIDTH_M);
    const other = pathStyle("other", false);
    expect(other.widthM).toBe(FAINT_WIDTH_M);
    expect(other.opacity).toBeLessThan(pathStyle("cue", false).opacity);
    expect(other.emphasised).toBe(false);
  });

  test("show all makes every path strong", () => {
    expect(pathStyle("other", true)).toEqual(pathStyle("cue", true));
    expect(pathStyle("other", true).widthM).toBe(STRONG_WIDTH_M);
  });
});

describe("pathColour and runs", () => {
  test("cue white, dark balls light grey, others their colour", () => {
    expect(pathColour("cue", "#fbfaf2")).toBe(CUE_PATH_COLOUR);
    expect(pathColour("other", "#141414")).toBe(DARK_BALL_PATH_COLOUR);
    expect(pathColour("other", "#c8102e")).toBe("#c8102e");
  });

  test("pieceRuns splits where sliding changes to rolling", () => {
    const s = piece([0, 0], [0, 1], [0, 2], true);
    const r1 = piece([0, 2], [0, 3], [0, 4]);
    const r2 = piece([0, 4], [0, 5], [0, 6]);
    expect(pieceRuns([s, r1, r2]).map((run) => run.length)).toEqual([1, 2]);
  });
});

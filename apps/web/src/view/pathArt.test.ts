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
    expect(d).toBe("M0.5 0.5 Q1 0.5 1.5 0.5");
  });

  test("one straight piece, portrait: screen = (x, length - y)", () => {
    const d = pathData([piece([0.5, 0.5], [0.5, 1], [0.5, 1.5])], portrait);
    expect(d).toBe("M0.5 2.04 Q0.5 1.54 0.5 1.04");
  });

  test("contiguous pieces share one M; a gap starts a new one", () => {
    const a = piece([0.1, 0.1], [0.1, 0.3], [0.1, 0.5]);
    const b = piece([0.1, 0.5], [0.1, 0.6], [0.1, 0.7]);
    const c = piece([0.4, 0.4], [0.4, 0.5], [0.4, 0.6]);
    expect(pathData([a, b], landscape).match(/M/g)).toHaveLength(1);
    expect(pathData([a, b, c], landscape).match(/M/g)).toHaveLength(2);
    expect(pathData([a, b], landscape).match(/Q/g)).toHaveLength(2);
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

  test("the transformed Bezier equals the transformed samples (exact in both orientations)", () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (const view of [landscape, portrait]) {
      for (let k = 0; k < 50; k++) {
        const p = piece(
          [rand() * 1.2, rand() * 2.5],
          [rand() * 1.2, rand() * 2.5],
          [rand() * 1.2, rand() * 2.5],
        );
        const f = view.toScreen(p.from);
        const c = view.toScreen(p.control);
        const e = view.toScreen(p.to);
        for (const u of [0, 0.2, 0.5, 0.83, 1]) {
          const a = (1 - u) * (1 - u);
          const b = 2 * (1 - u) * u;
          const d = u * u;
          const bez = { x: a * f.x + b * c.x + d * e.x, y: a * f.y + b * c.y + d * e.y };
          const want = view.toScreen(pointOnPiece(p, u));
          expect(bez.x).toBeCloseTo(want.x, 12);
          expect(bez.y).toBeCloseTo(want.y, 12);
        }
      }
    }
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

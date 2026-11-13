import { CLOTH_COLOURS, TABLE_PRESETS, getBallSet } from "@baize/tables";
import type { BallKind, BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { describeSummary, importPhoto, quantile, scorePhoto, summarise } from "../src/index";
import type { PhotoScore } from "../src/index";
import { renderPhoto } from "./render";
import { cameraOf, seeded } from "./synthetic";

/**
 * The evaluation, on a fixed set of synthetic photos: three tables, several cloth colours,
 * camera positions around the baulk end, and layouts of spread balls. It reports the same
 * figures the targets are stated in. Synthetic photos are far kinder than real ones (even
 * light, no glare, no clutter, exact cushions), so these numbers are an upper bound on what
 * the model-free finder can do, not a claim about real photos.
 */

const SIZE = { width: 1600, height: 1200 };

function preset(id: string): { table: TableSpec; set: BallSetSpec } {
  const table = TABLE_PRESETS.find((t) => t.id === id);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error(`no preset ${id}`);
  return { table, set };
}

const KINDS: Record<string, BallKind[]> = {
  "pool-9@1": ["cue", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"],
  "snooker-12@1": ["cue", "red", "red", "red", "red", "yellow", "brown", "blue", "pink", "black"],
  "blackball-7@1": ["cue", "red", "red", "red", "yellow", "yellow", "yellow", "black"],
};

function scene(index: number): {
  id: string;
  layout: Layout;
  cloth: string;
  score: () => PhotoScore;
} {
  const rand = seeded(1000 + index);
  const id = Object.keys(KINDS)[index % 3] as string;
  const { table, set } = preset(id);
  const { widthM: W, lengthM: L } = table.playingArea;
  const balls: Layout["balls"] = [];
  for (const kind of KINDS[id] as BallKind[]) {
    for (let tries = 0; tries < 300; tries++) {
      const x = 0.07 * W + rand() * 0.86 * W;
      const y = 0.05 * L + rand() * 0.9 * L;
      if (balls.every((b) => Math.hypot(b.x - x, b.y - y) > 2.2 * set.object.diameterM)) {
        balls.push({ kind, x, y });
        break;
      }
    }
  }
  const layout = { balls };
  // Not the cloth colour of a ball in play: a ball of the cloth's colour is a known miss.
  const cloths = CLOTH_COLOURS.filter((c) =>
    ["green", "blue", "tournament-blue", "grey"].includes(c.id),
  );
  const cloth = (cloths[index % cloths.length] as { hex: string }).hex;
  const camera = cameraOf({
    position: {
      x: (-0.2 + rand() * 0.9) * W,
      y: (-0.45 + rand() * 0.1) * L,
      z: (0.55 + rand() * 0.15) * L,
    },
    target: { x: 0.5 * W, y: (0.44 + rand() * 0.06) * L },
    rollRad: (rand() - 0.5) * 0.08,
    focalPx: 0.62 * SIZE.width,
    widthPx: SIZE.width,
    heightPx: SIZE.height,
  });
  return {
    id,
    layout,
    cloth,
    score: () => {
      const photo = renderPhoto(camera, table, set, layout, {
        cloth,
        noise: 4,
        seed: index,
        brightness: 0.8 + rand() * 0.4,
      });
      const result = importPhoto(photo.image, table, set);
      return scorePhoto(result.layout.balls, layout.balls, L, set.object.diameterM);
    },
  };
}

describe("scoring", () => {
  test("pairs nearest first, counts misses, extras and names", () => {
    const truth = [
      { kind: "cue" as const, x: 0.5, y: 0.5 },
      { kind: "1" as const, x: 1.0, y: 1.0 },
      { kind: "2" as const, x: 0.2, y: 2.0 },
    ];
    const found = [
      { kind: "cue" as const, x: 0.51, y: 0.5 },
      { kind: "3" as const, x: 1.0, y: 1.02 },
      { kind: "8" as const, x: 0.9, y: 0.1 },
    ];
    const s = scorePhoto(found, truth, 2.54, 0.05715);
    expect(s).toMatchObject({ truth: 3, found: 2, extra: 1, named: 1 });
    expect(s.errors.sort((a, b) => a - b)).toEqual(
      [0.01 / 2.54, 0.02 / 2.54].map((v) => expect.closeTo(v, 9)),
    );
  });

  test("quantiles and the summary of several photos", () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    const sum = summarise([
      { truth: 4, found: 4, extra: 0, named: 3, errors: [0.001, 0.002, 0.003, 0.004] },
      { truth: 6, found: 5, extra: 1, named: 5, errors: [0.001, 0.001, 0.002, 0.002, 0.02] },
    ]);
    expect(sum).toMatchObject({ photos: 2, balls: 10, recall: 0.9, extraPerPhoto: 0.5 });
    expect(sum.identity).toBeCloseTo(8 / 9, 12);
    expect(sum.medianError).toBe(0.002);
    expect(sum.p95Error).toBe(0.02);
    expect(describeSummary(sum)).toContain("found 90.0 %");
  });
});

describe("evaluation on synthetic photos", () => {
  test("18 photos of spread balls: found, placed and named within the stated bounds", () => {
    const scores: PhotoScore[] = [];
    for (let i = 0; i < 18; i++) scores.push(scene(i).score());
    const sum = summarise(scores);
    const report = describeSummary(sum);
    // BAIZE_EVAL_REPORT=<file> writes the figures to a file, to read them without failing a bound.
    if (process.env.BAIZE_EVAL_REPORT)
      writeFileSync(
        process.env.BAIZE_EVAL_REPORT,
        `${report}
`,
      );
    // Measured on 2026-11-13: found 96.6 %, named 97.6 %, position error median 0.23 % and
    // 95th percentile 0.75 % of the table length, no false balls. The bounds below leave a
    // margin; the spec's targets (for real photos) are in the comments.
    expect(sum.recall, report).toBeGreaterThan(0.93); // target 0.95
    expect(sum.medianError, report).toBeLessThan(0.004); // target 0.006
    expect(sum.p95Error, report).toBeLessThan(0.012); // target 0.015
    expect(sum.extraPerPhoto, report).toBeLessThan(0.25);
    expect(sum.identity, report).toBeGreaterThan(0.9); // target 0.9 for solids and snooker balls
  }, 120_000);
});

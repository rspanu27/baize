import { POOL_SIGHT_SETBACK_M, TABLE_PRESETS, getBallSet } from "@baize/tables";
import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import {
  apparentRadiusPx,
  describeSummary,
  imageToTableAtHeight,
  importPhoto,
  quantile,
  scorePhoto,
  summarise,
} from "../src/index";
import type { ImagePoint, PhotoImage, PhotoScore, PlacedBall } from "../src/index";
import { truthFromSights } from "./sights";
import type { SightTruth } from "./sights";

/**
 * The import measured on real pictures of pool tables in which the balls and the sights
 * (diamonds) have been marked, such as the public pix2pockets set (docs/DATASETS.md). It
 * runs only when asked, because the pictures are not in the repository:
 *
 *   BAIZE_REAL_LABELS  folder of YOLO label files (class, centre x, centre y, width, height,
 *                      as shares of the picture; one file per picture)
 *   BAIZE_REAL_PIXELS  folder of the pictures decoded by apps/web/scripts/decode-photos.mjs
 *   BAIZE_REAL_CLASSES class names in label order (default: the pix2pockets order)
 *   BAIZE_REAL_LIMIT   only the first so many pictures
 *   BAIZE_EVAL_REPORT  file to write the report to (a .csv with one line per picture is
 *                      written beside it)
 *
 * The truth comes from the sights (see sights.ts), so it is good to about a centimetre, and
 * the balls are known only as cue, black, solid or striped. Which end of the table is baulk
 * cannot be known, so a table found turned end for end counts as found.
 */
const LABELS = process.env.BAIZE_REAL_LABELS;
const PIXELS = process.env.BAIZE_REAL_PIXELS;
const CLASSES = (process.env.BAIZE_REAL_CLASSES ?? "Black,Cue,Dot,Solid,Striped").split(",");
const LIMIT = Number(process.env.BAIZE_REAL_LIMIT ?? "0");

type Group = "cue" | "black" | "solid" | "striped";

/** One kind standing for each group, so that the ordinary scoring can be used. */
const STAND_IN: Record<Group, BallKind> = { cue: "cue", black: "8", solid: "1", striped: "9" };

function groupOfKind(kind: BallKind): Group | undefined {
  if (kind === "cue") return "cue";
  const n = Number(kind);
  if (!Number.isInteger(n)) return undefined;
  if (n === 8) return "black";
  return n < 8 ? "solid" : "striped";
}

function groupOfClass(name: string): Group | undefined {
  const lower = name.toLowerCase();
  return lower === "cue" || lower === "black" || lower === "solid" || lower === "striped"
    ? lower
    : undefined;
}

interface Marked {
  dots: ImagePoint[];
  balls: { group: Group; at: ImagePoint; radiusPx: number }[];
}

function readLabels(path: string, widthPx: number, heightPx: number): Marked {
  const out: Marked = { dots: [], balls: [] };
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length < 5 || parts.some((v) => !Number.isFinite(v))) continue;
    const name = CLASSES[parts[0] as number] ?? "";
    let cx: number;
    let cy: number;
    let w: number;
    let h: number;
    if (parts.length === 5) {
      [, cx = 0, cy = 0, w = 0, h = 0] = parts;
    } else {
      // An outline instead of a box: take the box around it.
      const xs = parts.slice(1).filter((_, i) => i % 2 === 0);
      const ys = parts.slice(1).filter((_, i) => i % 2 === 1);
      w = Math.max(...xs) - Math.min(...xs);
      h = Math.max(...ys) - Math.min(...ys);
      cx = Math.min(...xs) + w / 2;
      cy = Math.min(...ys) + h / 2;
    }
    const at = { u: cx * widthPx, v: cy * heightPx };
    const group = groupOfClass(name);
    if (name.toLowerCase() === "dot") out.dots.push(at);
    else if (group) out.balls.push({ group, at, radiusPx: (w * widthPx + h * heightPx) / 4 });
  }
  return out;
}

function readPixels(path: string): PhotoImage {
  const raw = gunzipSync(readFileSync(path));
  const widthPx = raw.readUInt32LE(0);
  const heightPx = raw.readUInt32LE(4);
  return { widthPx, heightPx, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8) };
}

/** Pool tables twice as long as wide: the sizes a marked picture may show. */
const CANDIDATES: { table: TableSpec; set: BallSetSpec }[] = TABLE_PRESETS.flatMap((table) => {
  const { widthM, lengthM } = table.playingArea;
  const set = getBallSet(table.defaultBallSetId);
  return table.game === "pool" && Math.abs(lengthM / widthM - 2) < 0.01 && set
    ? [{ table, set }]
    : [];
});

interface Reading {
  table: TableSpec;
  set: BallSetSpec;
  truth: SightTruth;
  balls: PlacedBall[];
  /** How far the marked ball sizes are from what this table size predicts (0 is exact). */
  sizeMisfit: number;
}

/** The truth for one picture, for the table size whose balls are the size the marks show. */
function readingOf(marked: Marked, image: PhotoImage): Reading | undefined {
  let best: Reading | undefined;
  for (const { table, set } of CANDIDATES) {
    const nose = table.cushion.noseHeightM;
    const truth = truthFromSights(marked.dots, image.widthPx, image.heightPx, {
      widthM: table.playingArea.widthM,
      lengthM: table.playingArea.lengthM,
      setbackM: POOL_SIGHT_SETBACK_M,
      railHeightM: nose,
      noseHeightM: nose,
    });
    if (!truth) continue;
    const r = set.object.diameterM / 2;
    const balls: PlacedBall[] = [];
    const ratios: number[] = [];
    for (const b of marked.balls) {
      const at = imageToTableAtHeight(truth.camera, b.at, r);
      if (!at) continue;
      balls.push({ kind: STAND_IN[b.group], x: at.x, y: at.y });
      const expected = apparentRadiusPx(truth.camera, { ...at, z: r }, r);
      if (expected) ratios.push(Math.log(b.radiusPx / expected));
    }
    ratios.sort((a, b) => a - b);
    const sizeMisfit = ratios.length > 0 ? Math.abs(quantile(ratios, 0.5)) : 0;
    if (!best || sizeMisfit < best.sizeMisfit) best = { table, set, truth, balls, sizeMisfit };
  }
  return best;
}

function grouped(balls: readonly { kind: BallKind; x: number; y: number }[]): PlacedBall[] {
  return balls.flatMap((b) => {
    const group = groupOfKind(b.kind);
    return group ? [{ kind: STAND_IN[group], x: b.x, y: b.y }] : [];
  });
}

const pct = (v: number, digits = 1): string =>
  Number.isNaN(v) ? "n/a" : `${(v * 100).toFixed(digits)} %`;

describe.skipIf(!LABELS || !PIXELS)("the import on real marked pictures", () => {
  test("report", () => {
    const labels = LABELS ?? "";
    const pixels = PIXELS ?? "";
    let names = readdirSync(labels)
      .filter((n) => n.endsWith(".txt"))
      .sort();
    if (LIMIT > 0) names = names.slice(0, LIMIT);
    const stored = new Set(readdirSync(pixels));

    const given: PhotoScore[] = [];
    const automatic: PhotoScore[] = [];
    const cornerErrors: number[] = [];
    const tableCount = new Map<string, number>();
    let noPixels = 0;
    let noTruth = 0;
    let tableFound = 0;
    let tableRight = 0;
    const csv = [
      "picture,table,sights,sight_residual_px,balls,given_found,given_extra,given_named," +
        "given_median_error,auto_table,auto_corner_error,auto_found,auto_extra,auto_named",
    ];

    for (const name of names) {
      const base = name.slice(0, -4);
      const file = [".jpg", ".jpeg", ".png"]
        .map((ext) => `${base}${ext}.rgba.gz`)
        .find((n) => stored.has(n));
      if (!file) {
        noPixels++;
        continue;
      }
      const image = readPixels(join(pixels, file));
      const marked = readLabels(join(labels, name), image.widthPx, image.heightPx);
      const reading = readingOf(marked, image);
      if (!reading) {
        noTruth++;
        continue;
      }
      const { table, set, truth, balls } = reading;
      const { widthM, lengthM } = table.playingArea;
      const diameter = set.object.diameterM;
      tableCount.set(table.id, (tableCount.get(table.id) ?? 0) + 1);

      // 1. The corners given, as a person would place them: only the balls are judged.
      const withCorners = importPhoto(image, table, set, { corners: truth.corners });
      const g = scorePhoto(grouped(withCorners.layout.balls), balls, lengthM, diameter);
      given.push(g);

      // 2. Nothing given: the table has to be found first.
      const alone = importPhoto(image, table, set);
      let autoCells = "no,,,,";
      if (!alone.problem && alone.corners) {
        tableFound++;
        const nose = table.cushion.noseHeightM;
        const seen = alone.corners.map((c) => imageToTableAtHeight(truth.camera, c, nose));
        const real = [
          { x: 0, y: 0 },
          { x: widthM, y: 0 },
          { x: widthM, y: lengthM },
          { x: 0, y: lengthM },
        ];
        const worst = (turn: number): number =>
          Math.max(
            ...seen.map((s, i) => {
              const r = real[(i + turn) % 4] as { x: number; y: number };
              return s ? Math.hypot(s.x - r.x, s.y - r.y) / lengthM : Number.POSITIVE_INFINITY;
            }),
          );
        const turned = worst(2) < worst(0);
        const cornerError = Math.min(worst(0), worst(2));
        cornerErrors.push(cornerError);
        // A table whose corners are within 3 % of its length is the right table.
        const right = cornerError < 0.03;
        if (right) tableRight++;
        const found = grouped(alone.layout.balls).map((b) =>
          turned ? { ...b, x: widthM - b.x, y: lengthM - b.y } : b,
        );
        const a = scorePhoto(found, balls, lengthM, diameter);
        if (right) automatic.push(a);
        autoCells = `${right ? "yes" : "wrong"},${cornerError.toFixed(4)},${String(a.found)},${String(a.extra)},${String(a.named)}`;
      }
      const sorted = [...g.errors].sort((x, y) => x - y);
      csv.push(
        `${base},${table.id},${String(truth.matched)},${truth.residualPx.toFixed(2)},` +
          `${String(balls.length)},${String(g.found)},${String(g.extra)},${String(g.named)},` +
          `${quantile(sorted, 0.5).toFixed(4)},${autoCells}`,
      );
    }

    cornerErrors.sort((a, b) => a - b);
    const judged = given.length;
    const lines = [
      `Pictures: ${String(names.length)}; judged ${String(judged)}; ` +
        `no truth from the sights ${String(noTruth)}; not decoded ${String(noPixels)}.`,
      `Table sizes read from the ball sizes: ${[...tableCount]
        .map(([id, n]) => `${id} x ${String(n)}`)
        .join(", ")}.`,
      `Corners given: ${describeSummary(summarise(given))}.`,
      `Nothing given: a table was reported in ${String(tableFound)} of ${String(judged)} ` +
        `(${pct(tableFound / judged)}) and was the right one in ${String(tableRight)} ` +
        `(${pct(tableRight / judged)}); corner error of those reported, median ` +
        `${pct(quantile(cornerErrors, 0.5), 2)} and 95th percentile ` +
        `${pct(quantile(cornerErrors, 0.95), 2)} of the table length.`,
      `Nothing given, where the table was right: ${describeSummary(summarise(automatic))}.`,
    ];
    const report = lines.join("\n");
    const out = process.env.BAIZE_EVAL_REPORT;
    if (out) {
      writeFileSync(out, `${report}\n`);
      writeFileSync(`${out}.csv`, `${csv.join("\n")}\n`);
    }
    expect(judged).toBeGreaterThan(0);
  }, 7_200_000);
});

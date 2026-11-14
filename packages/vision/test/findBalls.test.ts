import { TABLE_PRESETS, getBallSet, rackLayout, racksFor, spotsFor } from "@baize/tables";
import type { BallKind, BallSetSpec, Layout, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { findBalls, findTable } from "../src/index";
import type { Camera, FoundBall } from "../src/index";
import { renderPhoto } from "./render";
import { cameraOf, seeded } from "./synthetic";

/**
 * The model-free ball finder on synthetic photos. The numbers asserted here are what it
 * achieves on clean rendered pictures; real photos will be harder, and the spec's targets
 * (95 % found, 90 % named) are for the trained detector of stage B.
 */

const WIDTH = 1600;
const HEIGHT = 1200;

function preset(id: string): { table: TableSpec; set: BallSetSpec } {
  const table = TABLE_PRESETS.find((t) => t.id === id);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error(`no preset ${id}`);
  return { table, set };
}

function standing(table: TableSpec, x = 0.08, y = -0.4, z = 0.62): Camera {
  const { widthM, lengthM } = table.playingArea;
  return cameraOf({
    position: { x: x * lengthM, y: y * lengthM, z: z * lengthM },
    target: { x: 0.5 * widthM, y: 0.47 * lengthM },
    rollRad: 0,
    focalPx: 1040,
    widthPx: WIDTH,
    heightPx: HEIGHT,
  });
}

interface Score {
  found: number;
  missed: number;
  extra: number;
  /** Position errors of the matched balls, as shares of the table length. */
  errors: number[];
  named: number;
}

/** Matches found balls to true ones (nearest first, within one ball diameter). */
function score(
  found: readonly FoundBall[],
  truth: Layout,
  table: TableSpec,
  set: BallSetSpec,
): Score {
  const L = table.playingArea.lengthM;
  const d = set.object.diameterM;
  const used = new Set<number>();
  const errors: number[] = [];
  let named = 0;
  const pairs: { t: number; f: number; dist: number }[] = [];
  truth.balls.forEach((t, ti) => {
    found.forEach((f, fi) => {
      const dist = Math.hypot(f.x - t.x, f.y - t.y);
      if (dist < d) pairs.push({ t: ti, f: fi, dist });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);
  const matched = new Set<number>();
  for (const p of pairs) {
    if (matched.has(p.t) || used.has(p.f)) continue;
    matched.add(p.t);
    used.add(p.f);
    errors.push(p.dist / L);
    if ((found[p.f] as FoundBall).kind === (truth.balls[p.t] as { kind: BallKind }).kind) named++;
  }
  return {
    found: matched.size,
    missed: truth.balls.length - matched.size,
    extra: found.length - used.size,
    errors: errors.sort((a, b) => a - b),
    named,
  };
}

function run(
  id: string,
  layout: Layout,
  cloth: string,
  cam?: Camera,
  look: { noise?: number; brightness?: number } = {},
): { result: Score; found: FoundBall[] } {
  const { table, set } = preset(id);
  const camera = cam ?? standing(table);
  const photo = renderPhoto(camera, table, set, layout, { cloth, ...look });
  const where = findTable(photo.image, table, 0);
  if (!where) throw new Error("table not found");
  const found = findBalls(photo.image, table, set, where.camera, 0);
  return { result: score(found, layout, table, set), found };
}

/** Balls spread over the table, none touching. */
function spread(table: TableSpec, kinds: readonly BallKind[], seed: number): Layout {
  const { widthM: W, lengthM: L } = table.playingArea;
  const rand = seeded(seed);
  const balls: Layout["balls"] = [];
  for (const kind of kinds) {
    for (let tries = 0; tries < 200; tries++) {
      const x = 0.08 * W + rand() * 0.84 * W;
      const y = 0.06 * L + rand() * 0.88 * L;
      if (balls.every((b) => Math.hypot(b.x - x, b.y - y) > 0.12)) {
        balls.push({ kind, x, y });
        break;
      }
    }
  }
  return { balls };
}

describe("findBalls on synthetic photos", () => {
  test("pool solids and the cue ball spread over a blue cloth: all found, placed and named", () => {
    const { table } = preset("pool-9@1");
    const layout = spread(table, ["cue", "1", "2", "3", "4", "5", "6", "7", "8"], 11);
    const { result } = run("pool-9@1", layout, "#1f4f8f");
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
    // Targets: median 0.6 % and 95th percentile 1.5 % of the table length.
    expect(result.errors[Math.floor(result.errors.length / 2)]).toBeLessThan(0.003);
    expect(result.errors[result.errors.length - 1]).toBeLessThan(0.008);
    expect(result.named).toBe(layout.balls.length);
  });

  test("an empty table has no balls on it", () => {
    const { result, found } = run("pool-9@1", { balls: [] }, "#1f6b3a");
    expect(found).toEqual([]);
    expect(result.extra).toBe(0);
  });

  test("snooker colours on their spots, with the cue ball, on a blue cloth", () => {
    const { table } = preset("snooker-12@1");
    const spot = (name: string) => {
      const s = spotsFor(table).find((p) => p.name === name);
      if (!s) throw new Error(name);
      return s;
    };
    const kinds: BallKind[] = ["yellow", "green", "brown", "blue", "pink", "black"];
    const layout: Layout = {
      balls: [
        ...kinds.map((kind) => ({ kind, x: spot(kind).x, y: spot(kind).y })),
        { kind: "cue", x: spot("brown").x + 0.3, y: spot("brown").y - 0.2 },
        { kind: "red", x: 0.5, y: 2.4 },
        { kind: "red", x: 1.2, y: 2.9 },
      ],
    };
    // A blue cloth, so that every colour differs from it (see the next test for green).
    const { result } = run("snooker-12@1", layout, "#2a7fa8");
    expect(result.missed).toBe(0);
    expect(result.extra).toBe(0);
    // Measured on 2026-11-13: the worst ball is 0.8 % of the table length out (2.8 cm on a
    // 12 ft table, where a far ball is about ten pixels across here). Inside the 1.5 %
    // target for the 95th percentile, but with little to spare.
    expect(result.errors[result.errors.length - 1]).toBeLessThan(0.012);
    expect(result.errors[Math.floor(result.errors.length / 2)]).toBeLessThan(0.004);
    // Blue on blue cloth is the cloth-coloured ball here; the rest must be named.
    expect(result.named).toBeGreaterThanOrEqual(layout.balls.length - 1);
  });

  test("known limit: a ball of the cloth's own colour is missed or doubted, not misplaced", () => {
    const { table } = preset("snooker-12@1");
    const layout: Layout = {
      balls: [
        { kind: "green", x: 0.6, y: 1.5 },
        { kind: "red", x: 1.1, y: 2.0 },
      ],
    };
    // Cloth exactly the green ball's colour.
    const { result, found } = run("snooker-12@1", layout, "#1c7c4a");
    expect(result.extra).toBe(0);
    const red = found.find((b) => b.kind === "red");
    expect(red && Math.hypot(red.x - 1.1, red.y - 2.0)).toBeLessThan(0.02);
    const green = found.find((b) => Math.hypot(b.x - 0.6, b.y - 1.5) < 0.05);
    // Either not found at all, or found with a confidence that marks it as uncertain.
    if (green) expect(green.confidence).toBeLessThan(0.6);
    void table;
  });

  test("a full pool rack: most balls are found although they hide each other", () => {
    const { table, set } = preset("pool-9@1");
    const kind = racksFor(table.game).find((r) => r === "pool-15") ?? racksFor(table.game)[0];
    if (!kind) throw new Error("no rack");
    const layout = rackLayout(table, set, kind);
    const { result } = run("pool-9@1", layout, "#1f6b3a");
    // Measured on 2026-11-14: 10 of 16 found (62 %). It was 12 of 16 before the finder
    // learned, from a real photo, not to count a ball's shadow as a second ball: a ball now
    // has to be justified by pixels that no ball already taken explains, and in a rack most
    // of a ball's pixels are its neighbours'. A rack is better put on the table with the
    // rack button than from a photo; this is a case for the trained detector.
    expect(result.found / layout.balls.length).toBeGreaterThanOrEqual(0.6);
    expect(result.extra).toBeLessThanOrEqual(2);
    expect(result.errors[Math.floor(result.errors.length / 2)]).toBeLessThan(0.004);
  });

  test("solids and stripes are told apart", () => {
    const { table } = preset("pool-9@1");
    const layout = spread(table, ["1", "9", "3", "11", "5", "13", "cue"], 5);
    const { result, found } = run("pool-9@1", layout, "#1f6b3a");
    expect(result.missed).toBe(0);
    const stripes = found.filter((b) => Number(b.kind) > 8).length;
    const solids = found.filter((b) => Number(b.kind) >= 1 && Number(b.kind) <= 8).length;
    expect(stripes).toBe(3);
    expect(solids).toBe(3);
    expect(found.filter((b) => b.kind === "cue")).toHaveLength(1);
  });

  test("balls against the cushions, near and far, are found on the table", () => {
    const { table, set } = preset("pool-9@1");
    const { widthM: W, lengthM: L } = table.playingArea;
    const r = set.object.diameterM / 2;
    const layout: Layout = {
      balls: [
        { kind: "1", x: W / 2, y: L - r - 0.001 },
        { kind: "2", x: r + 0.001, y: L * 0.6 },
        { kind: "3", x: W - r - 0.001, y: L * 0.3 },
        { kind: "4", x: W * 0.4, y: r + 0.001 },
        { kind: "cue", x: W / 2, y: L / 2 },
      ],
    };
    const { result } = run("pool-9@1", layout, "#1f6b3a");
    expect(result.missed).toBeLessThanOrEqual(1);
    expect(result.extra).toBe(0);
    expect(result.errors[result.errors.length - 1]).toBeLessThan(0.01);
  });

  test("noise and dim light: still found, with every confidence between 0 and 1", () => {
    const { table } = preset("pool-9@1");
    const layout = spread(table, ["cue", "1", "2", "3", "4", "5", "6", "7", "8"], 23);
    const { result, found } = run("pool-9@1", layout, "#1f6b3a", undefined, {
      noise: 8,
      brightness: 0.7,
    });
    expect(result.missed).toBeLessThanOrEqual(1);
    expect(result.extra).toBeLessThanOrEqual(1);
    for (const b of found) {
      expect(b.confidence).toBeGreaterThanOrEqual(0);
      expect(b.confidence).toBeLessThanOrEqual(1);
    }
  });

  test("never more balls of a kind than the set has; the same photo gives the same answer", () => {
    const { table, set } = preset("snooker-12@1");
    const layout = spread(table, ["red", "red", "red", "red", "black", "pink", "cue"], 9);
    const a = run("snooker-12@1", layout, "#2a7fa8").found;
    const b = run("snooker-12@1", layout, "#2a7fa8").found;
    expect(b).toEqual(a);
    for (const { kind, count } of set.kinds) {
      expect(a.filter((x) => x.kind === kind).length).toBeLessThanOrEqual(count);
    }
  });
});

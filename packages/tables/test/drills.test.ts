import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DRILL_TEMPLATES, drillFits, drillLayout, drillsFor } from "../src/drills";
import { ballSizeOf, noseContactDistanceM, sanitizeLayout } from "../src/layout";
import { spotsFor } from "../src/markings";
import { BALL_SETS, getBallSet } from "../src/presets/balls";
import { TABLE_PRESETS, getTablePreset } from "../src/presets/tables";
import { resolveCustomTable, validateTable } from "../src/validate";
import type { BallSetSpec, CustomTableFields, GameType, Layout, TableSpec } from "../src/types";

const GAMES: GameType[] = ["snooker", "pool", "blackball"];

function setOf(table: TableSpec): BallSetSpec {
  return getBallSet(table.defaultBallSetId) as BallSetSpec;
}

/** Asserts every invariant a returned drill layout must satisfy. */
function expectValid(layout: Layout, table: TableSpec, set: BallSetSpec): void {
  const { widthM, lengthM } = table.playingArea;
  expect(layout.balls.filter((b) => b.kind === "cue")).toHaveLength(1);
  for (const k of new Set(layout.balls.map((b) => b.kind))) {
    const have = set.kinds.find((x) => x.kind === k)?.count ?? 0;
    expect(layout.balls.filter((b) => b.kind === k).length).toBeLessThanOrEqual(have);
  }
  for (const [i, a] of layout.balls.entries()) {
    const ra = ballSizeOf(set, a.kind).diameterM / 2;
    const m = noseContactDistanceM(ra, table.cushion.noseHeightM) - 1e-9;
    expect(a.x).toBeGreaterThanOrEqual(m);
    expect(a.x).toBeLessThanOrEqual(widthM - m);
    expect(a.y).toBeGreaterThanOrEqual(m);
    expect(a.y).toBeLessThanOrEqual(lengthM - m);
    for (const b of layout.balls.slice(i + 1)) {
      const rb = ballSizeOf(set, b.kind).diameterM / 2;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(ra + rb + 0.001 - 1e-9);
    }
  }
  const s = sanitizeLayout(layout, table, set);
  expect(s.removed).toEqual([]);
  expect(s.moved).toEqual([]);
  expect(s.layout).toEqual(layout);
}

describe("drill templates", () => {
  it("have unique ids, names and descriptions", () => {
    const ids = DRILL_TEMPLATES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DRILL_TEMPLATES.length).toBeGreaterThanOrEqual(9);
    for (const d of DRILL_TEMPLATES) {
      expect(d.name.trim()).not.toBe("");
      expect(d.description.trim()).not.toBe("");
    }
  });

  it("drillsFor returns only that game's drills in order", () => {
    for (const g of GAMES) {
      const list = drillsFor(g);
      expect(list.length).toBeGreaterThan(0);
      expect(list).toEqual(DRILL_TEMPLATES.filter((d) => d.game === g));
    }
  });
});

describe("drills on every preset", () => {
  for (const table of TABLE_PRESETS) {
    for (const drill of drillsFor(table.game)) {
      it(`${drill.id} on ${table.id}`, () => {
        const set = setOf(table);
        const layout = drillLayout(table, set, drill.id);
        expect(drillFits(table, set, drill.id)).toBe(layout !== undefined);
        expect(layout, drill.id + " on " + table.id).toBeDefined();
        if (layout) expectValid(layout, table, set);
      });
    }
  }

  it("every drill fits on the full-size table of its game", () => {
    const fulls = ["snooker-12@1", "pool-9@1", "blackball-7@1"];
    for (const id of fulls) {
      const table = getTablePreset(id) as TableSpec;
      for (const drill of drillsFor(table.game)) {
        expect(drillFits(table, setOf(table), drill.id), `${drill.id} on ${id}`).toBe(true);
      }
    }
  });
});

describe("drills on custom tables", () => {
  const arb = fc
    .record({
      game: fc.constantFrom<GameType>(...GAMES),
      lengthM: fc.double({ min: 1.6, max: 3.8, noNaN: true }),
      ratio: fc.double({ min: 0.46, max: 0.54, noNaN: true }),
      ballDiameterM: fc.double({ min: 0.047, max: 0.062, noNaN: true }),
      cornerBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
      middleBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
    })
    .map((f) => {
      const fields: CustomTableFields = {
        game: f.game,
        lengthM: f.lengthM,
        widthM: f.lengthM * f.ratio,
        cornerMouthM: f.cornerBalls * f.ballDiameterM,
        middleMouthM: f.middleBalls * f.ballDiameterM,
      };
      if (validateTable(fields, f.ballDiameterM).some((i) => i.severity === "error"))
        return undefined;
      const base = BALL_SETS.find((s) => s.game === f.game) as BallSetSpec;
      const set: BallSetSpec = {
        ...base,
        object: { ...base.object, diameterM: f.ballDiameterM },
        cue: undefined,
      };
      if (!base.cue) delete set.cue;
      return { table: resolveCustomTable(fields, f.ballDiameterM), set };
    });

  it("never throws and returns only valid layouts", () => {
    fc.assert(
      fc.property(arb, (c) => {
        if (!c) return;
        for (const drill of drillsFor(c.table.game)) {
          const layout = drillLayout(c.table, c.set, drill.id);
          expect(drillFits(c.table, c.set, drill.id)).toBe(layout !== undefined);
          if (layout) expectValid(layout, c.table, c.set);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("drillLayout refusals", () => {
  const snooker = getTablePreset("snooker-12@1") as TableSpec;
  const pool = getTablePreset("pool-9@1") as TableSpec;

  it("returns undefined for an unknown id", () => {
    expect(drillLayout(snooker, setOf(snooker), "nope")).toBeUndefined();
  });

  it("returns undefined when the game does not match", () => {
    expect(drillLayout(pool, setOf(pool), "snooker-line-up")).toBeUndefined();
    expect(drillFits(pool, setOf(pool), "snooker-line-up")).toBe(false);
  });

  it("returns undefined when the ball set lacks balls", () => {
    const set = setOf(snooker);
    const few: BallSetSpec = {
      ...set,
      kinds: set.kinds.map((k) => (k.kind === "red" ? { ...k, count: 2 } : k)),
    };
    expect(drillLayout(snooker, few, "snooker-line-up")).toBeUndefined();
    const noCue: BallSetSpec = { ...set, kinds: set.kinds.filter((k) => k.kind !== "cue") };
    expect(drillLayout(snooker, noCue, "snooker-long-pot")).toBeUndefined();
  });
});

describe("snooker line-up geometry", () => {
  it("puts colours on their spots and reds on the centre line", () => {
    const table = getTablePreset("snooker-12@1") as TableSpec;
    const layout = drillLayout(table, setOf(table), "snooker-line-up") as Layout;
    for (const s of spotsFor(table)) {
      const ball = layout.balls.find((b) => b.kind === s.name);
      expect(ball?.x).toBe(s.x);
      expect(ball?.y).toBe(s.y);
    }
    const reds = layout.balls.filter((b) => b.kind === "red");
    expect(reds).toHaveLength(9);
    for (const r of reds) expect(r.x).toBe(table.playingArea.widthM / 2);
    // Three reds evenly between the pink and the black.
    const pink = spotsFor(table).find((s) => s.name === "pink")!;
    const black = spotsFor(table).find((s) => s.name === "black")!;
    const ys = reds.map((r) => r.y).filter((y) => y > pink.y && y < black.y);
    expect(ys).toHaveLength(3);
    expect(ys[0]).toBeCloseTo(pink.y + (black.y - pink.y) / 4, 12);
  });
});

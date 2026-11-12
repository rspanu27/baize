import { describe, expect, it } from "vitest";
import { ballSizeOf, noseContactDistanceM, sanitizeLayout, TOUCH_TOLERANCE_M } from "../src/layout";
import { spotsFor } from "../src/markings";
import { getBallSet } from "../src/presets/balls";
import fc from "fast-check";
import { rackFits, racksFor, rackLayout } from "../src/racks";
import { pocketDropCircles, resolveCustomTable } from "../src/validate";
import type { BallKind, BallSetSpec, GameType, RackKind, TableSpec } from "../src/types";

interface Case {
  name: string;
  table: TableSpec;
  set: BallSetSpec;
}

function make(
  game: GameType,
  lengthM: number,
  widthM: number,
  corner: number,
  middle: number,
  setId: string,
): Case {
  const set = getBallSet(setId) as BallSetSpec;
  const table = resolveCustomTable(
    { game, lengthM, widthM, cornerMouthM: corner, middleMouthM: middle },
    set.object.diameterM,
  );
  return { name: `${game} ${String(lengthM)}x${String(widthM)} ${setId}`, table, set };
}

const CASES: Case[] = [
  make("snooker", 3.569, 1.778, 0.09, 0.1, "snooker-52@1"),
  make("snooker", 1.83, 0.915, 0.08, 0.09, "snooker-48@1"),
  make("pool", 2.54, 1.27, 0.12, 0.13, "pool-57@1"),
  make("pool", 1.98, 0.99, 0.12, 0.13, "pool-57@1"),
  make("blackball", 1.829, 0.914, 0.09, 0.1, "blackball-51@1"),
];

const COUNTS: Record<RackKind, number> = {
  "snooker-15": 15,
  "snooker-10": 10,
  "snooker-6": 6,
  "pool-8ball": 15,
  "pool-9ball": 9,
  "pool-15": 15,
  blackball: 15,
};

function count(kinds: BallKind[], kind: BallKind): number {
  return kinds.filter((k) => k === kind).length;
}

describe("racksFor", () => {
  it("lists the racks of each game", () => {
    expect(racksFor("snooker")).toEqual(["snooker-15", "snooker-10", "snooker-6"]);
    expect(racksFor("pool")).toEqual(["pool-8ball", "pool-9ball", "pool-15"]);
    expect(racksFor("blackball")).toEqual(["blackball"]);
  });
});

describe.each(CASES)("racks on $name", ({ table, set }) => {
  const { widthM, lengthM } = table.playingArea;
  const spot = (n: string) => spotsFor(table).find((s) => s.name === n)!;
  const d = set.object.diameterM;

  describe.each(racksFor(table.game))("%s", (rack) => {
    const layout = rackLayout(table, set, rack);
    const balls = layout.balls;

    it("has the right balls, cue first", () => {
      expect(balls[0]?.kind).toBe("cue");
      expect(balls.length).toBe(COUNTS[rack] + 1 + (rack.startsWith("snooker") ? 6 : 0));
      const kinds = balls.map((b) => b.kind);
      for (const k of set.kinds) expect(count(kinds, k.kind)).toBeLessThanOrEqual(k.count);
      expect(balls.every((b) => b.confidence === undefined)).toBe(true);
    });

    it("keeps every ball inside the cushions without overlaps", () => {
      for (const b of balls) {
        const m = noseContactDistanceM(
          ballSizeOf(set, b.kind).diameterM / 2,
          table.cushion.noseHeightM,
        );
        expect(b.x).toBeGreaterThanOrEqual(m);
        expect(b.x).toBeLessThanOrEqual(widthM - m);
        expect(b.y).toBeGreaterThanOrEqual(m);
        expect(b.y).toBeLessThanOrEqual(lengthM - m);
      }
      for (let i = 0; i < balls.length; i++) {
        for (let j = i + 1; j < balls.length; j++) {
          const a = balls[i]!;
          const b = balls[j]!;
          const gap =
            Math.hypot(a.x - b.x, a.y - b.y) -
            (ballSizeOf(set, a.kind).diameterM + ballSizeOf(set, b.kind).diameterM) / 2;
          expect(gap).toBeGreaterThanOrEqual(-1e-12);
        }
      }
    });

    it("survives sanitising unchanged", () => {
      const r = sanitizeLayout(layout, table, set);
      expect(r.layout).toEqual(layout);
      expect(r.moved).toEqual([]);
      expect(r.removed).toEqual([]);
    });

    it("is deterministic", () => {
      expect(rackLayout(table, set, rack)).toEqual(layout);
    });

    it("has every non-apex object ball touching an earlier one", () => {
      const objects = balls.filter(
        (b) => b.kind !== "cue" && (table.game !== "snooker" || b.kind === "red"),
      );
      for (let i = 1; i < objects.length; i++) {
        const near = objects
          .slice(0, i)
          .some((p) => Math.abs(Math.hypot(p.x - objects[i]!.x, p.y - objects[i]!.y) - d) < 1e-12);
        expect(near).toBe(true);
      }
    });

    if (rack.startsWith("snooker")) {
      it("puts colours on their spots and the apex red just behind the pink", () => {
        for (const c of ["yellow", "green", "brown", "blue", "pink", "black"] as const) {
          const b = balls.find((x) => x.kind === c)!;
          expect(b.x).toBeCloseTo(spot(c).x, 12);
          expect(b.y).toBeCloseTo(spot(c).y, 12);
        }
        const reds = balls.filter((b) => b.kind === "red");
        const apex = reds[0]!;
        expect(apex.x).toBeCloseTo(spot("pink").x, 12);
        const gap = apex.y - spot("pink").y - d;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(0.002);
        for (const r of reds) expect(r.y).toBeGreaterThanOrEqual(apex.y);
        const cue = balls[0]!;
        expect(cue.y).toBeCloseTo(spot("brown").y, 12);
        expect(cue.x).toBeCloseTo((spot("brown").x + spot("yellow").x) / 2, 12);
      });
    }
  });

  if (table.game === "pool") {
    const rackOf = (rack: RackKind) => rackLayout(table, set, rack).balls;
    const at = (balls: ReturnType<typeof rackOf>, k: BallKind) => balls.find((b) => b.kind === k)!;
    it("8-ball: apex on foot spot, 8 in the middle of the third row, mixed back corners", () => {
      const balls = rackOf("pool-8ball");
      const foot = spot("foot");
      const rows = balls.slice(1);
      expect(rows[0]!.x).toBeCloseTo(foot.x, 12);
      expect(rows[0]!.y).toBeCloseTo(foot.y, 12);
      expect(rows[4]).toBe(at(balls, "8"));
      expect(at(balls, "8").x).toBeCloseTo(foot.x, 12);
      const corners = [rows[10]!.kind, rows[14]!.kind].map(Number);
      expect(corners.filter((n) => n < 8).length).toBe(1);
      expect(corners.filter((n) => n > 8).length).toBe(1);
      expect(rows[10]!.y).toBeCloseTo(rows[14]!.y, 12);
      expect(balls[0]!.x).toBeCloseTo(spot("head").x, 12);
      expect(balls[0]!.y).toBeCloseTo(spot("head").y, 12);
    });
    it("9-ball: 1 at the foot-spot apex, 9 in the centre", () => {
      const balls = rackOf("pool-9ball");
      const foot = spot("foot");
      expect(at(balls, "1").x).toBeCloseTo(foot.x, 12);
      expect(at(balls, "1").y).toBeCloseTo(foot.y, 12);
      const nine = at(balls, "9");
      expect(nine.x).toBeCloseTo(foot.x, 12);
      expect(nine.y).toBeCloseTo(foot.y + 2 * ((d * Math.sqrt(3)) / 2), 12);
    });
    it("15-ball: ascending row by row with 1 on the foot spot", () => {
      const balls = rackOf("pool-15");
      expect(balls.slice(1).map((b) => b.kind)).toEqual(
        Array.from({ length: 15 }, (_, i) => String(i + 1)),
      );
      expect(at(balls, "1").y).toBeCloseTo(spot("foot").y, 12);
    });
  }

  if (table.game === "blackball") {
    it("black on the black spot in the middle of the third row; 7 reds, 7 yellows", () => {
      const balls = rackLayout(table, set, "blackball").balls;
      const black = balls.find((b) => b.kind === "black")!;
      expect(black.x).toBeCloseTo(spot("black").x, 12);
      expect(black.y).toBeCloseTo(spot("black").y, 12);
      expect(balls.slice(1)[4]).toBe(black);
      const kinds = balls.map((b) => b.kind);
      expect(count(kinds, "red")).toBe(7);
      expect(count(kinds, "yellow")).toBe(7);
      expect(balls[0]!.x).toBeCloseTo(spot("baulk").x, 12);
      expect(balls[0]!.y).toBeCloseTo(spot("baulk").y, 12);
      const back = balls.slice(1).slice(10);
      expect(back[0]!.kind).not.toBe(back[4]!.kind);
    });
  }

  it("throws for a rack of another game", () => {
    const other = (["snooker", "pool", "blackball"] as const).find((g) => g !== table.game)!;
    expect(() => rackLayout(table, set, racksFor(other)[0]!)).toThrow(/for/);
  });
});

describe("rackLayout ball set check", () => {
  it("throws when the set lacks kinds", () => {
    const c = CASES[0]!;
    const poor: BallSetSpec = { ...c.set, kinds: c.set.kinds.filter((k) => k.kind !== "pink") };
    expect(() => rackLayout(c.table, poor, "snooker-15")).toThrow(/pink/);
  });
  it("exposes the touch tolerance", () => {
    expect(TOUCH_TOLERANCE_M).toBe(2e-5);
  });
});

describe("racks that do not fit", () => {
  const snooker52 = getBallSet("snooker-52@1") as BallSetSpec;
  const small = (lengthM: number): TableSpec =>
    resolveCustomTable(
      { game: "snooker", lengthM, widthM: lengthM / 2, cornerMouthM: 0.086, middleMouthM: 0.1 },
      snooker52.object.diameterM,
    );

  it("a full snooker pack on a very short table is refused with a plain message", () => {
    for (const lengthM of [1.0, 1.6]) {
      const table = small(lengthM);
      expect(rackFits(table, snooker52, "snooker-15")).toBe(false);
      expect(() => rackLayout(table, snooker52, "snooker-15")).toThrow(/does not fit/);
    }
  });

  it("rackFits is true exactly when rackLayout succeeds, and false for another game's rack", () => {
    const full = small(3.569);
    expect(rackFits(full, snooker52, "snooker-15")).toBe(true);
    expect(rackFits(full, snooker52, "pool-9ball")).toBe(false);
  });

  it("every rack that fits on a random valid table is clean", () => {
    const games: [GameType, string, number][] = [
      ["snooker", "snooker-52@1", 0.0525],
      ["pool", "pool-57@1", 0.05715],
      ["blackball", "blackball-51@1", 0.0508],
    ];
    fc.assert(
      fc.property(
        fc.constantFrom(...games),
        fc.double({ min: 1.2, max: 4.2, noNaN: true }),
        fc.double({ min: 0.47, max: 0.53, noNaN: true }),
        ([game, setId, ball], lengthM, ratio) => {
          const set = getBallSet(setId) as BallSetSpec;
          let table: TableSpec;
          try {
            table = resolveCustomTable(
              {
                game,
                lengthM,
                widthM: lengthM * ratio,
                cornerMouthM: 1.8 * ball,
                middleMouthM: 2 * ball,
              },
              ball,
            );
          } catch {
            return;
          }
          const circles = pocketDropCircles(table);
          for (const rack of racksFor(game)) {
            if (!rackFits(table, set, rack)) {
              expect(() => rackLayout(table, set, rack)).toThrow();
              continue;
            }
            const balls = rackLayout(table, set, rack).balls.map((b) => ({
              ...b,
              r: ballSizeOf(set, b.kind).diameterM / 2,
            }));
            for (let i = 0; i < balls.length; i++) {
              const a = balls[i] as (typeof balls)[number];
              for (const c of circles) {
                expect(Math.hypot(a.x - c.x, a.y - c.y)).toBeGreaterThanOrEqual(c.radiusM);
              }
              for (let j = i + 1; j < balls.length; j++) {
                const b = balls[j] as (typeof balls)[number];
                expect(Math.hypot(a.x - b.x, a.y - b.y) - a.r - b.r).toBeGreaterThan(-1e-9);
              }
            }
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

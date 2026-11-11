import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { markingsFor, spotsFor } from "../src/markings";
import type { GameType, Marking, PocketSpec, TableSpec } from "../src/types";

const pocket: PocketSpec = {
  mouthM: 0.1,
  jawRadiusM: 0,
  facingAngleRad: Math.PI / 2,
  dropRadiusM: 0.05,
  dropSetbackM: 0.01,
};

function table(game: GameType, lengthM: number, widthM: number): TableSpec {
  return {
    id: "test",
    name: "test",
    game,
    playingArea: { lengthM, widthM },
    pockets: { corner: pocket, middle: pocket },
    cushion: { noseHeightM: 0.036, restitution: 0.8, friction: 0.2 },
    defaultBallSetId: "test",
  };
}

const MM = 0.001;
const snooker12 = table("snooker", 3.569, 1.778);

function spot(t: TableSpec, name: string) {
  const s = spotsFor(t).find((x) => x.name === name);
  if (!s) throw new Error(`no spot ${name}`);
  return s;
}

describe("snooker 12 ft", () => {
  const cx = 1.778 / 2;

  test("spots sit at the WPBSA distances", () => {
    expect(spot(snooker12, "brown").y).toBeCloseTo(0.737, 3);
    expect(spot(snooker12, "black").y).toBeCloseTo(3.569 - 0.324, 3);
    expect(spot(snooker12, "blue").y).toBeCloseTo(3.569 / 2, 6);
    for (const n of ["black", "pink", "blue", "brown"]) {
      expect(spot(snooker12, n).x).toBeCloseTo(cx, 9);
    }
  });

  test("pink is exactly midway between blue and the top cushion", () => {
    expect(spot(snooker12, "pink").y).toBeCloseTo((spot(snooker12, "blue").y + 3.569) / 2, 12);
  });

  test("green is on the left (smaller x) and yellow on the right, 292 mm from brown", () => {
    const brown = spot(snooker12, "brown");
    const green = spot(snooker12, "green");
    const yellow = spot(snooker12, "yellow");
    expect(green.y).toBeCloseTo(brown.y, 9);
    expect(yellow.y).toBeCloseTo(brown.y, 9);
    expect(brown.x - green.x).toBeCloseTo(0.292, 3);
    expect(yellow.x - brown.x).toBeCloseTo(0.292, 3);
    expect(green.x).toBeLessThan(yellow.x);
  });

  test("baulk line and D markings", () => {
    const ms = markingsFor(snooker12);
    const line = ms.find((m) => m.kind === "line");
    expect(line).toMatchObject({ from: { x: 0 }, to: { x: 1.778 } });
    const arc = ms.find((m): m is Extract<Marking, { kind: "arc" }> => m.kind === "arc");
    if (!arc) throw new Error("no arc");
    const at = (a: number) => ({
      x: arc.centre.x + arc.radiusM * Math.cos(a),
      y: arc.centre.y + arc.radiusM * Math.sin(a),
    });
    const brown = spot(snooker12, "brown");
    const green = spot(snooker12, "green");
    const yellow = spot(snooker12, "yellow");
    expect(arc.centre.x).toBeCloseTo(brown.x, 9);
    expect(arc.centre.y).toBeCloseTo(brown.y, 9);
    expect(arc.radiusM).toBeCloseTo(0.292, 3);
    expect(at(arc.startRad).x).toBeCloseTo(green.x, 9);
    expect(at(arc.startRad).y).toBeCloseTo(green.y, 9);
    expect(at(arc.endRad).x).toBeCloseTo(yellow.x, 9);
    expect(at(arc.endRad).y).toBeCloseTo(yellow.y, 9);
    const mid = at((arc.startRad + arc.endRad) / 2);
    expect(mid.x).toBeCloseTo(brown.x, 9);
    expect(brown.y - mid.y).toBeCloseTo(0.292, 3); // on the baulk side
    expect(mid.y).toBeGreaterThan(0);
    expect(ms.filter((m) => m.kind === "spot").map((m) => m.name)).toEqual([
      "black",
      "pink",
      "blue",
      "brown",
      "green",
      "yellow",
    ]);
  });

  test("distances scale with table length", () => {
    const half = table("snooker", 3.569 / 2, 1.778 / 2);
    for (const name of ["black", "pink", "blue", "brown", "green", "yellow"]) {
      const full = spot(snooker12, name);
      const s = spot(half, name);
      expect(s.x).toBeCloseTo(full.x / 2, 9);
      expect(s.y).toBeCloseTo(full.y / 2, 9);
    }
    const arc = markingsFor(half).find((m) => m.kind === "arc");
    expect(arc).toMatchObject({ radiusM: expect.closeTo(0.146, 6) });
  });
});

describe("pool 9 ft", () => {
  const t = table("pool", 2.54, 1.27);
  const sights = markingsFor(t).filter((m) => m.kind === "sight");

  test("head string and spots", () => {
    const line = markingsFor(t).find((m) => m.kind === "line");
    expect(line).toMatchObject({ name: "head-string", from: { y: 0.635 }, to: { y: 0.635 } });
    expect(markingsFor(t).filter((m) => m.kind === "line")).toHaveLength(1);
    expect(spot(t, "foot").x).toBeCloseTo(0.635, 9);
    expect(spot(t, "foot").y).toBeCloseTo(1.905, 9);
    expect(spot(t, "head").y).toBeCloseTo(0.635, 9);
    expect(spot(t, "centre")).toEqual({ name: "centre", x: 0.635, y: 1.27 });
  });

  test("18 sights, none at a pocket, symmetric", () => {
    expect(sights).toHaveLength(18);
    const pockets = [
      [0, 0],
      [1.27, 0],
      [0, 2.54],
      [1.27, 2.54],
      [0, 1.27],
      [1.27, 1.27],
    ];
    for (const s of sights) {
      for (const [px, py] of pockets) {
        expect(Math.hypot(s.at.x - px!, s.at.y - py!)).toBeGreaterThan(MM);
      }
      // On the nose line.
      expect([0, 1.27].includes(s.at.x) || [0, 2.54].includes(s.at.y)).toBe(true);
      const has = (x: number, y: number) =>
        sights.some((o) => Math.abs(o.at.x - x) < 1e-9 && Math.abs(o.at.y - y) < 1e-9);
      expect(has(1.27 - s.at.x, s.at.y)).toBe(true);
      expect(has(s.at.x, 2.54 - s.at.y)).toBe(true);
    }
    expect(sights.filter((s) => s.at.x === 0)).toHaveLength(6);
    expect(sights.filter((s) => s.at.y === 0)).toHaveLength(3);
  });
});

describe("blackball 6 ft", () => {
  const t = table("blackball", 1.829, 0.914);
  test("baulk line at 1/5 and black spot at 3/4 of the length", () => {
    const line = markingsFor(t).find((m) => m.kind === "line");
    expect(line).toMatchObject({ from: { x: 0, y: expect.closeTo(1.829 / 5, 9) } });
    expect(spot(t, "baulk").y).toBeCloseTo(1.829 / 5, 9);
    expect(spot(t, "baulk").x).toBeCloseTo(0.457, 9);
    expect(spot(t, "black").x).toBeCloseTo(0.457, 9);
    expect(spot(t, "black").y).toBeCloseTo(0.75 * 1.829, 9);
    expect(markingsFor(t).some((m) => m.kind === "arc")).toBe(false);
    expect(markingsFor(t).some((m) => m.kind === "spot" && m.name === "black")).toBe(true);
  });
});

describe("any valid size", () => {
  const games: GameType[] = ["snooker", "pool", "blackball"];
  const sizes = fc.record({
    lengthM: fc.double({ min: 1, max: 4, noNaN: true }),
    ratio: fc.double({ min: 0.4, max: 0.6, noNaN: true }),
  });

  test("spots strictly inside, deterministic, unique names", () => {
    fc.assert(
      fc.property(fc.constantFrom(...games), sizes, (game, { lengthM, ratio }) => {
        const t = table(game, lengthM, lengthM * ratio);
        const spots = spotsFor(t);
        for (const s of spots) {
          expect(s.x).toBeGreaterThan(0);
          expect(s.x).toBeLessThan(t.playingArea.widthM);
          expect(s.y).toBeGreaterThan(0);
          expect(s.y).toBeLessThan(lengthM);
        }
        expect(spotsFor(t)).toEqual(spots);
        expect(markingsFor(t)).toEqual(markingsFor(t));
        const names = markingsFor(t).map((m) => m.name);
        expect(new Set(names).size).toBe(names.length);
        expect(new Set(spots.map((s) => s.name)).size).toBe(spots.length);
      }),
    );
  });
});

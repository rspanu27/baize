import { describe, expect, test } from "vitest";
import { BALL_SETS, getBallSet } from "../src/presets/balls";

const total = (id: string): number =>
  (getBallSet(id)?.kinds ?? []).reduce((n, k) => n + k.count, 0);

describe("ball sets", () => {
  test("ids are unique and carry a revision suffix", () => {
    const ids = BALL_SETS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/@\d+$/);
  });

  test.each(BALL_SETS.map((b) => [b.id, b] as const))("%s has sane values", (_id, set) => {
    for (const size of [set.object, ...(set.cue ? [set.cue] : [])]) {
      expect(Number.isFinite(size.diameterM) && size.diameterM > 0).toBe(true);
      expect(Number.isFinite(size.massKg) && size.massKg > 0).toBe(true);
      expect(size.diameterM).toBeLessThan(0.1);
      expect(size.massKg).toBeLessThan(0.5);
    }
    expect(set.restitution).toBeGreaterThan(0);
    expect(set.restitution).toBeLessThanOrEqual(1);
    expect(set.kinds.length).toBeGreaterThan(0);
    for (const k of set.kinds) expect(k.count).toBeGreaterThan(0);
    const kinds = set.kinds.map((k) => k.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(getBallSet(set.id)).toBe(set);
  });

  test("getBallSet returns undefined for unknown ids", () => {
    expect(getBallSet("nope@1")).toBeUndefined();
  });

  test("required ids exist", () => {
    for (const id of [
      "snooker-52@1",
      "snooker-51@1",
      "snooker-48@1",
      "pool-57@1",
      "blackball-51@1",
    ]) {
      expect(getBallSet(id)).toBeDefined();
    }
  });

  test("ball counts", () => {
    expect(total("snooker-52@1")).toBe(22);
    expect(total("snooker-51@1")).toBe(22);
    expect(total("snooker-48@1")).toBe(22);
    expect(total("pool-57@1")).toBe(16);
    expect(total("blackball-51@1")).toBe(16);
    expect(getBallSet("snooker-52@1")?.kinds.find((k) => k.kind === "red")?.count).toBe(15);
    expect(getBallSet("blackball-51@1")?.kinds.find((k) => k.kind === "red")?.count).toBe(7);
  });

  test("games match", () => {
    expect(getBallSet("snooker-52@1")?.game).toBe("snooker");
    expect(getBallSet("pool-57@1")?.game).toBe("pool");
    expect(getBallSet("blackball-51@1")?.game).toBe("blackball");
  });

  test("blackball has a smaller, lighter cue ball", () => {
    const s = getBallSet("blackball-51@1");
    expect(s?.cue).toBeDefined();
    expect(s!.cue!.diameterM).toBeLessThan(s!.object.diameterM);
    expect(s!.cue!.massKg).toBeLessThan(s!.object.massKg);
  });

  test("pool mass is inside the WPA range and diameter is 57.15 mm", () => {
    const s = getBallSet("pool-57@1")!;
    expect(s.object.diameterM).toBeCloseTo(0.05715, 6);
    expect(s.object.massKg).toBeGreaterThanOrEqual(0.156);
    expect(s.object.massKg).toBeLessThanOrEqual(0.17);
  });

  test("snooker sizes are ordered", () => {
    const d = (id: string): number => getBallSet(id)!.object.diameterM;
    expect(d("snooker-48@1")).toBeLessThan(d("snooker-51@1"));
    expect(d("snooker-51@1")).toBeLessThan(d("snooker-52@1"));
  });
});

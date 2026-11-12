import { describe, expect, it } from "vitest";
import { spotsFor } from "../src/markings";
import { getBallSet } from "../src/presets/balls";
import { PRESET_BALL_DIAMETER_M, TABLE_PRESETS, getTablePreset } from "../src/presets/tables";
import { rackFits, racksFor } from "../src/racks";
import type { BallSetSpec } from "../src/types";

function allFinite(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (value && typeof value === "object") return Object.values(value).every(allFinite);
  return true;
}

describe("table presets", () => {
  it("has the eleven agreed presets with unique, revisioned ids", () => {
    expect(TABLE_PRESETS.map((t) => t.id)).toEqual([
      "snooker-12@1",
      "snooker-10@1",
      "snooker-6@1",
      "pool-9@1",
      "pool-8-pro@1",
      "pool-8@1",
      "pool-7@1",
      "pool-7-valley@1",
      "blackball-7@1",
      "blackball-6@1",
      "chinese8-9@1",
    ]);
    for (const t of TABLE_PRESETS) {
      expect(t.id).toMatch(/^[a-z0-9-]+@\d+$/);
      expect(getTablePreset(t.id)).toBe(t);
      expect(allFinite(t)).toBe(true);
    }
    expect(getTablePreset("nope")).toBeUndefined();
  });

  it("uses the signed-off playing areas", () => {
    const area = (id: string) => getTablePreset(id)?.playingArea;
    expect(area("snooker-12@1")).toEqual({ lengthM: 3.569, widthM: 1.778 });
    expect(area("snooker-10@1")).toEqual({ lengthM: 2.946, widthM: 1.473 });
    expect(area("snooker-6@1")).toEqual({ lengthM: 1.74, widthM: 0.864 });
    expect(area("pool-9@1")?.lengthM).toBeCloseTo(2.54, 12);
    expect(area("pool-9@1")?.widthM).toBeCloseTo(1.27, 12);
    expect(area("pool-8-pro@1")?.lengthM).toBeCloseTo(2.3368, 12);
    expect(area("pool-8@1")?.lengthM).toBeCloseTo(2.2352, 12);
    expect(area("pool-7@1")?.lengthM).toBeCloseTo(1.9812, 12);
    expect(area("pool-7-valley@1")?.lengthM).toBeCloseTo(1.8796, 12);
    // Supplied by the project owner.
    expect(area("blackball-7@1")).toEqual({ lengthM: 1.83, widthM: 0.91 });
    expect(area("blackball-6@1")).toEqual({ lengthM: 1.68, widthM: 0.84 });
    expect(area("chinese8-9@1")).toEqual({ lengthM: 2.54, widthM: 1.27 });
  });

  it("every preset is about twice as long as wide and has pockets wider than its ball", () => {
    for (const t of TABLE_PRESETS) {
      const ball = PRESET_BALL_DIAMETER_M[t.id] as number;
      const ratio = t.playingArea.lengthM / t.playingArea.widthM;
      expect(ratio).toBeGreaterThan(1.95);
      expect(ratio).toBeLessThan(2.05);
      expect(t.pockets.corner.mouthM).toBeGreaterThan(1.4 * ball);
      expect(t.pockets.middle.mouthM).toBeGreaterThanOrEqual(t.pockets.corner.mouthM);
      expect(t.cushion.noseHeightM).toBeCloseTo(0.635 * ball, 12);
    }
  });

  it("the default ball set of each preset exists, matches its ball size, and every rack fits", () => {
    for (const t of TABLE_PRESETS) {
      const set = getBallSet(t.defaultBallSetId) as BallSetSpec;
      expect(set).toBeDefined();
      expect(set.game).toBe(t.game);
      expect(set.object.diameterM).toBeCloseTo(PRESET_BALL_DIAMETER_M[t.id] as number, 9);
      for (const rack of racksFor(t.game)) {
        expect([t.id, rack, rackFits(t, set, rack)]).toEqual([t.id, rack, true]);
      }
      for (const s of spotsFor(t)) {
        expect(s.x).toBeGreaterThan(0);
        expect(s.x).toBeLessThan(t.playingArea.widthM);
        expect(s.y).toBeGreaterThan(0);
        expect(s.y).toBeLessThan(t.playingArea.lengthM);
      }
    }
  });

  it("Chinese 8-ball has pool markings with rounded jaws; pool tables have near-sharp points", () => {
    const chinese = getTablePreset("chinese8-9@1");
    const pool = getTablePreset("pool-9@1");
    expect(chinese?.game).toBe("pool");
    expect(chinese?.pockets.corner.jawRadiusM).toBeGreaterThan(0.03);
    expect(pool?.pockets.corner.jawRadiusM).toBeLessThan(0.005);
  });
});

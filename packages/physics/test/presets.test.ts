import { PRESET_BALL_DIAMETER_M, TABLE_PRESETS, getBallSet, racksFor } from "@baize/tables";
import type { BallSetSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { buildTableGeometry, simulate } from "../src/index";
import type { SimInput } from "../src/index";
import { FAST, MEDIUM, SLOW, checkInvariants, eventsOf, rackInput } from "./helpers";

/**
 * Every table preset, end to end: geometry builds, every rack of the game can be broken with
 * all engine invariants intact, the result is deterministic, and the break is fast.
 */
describe.each(TABLE_PRESETS.map((t) => [t.id, t] as const))("preset %s", (_id, table) => {
  const set = getBallSet(table.defaultBallSetId) as BallSetSpec;

  test("geometry builds and matches the playing area", () => {
    const g = buildTableGeometry(table);
    expect(g.widthM).toBe(table.playingArea.widthM);
    expect(g.lengthM).toBe(table.playingArea.lengthM);
    expect(g.pockets).toHaveLength(6);
    expect(g.arcs).toHaveLength(12);
    expect(set.object.diameterM).toBeCloseTo(PRESET_BALL_DIAMETER_M[table.id] as number, 9);
  });

  test.each(racksFor(table.game))("breaking a %s rack keeps every invariant", (rack) => {
    for (const [cloth, speed, side] of [
      [MEDIUM, 6, 0.1],
      [FAST, 9, -0.2],
      [SLOW, 2.5, 0],
    ] as const) {
      const base = rackInput(table, set, rack, cloth);
      const cue = base.balls[0];
      const target = base.balls[base.balls.length > 12 ? 8 : 1];
      expect(cue).toBeDefined();
      expect(target).toBeDefined();
      if (!cue || !target) return;
      const input: SimInput = {
        ...base,
        shot: {
          ballId: cue.id,
          aimAngleRad: Math.atan2(target.y - cue.y, target.x - cue.x) + 0.004,
          speedMps: speed,
          tipOffset: { side, vertical: 0.1 },
        },
      };
      const start = performance.now();
      const r = simulate(input);
      const elapsed = performance.now() - start;
      expect(r.status).toBe("complete");
      expect(eventsOf(r, "ball-ball").length).toBeGreaterThan(0);
      expect(r.stats.eventCount).toBeLessThan(3000);
      expect(elapsed).toBeLessThan(250);
      expect(simulate(input)).toEqual(r);
      checkInvariants(r, input);
    }
  });
});

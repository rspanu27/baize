import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { GEOMETRIC_WINDOW_SCALE } from "../src/position";
import { makeContext, potCandidates, potPairs } from "../src/shots";
import { MEDIUM, TABLES, ball, must, runnerFor } from "./helpers";

/** Deterministic pseudo-random numbers for test layouts (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The geometric estimate's window against the simulator's, on random two-ball pots. Pins the
 * measurement behind GEOMETRIC_WINDOW_SCALE (measured 2026-11-19: medians 2.20 on blackball
 * 6 ft, 1.94 on snooker 12 ft, 1.49 on a custom pool table).
 */
describe("geometric window against the simulator", () => {
  test.each(TABLES.map((t) => [t.id === "custom" ? t.name : t.id, t] as const))(
    "on %s the scale is within the measured range",
    (_name, table) => {
      const level = must(getPlayerLevel("club"), "club");
      const W = table.playingArea.widthM;
      const L = table.playingArea.lengthM;
      const rand = lcg(7);
      const kind = table.game === "snooker" ? "red" : "3";
      const ratios: number[] = [];
      for (let k = 0; k < 40; k++) {
        const balls = [
          ball(table, "cue", "cue", W * (0.1 + 0.8 * rand()), L * (0.1 + 0.8 * rand())),
          ball(table, "a", kind, W * (0.1 + 0.8 * rand()), L * (0.1 + 0.8 * rand())),
        ];
        const state = { game: "straight" as const };
        const ctx = makeContext({
          table,
          balls,
          cueBallId: "cue",
          state,
          level,
          cloth: MEDIUM,
          run: runnerFor(table),
        });
        const pos = { balls, cueBallId: "cue", state };
        const pairs = potPairs(ctx, pos);
        const one = {
          maxPairs: 6,
          speedFactors: [1.8],
          verticals: [0],
          sides: [],
          sideVerticals: [],
          maxSpeedMps: 8,
        };
        for (const c of potCandidates(ctx, pos, one)) {
          const p = must(
            pairs.find((q) => q.pocket.id === c.pocketId),
            "pair",
          );
          ratios.push(c.halfWindowRad / p.estimate.aimHalfWindowRad);
        }
      }
      ratios.sort((a, b) => a - b);
      const median = must(ratios[Math.floor((ratios.length - 1) / 2)], "median");
      expect(ratios.length).toBeGreaterThan(40);
      // The scale stands for every table: within 30 % of each table's own median.
      expect(GEOMETRIC_WINDOW_SCALE / median).toBeGreaterThan(0.7);
      expect(GEOMETRIC_WINDOW_SCALE / median).toBeLessThan(1.3);
    },
  );
});

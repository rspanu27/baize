import { describe, expect, test } from "vitest";
import { kineticEnergy, sampleAt, simulate } from "../src/index";
import type { SimInput } from "../src/index";
import { POOL_9, checkInvariants, eventsOf } from "./helpers";

/**
 * Scenes that once broke an invariant, kept so that they cannot break again. Each was found
 * by the random property tests; the seed is noted so that the original run can be replayed
 * with BAIZE_PROPERTY_SEED.
 */
describe("regressions", () => {
  test("a slow ball touching a ball that is spinning on the spot does not wind its spin back up", () => {
    // Found with seed -1565606891. Three balls frozen in a line against the side cushion,
    // struck along the line with maximum side. Late in the shot the middle ball rolls back
    // at 8 mm/s into the cue ball, which by then has been spinning on the spot for 0.15 s.
    // The slow-contact solver read the cue ball's spin at the start of its spinning segment
    // instead of at the present time, so its spin (and the total energy) jumped back up.
    const input: SimInput = {
      table: POOL_9,
      cloth: {
        slidingFriction: 0.29999999999999916,
        rollingResistance: 0.007726659230571092,
        spinningFriction: 0.014564375476146918,
      },
      balls: [
        {
          id: "b0",
          radiusM: 0.028575,
          massKg: 0.163,
          x: 0.02761373370586951,
          y: 0.14632760781586207,
        },
        {
          id: "b1",
          radiusM: 0.028575,
          massKg: 0.163,
          x: 0.08476373370586951,
          y: 0.14632760781586207,
        },
        {
          id: "b2",
          radiusM: 0.028575,
          massKg: 0.163,
          x: 0.14191373370586952,
          y: 0.14632760781586207,
        },
      ],
      ballRestitution: 0.8000000000000007,
      shot: {
        ballId: "b0",
        aimAngleRad: 7.4e-323,
        speedMps: 1.8107099404323954,
        tipOffset: { side: 0.4999999999999995, vertical: 2.160622591386428e-176 },
      },
    };
    const result = simulate(input);
    expect(result.status).toBe("complete");
    checkInvariants(result, input);

    // The contact in question: the last ball-ball event, with the cue ball spinning.
    const last = eventsOf(result, "ball-ball").at(-1);
    if (!last) throw new Error("expected a ball-ball contact");
    const before = sampleAt(result, last.t - 1e-9).find((b) => b.id === "b0");
    const after = sampleAt(result, last.t + 1e-9).find((b) => b.id === "b0");
    if (!before || !after) throw new Error("missing cue ball");
    expect(before.state).toBe("spinning");
    expect(Math.abs(after.spin.z)).toBeLessThanOrEqual(Math.abs(before.spin.z));
    expect(kineticEnergy(result, last.t + 1e-9)).toBeLessThanOrEqual(
      kineticEnergy(result, last.t - 1e-9),
    );
  });
});

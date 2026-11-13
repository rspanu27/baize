import { describe, expect, test } from "vitest";
import { BALL_BALL_FRICTION } from "@baize/tables";
import {
  cushionContactDistance,
  frictionalBallBall,
  kineticEnergy,
  mathavanCushion,
  sampleAt,
  simulate,
} from "../src/index";
import type { SimInput } from "../src/index";
import { BLACKBALL_6, POOL_9, checkInvariants, eventsOf } from "./helpers";

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

  test("a spinning ball squeezed between a rail and another ball does not creep into the rail", () => {
    // Found with seed 2004746535 (the napped-cloth property; the nap plays no part). Five
    // balls frozen in a line, the first 0.1 mm off the left rail, struck hard along the line.
    // The cue ball comes back to the rail with no speed left but plenty of top spin, so cloth
    // friction pushes it into the rail while the next ball keeps touching it. Every time the
    // slow-contact solver or a release gave it a new segment, the rail's hold was forgotten
    // and the ball sank another 0.1 micrometres before the rail was noticed again: over a
    // micrometre in a tenth of a second. The slow-contact solver now treats a rail that a
    // ball touches as a fixed contact, and a ball resting on a rail is held from the start of
    // every new segment.
    const y = 0.23278318092093614;
    const xs = [
      0.02455665218299512, 0.07535665218299512, 0.1261566521829951, 0.1769566521829951,
      0.22775665218299512,
    ];
    const input: SimInput = {
      table: BLACKBALL_6,
      cloth: {
        slidingFriction: 0.17085656009361513,
        rollingResistance: 0.008823133601671274,
        spinningFriction: 0.006715784967957485,
      },
      balls: xs.map((x, i) => ({
        id: `b${i}`,
        radiusM: 0.0254,
        massKg: 0.11448010973936898,
        x,
        y,
      })),
      ballRestitution: 0.9999999999999992,
      shot: {
        ballId: "b0",
        aimAngleRad: 5.794789024208769e-204,
        speedMps: 8.999999999999973,
        tipOffset: { side: 1.266818018105203e-162, vertical: 0 },
      },
      models: { ballBall: frictionalBallBall(BALL_BALL_FRICTION), cushion: mathavanCushion },
    };
    const result = simulate(input);
    expect(result.status).toBe("complete");
    checkInvariants(result, input);

    // A slow touch on a rail is only noticed 0.1 micrometres past the line, so allow that
    // much; before the fix the ball was over a micrometre past it and still sinking.
    const line = cushionContactDistance(0.0254, BLACKBALL_6.cushion.noseHeightM);
    const cue = result.tracks[0];
    if (!cue) throw new Error("missing cue ball");
    for (const s of cue.segments) expect(s.r0.x).toBeGreaterThan(line - 1.5e-7);
  });
});

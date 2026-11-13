import { BALL_BALL_FRICTION, cueEndMassKg, resolveCustomTable, validateTable } from "@baize/tables";
import type { CustomTableFields, TableSpec } from "@baize/tables";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import {
  buildTableGeometry,
  cushionContactDistance,
  frictionalBallBall,
  mathavanCushion,
  sampleAt,
  simulate,
} from "../src/index";
import type { BallInput, ClothInput, ShotInput, SimInput } from "../src/index";
import { BLACKBALL_6, POOL_9, SNOOKER_12, checkInvariants, eventsOf } from "./helpers";

/**
 * Property tests (SPEC 5.7 and 5.8): for random tables, cloths, layouts and shots the
 * simulator terminates, is deterministic, never gains energy, never lets balls overlap or
 * leave the table, and conserves momentum in ball-ball collisions.
 */

// Raise for a soak run: BAIZE_PROPERTY_RUNS=20000 pnpm --filter @baize/physics test
const RUNS = Number(process.env.BAIZE_PROPERTY_RUNS ?? 400);
// In a soak run, report the first failure as found instead of spending minutes shrinking it.
const SOAK = process.env.BAIZE_PROPERTY_RUNS !== undefined;
// To replay a failure, pass the seed that fast-check reported: BAIZE_PROPERTY_SEED=-1565606891
const SEED =
  process.env.BAIZE_PROPERTY_SEED === undefined
    ? {}
    : { seed: Number(process.env.BAIZE_PROPERTY_SEED) };

interface Scene {
  input: SimInput;
}

const customTable = fc
  .record({
    game: fc.constantFrom("snooker", "pool", "blackball"),
    lengthM: fc.double({ min: 1.6, max: 3.8, noNaN: true }),
    ratio: fc.double({ min: 0.46, max: 0.54, noNaN: true }),
    ballDiameterM: fc.double({ min: 0.047, max: 0.062, noNaN: true }),
    cornerBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
    middleBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
    jawStyle: fc.constantFrom("angled", "rounded"),
  })
  .map((f): { table: TableSpec; diameterM: number } | undefined => {
    const fields: CustomTableFields = {
      game: f.game as CustomTableFields["game"],
      lengthM: f.lengthM,
      widthM: f.lengthM * f.ratio,
      cornerMouthM: f.cornerBalls * f.ballDiameterM,
      middleMouthM: f.middleBalls * f.ballDiameterM,
      jawStyle: f.jawStyle as CustomTableFields["jawStyle"],
    };
    if (validateTable(fields, f.ballDiameterM).some((i) => i.severity === "error"))
      return undefined;
    return { table: resolveCustomTable(fields, f.ballDiameterM), diameterM: f.ballDiameterM };
  });

const tableArb = fc.oneof(
  fc.constant({ table: BLACKBALL_6, diameterM: 0.0508 }),
  fc.constant({ table: SNOOKER_12, diameterM: 0.0525 }),
  fc.constant({ table: POOL_9, diameterM: 0.05715 }),
  customTable,
);

const clothArb: fc.Arbitrary<ClothInput> = fc.record({
  slidingFriction: fc.double({ min: 0.1, max: 0.3, noNaN: true }),
  rollingResistance: fc.double({ min: 0.004, max: 0.02, noNaN: true }),
  spinningFriction: fc.double({ min: 0.005, max: 0.03, noNaN: true }),
});

/** A placement request: either a free position (fractions of the table) or "touching ball k". */
const placementArb = fc.record({
  fx: fc.double({ min: 0, max: 1, noNaN: true }),
  fy: fc.double({ min: 0, max: 1, noNaN: true }),
  touch: fc.boolean(),
  touchIndex: fc.nat({ max: 30 }),
  touchAngle: fc.double({ min: 0, max: 6.283, noNaN: true }),
  cueSizeFactor: fc.constantFrom(1, 1, 1, 0.937),
});

const shotArb = fc.record({
  aimAngleRad: fc.double({ min: 0, max: 6.283, noNaN: true }),
  speedMps: fc.double({ min: 0.2, max: 9, noNaN: true }),
  offsetRadius: fc.double({ min: 0, max: 0.5, noNaN: true }),
  offsetAngle: fc.double({ min: 0, max: 6.283, noNaN: true }),
});

const sceneArb: fc.Arbitrary<Scene | undefined> = fc
  .record({
    t: tableArb,
    cloth: clothArb,
    placements: fc.array(placementArb, { minLength: 1, maxLength: 16 }),
    shot: shotArb,
    restitution: fc.double({ min: 0.8, max: 1, noNaN: true }),
  })
  .map(({ t, cloth, placements, shot, restitution }): Scene | undefined => {
    if (!t) return undefined;
    const { table, diameterM } = t;
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const balls: BallInput[] = [];
    const pocketCircles = buildTableGeometry(table).pockets;
    for (let i = 0; i < placements.length; i++) {
      const p = placements[i] as (typeof placements)[number];
      const radiusM = (i === 0 ? p.cueSizeFactor : 1) * (diameterM / 2);
      const massKg = 0.163 * (radiusM / 0.028575) ** 3;
      const margin = cushionContactDistance(radiusM, table.cushion.noseHeightM) + 1e-4;
      let x = margin + p.fx * (W - 2 * margin);
      let y = margin + p.fy * (L - 2 * margin);
      if (p.touch && balls.length > 0) {
        const other = balls[p.touchIndex % balls.length] as BallInput;
        const d = other.radiusM + radiusM;
        x = other.x + d * Math.cos(p.touchAngle);
        y = other.y + d * Math.sin(p.touchAngle);
      }
      if (x < margin || x > W - margin || y < margin || y > L - margin) continue;
      // Not over a pocket: the simulator rejects that as input.
      const overPocket = pocketCircles.some((c) => {
        const dx = x - c.centre.x;
        const dy = y - c.centre.y;
        return Math.sqrt(dx * dx + dy * dy) < c.radiusM + 1e-6;
      });
      if (overPocket) continue;
      // Reject overlaps; exact touching is allowed.
      const clash = balls.some((b) => {
        const dx = b.x - x;
        const dy = b.y - y;
        return Math.sqrt(dx * dx + dy * dy) < b.radiusM + radiusM - 1e-12;
      });
      if (clash) continue;
      balls.push({ id: `b${balls.length}`, radiusM, massKg, x, y });
    }
    if (balls.length === 0) return undefined;
    const shotInput: ShotInput = {
      ballId: "b0",
      aimAngleRad: shot.aimAngleRad,
      speedMps: shot.speedMps,
      tipOffset: {
        side: shot.offsetRadius * Math.cos(shot.offsetAngle),
        vertical: shot.offsetRadius * Math.sin(shot.offsetAngle),
      },
    };
    return {
      input: { table, cloth, balls, ballRestitution: restitution, shot: shotInput },
    };
  });

describe("random scenes", () => {
  test("terminate, stay deterministic and keep every invariant", () => {
    fc.assert(
      fc.property(sceneArb, (scene) => {
        fc.pre(scene !== undefined);
        if (!scene) return;
        const start = performance.now();
        const result = simulate(scene.input);
        const elapsedMs = performance.now() - start;
        expect(result.status).toBe("complete");
        // A handful of balls must never take long; a slow run means event chatter.
        expect(result.stats.eventCount).toBeLessThan(3000);
        expect(elapsedMs).toBeLessThan(1000);
        expect(simulate(scene.input)).toEqual(result);
        checkInvariants(result, scene.input);
      }),
      { numRuns: RUNS, endOnFailure: SOAK, ...SEED },
    );
  }, 900_000);

  test("with throw, squirt and the Mathavan cushion (version 2 models) the same invariants hold", () => {
    const models = {
      ballBall: frictionalBallBall(BALL_BALL_FRICTION),
      cushion: mathavanCushion,
    };
    fc.assert(
      fc.property(sceneArb, (scene) => {
        fc.pre(scene !== undefined);
        if (!scene?.input.shot) return;
        const struck = scene.input.balls.find((b) => b.id === scene.input.shot?.ballId);
        if (!struck) return;
        const input: SimInput = {
          ...scene.input,
          models,
          shot: { ...scene.input.shot, cueEndMassKg: cueEndMassKg(struck.massKg) },
        };
        const result = simulate(input);
        expect(result.status).toBe("complete");
        expect(result.stats.eventCount).toBeLessThan(3000);
        expect(simulate(input)).toEqual(result);
        checkInvariants(result, input);
      }),
      { numRuns: Math.ceil(RUNS / 2), endOnFailure: SOAK, ...SEED },
    );
  }, 900_000);

  test("momentum is conserved in every ordinary ball-ball collision", () => {
    fc.assert(
      fc.property(sceneArb, (scene) => {
        fc.pre(scene !== undefined);
        if (!scene) return;
        const result = simulate(scene.input);
        const mass = new Map(scene.input.balls.map((b) => [b.id, b.massKg]));
        const times = result.events.map((e) => e.t);
        for (const hit of eventsOf(result, "ball-ball")) {
          // Only collisions that are alone in time, so before/after sampling is clean.
          const crowded = times.filter((t) => Math.abs(t - hit.t) < 1e-6).length > 1;
          if (crowded || hit.t < 1e-6) continue;
          const eps = 1e-7;
          const before = sampleAt(result, hit.t - eps);
          const after = sampleAt(result, hit.t + eps);
          let px = 0;
          let py = 0;
          let scale = 0;
          for (const id of [hit.ballId, hit.otherBallId]) {
            const m = mass.get(id) ?? 0;
            const b = before.find((s) => s.id === id);
            const a = after.find((s) => s.id === id);
            if (!a || !b) continue;
            px += m * (a.velocity.x - b.velocity.x);
            py += m * (a.velocity.y - b.velocity.y);
            scale += m;
          }
          // Allowance: friction over the sampling gap, plus the 1 cm/s rest threshold.
          expect(Math.sqrt(px * px + py * py)).toBeLessThan(scale * 0.021);
        }
      }),
      { numRuns: Math.ceil(RUNS / 2), endOnFailure: SOAK, ...SEED },
    );
  }, 900_000);
});

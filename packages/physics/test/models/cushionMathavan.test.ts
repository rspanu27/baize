import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { mathavanCushion, noseImpulseCushion } from "../../src/index";
import type { BallBallContact, CushionInput, Vec3 } from "../../src/index";
import { kineticEnergy } from "../../src/motion";

/**
 * The version 2 cushion model. `fixtures/pooltool-cushion.json` holds results from pooltool's
 * implementation of the same paper (see cushion-reference.test.ts for the fixture's origin);
 * Baize integrates the same equations independently, with its own step size and end-of-phase
 * handling, so agreement is close but not to rounding error.
 */

interface Fixture {
  tableSlidingFriction: number;
  balls: { name: string; radiusM: number; massKg: number }[];
  cushions: { noseHeightPerDiameter: number; restitution: number; friction: number }[];
  rows: number[][];
}

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/pooltool-cushion.json", import.meta.url), "utf8"),
) as Fixture;

const R = 0.028575;
const M = 0.163;
const CUSHION: CushionInput = { noseHeightM: 0.635 * 2 * R, restitution: 0.85, friction: 0.2 };
const CLOTH = { slidingFriction: 0.2 };
const INTO = { x: 1, y: 0 };
const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };

function ball(vx: number, vy: number, spin: Vec3 = NO_SPIN): BallBallContact {
  return { radiusM: R, massKg: M, velocity: { x: vx, y: vy }, spin };
}

/** A ball rolling naturally with the given velocity, plus side spin. */
function rolling(vx: number, vy: number, wz = 0): BallBallContact {
  return ball(vx, vy, { x: -vy / R, y: vx / R, z: wz });
}

describe("Mathavan cushion model against pooltool's implementation", () => {
  const errors = fixture.rows.map((row) => {
    const [bi = 0, ci = 0, speed = 0, , , , vx = 0, vy = 0, wx = 0, wy = 0, wz = 0] = row;
    const b = fixture.balls[bi];
    const c = fixture.cushions[ci];
    if (!b || !c) throw new Error("bad fixture row");
    const out = mathavanCushion.resolve(
      {
        radiusM: b.radiusM,
        massKg: b.massKg,
        velocity: { x: vx, y: vy },
        spin: { x: wx, y: wy, z: wz },
      },
      INTO,
      {
        noseHeightM: c.noseHeightPerDiameter * 2 * b.radiusM,
        restitution: c.restitution,
        friction: c.friction,
      },
      { slidingFriction: fixture.tableSlidingFriction },
    );
    const [mvx = 0, mvy = 0, mwx = 0, mwy = 0, mwz = 0] = row.slice(16, 21);
    return {
      row,
      velocity: Math.hypot(out.velocity.x - mvx, out.velocity.y - mvy) / speed,
      spin: (Math.hypot(out.spin.x - mwx, out.spin.y - mwy, out.spin.z - mwz) * b.radiusM) / speed,
      angle:
        (Math.abs(Math.atan2(out.velocity.y, out.velocity.x) - Math.atan2(mvy, mvx)) * 180) /
        Math.PI,
      outward: out.velocity.x,
    };
  });
  const quantile = (values: number[], p: number): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] as number;
  };

  test("every impact sends the ball back onto the table", () => {
    expect(errors.length).toBe(1080);
    for (const e of errors) expect(e.outward).toBeGreaterThanOrEqual(0);
  });

  test("rebound velocity and spin agree closely on the whole grid", () => {
    const velocity = errors.map((e) => e.velocity);
    const spin = errors.map((e) => e.spin);
    const angle = errors.map((e) => e.angle);
    // Printed when a bound fails, to show where the grid stands.
    const summary = {
      velocity: [0.5, 0.9, 0.99, 1].map((p) => quantile(velocity, p)),
      spin: [0.5, 0.9, 0.99, 1].map((p) => quantile(spin, p)),
      angle: [0.5, 0.9, 0.99, 1].map((p) => quantile(angle, p)),
    };
    // Measured on 2026-11-13: velocity differs by 0.06 % of the incoming speed at the median,
    // 0.2 % at the 90th percentile and 1.4 % at worst; spin by 0.03 %, 0.12 % and 6.5 % (in
    // units of speed / radius); direction by 0.02, 0.12 and 1.1 degrees. The worst cases are
    // impacts where a contact point stops slipping part-way, which the two integrations
    // handle differently.
    expect(summary.velocity[0], JSON.stringify(summary)).toBeLessThan(0.001);
    expect(summary.velocity[1], JSON.stringify(summary)).toBeLessThan(0.004);
    expect(summary.velocity[3], JSON.stringify(summary)).toBeLessThan(0.02);
    expect(summary.spin[1], JSON.stringify(summary)).toBeLessThan(0.003);
    expect(summary.spin[3], JSON.stringify(summary)).toBeLessThan(0.08);
    expect(summary.angle[1], JSON.stringify(summary)).toBeLessThan(0.2);
    expect(summary.angle[3], JSON.stringify(summary)).toBeLessThan(1.5);
  });
});

describe("Mathavan cushion model", () => {
  test("a ball not heading into the cushion is unchanged", () => {
    const b = ball(0.5, 1, { x: 1, y: 2, z: 3 });
    expect(mathavanCushion.resolve(b, INTO, CUSHION, CLOTH)).toEqual({
      velocity: b.velocity,
      spin: b.spin,
    });
  });

  test("square on, rolling: comes straight back, slower than the cushion's restitution alone", () => {
    const out = mathavanCushion.resolve(rolling(-2, 0), INTO, CUSHION, CLOTH);
    expect(out.velocity.y).toBeCloseTo(0, 12);
    expect(out.velocity.x).toBeGreaterThan(0.5 * 2);
    expect(out.velocity.x).toBeLessThan(0.85 * 2);
    expect(out.spin.z).toBeCloseTo(0, 12);
  });

  test("running side lengthens the rebound and check side shortens it", () => {
    // Arriving at 45 degrees, moving along +y. Tangential speed after the cushion:
    const along = (wz: number) =>
      mathavanCushion.resolve(rolling(-1, 1, wz), INTO, CUSHION, CLOTH).velocity.y;
    // For a cushion on the left and a ball moving along +y, running side is
    // counter-clockwise spin: the ball's surface at the nose moves towards -y, so the rail
    // pushes the ball along +y.
    const plain = along(0);
    expect(along(40)).toBeGreaterThan(plain);
    expect(along(-40)).toBeLessThan(plain);
    // The version 1 model agrees about which way is which.
    const v1 = (wz: number) =>
      noseImpulseCushion.resolve(rolling(-1, 1, wz), INTO, CUSHION).velocity.y;
    expect(v1(40)).toBeGreaterThan(v1(-40));
  });

  test("mirror symmetry: mirrored input gives mirrored output", () => {
    const a = mathavanCushion.resolve(
      ball(-1.3, 0.7, { x: 5, y: -20, z: 30 }),
      INTO,
      CUSHION,
      CLOTH,
    );
    const b = mathavanCushion.resolve(
      ball(-1.3, -0.7, { x: -5, y: -20, z: -30 }),
      INTO,
      CUSHION,
      CLOTH,
    );
    expect(b.velocity.x).toBeCloseTo(a.velocity.x, 12);
    expect(b.velocity.y).toBeCloseTo(-a.velocity.y, 12);
    expect(b.spin.x).toBeCloseTo(-a.spin.x, 10);
    expect(b.spin.y).toBeCloseTo(a.spin.y, 10);
    expect(b.spin.z).toBeCloseTo(-a.spin.z, 10);
  });

  test("works the same on any rail: rotating the problem rotates the answer", () => {
    const base = mathavanCushion.resolve(
      ball(-1.1, 0.4, { x: 3, y: -30, z: 12 }),
      INTO,
      CUSHION,
      CLOTH,
    );
    // Quarter turn: (x, y) -> (-y, x).
    const turned = mathavanCushion.resolve(
      ball(-0.4, -1.1, { x: 30, y: 3, z: 12 }),
      { x: 0, y: 1 },
      CUSHION,
      CLOTH,
    );
    expect(turned.velocity.x).toBeCloseTo(-base.velocity.y, 12);
    expect(turned.velocity.y).toBeCloseTo(base.velocity.x, 12);
    expect(turned.spin.x).toBeCloseTo(-base.spin.y, 10);
    expect(turned.spin.y).toBeCloseTo(base.spin.x, 10);
    expect(turned.spin.z).toBeCloseTo(base.spin.z, 10);
  });

  test("a dead cushion (e = 0) leaves no speed away from the rail", () => {
    const out = mathavanCushion.resolve(
      rolling(-1.5, 0.5),
      INTO,
      { ...CUSHION, restitution: 0 },
      CLOTH,
    );
    expect(out.velocity.x).toBeCloseTo(0, 12);
  });

  test("without cloth friction and with the nose at centre height it is plain reflection", () => {
    const flat: CushionInput = { noseHeightM: R, restitution: 0.8, friction: 0 };
    const out = mathavanCushion.resolve(ball(-2, 0.9, { x: 1, y: 2, z: 3 }), INTO, flat);
    expect(out.velocity.x).toBeCloseTo(1.6, 9);
    expect(out.velocity.y).toBeCloseTo(0.9, 12);
    expect(out.spin).toEqual({ x: 1, y: 2, z: 3 });
  });

  test("it is close to the version 1 model for a plain rolling ball square on", () => {
    const v1 = noseImpulseCushion.resolve(rolling(-1, 0), INTO, CUSHION);
    const v2 = mathavanCushion.resolve(rolling(-1, 0), INTO, CUSHION, CLOTH);
    expect(Math.abs(v1.velocity.x - v2.velocity.x)).toBeLessThan(0.1);
  });

  test("never gains energy, never leaves the ball heading in, always finite", () => {
    const speed = fc.double({ min: 0.01, max: 10, noNaN: true });
    fc.assert(
      fc.property(
        speed,
        fc.double({ min: -10, max: 10, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: -400, max: 400, noNaN: true }),
        fc.double({ min: 0.5, max: 0.72, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.4, noNaN: true }),
        fc.double({ min: 0, max: 0.4, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (vin, vt, wx, wy, wz, nose, e, muW, muS, angle) => {
          const n = { x: Math.cos(angle), y: Math.sin(angle) };
          const t = { x: -n.y, y: n.x };
          const b = ball(-vin * n.x + vt * t.x, -vin * n.y + vt * t.y, { x: wx, y: wy, z: wz });
          const cushion: CushionInput = {
            noseHeightM: nose * 2 * R,
            restitution: e,
            friction: muW,
          };
          const out = mathavanCushion.resolve(b, n, cushion, { slidingFriction: muS });
          for (const v of [out.velocity.x, out.velocity.y, out.spin.x, out.spin.y, out.spin.z]) {
            expect(Number.isFinite(v)).toBe(true);
          }
          expect(out.velocity.x * n.x + out.velocity.y * n.y).toBeGreaterThanOrEqual(-1e-12);
          const before = kineticEnergy(M, R, b.velocity, b.spin);
          const after = kineticEnergy(M, R, out.velocity, out.spin);
          expect(after).toBeLessThanOrEqual(before * (1 + 1e-9) + 1e-12);
        },
      ),
      { numRuns: 3000 },
    );
  });

  test("the result is the same on every run (bit for bit)", () => {
    const b = ball(-1.7, 0.3, { x: 12, y: -40, z: 25 });
    expect(mathavanCushion.resolve(b, INTO, CUSHION, CLOTH)).toEqual(
      mathavanCushion.resolve(b, INTO, CUSHION, CLOTH),
    );
  });
});

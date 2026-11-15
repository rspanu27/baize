import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { noseImpulseCushion } from "../../src/models/cushion";
import { kineticEnergy } from "../../src/motion";
import type { BallBallContact, CushionInput, Vec2, Vec3 } from "../../src/index";

const R = 0.028575;
const M = 0.163;
const CUSHION: CushionInput = { noseHeightM: 0.635 * 2 * R, restitution: 0.85, friction: 0.2 };
// Left-hand rail: the ball is at x > 0 and the cushion normal points along +x.
const N: Vec2 = { x: 1, y: 0 };
const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };

function ball(v: Vec2, spin: Vec3 = NO_SPIN, radiusM = R, massKg = M): BallBallContact {
  return { radiusM, massKg, velocity: v, spin };
}

describe("nose-impulse cushion model", () => {
  test("a ball not heading into the cushion is unchanged", () => {
    const b = ball({ x: 0.5, y: 1 }, { x: 1, y: 2, z: 3 });
    expect(noseImpulseCushion.resolve(b, N, CUSHION)).toEqual({
      velocity: b.velocity,
      spin: b.spin,
    });
    const along = ball({ x: 0, y: 1 });
    expect(noseImpulseCushion.resolve(along, N, CUSHION).velocity).toEqual(along.velocity);
  });

  test("square, no spin: comes straight back slower, by the derived factor", () => {
    const out = noseImpulseCushion.resolve(ball({ x: -2, y: 0 }), N, CUSHION);
    const sin = (CUSHION.noseHeightM - R) / R;
    const cos2 = 1 - sin * sin;
    // v_out / v_in = (1 + e) cos^2 + (2/7) sin^2 - 1  (sticking case)
    const factor = (1 + CUSHION.restitution) * cos2 + (2 / 7) * sin * sin - 1;
    expect(out.velocity.x).toBeCloseTo(2 * factor, 13);
    expect(out.velocity.y).toBeCloseTo(0, 15);
    expect(out.velocity.x).toBeGreaterThan(0);
    expect(out.velocity.x).toBeLessThan(2);
    expect(out.spin.z + 0).toBe(0);
  });

  test("nose at centre height, no friction: plain reflection with restitution", () => {
    const flat: CushionInput = { noseHeightM: R, restitution: 0.8, friction: 0 };
    const out = noseImpulseCushion.resolve(ball({ x: -1, y: 0.7 }, { x: 0, y: 0, z: 9 }), N, flat);
    expect(out.velocity.x).toBeCloseTo(0.8, 14);
    expect(out.velocity.y).toBe(0.7);
    expect(out.spin).toEqual({ x: 0, y: 0, z: 9 });
  });

  test("angled, no spin: tangential speed drops, the ball picks up spin from the rail", () => {
    const out = noseImpulseCushion.resolve(ball({ x: -1, y: 1 }), N, CUSHION);
    expect(out.velocity.x).toBeGreaterThan(0);
    expect(out.velocity.y).toBeGreaterThan(0);
    expect(out.velocity.y).toBeLessThan(1);
    // The rail drags the cushion-side of the ball backwards: that is counter-clockwise here.
    expect(out.spin.z).toBeGreaterThan(0);
  });

  test("side spin changes the rebound: running side lengthens it, check side shortens it", () => {
    const v = { x: -1, y: 1 };
    const plain = noseImpulseCushion.resolve(ball(v), N, CUSHION).velocity.y;
    // Spin for which the contact point does not slip along the rail (rolling along it).
    const sin = (CUSHION.noseHeightM - R) / R;
    const cos = Math.sqrt(1 - sin * sin);
    const rollingSide = 1 / (R * cos);
    const neutral = noseImpulseCushion.resolve(ball(v, { x: 0, y: 0, z: rollingSide }), N, CUSHION);
    expect(neutral.velocity.y).toBeCloseTo(1, 12);
    const running = noseImpulseCushion.resolve(
      ball(v, { x: 0, y: 0, z: 3 * rollingSide }),
      N,
      CUSHION,
    );
    const check = noseImpulseCushion.resolve(
      ball(v, { x: 0, y: 0, z: -2 * rollingSide }),
      N,
      CUSHION,
    );
    expect(running.velocity.y).toBeGreaterThan(1);
    expect(check.velocity.y).toBeLessThan(plain);
    // Friction is bounded: the change in tangential speed never exceeds mu * normal impulse / m.
    const limit = CUSHION.friction * (1 + CUSHION.restitution) * cos * 1;
    expect(running.velocity.y - 1).toBeLessThanOrEqual(limit + 1e-12);
    expect(1 - check.velocity.y).toBeLessThanOrEqual(limit + 1e-12);
  });

  test("mirror symmetry: mirrored input gives mirrored output", () => {
    const a = noseImpulseCushion.resolve(
      ball({ x: -1.3, y: 0.6 }, { x: 4, y: -9, z: 12 }),
      N,
      CUSHION,
    );
    // Mirror in the x axis (y -> -y): spin components x and z flip sign (pseudovector).
    const b = noseImpulseCushion.resolve(
      ball({ x: -1.3, y: -0.6 }, { x: -4, y: -9, z: -12 }),
      N,
      CUSHION,
    );
    expect(b.velocity.x).toBeCloseTo(a.velocity.x, 13);
    expect(b.velocity.y).toBeCloseTo(-a.velocity.y, 13);
    expect(b.spin.x).toBeCloseTo(-a.spin.x, 11);
    expect(b.spin.y).toBeCloseTo(a.spin.y, 11);
    expect(b.spin.z).toBeCloseTo(-a.spin.z, 11);
  });

  test("works the same on any rail: rotating the problem rotates the answer", () => {
    const a = noseImpulseCushion.resolve(
      ball({ x: -1.3, y: 0.6 }, { x: 4, y: -9, z: 12 }),
      N,
      CUSHION,
    );
    // Rotate by 90 degrees: (x, y) -> (-y, x). Bottom rail, normal +y.
    const b = noseImpulseCushion.resolve(
      ball({ x: -0.6, y: -1.3 }, { x: 9, y: 4, z: 12 }),
      { x: 0, y: 1 },
      CUSHION,
    );
    expect(b.velocity.x).toBeCloseTo(-a.velocity.y, 13);
    expect(b.velocity.y).toBeCloseTo(a.velocity.x, 13);
    expect(b.spin.x).toBeCloseTo(-a.spin.y, 11);
    expect(b.spin.y).toBeCloseTo(a.spin.x, 11);
    expect(b.spin.z).toBeCloseTo(a.spin.z, 11);
  });

  test("the case CI found: a slow ball on a rail a hair off the axis is not sent into it", () => {
    // fast-check counterexample from CI (2026-11-15), pinned so that it runs every time.
    const radius = 0.025625545964270552;
    const angle = 8.624677082612921e-8;
    const n = { x: Math.cos(angle), y: Math.sin(angle) };
    // Built exactly as the property below builds it (speed 1 mm/s, no sideways speed).
    const tangent = { x: -n.y, y: n.x };
    const velocity = { x: -0.001 * n.x + 0 * tangent.x, y: -0.001 * n.y + 0 * tangent.y };
    const b = ball(velocity, { x: 0, y: 0.08223328120348734, z: 0 }, radius);
    const out = noseImpulseCushion.resolve(b, n, {
      noseHeightM: 0.7199999999999994 * 2 * radius,
      restitution: 0.5,
      friction: 0.35364871404573706,
    });
    const vn = out.velocity.x * n.x + out.velocity.y * n.y;
    expect(vn).toBeGreaterThanOrEqual(-1e-12 * (0.001 + radius * 0.0823));
    expect(kineticEnergy(M, radius, out.velocity, out.spin)).toBeLessThanOrEqual(
      kineticEnergy(M, radius, b.velocity, b.spin) * (1 + 1e-12) + 1e-15,
    );
  });

  test("never gains energy and never leaves the ball heading into the cushion", () => {
    const v = fc.double({ min: -10, max: 10, noNaN: true });
    const w = fc.double({ min: -300, max: 300, noNaN: true });
    fc.assert(
      fc.property(
        fc.double({ min: 0.001, max: 12, noNaN: true }),
        v,
        w,
        w,
        w,
        fc.double({ min: 0, max: 6.283, noNaN: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        fc.double({ min: 0.5, max: 0.72, noNaN: true }),
        fc.double({ min: 0.0225, max: 0.0325, noNaN: true }),
        (speedIn, vt, wx, wy, wz, angle, e, mu, noseFraction, radius) => {
          const n = { x: Math.cos(angle), y: Math.sin(angle) };
          const t = { x: -n.y, y: n.x };
          const velocity = { x: -speedIn * n.x + vt * t.x, y: -speedIn * n.y + vt * t.y };
          const b = ball(velocity, { x: wx, y: wy, z: wz }, radius);
          const cushion = { noseHeightM: noseFraction * 2 * radius, restitution: e, friction: mu };
          const out = noseImpulseCushion.resolve(b, n, cushion);
          const before = kineticEnergy(M, radius, b.velocity, b.spin);
          const after = kineticEnergy(M, radius, out.velocity, out.spin);
          expect(after).toBeLessThanOrEqual(before * (1 + 1e-12) + 1e-15);
          // The model clamps the outgoing normal speed to zero or more in the cushion's own
          // frame; turned back into table axes and dotted with n again, it can come out a few
          // units of round-off below zero (CI found -3.9e-34 m/s, 2026-11-15). Round-off is
          // allowed; anything physical is not.
          const scale =
            speedIn + Math.abs(vt) + radius * (Math.abs(wx) + Math.abs(wy) + Math.abs(wz));
          expect(out.velocity.x * n.x + out.velocity.y * n.y).toBeGreaterThanOrEqual(
            -1e-12 * scale,
          );
          expect(Number.isFinite(out.spin.x + out.spin.y + out.spin.z)).toBe(true);
        },
      ),
      { numRuns: 5000 },
    );
  });
});

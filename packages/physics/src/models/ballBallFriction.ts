import { expNeg } from "../math/exp";
import type { BallBallContact, BallBallModel, Impulsed, Vec2 } from "../types";

/**
 * Ball-ball sliding friction that falls with the speed at which the two surfaces rub:
 *   mu = a + b * exp(-c * surfaceSpeed), surfaceSpeed in m/s.
 * The values are data, supplied by the caller (see `packages/tables`).
 */
export interface BallBallFriction {
  readonly a: number;
  readonly b: number;
  readonly c: number;
}

/**
 * Ball-ball collision, version 2: instantaneous, with friction between the balls.
 *
 * The normal impulse is the same as in version 1,
 *   J = (1 + e) * m_a m_b / (m_a + m_b) * closing speed.
 * Friction acts at the contact point against the relative surface velocity there,
 *   s = (v_a - v_b) + R_a (w_a x n) + R_b (w_b x n), with its part along n removed,
 * which has a horizontal part (cut angle and side spin: this is throw) and a vertical part
 * (follow and draw rubbing against the object ball). The friction impulse on ball a is
 *   F = -min(mu J, |s| / k) * s / |s|,   k = (7/2) (1/m_a + 1/m_b),
 * and the opposite on ball b. The cap |s| / k is the impulse that stops the rubbing: a solid
 * sphere's surface point responds to an impulse with 1/m + R^2/I = 7/(2m), so beyond the cap
 * the surfaces would be driven backwards. With the cap the balls "gear" and friction never
 * adds energy.
 *
 * Each ball's spin changes by (R n x F) / I. The horizontal part of F changes the velocities;
 * the vertical part cannot (the balls stay on the table, there is no airborne state), so it
 * is dropped from the velocities, which only removes energy.
 *
 * Linear momentum is conserved exactly. Balls that are not closing are left unchanged.
 */
export function frictionalBallBall(friction: BallBallFriction): BallBallModel {
  const { a: fa, b: fb, c: fc } = friction;
  if (!(fa >= 0) || !(fb >= 0) || !(fc >= 0) || !Number.isFinite(fa + fb + fc)) {
    throw new Error("ball-ball friction values must be finite and not negative");
  }
  return {
    resolve(
      a: BallBallContact,
      b: BallBallContact,
      normal: Vec2,
      restitution: number,
    ): { a: Impulsed; b: Impulsed } {
      const nx = normal.x;
      const ny = normal.y;
      const dvx = a.velocity.x - b.velocity.x;
      const dvy = a.velocity.y - b.velocity.y;
      const closing = dvx * nx + dvy * ny;
      if (!(closing > 0)) {
        return {
          a: { velocity: a.velocity, spin: a.spin },
          b: { velocity: b.velocity, spin: b.spin },
        };
      }
      const j = ((1 + restitution) * closing * a.massKg * b.massKg) / (a.massKg + b.massKg);

      // Relative surface velocity at the contact point, tangential part only.
      // w x n for n = (nx, ny, 0) is (-wz ny, wz nx, wx ny - wy nx).
      const ra = a.radiusM;
      const rb = b.radiusM;
      const sx = dvx - closing * nx + ra * -a.spin.z * ny + rb * -b.spin.z * ny;
      const sy = dvy - closing * ny + ra * a.spin.z * nx + rb * b.spin.z * nx;
      const sz = ra * (a.spin.x * ny - a.spin.y * nx) + rb * (b.spin.x * ny - b.spin.y * nx);
      const s = Math.sqrt(sx * sx + sy * sy + sz * sz);

      let fx = 0;
      let fy = 0;
      let fz = 0;
      if (s > 0) {
        const mu = fa + fb * expNeg(fc * s);
        const stop = s / (3.5 * (1 / a.massKg + 1 / b.massKg));
        const size = Math.min(mu * j, stop);
        fx = (-size * sx) / s;
        fy = (-size * sy) / s;
        fz = (-size * sz) / s;
      }

      // n x F for n = (nx, ny, 0) is (ny Fz, -nx Fz, nx Fy - ny Fx); I = 2/5 m R^2.
      const tx = ny * fz;
      const ty = -nx * fz;
      const tz = nx * fy - ny * fx;
      const ka = 2.5 / (a.massKg * ra);
      const kb = 2.5 / (b.massKg * rb);
      const ja = j / a.massKg;
      const jb = j / b.massKg;
      return {
        a: {
          velocity: {
            x: a.velocity.x - ja * nx + fx / a.massKg,
            y: a.velocity.y - ja * ny + fy / a.massKg,
          },
          spin: { x: a.spin.x + ka * tx, y: a.spin.y + ka * ty, z: a.spin.z + ka * tz },
        },
        b: {
          velocity: {
            x: b.velocity.x + jb * nx - fx / b.massKg,
            y: b.velocity.y + jb * ny - fy / b.massKg,
          },
          // Ball b is pushed by -F at -R n, which is the same torque direction as on ball a.
          spin: { x: b.spin.x + kb * tx, y: b.spin.y + kb * ty, z: b.spin.z + kb * tz },
        },
      };
    },
  };
}

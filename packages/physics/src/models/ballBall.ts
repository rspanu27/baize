import type { BallBallContact, BallBallModel, Impulsed, Vec2 } from "../types";

/**
 * Ball-ball collision, version 1: instantaneous and frictionless.
 *
 * Only the velocity components along the line of centres change; spins are untouched, so
 * there is no throw. With restitution e and masses m_a, m_b the impulse along the normal is
 *   J = (1 + e) * m_a m_b / (m_a + m_b) * closing speed.
 * Linear momentum is conserved exactly and kinetic energy never increases for 0 <= e <= 1.
 * Balls that are not closing are left unchanged.
 */
export const frictionlessBallBall: BallBallModel = {
  resolve(
    a: BallBallContact,
    b: BallBallContact,
    normal: Vec2,
    restitution: number,
  ): { a: Impulsed; b: Impulsed } {
    const closing =
      (a.velocity.x - b.velocity.x) * normal.x + (a.velocity.y - b.velocity.y) * normal.y;
    if (!(closing > 0)) {
      return {
        a: { velocity: a.velocity, spin: a.spin },
        b: { velocity: b.velocity, spin: b.spin },
      };
    }
    const j = ((1 + restitution) * closing * a.massKg * b.massKg) / (a.massKg + b.massKg);
    const ja = j / a.massKg;
    const jb = j / b.massKg;
    return {
      a: {
        velocity: { x: a.velocity.x - ja * normal.x, y: a.velocity.y - ja * normal.y },
        spin: a.spin,
      },
      b: {
        velocity: { x: b.velocity.x + jb * normal.x, y: b.velocity.y + jb * normal.y },
        spin: b.spin,
      },
    };
  },
};

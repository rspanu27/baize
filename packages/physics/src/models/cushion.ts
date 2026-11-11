import type { BallBallContact, CushionInput, CushionModel, Impulsed, Vec2 } from "../types";

/**
 * Ball-cushion collision, version 1: an impulse at the cushion nose with restitution and
 * Coulomb friction. It accounts for spin and for the height of the nose.
 *
 * This follows the formulation used by Han (2005, "Dynamics in carom and three cushion
 * billiards"): the ball meets the cushion at a single point on the nose, which sits at height
 * h and is therefore usually above the ball's centre. It is derived here from first principles
 * rather than transcribed, and it differs from the paper in one respect: when the contact
 * slides for the whole impact, friction acts against the actual slip direction (for a sphere
 * that direction cannot change during the impact, so this is the exact Coulomb result).
 *
 * Geometry, in the cushion frame (n = unit normal into the table, tau = z x n along the rail,
 * z up), with sin(theta) = (h - R) / R:
 *   contact point relative to the centre   r = R (-cos, 0, sin)
 *   contact normal (cushion into ball)      N = (cos, 0, -sin)
 *   tangents                                T1 = tau,  T2 = N x T1 = (sin, 0, cos)
 * Contact point velocity w = v + omega x r has
 *   normal part   w.N  = cos * v_n
 *   slip          s1 = w.T1 = v_t - R cos * w_z - R sin * w_n
 *                 s2 = w.T2 = sin * v_n + R * w_t
 * An impulse P at the contact point changes the contact velocity by P_N / m along N and by
 * (7/2) P_T / m tangentially (sphere, I = 2/5 m R^2). So:
 *   normal impulse      P_N = -(1 + e) m cos * v_n
 *   to stop the slip    P_T = -(2 m / 7) s          (sticking), if |P_T| <= mu P_N
 *   otherwise           P_T = -mu P_N s / |s|       (sliding throughout)
 * and the ball changes by  dv = P / m,  d(omega) = (r x P) / I = (R / I) (-sin P1, P2, -cos P1).
 *
 * The vertical part of dv is discarded: the bed stops the ball being driven into it and there
 * is no airborne state in this engine. That only removes energy.
 */
export const noseImpulseCushion: CushionModel = {
  resolve(ball: BallBallContact, normal: Vec2, cushion: CushionInput): Impulsed {
    const nx = normal.x;
    const ny = normal.y;
    const vn = ball.velocity.x * nx + ball.velocity.y * ny;
    if (!(vn < 0)) return { velocity: ball.velocity, spin: ball.spin };

    const R = ball.radiusM;
    const m = ball.massKg;
    // tau = z x n
    const tx = -ny;
    const ty = nx;
    const vt = ball.velocity.x * tx + ball.velocity.y * ty;
    const wn = ball.spin.x * nx + ball.spin.y * ny;
    const wt = ball.spin.x * tx + ball.spin.y * ty;
    const wz = ball.spin.z;

    const sin = (cushion.noseHeightM - R) / R;
    const cos = Math.sqrt(1 - sin * sin);

    const s1 = vt - R * cos * wz - R * sin * wn;
    const s2 = sin * vn + R * wt;
    const pN = -(1 + cushion.restitution) * m * cos * vn;
    let p1 = (-2 * m * s1) / 7;
    let p2 = (-2 * m * s2) / 7;
    const stick = Math.sqrt(p1 * p1 + p2 * p2);
    const limit = cushion.friction * pN;
    if (stick > limit) {
      const k = limit / stick;
      p1 *= k;
      p2 *= k;
    }

    // Horizontal components of P = pN N + p1 T1 + p2 T2 in the (n, tau) frame.
    let vnOut = vn + (pN * cos + p2 * sin) / m;
    const vtOut = vt + p1 / m;
    // The ball must not still be heading into the cushion.
    if (vnOut < 0) vnOut = 0;

    const k = R / (0.4 * m * R * R);
    const wnOut = wn - k * sin * p1;
    const wtOut = wt + k * p2;
    const wzOut = wz - k * cos * p1;

    return {
      velocity: { x: vnOut * nx + vtOut * tx, y: vnOut * ny + vtOut * ty },
      spin: { x: wnOut * nx + wtOut * tx, y: wnOut * ny + wtOut * ty, z: wzOut },
    };
  },
};

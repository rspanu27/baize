import type { BallBallContact, CushionInput, CushionModel, Impulsed, Vec2 } from "../types";

/**
 * Number of impulse steps the compression phase is divided into. The result changes by less
 * than one part in a thousand between 200 and 2000 steps; 400 keeps a full break cheap.
 */
const COMPRESSION_STEPS = 400;
/** Safety limit on the steps of either phase, as a multiple of `COMPRESSION_STEPS`. */
const STEP_LIMIT_FACTOR = 20;

/**
 * Ball-cushion collision, version 2: the model of Mathavan, Jackson and Parkin (2010,
 * "A theoretical analysis of billiard ball dynamics under cushion impacts"), integrated
 * through the impact.
 *
 * Unlike the version 1 impulse model, the ball is followed through the impact in small steps
 * of the normal impulse P at the cushion nose. The nose presses on the ball above its centre,
 * which drives the ball into the bed, so the bed pushes back and there is friction at two
 * places at once: against the cushion (coefficient mu_w) and against the cloth (mu_s). Both
 * friction forces follow the direction in which their contact point is slipping at that
 * moment, and those directions turn during the impact; that is what the single-impulse model
 * cannot represent.
 *
 * Frame used inside: x along the rail (tau = z x n), y from the ball into the cushion (-n),
 * z up. With sin(theta) = (h - R) / R and cos(theta) for the nose contact point I, and C the
 * point where the ball touches the bed:
 *   slip at I   (v_x + w_y R sin - w_z R cos,  -v_y sin + w_x R)
 *   slip at C   (v_x - w_y R,                   v_y + w_x R)
 * with unit directions (cI, sI) and (cC, sC). Per unit of normal impulse dP, with
 * Q = sin + mu_w sI cos (the bed's reaction per unit of cushion impulse):
 *   M dv_x = -(mu_w cI + mu_s cC Q) dP
 *   M dv_y = -(cos - mu_w sin sI + mu_s sC Q) dP
 *   (2/5) M R dw_x = -(mu_w sI + mu_s sC Q) dP
 *   (2/5) M R dw_y = -(mu_w cI sin - mu_s cC Q) dP
 *   (2/5) M R dw_z = +(mu_w cI cos) dP
 * The work done against the normal force is dW = cos |v_y| dP. Compression lasts until
 * v_y = 0; restitution then continues until the work returned equals e^2 times the work of
 * compression (Stronge's energetic coefficient of restitution).
 *
 * The equations were taken from the description of the model in pooltool's implementation
 * (https://github.com/ekiefl/pooltool, Apache-2.0); the integration here is independent:
 * fixed steps of M v_y / 400, the direction of slip re-read at every step, work summed by the
 * trapezium rule, and the last step of each phase cut to end exactly at v_y = 0 and at the
 * work target. A contact point that is not slipping gets no friction, and one that is about
 * to stop slipping gets only as much as stops it within the step (the implementation in
 * pooltool applies full friction there, which chatters). Only + - * / and sqrt
 * are used, so the result is bit-identical everywhere.
 *
 * The cloth's sliding friction comes from the fourth argument; without it the bed is taken
 * as frictionless.
 */
export const mathavanCushion: CushionModel = {
  resolve(
    ball: BallBallContact,
    normal: Vec2,
    cushion: CushionInput,
    cloth?: { readonly slidingFriction: number },
  ): Impulsed {
    const nx = normal.x;
    const ny = normal.y;
    const vn = ball.velocity.x * nx + ball.velocity.y * ny;
    if (!(vn < 0)) return { velocity: ball.velocity, spin: ball.spin };

    const R = ball.radiusM;
    const M = ball.massKg;
    const muW = cushion.friction;
    const muS = cloth?.slidingFriction ?? 0;
    const sin = (cushion.noseHeightM - R) / R;
    const cos = Math.sqrt(Math.max(0, 1 - sin * sin));

    // Into the model's frame: x along tau = z x n, y along -n.
    const tx = -ny;
    const ty = nx;
    let vx = ball.velocity.x * tx + ball.velocity.y * ty;
    let vy = -vn;
    let wx = ball.spin.x * tx + ball.spin.y * ty;
    let wy = -(ball.spin.x * nx + ball.spin.y * ny);
    let wz = ball.spin.z;

    const k = 2.5 / (M * R);
    const dP = (M * vy) / COMPRESSION_STEPS;
    const limit = STEP_LIMIT_FACTOR * COMPRESSION_STEPS;

    // A friction impulse F moves its contact point by (7/2) F / M (sphere, I = 2/5 M R^2).
    const gripPerNormal = (3.5 * dP) / M;
    const gripI = gripPerNormal * muW;

    // Rates of change per unit impulse at the present state.
    let rvx = 0;
    let rvy = 0;
    let rwx = 0;
    let rwy = 0;
    let rwz = 0;
    const rates = (): void => {
      const ix = vx + wy * R * sin - wz * R * cos;
      const iy = -vy * sin + wx * R;
      const il = Math.sqrt(ix * ix + iy * iy);
      // Friction at full strength for one step would change the slip by about `grip`. A slip
      // smaller than that is nearly stopped: scale the friction down so that the step ends
      // the slip instead of reversing it (which would chatter and feed energy in).
      const gI = il < gripI ? il / gripI : 1;
      const cI = il > 0 ? (gI * ix) / il : 0;
      const sI = il > 0 ? (gI * iy) / il : 0;
      // The bed only pushes up; it cannot pull the ball down.
      const q = Math.max(0, sin + muW * sI * cos);
      const cx = vx - wy * R;
      const cy = vy + wx * R;
      const cl = Math.sqrt(cx * cx + cy * cy);
      const gripC = gripPerNormal * muS * q;
      const gC = cl < gripC ? cl / gripC : 1;
      const cC = cl > 0 ? (gC * cx) / cl : 0;
      const sC = cl > 0 ? (gC * cy) / cl : 0;
      rvx = -(muW * cI + muS * cC * q) / M;
      rvy = -(cos - muW * sin * sI + muS * sC * q) / M;
      rwx = -k * (muW * sI + muS * sC * q);
      rwy = -k * (muW * cI * sin - muS * cC * q);
      rwz = k * muW * cI * cos;
    };
    const step = (p: number): void => {
      vx += rvx * p;
      vy += rvy * p;
      wx += rwx * p;
      wy += rwy * p;
      wz += rwz * p;
    };

    if (cos > 0 && dP > 0) {
      // Compression: until the ball stops moving into the cushion.
      let work = 0;
      for (let i = 0; i < limit && vy > 0; i++) {
        rates();
        // A ball that the forces no longer slow down cannot be brought to rest: stop here.
        if (!(rvy < 0)) break;
        const before = vy;
        const after = vy + rvy * dP;
        if (after <= 0) {
          // v_y is linear in P within a step: cut the step to end exactly at zero.
          const part = (before / (before - after)) * dP;
          step(part);
          vy = 0;
          work += 0.5 * cos * before * part;
          break;
        }
        step(dP);
        work += 0.5 * cos * (before + after) * dP;
      }

      // Restitution: until the work returned reaches e^2 of the work of compression.
      const target = cushion.restitution * cushion.restitution * work;
      let returned = 0;
      for (let i = 0; i < limit && returned < target; i++) {
        rates();
        if (!(rvy < 0)) break;
        const before = -vy;
        const after = -(vy + rvy * dP);
        const full = 0.5 * cos * (before + after) * dP;
        if (returned + full >= target) {
          // Work within the step is b f + a f^2 for a fraction f of it; solve for the rest.
          const rest = target - returned;
          const b = cos * before * dP;
          const a = 0.5 * cos * (after - before) * dP;
          const denominator = b + Math.sqrt(b * b + 4 * a * rest);
          // A work target too small to register (restitution next to zero) needs no step.
          const f = denominator > 0 ? Math.min(1, (2 * rest) / denominator) : 0;
          step(f * dP);
          break;
        }
        step(dP);
        returned += full;
      }
    }
    // The ball must not still be heading into the cushion.
    if (vy > 0) vy = 0;

    return {
      velocity: { x: vx * tx - vy * nx, y: vx * ty - vy * ny },
      spin: { x: wx * tx - wy * nx, y: wx * ty - wy * ny, z: wz },
    };
  },
};

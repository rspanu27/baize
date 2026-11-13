import { sinCos } from "./math/trig";
import { SimInputError } from "./types";
import type { Impulsed, ShotInput } from "./types";

/**
 * Largest tip offset from the centre of the ball face, as a fraction of the ball radius.
 * Beyond about half a radius the tip slips off the ball (a miscue).
 * Source: D. G. Alciatore, "The Illustrated Principles of Pool and Billiards" (2004), miscue
 * limit of approximately 0.5 R.
 */
export const MAX_TIP_OFFSET = 0.5;

/**
 * Cue strike, version 1: a level cue delivering an impulse along the aim direction through
 * the tip contact point.
 *
 * `speedMps` is the ball's speed after the strike, so linear momentum is m v along the aim
 * direction. The same impulse acting at the contact point gives angular momentum
 * I w = r x P with I = 2/5 m R^2, which works out to
 *   w = (5 v / 2R) * ( -vertical * dir.y, vertical * dir.x, side )
 * so `vertical` = 0.4 gives natural roll, negative `vertical` gives backspin, and positive
 * `side` (right-hand side as the player sees it) gives counter-clockwise spin seen from above.
 *
 * Squirt (version 2, when `shot.cueEndMassKg` and the ball's mass are given). The tip grips
 * the ball, so during the hit the ball's surface and the tip move sideways together. Take x
 * along the aim and y to the player's left, the tip at r = R (-c, -s) with s the side offset
 * and c = sqrt(1 - s^2 - vertical^2), and let the tip end of the cue have sideways inertia
 * m_e. The ball receives the impulse (P_x, P_y); the tip end receives -P_y sideways. Equal
 * sideways velocity at the contact point,
 *   P_y / m - c R w_z = -P_y / m_e,   I w_z = R (s P_x - c P_y),   I = 2/5 m R^2,
 * gives the squirt angle
 *   tan(alpha) = P_y / P_x = (5/2) s c / (1 + m / m_e + (5/2) c^2),
 * to the left for a hit on the right. This is the result of D. G. Alciatore's technical proof
 * TP A.31 ("The physics of squirt"); it is derived here because the source could not be
 * fetched. `speedMps` stays the ball's speed; its direction turns by alpha. Side spin follows
 * from the same impulse, w_z = (5 v / 2R) (s cos(alpha) - c sin(alpha)), a little less than
 * without squirt, and follow or draw is about the axis across the ball's actual direction.
 */
export function strike(radiusM: number, shot: ShotInput, massKg?: number): Impulsed {
  const { side, vertical } = shot.tipOffset;
  if (
    !Number.isFinite(shot.aimAngleRad) ||
    !Number.isFinite(shot.speedMps) ||
    !Number.isFinite(side) ||
    !Number.isFinite(vertical)
  ) {
    throw new SimInputError("invalid-shot", "shot values must be finite numbers");
  }
  if (!(shot.speedMps > 0)) {
    throw new SimInputError("invalid-shot", "shot speed must be greater than zero");
  }
  if (shot.elevationRad !== undefined && shot.elevationRad !== 0) {
    throw new SimInputError(
      "elevation-not-supported",
      "cue elevation is not supported yet; elevationRad must be 0 or omitted",
    );
  }
  if (side * side + vertical * vertical > MAX_TIP_OFFSET * MAX_TIP_OFFSET * (1 + 1e-9)) {
    throw new SimInputError(
      "tip-offset-too-large",
      `tip offset is beyond the miscue limit of ${MAX_TIP_OFFSET} ball radii`,
    );
  }
  const { sin, cos } = sinCos(shot.aimAngleRad);
  const v = shot.speedMps;
  const k = (2.5 * v) / radiusM;
  const endMass = shot.cueEndMassKg;
  if (endMass === undefined || massKg === undefined || side === 0) {
    return {
      velocity: { x: v * cos, y: v * sin },
      spin: { x: -k * vertical * sin, y: k * vertical * cos, z: k * side },
    };
  }
  if (!(endMass > 0) || !Number.isFinite(endMass) || !(massKg > 0) || !Number.isFinite(massKg)) {
    throw new SimInputError("invalid-shot", "cue end mass and ball mass must be greater than zero");
  }
  const c = Math.sqrt(Math.max(0, 1 - side * side - vertical * vertical));
  const tanAlpha = (2.5 * side * c) / (1 + massKg / endMass + 2.5 * c * c);
  const cosAlpha = 1 / Math.sqrt(1 + tanAlpha * tanAlpha);
  const sinAlpha = tanAlpha * cosAlpha;
  // The ball's direction: the aim turned by alpha, counter-clockwise for a hit on the right.
  const dx = cos * cosAlpha - sin * sinAlpha;
  const dy = sin * cosAlpha + cos * sinAlpha;
  return {
    velocity: { x: v * dx, y: v * dy },
    spin: {
      x: -k * vertical * dy,
      y: k * vertical * dx,
      z: k * (side * cosAlpha - c * sinAlpha),
    },
  };
}

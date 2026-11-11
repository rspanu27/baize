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
 */
export function strike(radiusM: number, shot: ShotInput): Impulsed {
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
  return {
    velocity: { x: v * cos, y: v * sin },
    spin: { x: -k * vertical * sin, y: k * vertical * cos, z: k * side },
  };
}

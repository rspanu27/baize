/**
 * Values for the contacts that give a shot its spin effects: ball against ball (throw) and
 * cue tip against ball (squirt). Used by the version 2 physics models.
 */

/**
 * Ball-ball sliding friction as a function of the speed at which the two surfaces rub,
 *   mu = a + b * exp(-c * speed), speed in m/s.
 * Friction between balls is higher when they rub slowly, which is why slow cut shots are
 * thrown more than fast ones.
 * Source: the fit used in D. G. Alciatore's technical proof TP A.14 ("The effects of cut
 * angle, speed, and spin on object ball throw"), as encoded in pooltool
 * (`AlciatoreBallBallFriction`, a = 9.951e-3, b = 0.108, c = 1.088:
 * https://github.com/ekiefl/pooltool/blob/main/pooltool/physics/resolve/ball_ball/friction.py).
 * UNVERIFIED against the original: the values were read from pooltool; the proof itself could
 * not be fetched to check them.
 * Measured for pool balls; used for every set because all are cast phenolic resin.
 */
export const BALL_BALL_FRICTION: { readonly a: number; readonly b: number; readonly c: number } = {
  a: 9.951e-3,
  b: 0.108,
  c: 1.088,
};

/**
 * Ball mass divided by the effective mass of the tip end of the cue. The larger it is, the
 * less the cue ball squirts off line when hit with side.
 * UNVERIFIED: chosen so that a hit at the miscue limit (half a radius of side) squirts by
 * about 2 degrees, the middle of the 1.5 to 2.5 degrees commonly reported for ordinary cues
 * (Alciatore's squirt articles describe this range; the pages could not be fetched to quote
 * a number). With the squirt formula in `packages/physics/src/strike.ts`,
 * tan(alpha) = 1.083 / (2.875 + ratio), a ratio of 28 gives 2.0 degrees.
 */
export const BALL_TO_CUE_END_MASS_RATIO = 28;

/** Effective tip-end mass of an ordinary cue for a ball of the given mass, kg. */
export function cueEndMassKg(ballMassKg: number): number {
  return ballMassKg / BALL_TO_CUE_END_MASS_RATIO;
}

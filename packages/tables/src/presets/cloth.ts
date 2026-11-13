import type { ClothSpec, ClothSpeed } from "../types";

export interface ClothColour {
  id: string;
  name: string;
  hex: string;
}

export interface ClothCoefficients {
  slidingFriction: number;
  rollingResistance: number;
  spinningFriction: number;
}

/**
 * Cloth colour presets. Colours are visual only and do not affect physics. All hex values are a
 * visual choice approximating typical cloth shades (no single maker's chart was used).
 */
export const CLOTH_COLOURS: readonly ClothColour[] = [
  { id: "green", name: "Green", hex: "#1f6b3a" },
  { id: "blue", name: "Blue", hex: "#1f4f8f" },
  { id: "tournament-blue", name: "Tournament blue", hex: "#2a7fa8" },
  { id: "red", name: "Red", hex: "#a3262a" },
  { id: "grey", name: "Grey", hex: "#7a7f85" },
  { id: "black", name: "Black", hex: "#1c1c1f" },
  { id: "purple", name: "Purple", hex: "#5b3a8a" },
];

/**
 * Friction coefficients per speed preset.
 *
 * Sources:
 * - Dr. Dave Alciatore, "approximate values for pool equipment physical properties"
 *   (https://drdavepoolinfo.com/?p=2349): ball-cloth rolling resistance 0.005-0.015; sliding
 *   friction 0.15-0.4, typical 0.2; cloth spin deceleration 5-15 rad/s^2.
 * - pooltool (Apache-2.0, https://github.com/ekiefl/pooltool; defaults at
 *   https://pooltool.readthedocs.io/en/latest/_modules/pooltool/objects/ball/params.html):
 *   u_s = 0.2, u_r = 0.01, u_sp = (4/9) * R with R = 0.028575 m. Its spin model decays vertical
 *   spin at 5 * u_sp * g / (2R) rad/s^2, the same form as this project's definition.
 *
 * Project definition of spinningFriction mu_sp (dimensionless): vertical-axis spin decays at
 * 5 * mu_sp * g / (2R) rad/s^2. Hence mu_sp = alpha * 2R / (5g). Reference radius R = 0.028575 m
 * (pool ball), g = 9.80665 m/s^2, so mu_sp = alpha * 0.05715 / 49.03325 = alpha * 0.0011655.
 * pooltool's u_sp = (4/9) R = 0.012700 m, giving alpha = 5 * 0.0127 * g / (2R) = 10.89 rad/s^2,
 * and mu_sp = 0.0127 (the same number, because the R in u_sp cancels against the 1/R above).
 *
 * Speed choices (rolling resistance strictly decreases slow -> fast):
 * - medium: pooltool defaults (u_s 0.2, u_r 0.01, mu_sp 0.0127 = 10.9 rad/s^2).
 * - slow / fast: rolling resistance at the ends of Dr. Dave's range (0.015 / 0.005); spin
 *   deceleration at the ends of his range (15 / 5 rad/s^2): mu_sp = 15 * 0.0011655 = 0.01748
 *   and 5 * 0.0011655 = 0.00583. Sliding friction 0.22 / 0.18 is an UNVERIFIED small offset
 *   around the 0.2 typical value (within the published 0.15-0.4 range); no source ties sliding
 *   friction to cloth speed.
 */
export const CLOTH_SPEEDS: Readonly<Record<ClothSpeed, ClothCoefficients>> = {
  slow: {
    slidingFriction: 0.22,
    rollingResistance: 0.015,
    spinningFriction: 0.01748,
  },
  medium: {
    slidingFriction: 0.2,
    rollingResistance: 0.01,
    spinningFriction: 0.0127,
  },
  fast: {
    slidingFriction: 0.18,
    rollingResistance: 0.005,
    spinningFriction: 0.00583,
  },
};

/** Builds a ClothSpec from a colour and a speed preset. No nap. */
export const makeCloth = (colourHex: string, speed: ClothSpeed): ClothSpec => ({
  colour: colourHex,
  speedPreset: speed,
  slidingFriction: CLOTH_SPEEDS[speed].slidingFriction,
  rollingResistance: CLOTH_SPEEDS[speed].rollingResistance,
  spinningFriction: CLOTH_SPEEDS[speed].spinningFriction,
});

/**
 * Nap push at full strength (a `nap.strength` of 1, "heavy" in the editor), as a fraction of
 * the cloth's rolling resistance. The physics pushes a rolling ball along the nap with this
 * fraction of the force that slows it down.
 *
 * What it means on the table: a ball rolled across the nap that comes to rest after a
 * distance d has drifted by about ratio * d / 2 in the direction of the nap (2.2 cm in 1.5 m
 * at 0.03), most of it in the last part of the roll, and a ball rolled with the nap runs
 * (1 + ratio) / (1 - ratio) times as far as one rolled against it (6 % further at 0.03).
 *
 * UNVERIFIED: no measurement of nap drift was found. The direction of the effect follows
 * snooker coaching notes: Frank Callan, "The Nap of the Cloth"
 * (https://www.fcsnooker.co.uk/coaching/intermediate/the_nap/the_nap.htm), describes a slow
 * ball played against the nap towards a middle pocket falling away towards the side cushion
 * on a heavy nap, and the effect mattering only for slow balls. The size was chosen so that
 * a ball rolled a metre and a half across a heavy nap misses its line by a little under half
 * a ball.
 */
export const NAP_FULL_DRIFT_RATIO = 0.03;

/**
 * The nap of a cloth as the physics takes it (`ClothInput.napDrift` in `@baize/physics`), or
 * undefined for a cloth with no nap. A strength outside 0 to 1 is taken as the nearer end.
 * `fullRatio` replaces `NAP_FULL_DRIFT_RATIO` (for trying other values; never stored).
 */
export function napDrift(
  cloth: Pick<ClothSpec, "rollingResistance" | "nap">,
  fullRatio: number = NAP_FULL_DRIFT_RATIO,
): { directionRad: number; coefficient: number } | undefined {
  const nap = cloth.nap;
  if (!nap || !Number.isFinite(nap.strength) || !Number.isFinite(nap.directionRad)) {
    return undefined;
  }
  const strength = nap.strength < 0 ? 0 : nap.strength > 1 ? 1 : nap.strength;
  if (strength === 0) return undefined;
  return {
    directionRad: nap.directionRad,
    coefficient: strength * fullRatio * cloth.rollingResistance,
  };
}

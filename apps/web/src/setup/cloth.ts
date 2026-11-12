import { CLOTH_SPEEDS } from "@baize/tables";
import type { ClothCoefficients, ClothSpec, ClothSpeed } from "@baize/tables";

/** Pure helpers that return a new `ClothSpec`; the input is never changed. */

export type CoefficientKey = keyof ClothCoefficients;
export type NapLevel = "none" | "light" | "heavy";

/** Nap strength for each level; "none" removes the field. */
export const NAP_STRENGTH: Readonly<Record<Exclude<NapLevel, "none">, number>> = {
  light: 0.5,
  heavy: 1,
};
/** Nap runs from the baulk end to the top of the table. */
export const NAP_DIRECTION_RAD = Math.PI / 2;

export function withColour(cloth: ClothSpec, colour: string): ClothSpec {
  return { ...cloth, colour };
}

/** Sets the preset's exact coefficients; colour and nap stay. */
export function withSpeed(cloth: ClothSpec, speed: ClothSpeed): ClothSpec {
  return { ...cloth, ...CLOTH_SPEEDS[speed], speedPreset: speed };
}

/**
 * Sets one coefficient and marks the cloth "custom". A value that is not a finite number
 * greater than zero is rejected: the result is `undefined` and nothing should be applied.
 */
export function withCoefficient(
  cloth: ClothSpec,
  key: CoefficientKey,
  value: number,
): ClothSpec | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return { ...cloth, [key]: value, speedPreset: "custom" };
}

export function withNap(cloth: ClothSpec, level: NapLevel): ClothSpec {
  if (level === "none") {
    const rest: ClothSpec = { ...cloth };
    delete rest.nap;
    return rest;
  }
  return { ...cloth, nap: { directionRad: NAP_DIRECTION_RAD, strength: NAP_STRENGTH[level] } };
}

/** The nearest level to what the cloth has (documents may hold other strengths). */
export function napLevelOf(cloth: ClothSpec): NapLevel {
  const s = cloth.nap?.strength ?? 0;
  if (s <= 0.25) return "none";
  return s < 0.75 ? "light" : "heavy";
}

/** Reads a coefficient typed by a person; undefined if empty, not a number, or not above zero. */
export function parseCoefficient(text: string): number | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "" || !/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Same colour, ignoring letter case. */
export function sameColour(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

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

/** Cloth colour presets (visual only). Filled in by task 1.3. */
export const CLOTH_COLOURS: readonly ClothColour[] = [];

/** Friction coefficients per speed preset, each with a source comment. Filled in by task 1.3. */
export const CLOTH_SPEEDS: Readonly<Record<ClothSpeed, ClothCoefficients>> = {
  slow: {
    slidingFriction: Number.NaN,
    rollingResistance: Number.NaN,
    spinningFriction: Number.NaN,
  },
  medium: {
    slidingFriction: Number.NaN,
    rollingResistance: Number.NaN,
    spinningFriction: Number.NaN,
  },
  fast: {
    slidingFriction: Number.NaN,
    rollingResistance: Number.NaN,
    spinningFriction: Number.NaN,
  },
};

/** Builds a ClothSpec from a colour and a speed preset. Implemented by task 1.3. */
export const makeCloth: (colourHex: string, speed: ClothSpeed) => ClothSpec = () => {
  throw new Error("not implemented");
};

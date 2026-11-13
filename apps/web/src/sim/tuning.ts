import {
  BALL_BALL_FRICTION,
  BALL_TO_CUE_END_MASS_RATIO,
  NAP_FULL_DRIFT_RATIO,
} from "@baize/tables";
import { create } from "zustand";
import type { Scene } from "../doc/resolve";

/**
 * Physics numbers that can be changed while the editor is open, to see what each one does.
 *
 * These are the values that are not part of a diagram: they come from `@baize/tables` (or
 * from the table and ball set) and are the same for everyone who opens a link. A change made
 * here lasts until the page is reloaded and is never written into the document, the link or
 * the undo history. Cloth friction is not here because it is part of the diagram (Setup).
 */

export type TuningKey =
  | "cushionRestitution"
  | "cushionFriction"
  | "ballRestitution"
  | "ballFrictionA"
  | "ballFrictionB"
  | "ballFrictionC"
  | "cueEndMassRatio"
  | "napFullRatio";

/** Only the values that have been changed. */
export type Tuning = Readonly<Partial<Record<TuningKey, number>>>;

/** No changes: the simulator behaves exactly as it does without tuning. */
export const NO_TUNING: Tuning = Object.freeze({});

export interface TuningField {
  key: TuningKey;
  label: string;
  /** What the number does, in a few words. */
  hint: string;
  min: number;
  max: number;
  step: number;
  /** The value used when nothing has been changed. */
  standard: (scene: Scene) => number;
}

export const TUNING_FIELDS: readonly TuningField[] = [
  {
    key: "cushionRestitution",
    label: "Cushion bounce",
    hint: "Share of speed kept square off a cushion (0 to 1).",
    min: 0,
    max: 1,
    step: 0.01,
    standard: (scene) => scene.table.cushion.restitution,
  },
  {
    key: "cushionFriction",
    label: "Cushion friction",
    hint: "Grip between ball and cushion: how much side and angle change the rebound.",
    min: 0,
    max: 1,
    step: 0.01,
    standard: (scene) => scene.table.cushion.friction,
  },
  {
    key: "ballRestitution",
    label: "Ball bounce",
    hint: "Share of closing speed kept when two balls collide (0 to 1).",
    min: 0,
    max: 1,
    step: 0.01,
    standard: (scene) => scene.ballSet.restitution,
  },
  {
    key: "ballFrictionA",
    label: "Ball friction, fast",
    hint: "Friction between balls rubbing quickly. More gives more throw on hard shots.",
    min: 0,
    max: 1,
    step: 0.001,
    standard: () => BALL_BALL_FRICTION.a,
  },
  {
    key: "ballFrictionB",
    label: "Ball friction, slow extra",
    hint: "Added friction when balls rub slowly. More gives more throw on soft shots.",
    min: 0,
    max: 1,
    step: 0.001,
    standard: () => BALL_BALL_FRICTION.b,
  },
  {
    key: "ballFrictionC",
    label: "Ball friction, fall-off",
    hint: "How quickly the slow extra fades as the rubbing speed rises (per m/s).",
    min: 0,
    max: 20,
    step: 0.01,
    standard: () => BALL_BALL_FRICTION.c,
  },
  {
    key: "cueEndMassRatio",
    label: "Ball mass / cue end mass",
    hint: "Higher means a lighter cue end and less squirt with side.",
    min: 1,
    max: 500,
    step: 1,
    standard: () => BALL_TO_CUE_END_MASS_RATIO,
  },
  {
    key: "napFullRatio",
    label: "Heavy nap push",
    hint: "Nap push at heavy strength, as a share of rolling resistance (0 to 0.8).",
    min: 0,
    max: 0.8,
    step: 0.005,
    standard: () => NAP_FULL_DRIFT_RATIO,
  },
];

/** The field's value if it is a usable number inside the field's range, otherwise undefined. */
export function acceptTuning(field: TuningField, value: number): number | undefined {
  return Number.isFinite(value) && value >= field.min && value <= field.max ? value : undefined;
}

/** A tuning with one value set; a value equal to the standard one removes the change. */
export function withTuning(
  tuning: Tuning,
  field: TuningField,
  value: number,
  scene: Scene,
): Tuning {
  const next: Partial<Record<TuningKey, number>> = { ...tuning };
  if (value === field.standard(scene)) delete next[field.key];
  else next[field.key] = value;
  return Object.keys(next).length === 0 ? NO_TUNING : next;
}

export function isTuned(tuning: Tuning): boolean {
  return Object.keys(tuning).length > 0;
}

interface TuningState {
  tuning: Tuning;
  setTuning: (tuning: Tuning) => void;
  reset: () => void;
}

export const useTuningStore = create<TuningState>((set) => ({
  tuning: NO_TUNING,
  setTuning: (tuning) => {
    set({ tuning });
  },
  reset: () => {
    set({ tuning: NO_TUNING });
  },
}));

export function currentTuning(): Tuning {
  return useTuningStore.getState().tuning;
}

export function useTuning(): Tuning {
  return useTuningStore((s) => s.tuning);
}

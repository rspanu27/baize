import { CUE_BALL_COLOUR, ballAppearance } from "@baize/tables";

/**
 * How balls are drawn, for the editor and the playground: colour, stripe and number for every
 * ball kind of every game, plus the names used for accessibility.
 */

/**
 * A ball placed automatically (photo import) with a confidence below this is drawn as uncertain.
 * Design threshold: 0.6 marks "more likely wrong than a coin flip would excuse" without flagging
 * the many balls an importer is fairly sure about.
 */
export const LOW_CONFIDENCE = 0.6;

export function isLowConfidence(confidence: number | undefined): boolean {
  return confidence !== undefined && confidence < LOW_CONFIDENCE;
}

/** The cue ball's colour; the colours of all balls are defined in `@baize/tables`. */
export const CUE_COLOUR = CUE_BALL_COLOUR;

export interface BallLook {
  /** Main colour. */
  colour: string;
  /** Striped balls are white with a band of the main colour. */
  striped: boolean;
  /** Number shown on the ball, if any. */
  label: string;
}

/** How to draw a ball of a given kind ("cue", "1".."15", or a snooker colour). */
export function ballLook(kind: string): BallLook {
  const n = Number(kind);
  const numbered = Number.isInteger(n) && n >= 1 && n <= 15;
  return { ...ballAppearance(kind), label: numbered ? String(n) : "" };
}

/** Plain-words name of a ball: "9 ball", "cue ball", "red ball". */
export function ballName(kind: string): string {
  return `${kind} ball`;
}

/**
 * Outline of the coloured band on a striped ball, centred on the origin: the part of the disc
 * of radius `r` within `halfBand` of the horizontal axis.
 */
export function stripePath(r: number, halfBand: number): string {
  const h = Math.min(halfBand, r);
  const a = Math.sqrt(r * r - h * h);
  const f = (n: number): string => String(Math.round(n * 1e6) / 1e6);
  return (
    `M ${f(-a)} ${f(-h)} A ${f(r)} ${f(r)} 0 0 1 ${f(a)} ${f(-h)} ` +
    `L ${f(a)} ${f(h)} A ${f(r)} ${f(r)} 0 0 1 ${f(-a)} ${f(h)} Z`
  );
}

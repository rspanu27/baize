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

const POOL_COLOURS: Record<number, string> = {
  1: "#f2c200",
  2: "#1f4fbf",
  3: "#d12a2a",
  4: "#5b2a8c",
  5: "#f07a1a",
  6: "#1c7c4a",
  7: "#7a1f24",
  8: "#141414",
};

/** Snooker colours; blackball reds, yellows and black share them. */
const NAMED_COLOURS: Record<string, string> = {
  red: "#c8102e",
  yellow: "#f2c200",
  green: "#1c7c4a",
  brown: "#6b3f1d",
  blue: "#1f4fbf",
  pink: "#ef8fb0",
  black: "#141414",
};

export const CUE_COLOUR = "#fbfaf2";
const UNKNOWN_COLOUR = "#888888";

export interface BallLook {
  /** Main colour. */
  colour: string;
  /** Striped balls are white with a band of the main colour. */
  striped: boolean;
  /** Number shown on the ball, if any. */
  label: string;
}

function poolNumber(kind: string): number | undefined {
  const n = Number(kind);
  return Number.isInteger(n) && n >= 1 && n <= 15 ? n : undefined;
}

/** How to draw a ball of a given kind ("cue", "1".."15", or a snooker colour). */
export function ballLook(kind: string): BallLook {
  if (kind === "cue") return { colour: CUE_COLOUR, striped: false, label: "" };
  const n = poolNumber(kind);
  if (n !== undefined) {
    const base = n <= 8 ? n : n - 8;
    return { colour: POOL_COLOURS[base] ?? UNKNOWN_COLOUR, striped: n > 8, label: String(n) };
  }
  return { colour: NAMED_COLOURS[kind] ?? UNKNOWN_COLOUR, striped: false, label: "" };
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

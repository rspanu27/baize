import type { BallKind } from "../types";

/**
 * What each ball looks like: its main colour and whether it is striped. Used to draw balls
 * and, by the photo import, to tell balls apart by colour.
 *
 * Sources. Which colour belongs to which ball is fixed by the games: snooker's colours by the
 * rules of snooker; pool's 1 to 8 as yellow, blue, red, purple, orange, green, maroon and
 * black, with 9 to 15 as white balls carrying a band of the colour of the ball eight lower
 * (the standard numbered set, as described in the WPA equipment specifications). The exact
 * shades below are this project's visual choice of a typical set; makers differ, which is why
 * the photo import must not rely on exact matches.
 */

/** Pool 1 to 8; 9 to 15 are striped in the colour of the ball eight lower. */
const POOL_COLOURS: Readonly<Record<number, string>> = {
  1: "#f2c200", // yellow
  2: "#1f4fbf", // blue
  3: "#d12a2a", // red
  4: "#5b2a8c", // purple
  5: "#f07a1a", // orange
  6: "#1c7c4a", // green
  7: "#7a1f24", // maroon
  8: "#141414", // black
};

/** Snooker colours; blackball reds, yellows and the black share them. */
const NAMED_COLOURS: Readonly<Record<string, string>> = {
  red: "#c8102e",
  yellow: "#f2c200",
  green: "#1c7c4a",
  brown: "#6b3f1d",
  blue: "#1f4fbf",
  pink: "#ef8fb0",
  black: "#141414",
};

/** The cue ball: an off-white, as phenolic cue balls are. */
export const CUE_BALL_COLOUR = "#fbfaf2";

/** Colour for a kind that is not known (never the case for a `BallKind`). */
export const UNKNOWN_BALL_COLOUR = "#888888";

export interface BallAppearance {
  /** Main colour as #rrggbb. */
  colour: string;
  /** Striped balls are the cue ball's white with a band of the main colour. */
  striped: boolean;
}

/** How a ball of the given kind looks. Accepts any string so that callers need not narrow. */
export function ballAppearance(kind: BallKind | (string & {})): BallAppearance {
  if (kind === "cue") return { colour: CUE_BALL_COLOUR, striped: false };
  const n = Number(kind);
  if (Number.isInteger(n) && n >= 1 && n <= 15) {
    return { colour: POOL_COLOURS[n <= 8 ? n : n - 8] ?? UNKNOWN_BALL_COLOUR, striped: n > 8 };
  }
  return { colour: NAMED_COLOURS[kind] ?? UNKNOWN_BALL_COLOUR, striped: false };
}

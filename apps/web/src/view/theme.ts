import type { CSSProperties } from "react";
import type { DiagramStyle, DiagramTheme, PathLine, PathWeight } from "../doc/types";
import {
  LINE_OPACITY,
  MARKING_COLOUR,
  POCKET_COLOUR,
  RAIL_COLOUR,
  SIGHT_COLOUR,
  SPOT_OPACITY,
} from "./constants";
import { CUE_PATH_COLOUR, DARK_BALL_PATH_COLOUR, MARK_COLOUR } from "./pathArt";

/**
 * How each theme paints the diagram. Every colour here is a visual choice, not a measurement:
 * the table's size, pockets and cloth friction never depend on the theme, and the cloth colour
 * in the document is never changed (a theme only overrides how it is drawn).
 *
 * "table" is the look the editor always had, so its entries point at the shared constants.
 * Text and lines in "print" and "dark" are at least 4.5:1 against what they sit on (see
 * theme.test.ts).
 */

export interface ThemeColours {
  /** Paper or slide behind the whole drawing, rails included. Absent: transparent. */
  sheet?: string;
  /** Cloth. Absent: the document's own colour. */
  cloth?: string;
  rail: string;
  railOutline?: string;
  /** Absent: a darker shade of the cloth. */
  cushion?: string;
  cushionEdge?: string;
  pocket: string;
  marking: string;
  lineOpacity: number;
  spotOpacity: number;
  sight: string;

  /** Cue ball path (the white of the table theme would vanish on paper). */
  cuePath: string;
  /** Used instead of a ball colour too dark for the cloth. Absent: none is too dark. */
  darkPath?: string;
  /** Used instead of a ball colour too light for the cloth. Absent: none is too light. */
  lightPath?: string;
  /** Collision marks and final position rings. */
  mark: string;

  /** Ball outline, as colour, opacity and fraction of the radius. */
  ballOutline: string;
  ballOutlineOpacity: number;
  ballOutlineWidth: number;

  /** The "Baize ..." note printed on exports, which sits on the rail. */
  note: string;
  noteOpacity: number;

  captionBackground: string;
  captionText: string;

  /**
   * Colours for parts drawn from style sheets, passed down as CSS custom properties. Absent
   * for the table theme, whose style sheets already hold its colours.
   */
  css?: {
    aim: string;
    ghostFill: string;
    measure: string;
    measureLabel: string;
    measureLabelOutline: string;
    selection: string;
    focus: string;
    uncertain: string;
  };
}

const TABLE: ThemeColours = {
  rail: RAIL_COLOUR,
  pocket: POCKET_COLOUR,
  marking: MARKING_COLOUR,
  lineOpacity: LINE_OPACITY,
  spotOpacity: SPOT_OPACITY,
  sight: SIGHT_COLOUR,
  cuePath: CUE_PATH_COLOUR,
  darkPath: DARK_BALL_PATH_COLOUR,
  mark: MARK_COLOUR,
  ballOutline: "#000000",
  ballOutlineOpacity: 0.45,
  ballOutlineWidth: 0.06,
  note: "#ffffff",
  noteOpacity: 0.7,
  captionBackground: "#0f1b15",
  captionText: "#e8efe9",
};

const PRINT: ThemeColours = {
  sheet: "#ffffff",
  cloth: "#ffffff",
  rail: "#d6d6d6",
  railOutline: "#2b2b2b",
  cushion: "#c4c4c4",
  cushionEdge: "#2b2b2b",
  pocket: "#4a4a4a",
  marking: "#555555",
  lineOpacity: 1,
  spotOpacity: 1,
  sight: "#2b2b2b",
  cuePath: "#111111",
  lightPath: "#6b6b6b",
  mark: "#111111",
  ballOutline: "#1c1c1c",
  ballOutlineOpacity: 1,
  ballOutlineWidth: 0.07,
  note: "#222222",
  noteOpacity: 1,
  captionBackground: "#ffffff",
  captionText: "#1a1a1a",
  css: {
    aim: "#8a5a00",
    ghostFill: "rgba(0, 0, 0, 0.06)",
    measure: "#0b5cad",
    measureLabel: "#111111",
    measureLabelOutline: "#ffffff",
    selection: "#0b3d91",
    focus: "#0b5cad",
    uncertain: "#a35a00",
  },
};

const DARK: ThemeColours = {
  sheet: "#0a0d10",
  cloth: "#12161a",
  rail: "#262d34",
  cushion: "#1f262c",
  cushionEdge: "#3a444d",
  pocket: "#000000",
  marking: "#aab2ba",
  lineOpacity: 0.7,
  spotOpacity: 0.8,
  sight: "#8d97a0",
  cuePath: "#f5f5f5",
  darkPath: "#d4d4d4",
  mark: "#f5f5f5",
  ballOutline: "#000000",
  ballOutlineOpacity: 0.6,
  ballOutlineWidth: 0.06,
  note: "#c8d0d8",
  noteOpacity: 1,
  captionBackground: "#0a0d10",
  captionText: "#e6eaee",
  css: {
    aim: "#ffe27a",
    ghostFill: "rgba(255, 255, 255, 0.12)",
    measure: "#7fd1ff",
    measureLabel: "#ffffff",
    measureLabelOutline: "#0a0d10",
    selection: "#ffffff",
    focus: "#7fd1ff",
    uncertain: "#ffb020",
  },
};

export const THEMES: Record<DiagramTheme, ThemeColours> = {
  table: TABLE,
  print: PRINT,
  dark: DARK,
};

/** Names for the "Look" panel, in the order they are offered. */
export const THEME_LABELS: readonly { value: DiagramTheme; label: string }[] = [
  { value: "table", label: "Table colours" },
  { value: "print", label: "Print (white)" },
  { value: "dark", label: "Dark" },
];

/** How a style is applied to drawing, with every default filled in. */
export interface DrawStyle {
  theme: DiagramTheme;
  colours: ThemeColours;
  pathLine: PathLine;
  pathWeight: PathWeight;
  ballLabels: boolean;
  caption: string | undefined;
}

export function resolveDrawStyle(style: DiagramStyle | undefined): DrawStyle {
  const theme = style?.theme ?? "table";
  return {
    theme,
    colours: THEMES[theme],
    pathLine: style?.pathLine ?? "solid",
    pathWeight: style?.pathWeight ?? "normal",
    ballLabels: style?.ballLabels !== false,
    caption: style?.caption?.trim() ? style.caption : undefined,
  };
}

/** Custom properties that carry a theme's colours to the style sheets; none for "table". */
export function themeCssVars(colours: ThemeColours): CSSProperties | undefined {
  const c = colours.css;
  if (!c) return undefined;
  return {
    "--baize-aim": c.aim,
    "--baize-ghost-fill": c.ghostFill,
    "--baize-measure": c.measure,
    "--baize-measure-label": c.measureLabel,
    "--baize-measure-label-outline": c.measureLabelOutline,
    "--baize-selection": c.selection,
    "--baize-focus": c.focus,
    "--baize-uncertain": c.uncertain,
  } as CSSProperties;
}

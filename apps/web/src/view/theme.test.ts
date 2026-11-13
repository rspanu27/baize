import { describe, expect, test } from "vitest";
import { DEFAULT_CLOTH_COLOUR } from "../doc/resolve";
import { pathColour } from "./pathArt";
import { THEMES, resolveDrawStyle, themeCssVars } from "./theme";
import type { ThemeColours } from "./theme";

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`not a hex colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio of two opaque colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Colour `fg` at `opacity` drawn over `bg`. */
function over(fg: string, opacity: number, bg: string): string {
  const f = rgb(fg);
  const b = rgb(bg);
  const mix = f.map((v, i) => Math.round(v * opacity + (b[i] ?? 0) * (1 - opacity)));
  return `#${mix.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const MIN = 4.5;

describe("contrast helper", () => {
  test("black on white is 21:1", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe.each(Object.entries(THEMES) as [string, ThemeColours][])("theme %s", (name, t) => {
  const cloth = t.cloth ?? DEFAULT_CLOTH_COLOUR;

  test("the caption text reads on the caption band", () => {
    expect(contrast(t.captionText, t.captionBackground)).toBeGreaterThanOrEqual(MIN);
  });

  test("the export note reads on the rail", () => {
    expect(contrast(over(t.note, t.noteOpacity, t.rail), t.rail)).toBeGreaterThanOrEqual(MIN);
  });

  test("path colours, marks and the cue ball path read on the cloth", () => {
    expect(contrast(t.cuePath, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.mark, cloth)).toBeGreaterThanOrEqual(MIN);
    // Every ball colour either reads as it is or is replaced by the theme (the table look keeps
    // ball colours as they always were).
    if (name === "table") return;
    for (const ball of ["#f2c200", "#1f4fbf", "#c8102e", "#141414", "#ef8fb0", "#f07a1a"]) {
      const drawn = pathColour("other", ball, t);
      expect(contrast(drawn, cloth), `${ball} drawn as ${drawn}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("lines the theme draws as markings read on the cloth (not the table look)", () => {
    // The table theme keeps its faint markings: they are guides, not information.
    if (name === "table") return;
    expect(contrast(over(t.marking, t.lineOpacity, cloth), cloth)).toBeGreaterThanOrEqual(MIN);
  });

  test("style sheet colours read on the cloth", () => {
    if (!t.css) return;
    expect(contrast(t.css.aim, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.css.measure, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.css.selection, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.css.focus, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.css.uncertain, cloth)).toBeGreaterThanOrEqual(MIN);
    expect(contrast(t.css.measureLabel, t.css.measureLabelOutline)).toBeGreaterThanOrEqual(MIN);
  });
});

describe("the default look", () => {
  test("white and the yellow aim line read on the default cloth", () => {
    expect(contrast("#ffffff", DEFAULT_CLOTH_COLOUR)).toBeGreaterThanOrEqual(MIN);
    expect(contrast("#ffe27a", DEFAULT_CLOTH_COLOUR)).toBeGreaterThanOrEqual(3);
    // The yellow aim line and light blue measuring line have always been a little under 4.5:1
    // on this cloth (they are lines, so the 3:1 for graphics applies); the table look is kept.
    expect(contrast("#7fd1ff", DEFAULT_CLOTH_COLOUR)).toBeGreaterThanOrEqual(3);
  });
});

describe("resolveDrawStyle", () => {
  test("absent, empty and explicit defaults are the same style", () => {
    const a = resolveDrawStyle(undefined);
    expect(resolveDrawStyle({})).toEqual(a);
    expect(
      resolveDrawStyle({
        theme: "table",
        pathLine: "solid",
        pathWeight: "normal",
        ballLabels: true,
      }),
    ).toEqual(a);
  });

  test("a blank caption is no caption", () => {
    expect(resolveDrawStyle({ caption: "  " }).caption).toBeUndefined();
    expect(resolveDrawStyle({ caption: "Break" }).caption).toBe("Break");
  });

  test("only themes other than the table pass colours to the style sheets", () => {
    expect(themeCssVars(THEMES.table)).toBeUndefined();
    expect(themeCssVars(THEMES.print)).toMatchObject({ "--baize-aim": THEMES.print.css?.aim });
    expect(themeCssVars(THEMES.dark)).toBeDefined();
  });

  test("print draws a white cloth, whatever the document says", () => {
    expect(THEMES.print.cloth).toBe("#ffffff");
    expect(THEMES.print.sheet).toBe("#ffffff");
  });
});

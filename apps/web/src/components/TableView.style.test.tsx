import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import { CAPTION_MAX_LENGTH } from "../doc/types";
import type { DiagramStyle } from "../doc/types";
import { THEMES } from "../view/theme";
import { TableView } from "./TableView";

function sceneFor(id: string, colour?: string): Scene {
  const doc = newDoc(id);
  const r = resolveDoc(colour ? { ...doc, cloth: { ...doc.cloth, colour } } : doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

function render(scene: Scene, style?: DiagramStyle): string {
  return renderToStaticMarkup(<TableView scene={scene} orientation="landscape" style={style} />);
}

function viewBox(markup: string): number[] {
  const m = /viewBox="([^"]+)"/.exec(markup);
  if (!m?.[1]) throw new Error("no viewBox");
  return m[1].split(" ").map(Number);
}

const scene = sceneFor("pool-9@1");

describe("TableView style", () => {
  test("an absent style, an empty one and explicit defaults draw the same markup", () => {
    const plain = render(scene);
    expect(render(scene, {})).toBe(plain);
    expect(
      render(scene, { theme: "table", pathLine: "solid", pathWeight: "normal", ballLabels: true }),
    ).toBe(plain);
    expect(plain).not.toContain("data-theme");
    expect(plain).not.toContain("--baize");
    expect(plain).not.toContain("data-sheet");
    expect(plain).not.toContain("data-caption");
  });

  test("the table theme keeps the document's cloth, rails and pockets", () => {
    const markup = render(sceneFor("pool-9@1", "#336699"));
    expect(markup).toContain('fill="#336699"');
    expect(markup).toContain(`fill="${THEMES.table.rail}"`);
    expect(markup).toContain(`fill="${THEMES.table.pocket}"`);
  });

  test("each theme changes the cloth; print is white; the document is untouched", () => {
    const blue = sceneFor("pool-9@1", "#336699");
    const table = render(blue);
    const print = render(blue, { theme: "print" });
    const dark = render(blue, { theme: "dark" });
    expect(print).not.toContain("#336699");
    expect(dark).not.toContain("#336699");
    expect(print).toContain('data-theme="print"');
    expect(dark).toContain('data-theme="dark"');
    expect(new Set([table, print, dark]).size).toBe(3);
    // The cloth rectangle is the one drawn after the rails.
    const bed = (m: string) =>
      /<rect[^>]*rx="[^"]*"[^>]*><\/rect><rect[^>]*fill="([^"]+)"/.exec(m)?.[1];
    expect(bed(table)).toBe("#336699");
    expect(bed(print)).toBe("#ffffff");
    expect(bed(dark)).toBe(THEMES.dark.cloth);
    expect(blue.cloth.colour).toBe("#336699");
  });

  test("print and dark draw a sheet behind the table; print rails have a thin outline", () => {
    const print = render(scene, { theme: "print" });
    expect(print).toContain(`data-sheet="" `);
    expect(print).toContain(`stroke="${THEMES.print.railOutline ?? "none"}"`);
    expect(render(scene, { theme: "dark" })).toContain("--baize-aim");
  });

  test("without a caption the viewBox is the table alone", () => {
    const [x, y, w, h] = viewBox(render(scene)) as [number, number, number, number];
    expect(viewBox(render(scene, { theme: "print" }))).toEqual([x, y, w, h]);
    expect(render(scene)).not.toContain("<text");
  });

  test("a caption is drawn as text in a band that extends the viewBox downwards", () => {
    const [x, y, w, h] = viewBox(render(scene)) as [number, number, number, number];
    const markup = render(scene, { caption: "Break shot, 9 ball" });
    const [cx, cy, cw, ch] = viewBox(markup) as [number, number, number, number];
    expect([cx, cy, cw]).toEqual([x, y, w]);
    expect(ch).toBeGreaterThan(h);
    expect(ch - h).toBeCloseTo(w * 0.07, 6);
    expect(markup).toContain(">Break shot, 9 ball</text>");
    expect(markup).toContain('text-anchor="middle"');
    // A short caption is not squeezed.
    expect(markup).not.toContain("textLength");
  });

  test("a scaled table gets a band that scales with it", () => {
    const small = sceneFor("pool-9@1");
    const big = sceneFor("snooker-12@1");
    const band = (s: Scene) => {
      const [, , w, h] = viewBox(render(s)) as [number, number, number, number];
      const [, , , h2] = viewBox(render(s, { caption: "x" })) as [number, number, number, number];
      return (h2 - h) / w;
    };
    expect(band(small)).toBeCloseTo(band(big), 9);
  });

  test("a caption of the longest length is squeezed to fit the width", () => {
    const long = "W".repeat(CAPTION_MAX_LENGTH);
    const markup = render(scene, { caption: long });
    const [, , w] = viewBox(markup) as [number, number, number, number];
    const fit = /textLength="([\d.]+)"/.exec(markup);
    expect(fit).not.toBeNull();
    const scale = /scale\(([\d.e-]+)\)\)?"/.exec(markup.slice(markup.indexOf("<text")));
    // textLength is in the text's own units; scaled it must be inside the drawing's width.
    expect(Number(fit?.[1]) * Number(scale?.[1])).toBeLessThanOrEqual(w);
    expect(markup).toContain('lengthAdjust="spacingAndGlyphs"');
  });

  test("the caption band is coloured for the theme", () => {
    expect(render(scene, { theme: "print", caption: "A" })).toContain(
      `fill="${THEMES.print.captionText}"`,
    );
    expect(render(scene, { theme: "dark", caption: "A" })).toContain(
      `fill="${THEMES.dark.captionText}"`,
    );
  });
});

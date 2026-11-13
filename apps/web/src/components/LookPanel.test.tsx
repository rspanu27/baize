import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { CAPTION_MAX_LENGTH } from "../doc/types";
import type { DiagramStyle } from "../doc/types";
import { LookPanelView } from "./LookPanel";

function render(style?: DiagramStyle): string {
  return renderToStaticMarkup(
    <LookPanelView style={style} onChange={vi.fn()} onCaptionDone={vi.fn()} />,
  ).replaceAll("<!-- -->", "");
}

/** The select whose label has this text, as markup. */
function selectFor(markup: string, label: string): string {
  const l = new RegExp(`<label for="([^"]+)">${label}</label>`).exec(markup);
  if (!l?.[1]) throw new Error(`no label ${label}`);
  const s = new RegExp(`<select id="${l[1].replace(/:/g, ":")}"[\\s\\S]*?</select>`).exec(markup);
  if (!s) throw new Error(`label ${label} is not tied to a select`);
  return s[0];
}

function selected(select: string): string | undefined {
  return /<option value="([^"]*)" selected=""/.exec(select)?.[1];
}

describe("LookPanelView", () => {
  test("every control has a visible label tied to it", () => {
    const markup = render();
    for (const label of ["Theme", "Path line", "Path weight"]) {
      expect(selectFor(markup, label)).toContain("<option");
    }
    const caption = /<label for="([^"]+)">Caption<\/label><input id="([^"]+)"/.exec(markup);
    expect(caption?.[1]).toBeDefined();
    expect(caption?.[1]).toBe(caption?.[2]);
    const check =
      /<input id="([^"]+)" type="checkbox"[^>]*\/><label for="([^"]+)">Numbers on balls/.exec(
        markup,
      );
    expect(check?.[1]).toBe(check?.[2]);
    expect(markup).toContain("<h2>Look</h2>");
  });

  test("offers the three themes by name", () => {
    const theme = selectFor(render(), "Theme");
    expect(theme).toContain(">Table colours<");
    expect(theme).toContain(">Print (white)<");
    expect(theme).toContain(">Dark<");
  });

  test("shows the defaults when there is no style", () => {
    const markup = render();
    expect(selected(selectFor(markup, "Theme"))).toBe("table");
    expect(selected(selectFor(markup, "Path line"))).toBe("solid");
    expect(selected(selectFor(markup, "Path weight"))).toBe("normal");
    expect(markup).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(markup).toContain(`0 / ${String(CAPTION_MAX_LENGTH)}`);
  });

  test("shows the current values", () => {
    const markup = render({
      theme: "print",
      pathLine: "dashed",
      pathWeight: "thick",
      ballLabels: false,
      caption: "Cut the 9",
    });
    expect(selected(selectFor(markup, "Theme"))).toBe("print");
    expect(selected(selectFor(markup, "Path line"))).toBe("dashed");
    expect(selected(selectFor(markup, "Path weight"))).toBe("thick");
    expect(markup).not.toMatch(/type="checkbox"[^>]*checked=""/);
    expect(markup).toContain('value="Cut the 9"');
    expect(markup).toContain(`9 / ${String(CAPTION_MAX_LENGTH)}`);
  });

  test("the caption box is limited to the caption length and counts characters", () => {
    const markup = render({ caption: "x".repeat(CAPTION_MAX_LENGTH) });
    expect(markup).toContain(`maxLength="${String(CAPTION_MAX_LENGTH)}"`);
    expect(markup).toContain("140 / 140");
  });
});

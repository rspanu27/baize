import { BALL_SETS, TABLE_PRESETS, makeCloth } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { useEditor } from "../store/store";
import { setUnitSystem } from "../units/usePreference";
import { SetupPanel } from "./SetupPanel";

// Server rendering reads zustand's initial state, not what openDoc set. Read the live state
// instead, so the panel renders the document the test opened.
vi.mock("../store/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("../store/store")>();
  const useEditor = Object.assign(
    <T,>(selector: (s: ReturnType<typeof real.useEditor.getState>) => T): T =>
      selector(real.useEditor.getState()),
    real.useEditor,
  );
  return { ...real, useEditor, useDoc: () => real.useEditor.getState().history.present };
});

function render(doc: DiagramDoc): string {
  useEditor.getState().openDoc(doc);
  return renderToStaticMarkup(<SetupPanel />).replaceAll("<!-- -->", "");
}

/** The `<select>` with this id fragment, as markup. */
function selectMarkup(markup: string, idSuffix: string): string {
  const m = new RegExp(`<select id="[^"]*${idSuffix}"[\\s\\S]*?</select>`).exec(markup);
  if (!m) throw new Error(`no select ${idSuffix}`);
  return m[0];
}

function options(select: string): { value: string; selected: boolean }[] {
  return [...select.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map((m) => ({
    value: m[1] ?? "",
    selected: (m[2] ?? "").includes("selected"),
  }));
}

const customDoc = (over: Partial<DiagramDoc> = {}): DiagramDoc => ({
  ...newDoc("pool-9@1"),
  table: {
    custom: {
      game: "pool",
      lengthM: 2.54,
      widthM: 1.27,
      cornerMouthM: 0.1143,
      middleMouthM: 0.127,
    },
  },
  ...over,
});

beforeEach(() => {
  setUnitSystem("metric");
});

describe("SetupPanel", () => {
  test("table select lists every preset plus custom, with the document's preset selected", () => {
    const select = selectMarkup(render(newDoc("snooker-10@1")), "-table");
    const opts = options(select);
    expect(opts.map((o) => o.value)).toEqual([...TABLE_PRESETS.map((t) => t.id), "custom"]);
    expect(opts.filter((o) => o.selected).map((o) => o.value)).toEqual(["snooker-10@1"]);
    expect(select).toContain("Custom table…");
  });

  test("a preset shows no custom form but shows its playing area", () => {
    const markup = render(newDoc("pool-9@1"));
    expect(markup).not.toContain("Custom table</legend>");
    expect(markup).toContain("Playing area 2.54 m by 1.27 m");
  });

  test("a custom table shows the form with formatted values and custom selected", () => {
    const markup = render(customDoc());
    expect(markup).toContain("Custom table</legend>");
    expect(markup).toContain('value="2.54 m"');
    expect(markup).toContain('value="1.27 m"');
    expect(markup).toContain('value="114.3 mm"');
    expect(markup).toContain("Jaw shape");
    expect(options(selectMarkup(markup, "-table")).find((o) => o.selected)?.value).toBe("custom");
  });

  test("ball set select lists only sets of the table's game", () => {
    for (const [doc, game] of [
      [newDoc("snooker-12@1"), "snooker"],
      [newDoc("pool-9@1"), "pool"],
      [newDoc("blackball-7@1"), "blackball"],
      [customDoc({ ballSet: { preset: "pool-57@1" } }), "pool"],
    ] as const) {
      const opts = options(selectMarkup(render(doc), "-balls"));
      const expected = BALL_SETS.filter((b) => b.game === game).map((b) => b.id);
      expect(opts.map((o) => o.value)).toEqual(expected);
      expect(opts.find((o) => o.selected)?.value).toBe(doc.ballSet.preset);
    }
  });

  test("shows the ball diameter", () => {
    expect(render(newDoc("pool-9@1"))).toContain("Ball diameter 57.15 mm");
  });

  test("marks the current cloth colour and speed as pressed", () => {
    const doc = { ...newDoc("pool-9@1"), cloth: makeCloth("#1f4f8f", "fast") };
    const markup = render(doc);
    expect(markup).toMatch(/aria-label="Blue"[^>]*aria-pressed="true"/);
    expect(markup).toMatch(/aria-label="Green"[^>]*aria-pressed="false"/);
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Fast</);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>Slow</);
  });

  test("a custom colour presses no swatch", () => {
    const markup = render({ ...newDoc("pool-9@1"), cloth: makeCloth("#123456", "medium") });
    expect(markup).not.toMatch(/class="setup-swatch"[^>]*aria-pressed="true"/);
  });

  test("shows the nap note and the advanced coefficients", () => {
    const markup = render(newDoc("pool-9@1"));
    expect(markup).toContain(
      "Nap runs from the baulk end to the top. Slow balls drift with it and run further that way.",
    );
    expect(markup).toContain("Sliding friction");
    expect(markup).toContain("Rolling resistance");
    expect(markup).toContain("Spinning friction");
  });

  test("metric and imperial format the playing area differently, and the document is untouched", () => {
    const doc = newDoc("pool-9@1");
    setUnitSystem("metric");
    expect(render(doc)).toContain("Playing area 2.54 m by 1.27 m");
    setUnitSystem("imperial");
    const markup = render(doc);
    expect(markup).toContain("Playing area 8 ft 4 in by 4 ft 2 in");
    expect(markup).toMatch(/aria-pressed="true"[^>]*>Imperial</);
    expect(useEditor.getState().history.present).toBe(doc);
  });

  test("imperial shows custom fields in feet and inches", () => {
    setUnitSystem("imperial");
    expect(render(customDoc())).toContain('value="8 ft 4 in"');
  });

  test("a custom table with a bad ball size shows the message by the ball control", () => {
    const markup = render(customDoc({ ballSet: { preset: "pool-57@1", diameterM: 0.2 } }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("ball size");
  });
});

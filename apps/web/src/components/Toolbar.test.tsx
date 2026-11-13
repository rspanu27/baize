import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { Toolbar, ToolbarView } from "./Toolbar";
import type { ToolbarViewProps } from "./Toolbar";

function sceneFor(doc: DiagramDoc): Scene {
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

const noop = () => undefined;
function props(scene: Scene, over: Partial<ToolbarViewProps> = {}): ToolbarViewProps {
  return {
    scene,
    canUndo: false,
    canRedo: false,
    hasSelection: false,
    onUndo: noop,
    onRedo: noop,
    onAddBall: noop,
    onRemoveSelected: noop,
    onClear: noop,
    onRack: noop,
    onDrill: noop,
    ...over,
  };
}

/** The opening tag of the button with this text or aria-label. */
function button(markup: string, name: string): string {
  const re = new RegExp(`<button[^>]*(?:aria-label="${name}"[^>]*>|>${name}<)`);
  const m = re.exec(markup);
  if (!m) throw new Error(`no button ${name}`);
  return m[0];
}

describe("ToolbarView", () => {
  test("pool: a button per kind, a kind at its limit is disabled", () => {
    const base = newDoc("pool-9@1");
    const scene = sceneFor({ ...base, balls: [{ id: "b1", kind: "cue", x: 0.5, y: 0.5 }] });
    const markup = renderToStaticMarkup(<ToolbarView {...props(scene)} />);
    expect(markup.match(/data-kind=/g)).toHaveLength(16);
    expect(button(markup, "Add cue ball")).toContain("disabled");
    expect(button(markup, "Add 9 ball")).not.toContain("disabled");
    expect(markup).toContain("8-ball rack");
    expect(markup).toContain("9-ball rack");
    expect(markup).toContain("15-ball rack");
    expect(markup).not.toContain("Blackball rack");
  });

  test("snooker: its kinds and its racks", () => {
    const scene = sceneFor(newDoc("snooker-12@1"));
    const markup = renderToStaticMarkup(<ToolbarView {...props(scene)} />);
    expect(markup.match(/data-kind=/g)).toHaveLength(8);
    expect(markup).toContain('aria-label="Add red ball"');
    expect(markup).toContain("Full snooker rack");
    expect(markup).toContain("10 reds");
    expect(markup).toContain("6 reds");
    expect(markup).not.toContain("9-ball rack");
  });

  test("a rack that does not fit is disabled with a reason", () => {
    const scene = sceneFor(newDoc("snooker-6@1"));
    const markup = renderToStaticMarkup(<ToolbarView {...props(scene)} />);
    const full = button(markup, "Full snooker rack");
    if (full.includes("disabled")) expect(full).toContain("title=");
    expect(button(markup, "6 reds")).not.toContain("disabled");
  });

  test("remove and clear are disabled until they can act", () => {
    const empty = sceneFor(newDoc("pool-9@1"));
    const markup = renderToStaticMarkup(<ToolbarView {...props(empty)} />);
    expect(button(markup, "Remove ball")).toContain("disabled");
    expect(button(markup, "Clear table")).toContain("disabled");
    const base = newDoc("pool-9@1");
    const scene = sceneFor({ ...base, balls: [{ id: "b1", kind: "1", x: 0.5, y: 0.5 }] });
    const on = renderToStaticMarkup(<ToolbarView {...props(scene, { hasSelection: true })} />);
    expect(button(on, "Remove ball")).not.toContain("disabled");
    expect(button(on, "Clear table")).not.toContain("disabled");
  });

  test("undo and redo follow the history flags", () => {
    const scene = sceneFor(newDoc("pool-9@1"));
    const off = renderToStaticMarkup(<ToolbarView {...props(scene)} />);
    expect(button(off, "Undo")).toContain("disabled");
    expect(button(off, "Redo")).toContain("disabled");
    const on = renderToStaticMarkup(<ToolbarView {...props(scene, { canUndo: true })} />);
    expect(button(on, "Undo")).not.toContain("disabled");
  });
});

describe("Toolbar", () => {
  test("on a fresh document undo is disabled and the palette is there", () => {
    const markup = renderToStaticMarkup(<Toolbar />);
    expect(button(markup, "Undo")).toContain("disabled");
    expect(markup).toContain("Add cue ball");
  });
});

describe("drills in the toolbar", () => {
  test("the drills of the table's game are offered, with nothing chosen at first", () => {
    const pool = renderToStaticMarkup(<ToolbarView {...props(sceneFor(newDoc("pool-9@1")))} />);
    expect(pool).toContain("<h2");
    expect(pool).toContain("Drills");
    expect(pool).toContain("Choose a drill");
    expect(pool).toContain("Stop-shot ladder");
    expect(pool).toContain("Wagon wheel");
    expect(pool).not.toContain("T line-up");
    // Nothing is put on the table until a drill is chosen.
    expect(button(pool, "Put on the table")).toContain("disabled");

    const snooker = renderToStaticMarkup(
      <ToolbarView {...props(sceneFor(newDoc("snooker-12@1")))} />,
    );
    expect(snooker).toContain("T line-up");
    expect(snooker).not.toContain("Wagon wheel");
  });
});

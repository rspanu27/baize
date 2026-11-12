import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { loadLayout, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { simulateDoc } from "../sim/useSimulation";
import { STRONG_WIDTH_M, FAINT_WIDTH_M } from "../view/pathArt";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { PathsLayer } from "./PathsLayer";

// The static renderer reads the store's initial snapshot, so the document is supplied directly.
let current: DiagramDoc = newDoc("pool-9@1");
vi.mock("../store/store", () => ({ useDoc: () => current }));

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-9@1"), "table");
const set = must(getBallSet(table.defaultBallSetId), "set");

function breakDoc(showAll?: boolean): DiagramDoc {
  const racked = loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
  const doc = setShot(racked, { aimAngleRad: Math.PI / 2, speedMps: 7 });
  return showAll ? { ...doc, style: { showAllPaths: true } } : doc;
}

function render(doc: DiagramDoc, withPaths = true): string {
  current = doc;
  const sim = simulateDoc(doc);
  const view = makeViewTransform(table.playingArea, "landscape");
  return renderToStaticMarkup(
    <ViewTransformContext.Provider value={view}>
      <svg>
        <PathsLayer paths={withPaths ? sim.paths : undefined} />
      </svg>
    </ViewTransformContext.Provider>,
  );
}

function count(html: string, re: RegExp): number {
  return html.match(re)?.length ?? 0;
}

describe("PathsLayer", () => {
  beforeEach(() => {
    current = newDoc("pool-9@1");
  });

  test("nothing is drawn without paths", () => {
    expect(render(breakDoc(), false)).toBe("<svg></svg>");
  });

  test("the group does not capture pointer events", () => {
    expect(render(breakDoc())).toContain("pointer-events:none");
  });

  test("strong cue and first-object paths, more faint ones, one first contact", () => {
    const html = render(breakDoc());
    expect(html).toContain("cue ball path");
    expect(html).toContain("(first ball hit)");
    expect(count(html, /data-role="cue"/g)).toBe(1);
    expect(count(html, /data-role="first-object"/g)).toBe(1);
    expect(html).toContain(`stroke-width="${STRONG_WIDTH_M}"`);
    expect(html).toContain(`stroke-width="${FAINT_WIDTH_M}"`);
    expect(count(html, /data-faint="true"/g)).toBeGreaterThan(2);
    expect(count(html, /data-mark="first-contact"/g)).toBe(1);
  });

  test("one final outline per moved, unpocketed ball", () => {
    const doc = breakDoc();
    const paths = must(simulateDoc(doc).paths, "paths");
    const expected = paths.finals.filter((f) => f.moved && !f.pocketed).length;
    expect(expected).toBeGreaterThan(2);
    expect(count(render(doc), /data-final=/g)).toBe(expected);
  });

  test("show all: no path is faint", () => {
    const html = render(breakDoc(true));
    expect(html).not.toContain("data-faint");
    expect(html).not.toContain(`stroke-width="${FAINT_WIDTH_M}"`);
  });
});

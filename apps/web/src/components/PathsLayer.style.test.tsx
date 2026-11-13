import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { loadLayout, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc, DiagramStyle } from "../doc/types";
import { simulateDoc } from "../sim/useSimulation";
import { FAINT_WIDTH_M, STRONG_WIDTH_M } from "../view/pathArt";
import { DrawStyleContext } from "../view/drawStyleContext";
import { THEMES, resolveDrawStyle } from "../view/theme";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { PathsLayer } from "./PathsLayer";

let current: DiagramDoc = newDoc("pool-9@1");
vi.mock("../store/store", () => ({ useDoc: () => current }));

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-9@1"), "table");
const set = must(getBallSet(table.defaultBallSetId), "set");
const racked = loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
  source: "rack",
  mode: "replace",
});
const doc = setShot(racked, { aimAngleRad: Math.PI / 2, speedMps: 7 });
const sim = simulateDoc(doc);

function render(style: DiagramStyle | undefined): string {
  current = style ? { ...doc, style } : doc;
  const view = makeViewTransform(table.playingArea, "landscape");
  return renderToStaticMarkup(
    <DrawStyleContext.Provider value={resolveDrawStyle(style)}>
      <ViewTransformContext.Provider value={view}>
        <svg>
          <PathsLayer paths={sim.paths} />
        </svg>
      </ViewTransformContext.Provider>
    </DrawStyleContext.Provider>,
  );
}

/** The stroke-dasharray values of the ball paths (not the final-position rings). */
function pathDashes(html: string): string[] {
  const out: string[] = [];
  for (const g of html.matchAll(/<g data-path=[\s\S]*?<\/g>/g)) {
    for (const p of g[0].matchAll(/<path [^>]*>/g)) {
      out.push(/stroke-dasharray="([^"]+)"/.exec(p[0])?.[1] ?? "none");
    }
  }
  return out;
}

function pathWidths(html: string): number[] {
  const out: number[] = [];
  for (const g of html.matchAll(/<g data-path=[\s\S]*?<\/g>/g)) {
    for (const p of g[0].matchAll(/<path [^>]*>/g)) {
      out.push(Number(/stroke-width="([^"]+)"/.exec(p[0])?.[1]));
    }
  }
  return out;
}

describe("PathsLayer style", () => {
  test("no style, an empty style and explicit defaults draw identical markup", () => {
    const plain = render(undefined);
    expect(render({})).toBe(plain);
    expect(render({ theme: "table", pathLine: "solid", pathWeight: "normal" })).toBe(plain);
    expect(plain).toContain(`stroke-width="${STRONG_WIDTH_M}"`);
    expect(plain).toContain(`stroke-width="${FAINT_WIDTH_M}"`);
  });

  test("solid paths set a dash only where a ball slides", () => {
    const dashes = pathDashes(render(undefined));
    expect(dashes.length).toBeGreaterThan(2);
    // Faint paths and rolling stretches have none.
    expect(dashes).toContain("none");
  });

  test.each(["dashed", "dotted"] as const)("%s sets a dash array on every path", (line) => {
    const dashes = pathDashes(render({ pathLine: line }));
    expect(dashes.length).toBeGreaterThan(2);
    expect(dashes.every((d) => d !== "none")).toBe(true);
    expect(new Set(dashes).size).toBeGreaterThan(1); // strong and faint widths differ
    // One continuous line per ball: the pattern does not restart where sliding ends.
    expect(dashes.length).toBe(
      render({ pathLine: line }).match(/data-role=/g)?.length ?? Number.NaN,
    );
  });

  test("thin and thick scale the stroke widths; normal leaves them", () => {
    const normal = pathWidths(render(undefined));
    const thin = pathWidths(render({ pathWeight: "thin" }));
    const thick = pathWidths(render({ pathWeight: "thick" }));
    expect(thin).toHaveLength(normal.length);
    normal.forEach((w, i) => {
      expect(thin[i]).toBeCloseTo(w * 0.6, 5);
      expect(thick[i]).toBeCloseTo(w * 1.6, 5);
    });
    expect(render({ pathWeight: "normal" })).toBe(render(undefined));
  });

  test("the show-all emphasis still works with a weight and a line style", () => {
    const html = render({ showAllPaths: true, pathWeight: "thick", pathLine: "dashed" });
    expect(html).not.toContain("data-faint");
  });

  test("print draws the cue ball path and marks dark", () => {
    const html = render({ theme: "print" });
    const cue = /data-role="cue"[\s\S]*?<path [^>]*stroke="([^"]+)"/.exec(html)?.[1];
    expect(cue).toBe(THEMES.print.cuePath);
    expect(html).toContain(`stroke="${THEMES.print.mark}"`);
    expect(html).not.toContain('stroke="#ffffff"');
  });
});

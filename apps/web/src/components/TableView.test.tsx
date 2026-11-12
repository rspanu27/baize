import { TABLE_PRESETS } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { Orientation } from "../view/transform";
import { useViewTransform } from "../view/viewContext";
import { TableView } from "./TableView";

function sceneFor(id: string): Scene {
  const r = resolveDoc(newDoc(id));
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

function render(scene: Scene, orientation: Orientation): string {
  return renderToStaticMarkup(<TableView scene={scene} orientation={orientation} />);
}

function viewBox(markup: string): number[] {
  const m = /viewBox="([^"]+)"/.exec(markup);
  if (!m?.[1]) throw new Error("no viewBox");
  return m[1].split(" ").map(Number);
}

const orientations: Orientation[] = ["landscape", "portrait"];

describe.each(TABLE_PRESETS.map((t) => [t.id, t.game] as const))("%s", (id, game) => {
  describe.each(orientations)("%s", (orientation) => {
    const scene = sceneFor(id);
    const markup = render(scene, orientation);

    test("renders cleanly with the document's cloth colour", () => {
      expect(markup).not.toContain("NaN");
      expect(markup).toContain('role="img"');
      expect(markup).toContain('aria-label="');
      expect(markup).toContain(`fill="${scene.cloth.colour}"`);
    });

    test("the long side runs the way the orientation says", () => {
      const [, , w, h] = viewBox(markup) as [number, number, number, number];
      if (orientation === "landscape") expect(w).toBeGreaterThan(h);
      else expect(h).toBeGreaterThan(w);
    });

    test("six pockets and six cushions", () => {
      expect(markup.match(/fill="#0d0d0d"/g)).toHaveLength(6);
      expect(markup.match(/<path /g)?.length ?? 0).toBeGreaterThanOrEqual(6);
    });

    test("markings for the game", () => {
      const sights = markup.match(/fill="#e9dcc3"/g)?.length ?? 0;
      const arcs = markup.match(/ A /g)?.length ?? 0;
      if (game === "pool") expect(sights).toBe(18);
      else expect(sights).toBe(0);
      if (game === "snooker") {
        expect(arcs).toBe(1);
        expect(markup).toContain("<line ");
      }
    });
  });
});

describe("custom tables", () => {
  test("a custom table renders", () => {
    const doc = {
      ...newDoc("pool-8-pro@1"),
      table: {
        custom: {
          game: "pool" as const,
          lengthM: 2,
          widthM: 1,
          cornerMouthM: 0.1,
          middleMouthM: 0.11,
        },
      },
    };
    const r = resolveDoc(doc);
    if (!r.ok) throw new Error(r.problems.join(" "));
    const markup = render(r.scene, "portrait");
    expect(markup).not.toContain("NaN");
    expect(markup.match(/fill="#0d0d0d"/g)).toHaveLength(6);
    expect(markup.match(/fill="#e9dcc3"/g)).toHaveLength(18);
  });
});

describe("children", () => {
  test("are drawn inside the svg and can read the view transform", () => {
    function Probe() {
      const t = useViewTransform();
      return <circle data-orientation={t.orientation} />;
    }
    const markup = renderToStaticMarkup(
      <TableView scene={sceneFor("pool-8-pro@1")} orientation="portrait">
        <Probe />
      </TableView>,
    );
    expect(markup).toContain('data-orientation="portrait"');
    expect(markup.indexOf("data-orientation")).toBeLessThan(markup.lastIndexOf("</svg>"));
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramStyle } from "../doc/types";
import { DrawStyleContext } from "../view/drawStyleContext";
import { THEMES, resolveDrawStyle } from "../view/theme";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { BallBody } from "./BallBody";
import { BallsLayerView } from "./BallsLayer";

const resolved = resolveDoc({
  ...newDoc("pool-9@1"),
  balls: [
    { id: "b1", kind: "cue", x: 0.6, y: 0.6 },
    { id: "b2", kind: "9", x: 0.4, y: 1.5, confidence: 0.3 },
    { id: "b3", kind: "3", x: 0.8, y: 1.9 },
  ],
});
if (!resolved.ok) throw new Error("scene");
const scene: Scene = resolved.scene;

function renderLayer(style: DiagramStyle | undefined): string {
  const view = makeViewTransform(scene.table.playingArea, "landscape");
  return renderToStaticMarkup(
    <DrawStyleContext.Provider value={resolveDrawStyle(style)}>
      <ViewTransformContext.Provider value={view}>
        <svg>
          <BallsLayerView scene={scene} selectedBallId={undefined} />
        </svg>
      </ViewTransformContext.Provider>
    </DrawStyleContext.Provider>,
  );
}

function renderBall(kind: string, style: DiagramStyle | undefined): string {
  return renderToStaticMarkup(
    <DrawStyleContext.Provider value={resolveDrawStyle(style)}>
      <svg>
        <BallBody kind={kind} r={0.028} />
      </svg>
    </DrawStyleContext.Provider>,
  );
}

describe("BallsLayer style", () => {
  test("no style, an empty style and explicit defaults draw identical markup", () => {
    const plain = renderLayer(undefined);
    expect(renderLayer({})).toBe(plain);
    expect(renderLayer({ ballLabels: true, theme: "table" })).toBe(plain);
  });

  test("a pool ball has its number unless labels are off", () => {
    expect(renderBall("9", undefined)).toContain(">9</text>");
    const off = renderBall("9", { ballLabels: false });
    expect(off).not.toContain("<text");
    expect(off).not.toContain(">9<");
  });

  test("balls keep their colours and stripes when labels are off", () => {
    const on = renderBall("12", undefined);
    const off = renderBall("12", { ballLabels: false });
    expect(off).toContain("<path ");
    expect(off).toContain(on.match(/<path [^>]*fill="([^"]+)"/)?.[1] ?? "missing");
    expect(off).not.toContain("<text");
  });

  test("the uncertain mark goes with the labels, the name stays", () => {
    expect(renderLayer(undefined)).toContain("uncertain position</title>");
    const off = renderLayer({ ballLabels: false });
    expect(off).not.toContain("ball-uncertain-ring");
    expect(off).not.toContain(">?</text>");
    expect(off).toContain('aria-label="9 ball, uncertain position"');
    expect(off).not.toContain(">3</text>");
  });

  test("print gives balls a thin dark outline", () => {
    const html = renderBall("cue", { theme: "print" });
    expect(html).toContain(`stroke="${THEMES.print.ballOutline}"`);
    expect(html).toContain('stroke-opacity="1"');
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { BallsLayerView } from "./BallsLayer";

function sceneFor(doc: DiagramDoc): Scene {
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

const base = newDoc("pool-9@1");
const doc: DiagramDoc = {
  ...base,
  balls: [
    { id: "b1", kind: "cue", x: 0.6, y: 0.6 },
    { id: "b2", kind: "9", x: 0.4, y: 1.5, confidence: 0.3 },
    { id: "b3", kind: "3", x: 0.8, y: 1.9, confidence: 0.9 },
  ],
};

function render(scene: Scene, selectedBallId?: string): string {
  const view = makeViewTransform(scene.table.playingArea, "landscape");
  return renderToStaticMarkup(
    <ViewTransformContext.Provider value={view}>
      <svg>
        <BallsLayerView scene={scene} selectedBallId={selectedBallId} />
      </svg>
    </ViewTransformContext.Provider>,
  );
}

describe("BallsLayer", () => {
  const scene = sceneFor(doc);

  test("one focusable button per ball with an accessible name", () => {
    const markup = render(scene);
    expect(markup.match(/data-ball-id=/g)).toHaveLength(3);
    expect(markup.match(/role="button"/g)).toHaveLength(3);
    expect(markup.match(/tabindex="0"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="cue ball"');
    expect(markup).toContain('aria-label="3 ball"');
  });

  test("balls are drawn with their real radius", () => {
    const markup = render(scene);
    const radius = scene.ballSet.object.diameterM / 2;
    expect(scene.balls[0]?.radiusM).toBe(radius);
    expect(markup).toContain(`<circle r="${String(radius)}"`);
    expect(markup).not.toContain("NaN");
  });

  test("only the low-confidence ball is marked uncertain", () => {
    const markup = render(scene);
    expect(markup.match(/uncertain position<\/title>/g)).toHaveLength(1);
    expect(markup.match(/ball-uncertain-ring/g)).toHaveLength(1);
    expect(markup).toContain('aria-label="9 ball, uncertain position"');
    expect(markup).toContain(">?</text>");
  });

  test("balls without a confidence have no markers", () => {
    const certain = sceneFor({
      ...doc,
      balls: doc.balls.map(({ id, kind, x, y }) => ({ id, kind, x, y })),
    });
    expect(render(certain)).not.toContain("uncertain");
  });

  test("the selected ball has the selection ring", () => {
    expect(render(scene)).not.toContain("ball-selection");
    const markup = render(scene, "b3");
    expect(markup.match(/ball-selection/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
  });
});

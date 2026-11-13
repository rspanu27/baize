import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { docFromHash, docToHash } from "../doc/codec";
import { addMeasure, clearAnnotations, loadLayout, removeAnnotation, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { exportFileName, pixelSize } from "../export/exportDiagram";
import { aimReadout, describeHit } from "../shot/shotModel";
import { simulateDoc } from "../sim/useSimulation";
import { snapToBall } from "./MeasureLayer";
import { MeasurePanelView } from "./MeasurePanel";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-9@1"), "table");
const set = must(getBallSet(table.defaultBallSetId), "set");

function racked(): DiagramDoc {
  return loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
}

describe("measuring lines", () => {
  test("add, remove and clear; ids are never reused while a line is there", () => {
    let doc = addMeasure(newDoc("pool-9@1"), { x: 0.1, y: 0.2 }, { x: 0.4, y: 0.6 });
    doc = addMeasure(doc, { x: 0.5, y: 0.5 }, { x: 0.5, y: 1.5 });
    expect(doc.annotations.map((a) => a.id)).toEqual(["m1", "m2"]);
    doc = removeAnnotation(doc, "m1");
    doc = addMeasure(doc, { x: 0, y: 0 }, { x: 1, y: 1 });
    expect(doc.annotations.map((a) => a.id)).toEqual(["m2", "m3"]);
    expect(clearAnnotations(doc).annotations).toEqual([]);
  });

  test("a line of no length or with a broken end is not added", () => {
    const doc = newDoc("pool-9@1");
    expect(addMeasure(doc, { x: 0.3, y: 0.3 }, { x: 0.3, y: 0.3 })).toBe(doc);
    expect(addMeasure(doc, { x: Number.NaN, y: 0.3 }, { x: 0.5, y: 0.3 })).toBe(doc);
    expect(removeAnnotation(doc, "m9")).toBe(doc);
    expect(clearAnnotations(doc)).toBe(doc);
  });

  test("lines travel in a share link", async () => {
    const doc = addMeasure(racked(), { x: 0.25, y: 0.5 }, { x: 1, y: 2 });
    const back = await docFromHash(await docToHash(doc));
    expect(back?.ok).toBe(true);
    if (back?.ok) expect(back.doc.annotations).toEqual(doc.annotations);
  });

  test("an end on a ball snaps to its centre; elsewhere it stays put", () => {
    const balls = [
      { x: 0.5, y: 0.5, radiusM: 0.03 },
      { x: 0.55, y: 0.5, radiusM: 0.03 },
    ];
    expect(snapToBall({ x: 0.51, y: 0.51 }, balls)).toEqual({ x: 0.5, y: 0.5 });
    expect(snapToBall({ x: 0.545, y: 0.5 }, balls)).toEqual({ x: 0.55, y: 0.5 });
    expect(snapToBall({ x: 0.9, y: 0.9 }, balls)).toEqual({ x: 0.9, y: 0.9 });
  });

  test("the panel lists each line with its length", () => {
    const doc = addMeasure(newDoc("pool-9@1"), { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.6 });
    const html = renderToStaticMarkup(
      <MeasurePanelView
        measuring={false}
        annotations={doc.annotations}
        units="metric"
        onToggle={() => undefined}
        onRemove={() => undefined}
        onClear={() => undefined}
      />,
    );
    expect(html).toContain("Measure a distance");
    expect(html).toContain("Line 1: 50 cm");
    expect(html).not.toContain("Remove all");
  });
});

describe("aim readout", () => {
  test("straight at the head ball of the rack: a full-ball hit", () => {
    const scene = must(simulateDoc(setShot(racked(), { aimAngleRad: Math.PI / 2 })).scene, "scene");
    const readout = must(aimReadout(scene), "readout");
    expect(readout.cutAngleRad).toBeCloseTo(0, 9);
    const cue = must(
      scene.balls.find((b) => b.kind === "cue"),
      "cue",
    );
    const one = must(
      scene.balls.find((b) => b.id === readout.targetBallId),
      "target",
    );
    expect(readout.distanceM).toBeCloseTo(one.y - cue.y - cue.radiusM - one.radiusM, 9);
  });

  test("a half-ball hit is a 30 degree cut", () => {
    let doc = loadLayout(
      newDoc("pool-9@1"),
      {
        balls: [
          { kind: "cue", x: 0.5, y: 0.5 },
          { kind: "1", x: 0.5, y: 1.5 },
        ],
      },
      { source: "manual", mode: "replace" },
    );
    const r = set.object.diameterM / 2;
    // Aim at the edge of the object ball: the centres are one radius apart sideways.
    doc = setShot(doc, { aimAngleRad: Math.atan2(1, r / 1) > 0 ? Math.PI / 2 - Math.asin(r) : 0 });
    const readout = must(aimReadout(must(simulateDoc(doc).scene, "scene")), "readout");
    expect((readout.cutAngleRad * 180) / Math.PI).toBeGreaterThan(29);
    expect((readout.cutAngleRad * 180) / Math.PI).toBeLessThan(31.5);
    expect(aimReadout(must(simulateDoc(setShot(doc, { aimAngleRad: 0 })).scene, "scene"))).toBe(
      undefined,
    );
  });

  test("hits are named in fractions of the ball", () => {
    expect(describeHit(0)).toBe("full ball");
    expect(describeHit(Math.PI / 6)).toBe("half ball");
    expect(describeHit(Math.asin(0.75))).toBe("quarter ball");
    expect(describeHit((85 * Math.PI) / 180)).toBe("very thin");
    expect(describeHit((20 * Math.PI) / 180)).toBe("0.66 of the ball");
  });
});

describe("export helpers", () => {
  test("the picture keeps the shape of the drawing, long side as asked", () => {
    expect(pixelSize(2.88, 1.61, 2000)).toEqual({ width: 2000, height: 1118 });
    expect(pixelSize(1.61, 2.88, 2000)).toEqual({ width: 1118, height: 2000 });
    expect(pixelSize(0, 1, 500)).toEqual({ width: 500, height: 500 });
  });

  test("file names are plain", () => {
    expect(exportFileName("Pool 9 ft (WPA)", "2026-11-13", "png")).toBe(
      "baize-pool-9-ft-wpa-2026-11-13.png",
    );
    expect(exportFileName("  ", "2026-11-13", "svg")).toBe("baize-diagram-2026-11-13.svg");
  });
});

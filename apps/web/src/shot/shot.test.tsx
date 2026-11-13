import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ShotPanelView } from "../components/ShotPanel";
import type { ShotPanelActions } from "../components/ShotPanel";
import { loadLayout, setShot, setStyle } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { simulateDoc } from "../sim/useSimulation";
import {
  DEG,
  SPEED_STOPS,
  aimAt,
  aimGuide,
  aimKeyStep,
  aimReadout,
  angleToDegrees,
  clampTip,
  departureAngle,
  describeTip,
  nudgeAngle,
  rollInTableLengths,
  speedName,
  tipFromWidget,
} from "./shotModel";

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

const noop: ShotPanelActions = {
  setShot: () => undefined,
  clearShot: () => undefined,
  endGesture: () => undefined,
  setShowAllPaths: () => undefined,
};

function render(doc: DiagramDoc, selectedBallId?: string): string {
  const sim = simulateDoc(doc);
  return renderToStaticMarkup(
    <ShotPanelView
      doc={doc}
      scene={sim.scene}
      paths={sim.paths}
      selectedBallId={selectedBallId}
      units="metric"
      actions={noop}
    />,
  );
}

describe("aiming is smooth", () => {
  test("aimAt gives the exact direction to any point, with no rounding", () => {
    const cue = { x: 0.6, y: 0.5 };
    // Two targets a hundredth of a millimetre apart, two metres away: the angles differ by
    // about 0.0003 degrees, and both are kept.
    const a = must(aimAt(cue, { x: 0.6, y: 2.5 }), "a");
    const b = must(aimAt(cue, { x: 0.60001, y: 2.5 }), "b");
    expect(a).toBe(Math.PI / 2);
    expect(a - b).toBeGreaterThan(0);
    expect((a - b) / DEG).toBeLessThan(0.0005);
    expect(aimAt(cue, cue)).toBeUndefined();
  });

  test("any angle set on the document comes back unchanged", () => {
    for (const angle of [0.1 + 0.2, 1.2345678901234567, Math.PI / 3, 5.999999999]) {
      expect(setShot(racked(), { aimAngleRad: angle }).shot?.aimAngleRad).toBe(angle);
    }
  });

  test("fine steps reach a hundredth of a degree and wrap around the circle", () => {
    expect(nudgeAngle(1, 0.01) - 1).toBeCloseTo(0.01 * DEG, 15);
    expect(angleToDegrees(nudgeAngle(0, -0.01))).toBeCloseTo(359.99, 9);
    expect(angleToDegrees(nudgeAngle(359.995 * DEG, 0.01))).toBeCloseTo(0.005, 9);
    let a = 0;
    for (let i = 0; i < 100; i++) a = nudgeAngle(a, 0.01);
    expect(angleToDegrees(a)).toBeCloseTo(1, 9);
  });

  test("arrow keys on the handle: 0.1 degrees, 1 with Shift, 0.01 with Alt", () => {
    expect(aimKeyStep("ArrowLeft", { shift: false, alt: false })).toBe(0.1);
    expect(aimKeyStep("ArrowRight", { shift: false, alt: false })).toBe(-0.1);
    expect(aimKeyStep("ArrowLeft", { shift: true, alt: false })).toBe(1);
    expect(aimKeyStep("ArrowRight", { shift: false, alt: true })).toBe(-0.01);
    expect(aimKeyStep("ArrowUp", { shift: false, alt: false })).toBeUndefined();
  });
});

describe("aimGuide", () => {
  test("the line runs to the ghost ball in front of the first ball on it", () => {
    const doc = setShot(racked(), { aimAngleRad: Math.PI / 2 });
    const scene = must(simulateDoc(doc).scene, "scene");
    const guide = must(aimGuide(scene), "guide");
    const target = must(
      scene.balls.find((b) => b.id === guide.targetBallId),
      "target",
    );
    expect(target.kind).toBe("1");
    const ghost = must(guide.ghost, "ghost");
    expect(Math.hypot(ghost.x - target.x, ghost.y - target.y)).toBeCloseTo(2 * target.radiusM, 12);
    expect(guide.to).toEqual(ghost);
  });

  test("with nothing in the way the line has a fixed length and no ghost ball", () => {
    const doc = setShot(racked(), { aimAngleRad: 0 });
    const guide = must(aimGuide(must(simulateDoc(doc).scene, "scene")), "guide");
    expect(guide.ghost).toBeUndefined();
    expect(guide.to.x - guide.from.x).toBeCloseTo(0.6, 12);
    expect(aimGuide(must(simulateDoc(racked()).scene, "scene"))).toBeUndefined();
  });
});

describe("tip position and speed", () => {
  test("the tip stays inside half a ball radius, and up on the widget is above centre", () => {
    expect(clampTip(0.2, 0.1)).toEqual({ side: 0.2, vertical: 0.1 });
    const far = clampTip(3, 4);
    expect(Math.hypot(far.side, far.vertical)).toBeCloseTo(0.5, 12);
    expect(tipFromWidget(0, -0.3)).toEqual({ side: 0, vertical: 0.3 });
    expect(tipFromWidget(0.25, 0.1)).toEqual({ side: 0.25, vertical: -0.1 });
  });

  test("tip positions are described in players' words", () => {
    expect(describeTip(0, 0)).toBe("Centre ball");
    expect(describeTip(0, -0.3)).toBe("0.30 below centre (draw)");
    expect(describeTip(0.2, 0.4)).toBe("0.40 above centre (follow), 0.20 right side");
    expect(describeTip(-0.25, 0)).toBe("0.25 left side");
  });

  test("named speeds are in order and recognised; the roll hint grows with speed", () => {
    const speeds = SPEED_STOPS.map((s) => s.speedMps);
    expect([...speeds].sort((a, b) => a - b)).toEqual(speeds);
    expect(speedName(0.7)).toBe("Soft");
    expect(speedName(9)).toBe("Break");
    expect(speedName(2.6)).toBeUndefined();
    const scene = must(simulateDoc(racked()).scene, "scene");
    expect(rollInTableLengths(0.7, scene)).toBeGreaterThan(0.3);
    expect(rollInTableLengths(0.7, scene)).toBeLessThan(1.5);
    expect(rollInTableLengths(3, scene)).toBeGreaterThan(rollInTableLengths(1, scene));
  });
});

describe("ShotPanelView", () => {
  test("no cue ball: a hint and no controls", () => {
    const html = render(newDoc("pool-9@1"));
    expect(html).toContain("Add a cue ball");
    expect(html).not.toContain("shot-angle");
  });

  test("a cue ball and no shot: an Add a shot button", () => {
    const html = render(racked());
    expect(html).toContain("Add a shot");
    expect(html).not.toContain("shot-angle");
  });

  test("with a shot: the angle to two decimals, fine steps, tip, speed and the result", () => {
    const doc = setShot(racked(), {
      aimAngleRad: 90.127 * DEG,
      speedMps: 9,
      tipOffset: { side: 0, vertical: -0.3 },
    });
    const html = render(doc);
    expect(html).toContain('value="90.13"');
    for (const label of ["−0.01°", "+0.01°", "−0.1°", "+1°"]) expect(html).toContain(label);
    expect(html).toContain("0.30 below centre (draw)");
    expect(html).toContain("9 m/s (Break)");
    expect(html).toContain("First ball hit");
    expect(html).toContain("1 ball");
    expect(html).toContain("Cue ball travel");
    expect(html).toContain("Remove the shot");
    // Nothing selected: the aim-at-ball button is disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Aim at the selected ball/);
  });

  test("selecting an object ball enables aiming at it; show-all is reflected", () => {
    const doc = setStyle(setShot(racked(), { speedMps: 2 }), { showAllPaths: true });
    const html = render(doc, "b4");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Aim at the selected ball/);
    expect(html).toMatch(/type="checkbox"[^>]*checked=""/);
    expect(setStyle(doc, { showAllPaths: false }).style).toBeUndefined();
  });
});

describe("squirt in the aim guide", () => {
  /** Cue ball and one object ball 1.2 m up the table, dead straight, aimed full ball. */
  function straightIn(side: number, speedMps = 2): DiagramDoc {
    const base = loadLayout(
      newDoc("pool-9@1"),
      {
        balls: [
          { kind: "cue", x: 0.6, y: 0.4 },
          { kind: "3", x: 0.6, y: 1.6 },
        ],
      },
      { source: "manual", mode: "replace" },
    );
    return setShot(base, {
      aimAngleRad: Math.PI / 2,
      speedMps,
      tipOffset: { side, vertical: 0 },
    });
  }
  const sceneOf = (doc: DiagramDoc) => must(simulateDoc(doc).scene, "scene");

  test("without side the cue ball leaves along the aim line exactly", () => {
    const scene = sceneOf(straightIn(0));
    expect(departureAngle(scene)).toBe(Math.PI / 2);
    const guide = must(aimGuide(scene), "guide");
    expect(guide.departureAngleRad).toBe(Math.PI / 2);
    expect(guide.to).toEqual(guide.ghost);
    expect(must(aimReadout(scene), "readout").cutAngleRad).toBeCloseTo(0, 9);
  });

  test("with right-hand side it leaves to the left of the aim line, by a degree or two", () => {
    const scene = sceneOf(straightIn(0.5));
    const off = must(departureAngle(scene), "angle") - Math.PI / 2;
    // Counter-clockwise is to the left of the direction of the shot.
    expect(off / DEG).toBeGreaterThan(1);
    expect(off / DEG).toBeLessThan(3);
    // Left-hand side: the mirror image.
    const left = must(departureAngle(sceneOf(straightIn(-0.5))), "angle") - Math.PI / 2;
    expect(left).toBeCloseTo(-off, 12);
  });

  test("a lighter cue end squirts less", () => {
    const scene = sceneOf(straightIn(0.5));
    const usual = must(departureAngle(scene), "angle") - Math.PI / 2;
    const light = must(departureAngle(scene, 200), "angle") - Math.PI / 2;
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThan(usual / 3);
  });

  test("the ghost ball is where the simulated cue ball is at first contact, off the aim line", () => {
    const doc = straightIn(0.5);
    const simulation = simulateDoc(doc);
    const scene = must(simulation.scene, "scene");
    const guide = must(aimGuide(scene), "guide");
    const ghost = must(guide.ghost, "ghost");
    // Aimed straight up the table from x = 0.6: the ghost ball is to the left of that line.
    expect(ghost.x).toBeLessThan(0.6 - 0.01);
    // The aim line itself still runs straight up the table, as far as the ball travels.
    expect(guide.to.x).toBeCloseTo(0.6, 12);
    expect(guide.to.y - guide.from.y).toBeCloseTo(Math.hypot(ghost.x - 0.6, ghost.y - 0.4), 12);
    // The simulation agrees about where the first contact is.
    const result = must(simulation.outcome.result, "result");
    const hit = must(
      result.events.find((e) => e.type === "ball-ball"),
      "contact",
    );
    const cueTrack = must(
      result.tracks.find((t) => t.id === scene.shot?.cueBallId),
      "track",
    );
    const seg = must(
      [...cueTrack.segments].reverse().find((s) => s.t0 < hit.t),
      "segment",
    );
    const tau = hit.t - seg.t0;
    const at = {
      x: seg.r0.x + tau * (seg.v0.x + 0.5 * seg.a.x * tau),
      y: seg.r0.y + tau * (seg.v0.y + 0.5 * seg.a.y * tau),
    };
    expect(Math.hypot(at.x - ghost.x, at.y - ghost.y)).toBeLessThan(1e-6);
  });

  test("the cut angle is that of the squirted line, not of the aim line", () => {
    // Aimed full ball; the squirt turns it into a cut.
    const readout = must(aimReadout(sceneOf(straightIn(0.5))), "readout");
    expect(readout.cutAngleRad / DEG).toBeGreaterThan(20);
    expect(must(aimReadout(sceneOf(straightIn(0))), "readout").cutAngleRad).toBeCloseTo(0, 9);
  });

  test("when squirt takes the cue ball past the ball it was aimed at, there is no ghost ball", () => {
    // A thin cut on the left edge of the ball, with right-hand side: the ball squirts further
    // left and misses.
    const base = straightIn(0.5);
    const thin = Math.PI / 2 + Math.asin((2 * 0.028575 - 0.0005) / 1.2);
    const noSide = sceneOf(
      setShot(base, { aimAngleRad: thin, tipOffset: { side: 0, vertical: 0 } }),
    );
    expect(aimGuide(noSide)?.ghost).toBeDefined();
    const withSide = must(aimGuide(sceneOf(setShot(base, { aimAngleRad: thin }))), "guide");
    expect(withSide.ghost).toBeUndefined();
    expect(withSide.targetBallId).toBeUndefined();
    expect(
      Math.hypot(withSide.to.x - withSide.from.x, withSide.to.y - withSide.from.y),
    ).toBeCloseTo(0.6, 12);
  });
});

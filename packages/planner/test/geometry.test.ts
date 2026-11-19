import { describe, expect, test } from "vitest";
import {
  chanceInWindow,
  cutCos,
  distanceToSegment,
  estimatePot,
  ghostBall,
  laneHalfWidthM,
  pathClear,
  pocketTargets,
} from "../src/geometry";
import { TABLES, ball, ballSetFor, must } from "./helpers";

describe.each(TABLES.map((t) => [t.id === "custom" ? t.name : t.id, t] as const))(
  "on %s",
  (_name, table) => {
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const R = ballSetFor(table).object.diameterM / 2;
    const pockets = pocketTargets(table);
    const pocket = (id: string) =>
      must(
        pockets.find((p) => p.id === id),
        id,
      );

    test("six pockets, aimed at their drop circles, axes pointing off the table", () => {
      expect(pockets.map((p) => p.id).sort()).toEqual(
        ["corner-bl", "corner-br", "corner-tl", "corner-tr", "middle-l", "middle-r"].sort(),
      );
      const centre = { x: W / 2, y: L / 2 };
      for (const p of pockets) {
        const out = { x: p.aim.x - centre.x, y: p.aim.y - centre.y };
        expect(out.x * p.axis.x + out.y * p.axis.y).toBeGreaterThan(0);
        expect(Math.hypot(p.axis.x, p.axis.y)).toBeCloseTo(1, 12);
        expect(p.mouthM).toBeGreaterThan(2 * R);
      }
    });

    test("ghost ball sits one ball's width behind the target on the pocket line", () => {
      const target = { x: W / 2, y: L / 2 };
      const tr = pocket("corner-tr");
      const g = ghostBall(target, tr.aim, 2 * R);
      expect(Math.hypot(g.x - target.x, g.y - target.y)).toBeCloseTo(2 * R, 12);
      // Ghost, target and pocket aim are in line, ghost on the far side from the pocket.
      const a = { x: target.x - g.x, y: target.y - g.y };
      const b = { x: tr.aim.x - target.x, y: tr.aim.y - target.y };
      expect(a.x * b.y - a.y * b.x).toBeCloseTo(0, 12);
      expect(a.x * b.x + a.y * b.y).toBeGreaterThan(0);
    });

    test("a straight pot has cut cosine 1 and the widest window", () => {
      const tl = pocket("corner-tl");
      // Target on the diagonal from the top-left corner, cue ball behind it on the same line.
      const t = { x: tl.aim.x + 0.3 * W, y: tl.aim.y - 0.3 * W };
      const c = { x: tl.aim.x + 0.6 * W, y: tl.aim.y - 0.6 * W };
      const straight = estimatePot({
        cue: c,
        target: t,
        cueRadiusM: R,
        targetRadiusM: R,
        pocket: tl,
      });
      expect(straight.cutCos).toBeCloseTo(1, 12);
      expect(straight.aimHalfWindowRad).toBeGreaterThan(0);
      // Moving the cue ball off the line makes a cut, and the window narrows.
      for (const off of [0.05, 0.1, 0.2]) {
        const cut = estimatePot({
          cue: { x: c.x + off * W, y: c.y + off * W },
          target: t,
          cueRadiusM: R,
          targetRadiusM: R,
          pocket: tl,
        });
        expect(cut.cutCos).toBeLessThan(1);
        expect(cut.aimHalfWindowRad).toBeLessThan(straight.aimHalfWindowRad);
      }
    });

    test("the window falls with the cue ball's distance and with the object ball's", () => {
      const mr = pocket("middle-r");
      const t = (d: number) => ({ x: mr.aim.x - d, y: mr.aim.y });
      const est = (dCue: number, dTarget: number) =>
        estimatePot({
          cue: { x: t(dTarget).x - dCue, y: t(dTarget).y },
          target: t(dTarget),
          cueRadiusM: R,
          targetRadiusM: R,
          pocket: mr,
        }).aimHalfWindowRad;
      const span = W - 4 * R;
      expect(est(0.4 * span, 0.2 * span)).toBeGreaterThan(est(0.6 * span, 0.2 * span));
      expect(est(0.3 * span, 0.2 * span)).toBeGreaterThan(est(0.3 * span, 0.4 * span));
    });

    test("a cut of 90 degrees or more, or a lane the ball cannot fit, is not on", () => {
      const bl = pocket("corner-bl");
      const t = { x: W / 2, y: L / 2 };
      // Cue ball on the far side of the target from the pocket's line: a backwards cut.
      const g = ghostBall(t, bl.aim, 2 * R);
      const beyond = { x: t.x + (t.x - g.x) * 5, y: t.y + (t.y - g.y) * 5 };
      const back = estimatePot({
        cue: beyond,
        target: t,
        cueRadiusM: R,
        targetRadiusM: R,
        pocket: bl,
      });
      expect(back.cutCos).toBeLessThan(0);
      expect(back.aimHalfWindowRad).toBe(0);
      // A ball rolling along the bottom rail into a middle pocket's mouth sideways cannot drop.
      const ml = pocket("middle-l");
      expect(laneHalfWidthM(ml, { x: 0, y: 1 }, R)).toBe(0);
      // Straight in, it has room.
      expect(laneHalfWidthM(ml, { x: -1, y: 0 }, R)).toBeCloseTo(ml.mouthM / 2 - R, 12);
    });

    test("a ball in the way blocks the line; one just clear does not", () => {
      const a = { x: W * 0.25, y: L * 0.25 };
      const b = { x: W * 0.25, y: L * 0.75 };
      const mover = 0.02;
      const blocker = ball(table, "x", "red", W * 0.25 + 2 * R - 1e-4, L / 2);
      expect(pathClear(a, b, R, [blocker], [])).toBe(false);
      const clear = { ...blocker, x: W * 0.25 + 2 * R + 1e-4 };
      expect(pathClear(a, b, R, [clear], [])).toBe(true);
      expect(pathClear(a, b, R, [clear], [], mover)).toBe(false);
      expect(pathClear(a, b, R, [blocker], ["x"])).toBe(true);
    });
  },
);

describe("helpers", () => {
  test("distance to a segment: inside, beyond each end, degenerate", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 2, y: 0 };
    expect(distanceToSegment({ x: 1, y: 3 }, a, b)).toBe(3);
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 5, y: 4 }, a, b)).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5);
  });

  test("cut cosine of a 60 degree cut", () => {
    const c = cutCos(
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2.5, y: Math.sqrt(3) / 2 },
    );
    expect(c).toBeCloseTo(0.5, 12);
  });

  test("chance in a window", () => {
    expect(chanceInWindow(1, 1, 1)).toBeCloseTo(0.6826895, 6);
    expect(chanceInWindow(0, 0, 1)).toBe(0);
    expect(chanceInWindow(1, 1, 0)).toBe(1);
    expect(chanceInWindow(1, 2, 1)).toBeGreaterThan(chanceInWindow(1, 1, 1));
    expect(chanceInWindow(0.01, 0.01, 0.001)).toBeCloseTo(1, 9);
  });
});

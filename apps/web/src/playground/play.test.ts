import { simulate } from "@baize/physics";
import type { SimInput } from "@baize/physics";
import { getBallSet, getTablePreset, makeCloth, pocketDropCircles } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { freshRack, layoutAfterShot, placeCueBall } from "./play";
import type { SceneBall } from "./play";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-8-pro@1"), "table preset");
const set = must(getBallSet(table.defaultBallSetId), "ball set");
const W = table.playingArea.widthM;
const L = table.playingArea.lengthM;
const cloth = makeCloth("#1d7a5f", "medium");

function input(balls: SceneBall[], aimAngleRad: number, speedMps: number): SimInput {
  return {
    table,
    cloth,
    balls,
    ballRestitution: set.restitution,
    shot: {
      ballId: balls[0]?.id ?? "",
      aimAngleRad,
      speedMps,
      tipOffset: { side: 0, vertical: 0 },
    },
  };
}

function ball(id: string, kind: SceneBall["kind"], x: number, y: number): SceneBall {
  return {
    id,
    kind,
    radiusM: set.object.diameterM / 2,
    massKg: set.object.massKg,
    x,
    y,
  };
}

describe("freshRack", () => {
  test("cue ball first, the right number of balls, and the engine accepts it", () => {
    expect(freshRack(table, set, "pool-9ball")).toHaveLength(10);
    expect(freshRack(table, set, "pool-8ball")).toHaveLength(16);
    expect(freshRack(table, set, "two-balls")).toHaveLength(2);
    for (const rack of ["pool-9ball", "pool-8ball", "pool-15", "two-balls"] as const) {
      const balls = freshRack(table, set, rack);
      expect(balls[0]?.kind).toBe("cue");
      expect(() => simulate(input(balls, Math.PI / 2, 5))).not.toThrow();
    }
  });
});

describe("layoutAfterShot", () => {
  test("balls stay where they stopped and nothing is lost when nothing drops", () => {
    const balls = [ball("cue", "cue", W / 2, 0.5), ball("one", "1", W / 2 + 0.01, 1.2)];
    const result = simulate(input(balls, Math.PI / 2, 1));
    const after = layoutAfterShot(result, balls, table, set);
    expect(after.scratch).toBe(false);
    expect(after.potted).toEqual([]);
    expect(after.balls.map((b) => b.id)).toEqual(["cue", "one"]);
    // The object ball was hit and has moved up the table.
    expect(after.balls[1]?.y).toBeGreaterThan(1.25);
    // The next shot can be played from here.
    expect(() => simulate(input(after.balls, 1, 2))).not.toThrow();
  });

  test("a potted object ball is removed and reported", () => {
    // Object ball in front of the top-right corner pocket, cue ball straight behind it.
    const balls = [
      ball("cue", "cue", W - 0.5, L - 0.5),
      ball("nine", "9", W - 0.2, L - 0.2),
      ball("far", "3", 0.3, 0.6),
    ];
    const result = simulate(input(balls, Math.PI / 4, 1.2));
    const after = layoutAfterShot(result, balls, table, set);
    expect(after.potted).toEqual(["9"]);
    expect(after.balls.map((b) => b.id)).toEqual(["cue", "far"]);
    expect(after.balls[1]).toMatchObject({ x: 0.3, y: 0.6 });
  });

  test("a potted cue ball comes back on the head spot, and gives way if a ball is there", () => {
    const balls = [
      ball("cue", "cue", 0.4, 0.4),
      ball("blocker", "5", W / 2, L / 4),
      ball("other", "2", 0.9, 1.7),
    ];
    // Straight into the bottom-left corner pocket.
    const result = simulate(input(balls, (5 * Math.PI) / 4, 1.5));
    const after = layoutAfterShot(result, balls, table, set);
    expect(after.scratch).toBe(true);
    expect(after.potted).toEqual([]);
    expect(after.balls.map((b) => b.id)).toEqual(["cue", "blocker", "other"]);
    // The ball on the head spot did not move; the cue ball sits against it.
    expect(after.balls[1]).toMatchObject({ x: W / 2, y: L / 4 });
    const cue = after.balls[0] as SceneBall;
    const gap = Math.hypot(cue.x - W / 2, cue.y - L / 4) - 2 * cue.radiusM;
    expect(gap).toBeGreaterThan(-1e-9);
    expect(gap).toBeLessThan(0.01);
    expect(() => simulate(input(after.balls, 1, 2))).not.toThrow();
  });

  test("ten shots in a row from a break always leave a position the engine accepts", () => {
    let balls = freshRack(table, set, "pool-9ball");
    let down = 0;
    for (let shot = 0; shot < 10; shot++) {
      // A different, fixed aim and speed each time.
      const aim = shot === 0 ? Math.PI / 2 : 0.7 + shot * 1.3;
      const result = simulate(input(balls, aim, shot === 0 ? 8 : 2 + (shot % 4)));
      expect(result.status).toBe("complete");
      const after = layoutAfterShot(result, balls, table, set);
      down += after.potted.length;
      expect(after.balls[0]?.kind).toBe("cue");
      expect(after.balls.length).toBe(10 - down);
      const circles = pocketDropCircles(table);
      for (const b of after.balls) {
        for (const c of circles) {
          expect(Math.hypot(b.x - c.x, b.y - c.y)).toBeGreaterThanOrEqual(c.radiusM);
        }
      }
      balls = after.balls;
    }
  });
});

describe("placeCueBall", () => {
  test("puts the cue ball where asked when the spot is free", () => {
    const balls = [ball("cue", "cue", 0.4, 0.4), ball("one", "1", 0.9, 1.7)];
    const placed = placeCueBall(balls, { x: 0.6, y: 1.0 }, table, set);
    expect(placed[0]).toMatchObject({ id: "cue", x: 0.6, y: 1.0 });
    expect(placed[1]).toMatchObject({ x: 0.9, y: 1.7 });
  });

  test("on top of a ball, off the table or over a pocket: the cue ball is nudged, others stay", () => {
    const balls = [ball("cue", "cue", 0.4, 0.4), ball("one", "1", 0.9, 1.7)];
    const onBall = placeCueBall(balls, { x: 0.9, y: 1.7 }, table, set);
    expect(onBall[1]).toMatchObject({ x: 0.9, y: 1.7 });
    const cue = onBall[0] as SceneBall;
    expect(Math.hypot(cue.x - 0.9, cue.y - 1.7)).toBeGreaterThanOrEqual(2 * cue.radiusM - 1e-9);

    const off = placeCueBall(balls, { x: -1, y: 1 }, table, set);
    expect(off[0]?.x).toBeGreaterThan(0);
    expect(off[0]?.x).toBeLessThan(0.05);

    const overPocket = placeCueBall(balls, { x: 0.01, y: 0.01 }, table, set);
    expect(() => simulate(input(overPocket, 1, 1))).not.toThrow();
  });
});

import { prepareTable, sampleAt, simulate } from "@baize/physics";
import type { PocketId, SimEvent, SimResult } from "@baize/physics";
import { ballSizeOf, getBallSet, getTablePreset, makeCloth, spotsFor } from "@baize/tables";
import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { afterShot, ballsOn, defaultGameState, judgeShot, potValue } from "../src/index";
import type { GameState, PlanBall } from "../src/index";

function need<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const snookerTable = need(getTablePreset("snooker-12@1"), "snooker table");
const snookerSet = need(getBallSet("snooker-52@1"), "snooker set");
const poolTable = need(getTablePreset("pool-9@1"), "pool table");
const poolSet = need(getBallSet("pool-57@1"), "pool set");
const blackballSet = need(getBallSet("blackball-51@1"), "blackball set");
const cloth = makeCloth("#0a6c3b", "medium");

function mk(set: BallSetSpec, id: string, kind: BallKind, x: number, y: number): PlanBall {
  const size = ballSizeOf(set, kind);
  return { id, kind, radiusM: size.diameterM / 2, massKg: size.massKg, x, y };
}

function shoot(
  table: TableSpec,
  set: BallSetSpec,
  balls: readonly PlanBall[],
  aimAngleRad: number,
  speedMps: number,
  tip = { side: 0, vertical: 0 },
): SimResult {
  return simulate({
    table: prepareTable(table),
    cloth,
    balls,
    ballRestitution: set.restitution,
    shot: { ballId: "cue", aimAngleRad, speedMps, tipOffset: tip },
  });
}

function spot(table: TableSpec, name: string): { x: number; y: number } {
  const s = need(
    spotsFor(table).find((p) => p.name === name),
    `spot ${name}`,
  );
  return { x: s.x, y: s.y };
}

// ---------------------------------------------------------------------------------------------
// Hand-built results: every ball stays where it is unless it is potted or given an end position.
// ---------------------------------------------------------------------------------------------

type Ev = { hit: [string, string] } | { cushion: string } | { pocket: string; at?: PocketId };

function fake(
  balls: readonly PlanBall[],
  evs: readonly Ev[],
  moves: Readonly<Record<string, { x: number; y: number }>> = {},
): SimResult {
  const events: SimEvent[] = [{ type: "strike", t: 0, ballId: "cue" }];
  const pocketed = new Set<string>();
  const point = { x: 0, y: 0 };
  evs.forEach((e, i) => {
    const t = 0.1 * (i + 1);
    if ("hit" in e) {
      events.push({ type: "ball-ball", t, ballId: e.hit[0], otherBallId: e.hit[1], point });
    } else if ("cushion" in e) {
      events.push({ type: "ball-cushion", t, ballId: e.cushion, cushionId: "rail", point });
    } else {
      pocketed.add(e.pocket);
      events.push({ type: "pocket", t, ballId: e.pocket, pocketId: e.at ?? "corner-tr", point });
    }
  });
  const zero = { x: 0, y: 0 };
  const zero3 = { x: 0, y: 0, z: 0 };
  return {
    status: "complete",
    events,
    tracks: balls.map((b) => ({
      id: b.id,
      radiusM: b.radiusM,
      massKg: b.massKg,
      segments: [
        {
          t0: 0,
          duration: Infinity,
          state: pocketed.has(b.id) ? "pocketed" : "stationary",
          r0: moves[b.id] ?? { x: b.x, y: b.y },
          v0: zero,
          a: zero,
          omega0: zero3,
          alpha: zero3,
        },
      ],
    })),
    durationS: 0.1 * (evs.length + 1),
    stats: { eventCount: events.length, rootSearches: 0 },
  };
}

const ids = (balls: readonly PlanBall[]): string[] => balls.map((b) => b.id);

const NINE: GameState = { game: "nine-ball" };
const STRAIGHT: GameState = { game: "straight" };
const SOLIDS: GameState = { game: "eight-ball", group: "solids" };
const REDS_GROUP: GameState = { game: "eight-ball", group: "reds" };
const RED: GameState = { game: "snooker", phase: "red" };
const COLOUR: GameState = { game: "snooker", phase: "colour" };
const COLOURS: GameState = { game: "snooker", phase: "colours" };

// Pool balls laid out anywhere legal; hand-built results ignore positions except for respotting.
function poolBalls(...kinds: BallKind[]): PlanBall[] {
  return [
    mk(poolSet, "cue", "cue", 0.6, 0.5),
    ...kinds.map((k, i) => mk(poolSet, `b${k}`, k, 0.2 + 0.1 * i, 1.5)),
  ];
}

describe("ballsOn", () => {
  test("snooker: reds, then any colour, then the lowest colour left", () => {
    const balls = [
      mk(snookerSet, "cue", "cue", 0.5, 0.5),
      mk(snookerSet, "r1", "red", 0.9, 2.5),
      mk(snookerSet, "pink", "pink", 0.9, 2.7),
      mk(snookerSet, "r2", "red", 1.0, 2.5),
      mk(snookerSet, "green", "green", 0.6, 0.7),
      mk(snookerSet, "blue", "blue", 0.9, 1.8),
    ];
    expect(ids(ballsOn(balls, "cue", RED))).toEqual(["r1", "r2"]);
    expect(ids(ballsOn(balls, "cue", COLOUR))).toEqual(["pink", "green", "blue"]);
    expect(ids(ballsOn(balls, "cue", COLOURS))).toEqual(["green"]);
    expect(ballsOn([balls[0] as PlanBall], "cue", COLOURS)).toEqual([]);
  });

  test("nine-ball: the lowest number on the table", () => {
    const balls = poolBalls("9", "4", "2", "7");
    expect(ids(ballsOn(balls, "cue", NINE))).toEqual(["b2"]);
  });

  test("eight-ball: the group, then the game ball", () => {
    const balls = poolBalls("3", "8", "11", "5");
    expect(ids(ballsOn(balls, "cue", SOLIDS))).toEqual(["b3", "b5"]);
    expect(ids(ballsOn(balls, "cue", { game: "eight-ball", group: "stripes" }))).toEqual(["b11"]);
    expect(ids(ballsOn(poolBalls("8", "11"), "cue", SOLIDS))).toEqual(["b8"]);
    const bb = [
      mk(blackballSet, "cue", "cue", 0.5, 0.3),
      mk(blackballSet, "y1", "yellow", 0.5, 1.0),
      mk(blackballSet, "blk", "black", 0.5, 1.4),
      mk(blackballSet, "r1", "red", 0.7, 1.0),
    ];
    expect(ids(ballsOn(bb, "cue", REDS_GROUP))).toEqual(["r1"]);
    expect(ids(ballsOn(bb, "cue", { game: "eight-ball", group: "yellows" }))).toEqual(["y1"]);
    expect(ids(ballsOn(bb.slice(0, 3), "cue", REDS_GROUP))).toEqual(["blk"]);
  });

  test("straight: every object ball, never the cue ball", () => {
    expect(ids(ballsOn(poolBalls("12", "3"), "cue", STRAIGHT))).toEqual(["b12", "b3"]);
  });
});

describe("potValue", () => {
  test("snooker values", () => {
    const kinds: [BallKind, number][] = [
      ["red", 1],
      ["yellow", 2],
      ["green", 3],
      ["brown", 4],
      ["blue", 5],
      ["pink", 6],
      ["black", 7],
      ["cue", 0],
    ];
    for (const [kind, v] of kinds) expect(potValue(kind, COLOUR, 10)).toBe(v);
  });

  test("pool values", () => {
    expect(potValue("3", NINE, 5)).toBe(1);
    expect(potValue("9", NINE, 5)).toBe(5);
    expect(potValue("cue", NINE, 5)).toBe(0);
    expect(potValue("3", SOLIDS, 6)).toBe(1);
    expect(potValue("12", SOLIDS, 6)).toBe(0);
    expect(potValue("8", SOLIDS, 6)).toBe(6);
    expect(potValue("black", REDS_GROUP, 4)).toBe(4);
    expect(potValue("yellow", REDS_GROUP, 4)).toBe(0);
    expect(potValue("red", REDS_GROUP, 4)).toBe(1);
    expect(potValue("8", STRAIGHT, 9)).toBe(1);
  });
});

describe("defaultGameState", () => {
  test("snooker sets", () => {
    const withRed = [mk(snookerSet, "cue", "cue", 0.5, 0.5), mk(snookerSet, "r", "red", 1, 2)];
    const noRed = [mk(snookerSet, "cue", "cue", 0.5, 0.5), mk(snookerSet, "b", "black", 1, 3)];
    expect(defaultGameState(snookerSet, withRed)).toEqual(RED);
    expect(defaultGameState(snookerSet, noRed)).toEqual(COLOURS);
  });

  test("blackball and pool sets", () => {
    expect(defaultGameState(blackballSet, [])).toEqual(REDS_GROUP);
    expect(defaultGameState(poolSet, poolBalls("1", "5", "9"))).toEqual(NINE);
    expect(defaultGameState(poolSet, poolBalls("1", "5", "10"))).toEqual(SOLIDS);
  });
});

// ---------------------------------------------------------------------------------------------
// Real shots on a 9 ft pool table.
// ---------------------------------------------------------------------------------------------

describe("judgeShot with simulated pool shots", () => {
  const { widthM: W, lengthM: L } = poolTable.playingArea;
  // An object ball on the diagonal to the top-right corner, the cue ball 0.2 m behind it.
  const onDiag = { x: W - 0.3, y: L - 0.3 };
  const back = (d: number) => ({ x: onDiag.x - d / Math.SQRT2, y: onDiag.y - d / Math.SQRT2 });

  function layout(diagKind: BallKind, cueBack: number, others: BallKind[]): PlanBall[] {
    const c = back(cueBack);
    return [
      mk(poolSet, "cue", "cue", c.x, c.y),
      mk(poolSet, `b${diagKind}`, diagKind, onDiag.x, onDiag.y),
      ...others.map((k, i) => mk(poolSet, `b${k}`, k, 0.2 + 0.1 * i, 0.6)),
    ];
  }

  test("a straight pot into the corner", () => {
    const balls = layout("1", 0.2, ["9"]);
    const result = shoot(poolTable, poolSet, balls, Math.PI / 4, 2);
    const j = judgeShot(result, balls, "cue", NINE, { targetId: "b1", pocketId: "corner-tr" });
    expect(j).toMatchObject({
      firstHitId: "b1",
      potted: ["b1"],
      cuePotted: false,
      foul: false,
      intendedPotted: true,
      scored: 1,
      continues: true,
      finished: false,
    });
    expect(j.reason).toBeUndefined();
    const other = judgeShot(result, balls, "cue", NINE, { targetId: "b1", pocketId: "corner-tl" });
    expect(other.intendedPotted).toBe(false);
    expect(judgeShot(result, balls, "cue", NINE, { targetId: "b1" }).intendedPotted).toBe(true);
    expect(judgeShot(result, balls, "cue", NINE).intendedPotted).toBe(false);

    const after = afterShot(result, balls, "cue", NINE, poolTable, j);
    expect(ids(after.balls)).toEqual(["cue", "b9"]);
    const finals = sampleAt(result, result.durationS);
    expect(after.balls[0]).toEqual({
      id: "cue",
      kind: "cue",
      radiusM: balls[0]?.radiusM,
      massKg: balls[0]?.massKg,
      x: finals[0]?.position.x,
      y: finals[0]?.position.y,
    });
    expect(after.balls[0]?.x).not.toBe(balls[0]?.x);
    expect(after.balls[1]).toEqual(balls[2]);
    expect(after.state).toBe(NINE);
  });

  test("a shot that misses everything", () => {
    const balls = layout("1", 0.2, ["9"]);
    const result = shoot(poolTable, poolSet, balls, -Math.PI / 2, 1);
    const j = judgeShot(result, balls, "cue", NINE);
    expect(j).toMatchObject({ foul: true, reason: "no-contact", scored: 0, continues: false });
    expect(j.firstHitId).toBeUndefined();
  });

  test("a scratch: the cue ball follows the object ball in", () => {
    const balls = layout("1", 0.6, ["9"]);
    const result = shoot(poolTable, poolSet, balls, Math.PI / 4, 3, { side: 0, vertical: 0.5 });
    const j = judgeShot(result, balls, "cue", NINE);
    expect(j).toMatchObject({
      firstHitId: "b1",
      potted: ["b1"],
      cuePotted: true,
      foul: true,
      reason: "cue-potted",
      scored: 0,
      continues: false,
    });
    const after = afterShot(result, balls, "cue", NINE, poolTable, j);
    expect(ids(after.balls)).toEqual(["b9"]);
  });

  test("wrong ball first", () => {
    const balls = layout("2", 0.2, ["1", "9"]);
    const result = shoot(poolTable, poolSet, balls, Math.PI / 4, 2);
    const j = judgeShot(result, balls, "cue", NINE);
    expect(j).toMatchObject({ firstHitId: "b2", foul: true, reason: "wrong-ball-first" });
    expect(j.potted).toEqual(["b2"]);
    expect(j.scored).toBe(0);
    // In straight pool any ball is on.
    expect(judgeShot(result, balls, "cue", STRAIGHT)).toMatchObject({ foul: false, scored: 1 });
  });

  test("no rail: a soft touch in the middle of the table", () => {
    const balls = [
      mk(poolSet, "cue", "cue", W / 2, L / 2 - 0.2),
      mk(poolSet, "b1", "1", W / 2, L / 2),
      mk(poolSet, "b9", "9", 0.2, 0.6),
    ];
    const result = shoot(poolTable, poolSet, balls, Math.PI / 2, 0.3);
    expect(result.events.some((e) => e.type === "ball-cushion")).toBe(false);
    for (const state of [NINE, SOLIDS, STRAIGHT]) {
      const j = judgeShot(result, balls, "cue", state);
      expect(j).toMatchObject({
        firstHitId: "b1",
        foul: true,
        reason: "no-rail",
        continues: false,
      });
    }
    // Snooker has no rail rule.
    const sb = balls.map((b) => ({ ...b, kind: b.id === "cue" ? "cue" : "red" }) as PlanBall);
    expect(judgeShot(result, sb, "cue", RED).foul).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Hand-built pool results.
// ---------------------------------------------------------------------------------------------

describe("judgeShot: pool rules", () => {
  test("a cushion after the contact counts as a rail", () => {
    const balls = poolBalls("1", "9");
    const ok = fake(balls, [{ hit: ["cue", "b1"] }, { cushion: "b1" }]);
    expect(judgeShot(ok, balls, "cue", NINE)).toMatchObject({ foul: false, continues: false });
    // A cushion before the contact does not; the contact may be reported either way round.
    const before = fake(balls, [{ cushion: "cue" }, { hit: ["b1", "cue"] }]);
    expect(judgeShot(before, balls, "cue", NINE)).toMatchObject({
      firstHitId: "b1",
      reason: "no-rail",
    });
  });

  test("foul reasons are reported in order", () => {
    const balls = poolBalls("1", "2", "9");
    const r = fake(balls, [{ hit: ["cue", "b2"] }, { pocket: "cue" }]);
    expect(judgeShot(r, balls, "cue", NINE).reason).toBe("wrong-ball-first");
    expect(judgeShot(r, balls, "cue", STRAIGHT).reason).toBe("cue-potted");
  });

  test("nine-ball: the 9 potted legally ends the rack and is worth every ball left", () => {
    const balls = poolBalls("1", "5", "9");
    const r = fake(balls, [{ hit: ["cue", "b1"] }, { pocket: "b9" }, { pocket: "b1" }]);
    const j = judgeShot(r, balls, "cue", NINE);
    expect(j).toMatchObject({
      potted: ["b9", "b1"],
      foul: false,
      scored: 3,
      continues: true,
      finished: true,
    });
  });

  test("nine-ball: the 9 on a foul is just a foul and leaves the table", () => {
    const balls = poolBalls("1", "5", "9");
    const r = fake(balls, [{ hit: ["cue", "b5"] }, { pocket: "b9" }]);
    const j = judgeShot(r, balls, "cue", NINE);
    expect(j).toMatchObject({ foul: true, reason: "wrong-ball-first", finished: false });
    expect(j.scored).toBe(0);
    const after = afterShot(r, balls, "cue", NINE, poolTable, j);
    expect(ids(after.balls)).toEqual(["cue", "b1", "b5"]);
  });

  test("nine-ball: any ball potted on a legal shot counts", () => {
    const balls = poolBalls("1", "5", "9");
    const r = fake(balls, [{ hit: ["cue", "b1"] }, { pocket: "b5" }]);
    expect(judgeShot(r, balls, "cue", NINE)).toMatchObject({
      foul: false,
      scored: 1,
      continues: true,
    });
  });

  test("eight-ball: own ball, opponent's ball, wrong ball first", () => {
    const balls = poolBalls("3", "11", "8");
    const own = fake(balls, [{ hit: ["cue", "b3"] }, { pocket: "b3" }]);
    expect(judgeShot(own, balls, "cue", SOLIDS)).toMatchObject({ scored: 1, continues: true });
    const theirs = fake(balls, [{ hit: ["cue", "b3"] }, { pocket: "b11" }]);
    expect(judgeShot(theirs, balls, "cue", SOLIDS)).toMatchObject({
      foul: false,
      scored: 0,
      continues: false,
      finished: false,
    });
    const both = fake(balls, [{ hit: ["cue", "b3"] }, { pocket: "b11" }, { pocket: "b3" }]);
    expect(judgeShot(both, balls, "cue", SOLIDS)).toMatchObject({ scored: 1, continues: true });
    const wrong = fake(balls, [{ hit: ["cue", "b11"] }, { pocket: "b11" }]);
    expect(judgeShot(wrong, balls, "cue", SOLIDS)).toMatchObject({
      foul: true,
      reason: "wrong-ball-first",
    });
  });

  test("eight-ball: the 8 early loses the rack", () => {
    const balls = poolBalls("3", "11", "8");
    const r = fake(balls, [{ hit: ["cue", "b3"] }, { pocket: "b8" }]);
    expect(judgeShot(r, balls, "cue", SOLIDS)).toMatchObject({
      foul: true,
      reason: "ball-not-on-potted",
      finished: true,
      scored: 0,
      continues: false,
    });
    // Also with the last group ball on the same shot.
    const last = fake(balls, [{ hit: ["cue", "b3"] }, { pocket: "b3" }, { pocket: "b8" }]);
    expect(judgeShot(last, balls, "cue", SOLIDS)).toMatchObject({
      reason: "ball-not-on-potted",
      finished: true,
    });
  });

  test("eight-ball: the 8 after the group wins, unless it is potted on a foul", () => {
    const balls = poolBalls("11", "8", "12");
    const win = fake(balls, [{ hit: ["cue", "b8"] }, { pocket: "b8" }]);
    expect(judgeShot(win, balls, "cue", SOLIDS)).toMatchObject({
      foul: false,
      scored: 3,
      continues: true,
      finished: true,
    });
    const scratch = fake(balls, [{ hit: ["cue", "b8"] }, { pocket: "b8" }, { pocket: "cue" }]);
    expect(judgeShot(scratch, balls, "cue", SOLIDS)).toMatchObject({
      foul: true,
      reason: "ball-not-on-potted",
      finished: true,
      scored: 0,
    });
  });

  test("blackball: reds, then the black", () => {
    const bb = [
      mk(blackballSet, "cue", "cue", 0.5, 0.3),
      mk(blackballSet, "y1", "yellow", 0.5, 1.0),
      mk(blackballSet, "blk", "black", 0.5, 1.4),
      mk(blackballSet, "r1", "red", 0.7, 1.0),
    ];
    const red = fake(bb, [{ hit: ["cue", "r1"] }, { pocket: "r1" }]);
    expect(judgeShot(red, bb, "cue", REDS_GROUP)).toMatchObject({ scored: 1, continues: true });
    const early = fake(bb, [{ hit: ["cue", "r1"] }, { pocket: "blk" }]);
    expect(judgeShot(early, bb, "cue", REDS_GROUP)).toMatchObject({
      reason: "ball-not-on-potted",
      finished: true,
    });
    const noReds = bb.slice(0, 3);
    const win = fake(noReds, [{ hit: ["cue", "blk"] }, { pocket: "blk" }]);
    expect(judgeShot(win, noReds, "cue", REDS_GROUP)).toMatchObject({
      foul: false,
      scored: 2,
      finished: true,
    });
  });

  test("straight pool: no contact, scratch and plain pots", () => {
    const balls = poolBalls("4", "12");
    expect(judgeShot(fake(balls, [{ cushion: "cue" }]), balls, "cue", STRAIGHT).reason).toBe(
      "no-contact",
    );
    const two = fake(balls, [{ hit: ["cue", "b12"] }, { pocket: "b12" }, { pocket: "b4" }]);
    expect(judgeShot(two, balls, "cue", STRAIGHT)).toMatchObject({
      foul: false,
      scored: 2,
      continues: true,
      finished: false,
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Snooker.
// ---------------------------------------------------------------------------------------------

describe("snooker", () => {
  const { widthM: W, lengthM: L } = snookerTable.playingArea;
  const black = spot(snookerTable, "black");
  const pink = spot(snookerTable, "pink");
  const blue = spot(snookerTable, "blue");
  const brown = spot(snookerTable, "brown");
  const green = spot(snookerTable, "green");
  const yellow = spot(snookerTable, "yellow");
  const s = (id: string, kind: BallKind, p: { x: number; y: number }) =>
    mk(snookerSet, id, kind, p.x, p.y);

  test("a red potted into the corner, then the state moves to a colour", () => {
    const target = { x: W - 0.3, y: L - 0.3 };
    const balls = [
      s("cue", "cue", { x: target.x - 0.15, y: target.y - 0.15 }),
      s("r1", "red", target),
      s("r2", "red", { x: 0.4, y: 2.0 }),
      s("pink", "pink", pink),
    ];
    const result = shoot(snookerTable, snookerSet, balls, Math.PI / 4, 2);
    const j = judgeShot(result, balls, "cue", RED, { targetId: "r1", pocketId: "corner-tr" });
    expect(j).toMatchObject({
      potted: ["r1"],
      foul: false,
      scored: 1,
      continues: true,
      intendedPotted: true,
    });
    const after = afterShot(result, balls, "cue", RED, snookerTable, j);
    expect(ids(after.balls)).toEqual(["cue", "r2", "pink"]);
    expect(after.state).toEqual(COLOUR);
  });

  test("a colour potted with its own spot taken goes to the highest free spot", () => {
    // Black near the top-right corner; a red sits on the black spot and the pink on its own.
    const target = { x: W - 0.3, y: L - 0.3 };
    const balls = [
      s("cue", "cue", { x: target.x - 0.15, y: target.y - 0.15 }),
      s("black", "black", target),
      s("r1", "red", black),
      s("pink", "pink", pink),
    ];
    const result = shoot(snookerTable, snookerSet, balls, Math.PI / 4, 2);
    const j = judgeShot(result, balls, "cue", COLOUR, { targetId: "black" });
    expect(j).toMatchObject({ potted: ["black"], foul: false, scored: 7, intendedPotted: true });
    const after = afterShot(result, balls, "cue", COLOUR, snookerTable, j);
    expect(ids(after.balls)).toEqual(["cue", "black", "r1", "pink"]);
    expect(after.balls[1]).toMatchObject({ x: blue.x, y: blue.y });
    // Reds remain, so the next ball on is a red.
    expect(after.state).toEqual(RED);
  });

  test("after the last red's colour the colours phase starts, and that colour is respotted", () => {
    const balls = [s("cue", "cue", { x: 0.5, y: 0.5 }), s("pink", "pink", { x: 1, y: 2.4 })];
    const r = fake(balls, [{ hit: ["cue", "pink"] }, { pocket: "pink" }]);
    const j = judgeShot(r, balls, "cue", COLOUR);
    const after = afterShot(r, balls, "cue", COLOUR, snookerTable, j);
    expect(after.state).toEqual(COLOURS);
    expect(after.balls[1]).toMatchObject({ x: pink.x, y: pink.y });
  });

  test("colour phase: the intended colour must be hit first; any colour without an intention", () => {
    const balls = [
      s("cue", "cue", { x: 0.5, y: 0.5 }),
      s("blue", "blue", blue),
      s("pink", "pink", pink),
      s("r1", "red", { x: 0.4, y: 2.2 }),
    ];
    const r = fake(balls, [{ hit: ["cue", "blue"] }, { pocket: "blue" }]);
    expect(judgeShot(r, balls, "cue", COLOUR)).toMatchObject({ foul: false, scored: 5 });
    expect(judgeShot(r, balls, "cue", COLOUR, { targetId: "pink" })).toMatchObject({
      foul: true,
      reason: "wrong-ball-first",
      intendedPotted: false,
    });
    const red = fake(balls, [{ hit: ["cue", "r1"] }]);
    expect(judgeShot(red, balls, "cue", COLOUR).reason).toBe("wrong-ball-first");
  });

  test("balls not on potted", () => {
    const balls = [
      s("cue", "cue", { x: 0.5, y: 0.5 }),
      s("blue", "blue", blue),
      s("pink", "pink", pink),
      s("r1", "red", { x: 0.4, y: 2.2 }),
      s("yellow", "yellow", yellow),
    ];
    // Red phase: a colour.
    const redPhase = fake(balls, [{ hit: ["cue", "r1"] }, { pocket: "r1" }, { pocket: "pink" }]);
    expect(judgeShot(redPhase, balls, "cue", RED)).toMatchObject({
      foul: true,
      reason: "ball-not-on-potted",
      scored: 0,
    });
    // Colour phase: a red, or a colour other than the one hit.
    const withRed = fake(balls, [{ hit: ["cue", "blue"] }, { pocket: "r1" }]);
    expect(judgeShot(withRed, balls, "cue", COLOUR).reason).toBe("ball-not-on-potted");
    const other = fake(balls, [{ hit: ["cue", "blue"] }, { pocket: "pink" }]);
    expect(judgeShot(other, balls, "cue", COLOUR).reason).toBe("ball-not-on-potted");
    // Colours phase (no reds): anything but the yellow.
    const noRed = balls.filter((b) => b.kind !== "red");
    const wrong = fake(noRed, [{ hit: ["cue", "yellow"] }, { pocket: "blue" }]);
    expect(judgeShot(wrong, noRed, "cue", COLOURS).reason).toBe("ball-not-on-potted");
    const first = fake(noRed, [{ hit: ["cue", "blue"] }]);
    expect(judgeShot(first, noRed, "cue", COLOURS).reason).toBe("wrong-ball-first");
    const cue = fake(noRed, [{ hit: ["cue", "yellow"] }, { pocket: "cue" }]);
    expect(judgeShot(cue, noRed, "cue", COLOURS).reason).toBe("cue-potted");
    expect(judgeShot(fake(noRed, []), noRed, "cue", COLOURS).reason).toBe("no-contact");
  });

  test("colours phase: the colour on stays off; the black ends the frame", () => {
    const balls = [
      s("cue", "cue", { x: 0.5, y: 0.5 }),
      s("yellow", "yellow", { x: 1.2, y: 1.2 }),
      s("black", "black", black),
    ];
    const y = fake(balls, [{ hit: ["cue", "yellow"] }, { pocket: "yellow" }]);
    const jy = judgeShot(y, balls, "cue", COLOURS);
    expect(jy).toMatchObject({ foul: false, scored: 2, continues: true, finished: false });
    const after = afterShot(y, balls, "cue", COLOURS, snookerTable, jy);
    expect(ids(after.balls)).toEqual(["cue", "black"]);
    expect(after.state).toEqual(COLOURS);

    const last = [balls[0] as PlanBall, balls[2] as PlanBall];
    const b = fake(last, [{ hit: ["cue", "black"] }, { pocket: "black" }]);
    expect(judgeShot(b, last, "cue", COLOURS)).toMatchObject({
      scored: 7,
      continues: true,
      finished: true,
    });
    // The black in the colour phase is not the end: it comes back.
    const withRed = [...last, s("r1", "red", { x: 0.4, y: 2.2 })];
    const b2 = fake(withRed, [{ hit: ["cue", "black"] }, { pocket: "black" }]);
    const j2 = judgeShot(b2, withRed, "cue", COLOUR);
    expect(j2.finished).toBe(false);
    expect(afterShot(b2, withRed, "cue", COLOUR, snookerTable, j2).balls[1]).toMatchObject(black);
  });

  test("on a foul, colours are respotted (any phase, highest value first) and reds stay off", () => {
    // The cue ball ends on the black spot; black and pink are potted on a foul.
    const balls = [
      s("cue", "cue", { x: 0.5, y: 0.5 }),
      s("r1", "red", { x: 0.4, y: 2.2 }),
      s("pink", "pink", { x: 1.2, y: 2.9 }),
      s("black", "black", { x: 0.3, y: 3.2 }),
    ];
    const r = fake(
      balls,
      [{ hit: ["cue", "r1"] }, { pocket: "r1" }, { pocket: "pink" }, { pocket: "black" }],
      { cue: black },
    );
    for (const state of [RED, COLOURS]) {
      const j = judgeShot(r, balls, "cue", state);
      expect(j.foul).toBe(true);
      const after = afterShot(r, balls, "cue", state, snookerTable, j);
      expect(ids(after.balls)).toEqual(["cue", "pink", "black"]);
      expect(after.balls[0]).toMatchObject(black);
      // Black first: its spot is taken, so it takes the pink spot; the pink then takes the blue.
      expect(after.balls[2]).toMatchObject({ x: pink.x, y: pink.y });
      expect(after.balls[1]).toMatchObject({ x: blue.x, y: blue.y });
      expect(after.state).toBe(state);
    }
  });

  test("every spot taken: above its own spot, else below", () => {
    const occupy = [
      s("cue", "cue", { x: 0.5, y: 0.5 }),
      s("r1", "red", black),
      s("pink", "pink", pink),
      s("blue", "blue", blue),
      s("brown", "brown", brown),
      s("green", "green", green),
      s("yellow", "yellow", yellow),
    ];
    const r = snookerSet.object.diameterM / 2;
    const potBlack = (extra: PlanBall[]) => {
      const balls = [...occupy, ...extra, s("black", "black", { x: 0.3, y: 3.2 })];
      const res = fake(balls, [{ hit: ["cue", "black"] }, { pocket: "black" }]);
      const j = judgeShot(res, balls, "cue", COLOUR);
      expect(j.foul).toBe(false);
      const after = afterShot(res, balls, "cue", COLOUR, snookerTable, j);
      return need(
        after.balls.find((b) => b.id === "black"),
        "black",
      );
    };
    // The nearest free point above: one ball diameter (plus a hair), rounded up to the next mm.
    const above = potBlack([]);
    expect(above.x).toBe(black.x);
    expect(above.y).toBeCloseTo(black.y + 0.053, 9);

    // Fill the line above the black spot to the top cushion: it goes below its spot instead.
    const fill: PlanBall[] = [];
    for (let k = 1; black.y + k * 0.053 <= L - r; k++) {
      fill.push(s(`f${k}`, "red", { x: black.x, y: black.y + k * 0.053 }));
    }
    const below = potBlack(fill);
    expect(below.x).toBe(black.x);
    expect(below.y).toBeCloseTo(black.y - 0.053, 9);
  });

  test("a table without snooker spots leaves the colour off", () => {
    const balls = [
      mk(snookerSet, "cue", "cue", 0.5, 0.5),
      mk(snookerSet, "r1", "red", 0.4, 1.2),
      mk(snookerSet, "pink", "pink", 1.0, 1.8),
    ];
    const r = fake(balls, [{ hit: ["cue", "r1"] }, { pocket: "pink" }]);
    const j = judgeShot(r, balls, "cue", RED);
    expect(ids(afterShot(r, balls, "cue", RED, poolTable, j).balls)).toEqual(["cue", "r1"]);
  });
});

import { resolveCustomTable, validateTable } from "@baize/tables";
import type { BallSetSpec, ClothSpec, CustomTableFields, TableSpec } from "@baize/tables";
import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { noseImpulseCushion, sampleAt, simulate } from "../src/index";
import type { BallInput, SimInput, SimResult } from "../src/index";
import {
  BLACKBALL_6,
  BLACKBALL_BALLS,
  FAST,
  MEDIUM,
  POOL_7,
  POOL_BALLS,
  SLOW,
  SNOOKER_12,
  SNOOKER_BALLS,
  checkInvariants,
  eventsOf,
  finalPosition,
} from "./helpers";

/**
 * Physical verification (SPEC 5.8). Every check runs on the smallest and largest tables and
 * on a hand-picked odd custom table; the property tests at the end add random custom tables.
 */

const G = 9.80665;

interface Case {
  name: string;
  table: TableSpec;
  set: BallSetSpec;
}

const ODD_CUSTOM: TableSpec = resolveCustomTable(
  {
    game: "pool",
    lengthM: 2.9,
    widthM: 1.38,
    cornerMouthM: 0.105,
    middleMouthM: 0.118,
    jawStyle: "rounded",
  },
  0.0508,
);
const ODD_SET: BallSetSpec = {
  ...POOL_BALLS,
  object: { diameterM: 0.0508, massKg: 0.118 },
};

const CASES: Case[] = [
  { name: "blackball 6 ft (smallest)", table: BLACKBALL_6, set: BLACKBALL_BALLS },
  { name: "pool 7 ft", table: POOL_7, set: POOL_BALLS },
  { name: "snooker 12 ft (largest)", table: SNOOKER_12, set: SNOOKER_BALLS },
  { name: "odd custom table", table: ODD_CUSTOM, set: ODD_SET },
];

function ball(
  c: Case,
  id: string,
  x: number,
  y: number,
  extra: Partial<BallInput> = {},
): BallInput {
  return { id, radiusM: c.set.object.diameterM / 2, massKg: c.set.object.massKg, x, y, ...extra };
}

function input(c: Case, balls: BallInput[], cloth: ClothSpec = SLOW, e = 1): SimInput {
  return { table: c.table, cloth, balls, ballRestitution: e };
}

function unit(v: { x: number; y: number }): { x: number; y: number } {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);
  return { x: v.x / l, y: v.y / l };
}

function delta(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: b.x - a.x, y: b.y - a.y };
}

/**
 * Cue ball touching an object ball, moving along +y, with the line of centres rotated by
 * `cut` (radians) from the cue ball's direction. The collision happens at t = 0.
 */
function cutScene(
  c: Case,
  cut: number,
  speed: number,
  rolling: boolean,
): { sim: SimInput; start: { x: number; y: number }; objStart: { x: number; y: number } } {
  const R = c.set.object.diameterM / 2;
  const start = { x: c.table.playingArea.widthM / 2, y: c.table.playingArea.lengthM * 0.35 };
  const objStart = { x: start.x + 2 * R * Math.sin(cut), y: start.y + 2 * R * Math.cos(cut) };
  const cue = ball(c, "cue", start.x, start.y, {
    velocity: { x: 0, y: speed },
    spin: rolling ? { x: -speed / R, y: 0, z: 0 } : { x: 0, y: 0, z: 0 },
  });
  return { sim: input(c, [cue, ball(c, "obj", objStart.x, objStart.y)]), start, objStart };
}

describe.each(CASES)("$name", (c) => {
  const R = c.set.object.diameterM / 2;
  const W = c.table.playingArea.widthM;
  const L = c.table.playingArea.lengthM;

  test("straight stun shot: the cue ball stops dead", () => {
    const sim = input(c, [
      ball(c, "cue", W / 2, L * 0.3, { velocity: { x: 0, y: 0.6 } }),
      ball(c, "obj", W / 2, L * 0.3 + 2 * R),
    ]);
    const r = simulate(sim);
    expect(finalPosition(r, "cue")).toEqual({ x: W / 2, y: L * 0.3 });
    expect(finalPosition(r, "obj").y).toBeGreaterThan(L * 0.3 + 2 * R + 0.05);
    checkInvariants(r, sim);
  });

  test.each([15, 30, 45, 60])("90 degree rule at a %i degree cut", (deg) => {
    const { sim, start, objStart } = cutScene(c, (deg * Math.PI) / 180, 0.45, false);
    const r = simulate(sim);
    expect(eventsOf(r, "ball-cushion")).toHaveLength(0);
    const cuePath = unit(delta(start, finalPosition(r, "cue")));
    const objPath = unit(delta(objStart, finalPosition(r, "obj")));
    expect(cuePath.x * objPath.x + cuePath.y * objPath.y).toBeCloseTo(0, 9);
    checkInvariants(r, sim);
  });

  test("30 degree rule: a rolling cue ball on a half-ball hit deflects by about 34 degrees", () => {
    const cut = Math.PI / 6;
    const { sim } = cutScene(c, cut, 0.45, true);
    const r = simulate(sim);
    // Direction once the cue ball is rolling again.
    const track = r.tracks[0] as SimResult["tracks"][number];
    const rolling = track.segments.find((s) => s.state === "rolling" && s.t0 > 0);
    expect(rolling).toBeDefined();
    if (!rolling) return;
    const dir = unit(rolling.v0);
    const deflection = Math.atan2(Math.abs(dir.x), dir.y);
    const expected = Math.atan2(
      Math.sin(cut) * Math.cos(cut),
      Math.sin(cut) * Math.sin(cut) + 2 / 5,
    );
    expect(deflection).toBeCloseTo(expected, 9);
    expect((deflection * 180) / Math.PI).toBeGreaterThan(30);
    expect((deflection * 180) / Math.PI).toBeLessThan(35);
    checkInvariants(r, sim);
  });

  test.each([
    ["stun", 0],
    ["follow", 0.25],
    ["draw", -0.3],
  ])("%s: natural roll starts at the analytic time and place", (_name, vertical) => {
    const v = 0.5;
    const sim: SimInput = {
      ...input(c, [ball(c, "cue", W / 2, L * 0.2)], MEDIUM),
      shot: {
        ballId: "cue",
        aimAngleRad: Math.PI / 2,
        speedMps: v,
        tipOffset: { side: 0, vertical },
      },
    };
    const r = simulate(sim);
    const first = eventsOf(r, "transition")[0];
    expect(first?.to).toBe("rolling");
    // Slip speed just after the strike, signed along the direction of travel.
    const slip = v * (1 - 2.5 * vertical);
    const mu = MEDIUM.slidingFriction;
    const T = (2 * Math.abs(slip)) / (7 * mu * G);
    expect(first?.t).toBeCloseTo(T, 12);
    const accel = -Math.sign(slip) * mu * G;
    const at = sampleAt(r, T).find((b) => b.id === "cue");
    expect(at?.position.y).toBeCloseTo(L * 0.2 + v * T + 0.5 * accel * T * T, 12);
    // Speed at natural roll: 5/7 of the launch speed plus 2/7 of the spin's surface speed.
    expect(at?.velocity.y).toBeCloseTo((5 * v + 2 * 2.5 * vertical * v) / 7, 12);
    checkInvariants(r, sim);
  });

  test("faster cloth rolls further, and the order is slow < medium < fast", () => {
    const run = (cloth: ClothSpec): number => {
      const sim: SimInput = {
        ...input(c, [ball(c, "cue", W / 2, L * 0.15)], cloth),
        shot: {
          ballId: "cue",
          aimAngleRad: Math.PI / 2,
          speedMps: 0.35,
          tipOffset: { side: 0, vertical: 0.4 },
        },
      };
      const r = simulate(sim);
      expect(eventsOf(r, "ball-cushion")).toHaveLength(0);
      return finalPosition(r, "cue").y - L * 0.15;
    };
    const slow = run(SLOW);
    const medium = run(MEDIUM);
    const fast = run(FAST);
    expect(medium).toBeGreaterThan(slow);
    expect(fast).toBeGreaterThan(medium);
    // Natural roll from the start: distance is v^2 / (2 mu_r g) exactly.
    expect(medium).toBeCloseTo((0.35 * 0.35) / (2 * MEDIUM.rollingResistance * G), 12);
  });

  test("grippier cloth turns draw into natural roll sooner", () => {
    const time = (cloth: ClothSpec): number => {
      const sim: SimInput = {
        ...input(c, [ball(c, "cue", W / 2, L * 0.2)], cloth),
        shot: {
          ballId: "cue",
          aimAngleRad: Math.PI / 2,
          speedMps: 0.5,
          tipOffset: { side: 0, vertical: -0.3 },
        },
      };
      return eventsOf(simulate(sim), "transition")[0]?.t ?? Number.NaN;
    };
    expect(time(SLOW)).toBeLessThan(time(MEDIUM));
    expect(time(MEDIUM)).toBeLessThan(time(FAST));
  });

  test("cushion rebound of a no-spin ball matches the cushion model, on both side rails", () => {
    // Find the contact distance by rolling a probe square into the left rail.
    const probe = simulate(
      input(c, [ball(c, "p", W / 2, L * 0.3, { velocity: { x: -0.8, y: 0 } })], MEDIUM),
    );
    const contactX = eventsOf(probe, "ball-cushion")[0]?.point.x ?? Number.NaN;
    expect(contactX).toBeLessThan(R);
    expect(contactX).toBeGreaterThan(0.9 * R);

    const vIn = { x: -0.8, y: 0.6 };
    const left = simulate(input(c, [ball(c, "b", contactX, L * 0.3, { velocity: vIn })], MEDIUM));
    const hit = eventsOf(left, "ball-cushion")[0];
    expect(hit?.t).toBeLessThan(1e-12);
    const after = sampleAt(left, 1e-9).find((b) => b.id === "b");
    const model = noseImpulseCushion.resolve(
      { radiusM: R, massKg: c.set.object.massKg, velocity: vIn, spin: { x: 0, y: 0, z: 0 } },
      { x: 1, y: 0 },
      c.table.cushion,
    );
    expect(after?.velocity.x).toBeCloseTo(model.velocity.x, 7);
    expect(after?.velocity.y).toBeCloseTo(model.velocity.y, 7);
    // It leaves the rail, slower, still travelling up the table.
    expect(after?.velocity.x).toBeGreaterThan(0);
    expect(after?.velocity.x).toBeLessThan(0.8);
    expect(after?.velocity.y).toBeGreaterThan(0);

    // Mirror image on the right rail.
    const right = simulate(
      input(c, [ball(c, "b", W - contactX, L * 0.3, { velocity: { x: 0.8, y: 0.6 } })], MEDIUM),
    );
    const mirrored = sampleAt(right, 1e-9).find((b) => b.id === "b");
    expect(mirrored?.velocity.x).toBeCloseTo(-(after?.velocity.x ?? 0), 13);
    expect(mirrored?.velocity.y).toBeCloseTo(after?.velocity.y ?? 0, 13);
    const endLeft = finalPosition(left, "b");
    const endRight = finalPosition(right, "b");
    expect(endRight.x).toBeCloseTo(W - endLeft.x, 9);
    expect(endRight.y).toBeCloseTo(endLeft.y, 9);
  });

  test("the whole simulation is mirror symmetric", () => {
    const balls = (mirror: boolean): BallInput[] => {
      const mx = (x: number): number => (mirror ? W - x : x);
      return [
        ball(c, "cue", mx(W * 0.3), L * 0.25),
        ball(c, "a", mx(W * 0.42), L * 0.55),
        ball(c, "b", mx(W * 0.7), L * 0.7),
      ];
    };
    const shot = (mirror: boolean): SimInput["shot"] => ({
      ballId: "cue",
      aimAngleRad: mirror ? Math.PI - 1.2 : 1.2,
      speedMps: 2.4,
      tipOffset: { side: mirror ? -0.2 : 0.2, vertical: 0.15 },
    });
    const a = simulate({ ...input(c, balls(false), MEDIUM, 0.94), shot: shot(false) });
    const b = simulate({ ...input(c, balls(true), MEDIUM, 0.94), shot: shot(true) });
    expect(b.events.map((e) => e.type)).toEqual(a.events.map((e) => e.type));
    for (const id of ["cue", "a", "b"]) {
      const pa = finalPosition(a, id);
      const pb = finalPosition(b, id);
      expect(pb.x).toBeCloseTo(W - pa.x, 6);
      expect(pb.y).toBeCloseTo(pa.y, 6);
    }
  });
});

describe("random custom tables", () => {
  const tableArb = fc
    .record({
      game: fc.constantFrom("snooker", "pool", "blackball"),
      lengthM: fc.double({ min: 1.6, max: 3.8, noNaN: true }),
      ratio: fc.double({ min: 0.46, max: 0.54, noNaN: true }),
      ballDiameterM: fc.double({ min: 0.047, max: 0.062, noNaN: true }),
      cornerBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
      middleBalls: fc.double({ min: 1.5, max: 2.3, noNaN: true }),
      jawStyle: fc.constantFrom("angled", "rounded"),
    })
    .map((f): Case | undefined => {
      const fields: CustomTableFields = {
        game: f.game as CustomTableFields["game"],
        lengthM: f.lengthM,
        widthM: f.lengthM * f.ratio,
        cornerMouthM: f.cornerBalls * f.ballDiameterM,
        middleMouthM: f.middleBalls * f.ballDiameterM,
        jawStyle: f.jawStyle as CustomTableFields["jawStyle"],
      };
      if (validateTable(fields, f.ballDiameterM).some((i) => i.severity === "error")) {
        return undefined;
      }
      const massKg = 0.163 * (f.ballDiameterM / 0.05715) ** 3;
      return {
        name: "random",
        table: resolveCustomTable(fields, f.ballDiameterM),
        set: { ...POOL_BALLS, object: { diameterM: f.ballDiameterM, massKg } },
      };
    });

  test("90 and 30 degree rules hold at any cut angle on any table", () => {
    fc.assert(
      fc.property(tableArb, fc.double({ min: 0.1, max: 1.4, noNaN: true }), (c, cut) => {
        fc.pre(c !== undefined);
        if (!c) return;
        const stun = cutScene(c, cut, 0.4, false);
        const r1 = simulate(stun.sim);
        fc.pre(eventsOf(r1, "ball-cushion").length === 0 && eventsOf(r1, "pocket").length === 0);
        const cuePath = unit(delta(stun.start, finalPosition(r1, "cue")));
        const objPath = unit(delta(stun.objStart, finalPosition(r1, "obj")));
        expect(cuePath.x * objPath.x + cuePath.y * objPath.y).toBeCloseTo(0, 8);

        const roll = cutScene(c, cut, 0.4, true);
        const r2 = simulate(roll.sim);
        const track = r2.tracks[0] as SimResult["tracks"][number];
        const rolling = track.segments.find((s) => s.state === "rolling" && s.t0 > 0);
        fc.pre(rolling !== undefined);
        if (!rolling) return;
        const dir = unit(rolling.v0);
        const expected = Math.atan2(
          Math.sin(cut) * Math.cos(cut),
          Math.sin(cut) * Math.sin(cut) + 2 / 5,
        );
        expect(Math.atan2(Math.abs(dir.x), dir.y)).toBeCloseTo(expected, 8);
      }),
      { numRuns: 150 },
    );
  });
});

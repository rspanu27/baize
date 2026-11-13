import { napDrift } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { SimInputError, sampleAt, simulate } from "../src/index";
import type { BallInput, ClothInput, SimInput, SimResult, Vec2 } from "../src/index";
import { MEDIUM, SNOOKER_12, SNOOKER_BALLS, checkInvariants, eventsOf } from "./helpers";
import { snookerBreakOff } from "./scenes";

/**
 * Nap: a rolling ball is pushed along the nap. The exact motion, v' = -mu_r g v_hat + b, is
 * followed in pieces of constant acceleration; these tests compare the pieces with a fine
 * numerical integration of the exact equation and check the directions that players know.
 */

const G = 9.80665;
const MU_R = 0.01;
const R = SNOOKER_BALLS.object.diameterM / 2;
const M = SNOOKER_BALLS.object.massKg;
/** Nap runs from baulk to top: +y. */
const UP = Math.PI / 2;
const START: Vec2 = { x: 0.889, y: 1.7845 };

function cloth(ratio: number, directionRad = UP): ClothInput {
  return {
    slidingFriction: 0.2,
    rollingResistance: MU_R,
    spinningFriction: 0.0127,
    ...(ratio > 0 ? { napDrift: { directionRad, coefficient: ratio * MU_R } } : {}),
  };
}

/** One ball in the middle of a snooker table, already rolling with the given velocity. */
function rollingScene(v: Vec2, c: ClothInput, at: Vec2 = START): SimInput {
  const ball: BallInput = {
    id: "b",
    radiusM: R,
    massKg: M,
    x: at.x,
    y: at.y,
    velocity: v,
    spin: { x: -v.y / R, y: v.x / R, z: 0 },
  };
  return { table: SNOOKER_12, cloth: c, balls: [ball], ballRestitution: 0.92 };
}

function restOf(result: SimResult): Vec2 {
  const b = sampleAt(result, result.durationS + 1)[0];
  if (!b) throw new Error("no ball");
  return b.position;
}

function roll(v: Vec2, ratio: number, directionRad = UP): { end: Vec2; result: SimResult } {
  const input = rollingScene(v, cloth(ratio, directionRad));
  const result = simulate(input);
  expect(result.status).toBe("complete");
  checkInvariants(result, input);
  return { end: restOf(result), result };
}

/** The exact equation of motion integrated with small Runge-Kutta steps until the ball stops. */
function reference(v0: Vec2, ratio: number, directionRad = UP): Vec2 {
  const bx = ratio * MU_R * G * Math.cos(directionRad);
  const by = ratio * MU_R * G * Math.sin(directionRad);
  const f = (vx: number, vy: number): [number, number] => {
    const s = Math.hypot(vx, vy);
    return [(-MU_R * G * vx) / s + bx, (-MU_R * G * vy) / s + by];
  };
  let x = START.x;
  let y = START.y;
  let vx = v0.x;
  let vy = v0.y;
  const dt = 2e-5;
  // Stop when the ball has well under a micrometre left to roll.
  while (Math.hypot(vx, vy) > 5e-5) {
    const [k1x, k1y] = f(vx, vy);
    const [k2x, k2y] = f(vx + 0.5 * dt * k1x, vy + 0.5 * dt * k1y);
    const [k3x, k3y] = f(vx + 0.5 * dt * k2x, vy + 0.5 * dt * k2y);
    const [k4x, k4y] = f(vx + dt * k3x, vy + dt * k3y);
    const ax = (k1x + 2 * k2x + 2 * k3x + k4x) / 6;
    const ay = (k1y + 2 * k2y + 2 * k3y + k4y) / 6;
    x += dt * (vx + 0.5 * dt * ax);
    y += dt * (vy + 0.5 * dt * ay);
    vx += dt * ax;
    vy += dt * ay;
  }
  return { x, y };
}

/** Speed that rolls `distanceM` on the plain cloth. */
function speedFor(distanceM: number): number {
  return Math.sqrt(2 * MU_R * G * distanceM);
}

describe("nap: along the nap", () => {
  const v = speedFor(0.8);

  test("with the nap the ball runs further, against it less far, by the exact amounts", () => {
    const ratio = 0.1;
    const plain = roll({ x: 0, y: v }, 0).end.y - START.y;
    const withNap = roll({ x: 0, y: v }, ratio).end.y - START.y;
    const against = START.y - roll({ x: 0, y: -v }, ratio).end.y;
    expect(plain).toBeCloseTo(0.8, 9);
    expect(withNap).toBeCloseTo(0.8 / (1 - ratio), 8);
    expect(against).toBeCloseTo(0.8 / (1 + ratio), 8);
  });

  test("the ball stays on its line", () => {
    expect(roll({ x: 0, y: v }, 0.3).end.x).toBeCloseTo(START.x, 9);
    expect(roll({ x: 0, y: -v }, 0.3).end.x).toBeCloseTo(START.x, 9);
  });
});

describe("nap: across and at an angle", () => {
  test("a ball rolled across the nap drifts the way the nap runs, by half of ratio x distance", () => {
    const d = 0.7;
    const ratio = 0.02;
    const { end } = roll({ x: speedFor(d), y: 0 }, ratio);
    const drift = end.y - START.y;
    expect(drift).toBeGreaterThan(0);
    // To first order in the ratio the sideways speed is ratio * s * ln(v0 / s) at speed s (the
    // drag turns with the ball and takes back half of what the push alone would give), which
    // adds up to a drift of ratio * d / 2.
    expect(drift).toBeGreaterThan(0.95 * 0.5 * ratio * d);
    expect(drift).toBeLessThan(1.05 * 0.5 * ratio * d);
    // The opposite way across: the same drift.
    const other = roll({ x: -speedFor(d), y: 0 }, ratio).end;
    expect(other.y - START.y).toBeCloseTo(drift, 9);
    expect(other.x - START.x).toBeCloseTo(-(end.x - START.x), 9);
  });

  test("against the nap at an angle, the ball falls away towards the side it is heading for", () => {
    // Towards baulk (-y) and towards the right-hand cushion (+x), as when a ball is played
    // slowly towards a middle pocket from the top of the table.
    const s = speedFor(0.7);
    const v = { x: s * 0.5, y: -s * Math.sqrt(0.75) };
    const plain = roll(v, 0).end;
    const napped = roll(v, 0.05).end;
    // Distance off the line of the shot, measured towards the right-hand cushion.
    const offLine = (p: Vec2) => (p.x - START.x) * Math.sqrt(0.75) + (p.y - START.y) * 0.5;
    expect(offLine(plain)).toBeCloseTo(0, 9);
    expect(offLine(napped)).toBeGreaterThan(0.005);
    // And it does not get as far down the table against the nap.
    expect(napped.y).toBeGreaterThan(plain.y);
  });

  test("with the nap at an angle, the ball is turned towards the line of the nap", () => {
    const s = speedFor(0.7);
    const v = { x: s * 0.5, y: s * Math.sqrt(0.75) };
    const plain = roll(v, 0).end;
    const napped = roll(v, 0.05).end;
    const angle = (p: Vec2) => Math.atan2(p.x - START.x, p.y - START.y);
    expect(angle(napped)).toBeLessThan(angle(plain));
    expect(napped.y).toBeGreaterThan(plain.y);
  });

  test("the drift grows as the ball slows: the first half of the roll has under a fifth of it", () => {
    const d = 0.7;
    const { result, end } = roll({ x: speedFor(d), y: 0 }, 0.05);
    // Position when the ball has covered half the distance across.
    let lo = 0;
    let hi = result.durationS;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      const x = (sampleAt(result, mid)[0] as { position: Vec2 }).position.x;
      if (x - START.x < 0.5 * (end.x - START.x)) lo = mid;
      else hi = mid;
    }
    const half = (sampleAt(result, lo)[0] as { position: Vec2 }).position.y - START.y;
    // To first order it is (1 - ln 2) / 2 of the whole, about 15 %.
    expect(half).toBeLessThan(0.2 * (end.y - START.y));
    expect(half).toBeGreaterThan(0.1 * (end.y - START.y));
  });
});

describe("nap: the pieces follow the exact equation", () => {
  const cases: [string, Vec2, number][] = [];
  for (const ratio of [0.01, 0.02, 0.1, 0.3, 0.8]) {
    for (const deg of [10, 60, 90, 135, 170, 179]) {
      const s = speedFor(0.3);
      const a = (deg * Math.PI) / 180;
      // Angle measured from the direction of the nap (+y).
      cases.push([
        `ratio ${ratio}, ${deg} degrees off the nap`,
        { x: s * Math.sin(a), y: s * Math.cos(a) },
        ratio,
      ]);
    }
  }

  test.each(cases)("%s", (_name, v, ratio) => {
    const { end } = roll(v, ratio);
    const exact = reference(v, ratio);
    const speed = Math.hypot(v.x, v.y);
    const plain = { x: START.x + (v.x / speed) * 0.3, y: START.y + (v.y / speed) * 0.3 };
    const error = Math.hypot(end.x - exact.x, end.y - exact.y);
    const effect = Math.hypot(exact.x - plain.x, exact.y - plain.y);
    // Within 1 % of what the nap does to the ball (plus 10 micrometres).
    expect(error, `effect ${effect}`).toBeLessThan(0.01 * effect + 1e-5);
  });
});

describe("nap: symmetry and direction", () => {
  test("mirror symmetry about the line of the nap", () => {
    const s = speedFor(0.6);
    const a = roll({ x: 0.6 * s, y: -0.8 * s }, 0.1).end;
    const b = roll({ x: -0.6 * s, y: -0.8 * s }, 0.1).end;
    expect(b.x - START.x).toBeCloseTo(-(a.x - START.x), 10);
    expect(b.y).toBeCloseTo(a.y, 10);
  });

  test("turning the nap and the shot together turns the result", () => {
    const s = speedFor(0.5);
    // Nap along +y, ball at 60 degrees off it; then both turned a quarter turn clockwise
    // (nap along +x).
    const a = roll({ x: s * Math.sin(1), y: s * Math.cos(1) }, 0.1, UP).end;
    const b = roll({ x: s * Math.cos(1), y: -s * Math.sin(1) }, 0.1, 0).end;
    expect(b.x - START.x).toBeCloseTo(a.y - START.y, 9);
    expect(b.y - START.y).toBeCloseTo(-(a.x - START.x), 9);
  });
});

describe("nap: what it leaves alone", () => {
  test("a coefficient of zero is the same as no nap, bit for bit", () => {
    const v = { x: 0.3, y: 0.1 };
    const none = simulate(rollingScene(v, cloth(0)));
    const zero = simulate(
      rollingScene(v, { ...cloth(0), napDrift: { directionRad: UP, coefficient: 0 } }),
    );
    expect(zero).toEqual(none);
  });

  test("the stored nap setting alone changes nothing", () => {
    const v = { x: 0.3, y: 0.1 };
    const none = simulate(rollingScene(v, cloth(0)));
    const stored = simulate(
      rollingScene(v, { ...cloth(0), nap: { directionRad: UP, strength: 1 } }),
    );
    expect(stored).toEqual(none);
  });

  test("a sliding ball is not affected until it starts to roll", () => {
    const make = (ratio: number): SimInput => ({
      table: SNOOKER_12,
      cloth: cloth(ratio),
      balls: [{ id: "b", radiusM: R, massKg: M, x: START.x, y: START.y }],
      ballRestitution: 0.92,
      shot: { ballId: "b", aimAngleRad: 0, speedMps: 1, tipOffset: { side: 0, vertical: 0 } },
    });
    const plain = simulate(make(0));
    const napped = simulate(make(0.3));
    const slidePlain = plain.tracks[0]?.segments[0];
    const slideNapped = napped.tracks[0]?.segments[0];
    expect(slideNapped?.state).toBe("sliding");
    expect(slideNapped).toEqual(slidePlain);
    expect(restOf(napped).y).toBeGreaterThan(restOf(plain).y + 0.01);
  });

  test("a roll in pieces is still one roll in the event list", () => {
    const { result } = roll({ x: speedFor(0.6), y: 0 }, 0.1);
    expect(result.tracks[0]?.segments.length).toBeGreaterThan(10);
    expect(result.events).toHaveLength(1);
    expect(eventsOf(result, "transition")[0]).toMatchObject({ from: "rolling", to: "stationary" });
  });

  test("a ball at rest stays at rest", () => {
    const input: SimInput = {
      table: SNOOKER_12,
      cloth: cloth(0.8),
      balls: [{ id: "b", radiusM: R, massKg: M, x: START.x, y: START.y }],
      ballRestitution: 0.92,
    };
    const result = simulate(input);
    expect(result.events).toHaveLength(0);
    expect(restOf(result)).toEqual(START);
  });
});

describe("nap: input checks", () => {
  const bad = (napDriftValue: { directionRad: number; coefficient: number }) => () =>
    simulate(rollingScene({ x: 0.1, y: 0 }, { ...cloth(0), napDrift: napDriftValue }));

  test("the push must stay below 0.8 of the rolling resistance", () => {
    expect(bad({ directionRad: UP, coefficient: 0.81 * MU_R })).toThrow(SimInputError);
    expect(bad({ directionRad: UP, coefficient: 0.8 * MU_R })).not.toThrow();
  });

  test("negative or non-finite values are rejected", () => {
    expect(bad({ directionRad: UP, coefficient: -1e-4 })).toThrow(SimInputError);
    expect(bad({ directionRad: UP, coefficient: Number.NaN })).toThrow(SimInputError);
    expect(bad({ directionRad: Number.POSITIVE_INFINITY, coefficient: 1e-4 })).toThrow(
      SimInputError,
    );
  });
});

describe("nap: whole shots", () => {
  test("a snooker break-off on a heavy nap keeps every invariant and stays cheap", () => {
    const base = snookerBreakOff();
    const drift = napDrift({ ...MEDIUM, nap: { directionRad: UP, strength: 1 } });
    if (!drift) throw new Error("expected a nap");
    const input: SimInput = { ...base, cloth: { ...base.cloth, napDrift: drift } };
    const result = simulate(input);
    expect(result.status).toBe("complete");
    checkInvariants(result, input);
    expect(simulate(input)).toEqual(result);
    const plain = simulate(base);
    // Measured on 2026-11-13: see the performance test for the time.
    expect(result.stats.eventCount).toBeLessThan(plain.stats.eventCount + 2000);
    // The nap changes where balls stop.
    expect(sampleAt(result, 1e3)).not.toEqual(sampleAt(plain, 1e3));
  });

  test("rough size on a snooker cloth: a slow ball across a heavy nap is off line by 1 to 5 cm in 1.5 m", () => {
    const drift = napDrift({ ...MEDIUM, nap: { directionRad: UP, strength: 1 } });
    if (!drift) throw new Error("expected a nap");
    const c: ClothInput = { ...MEDIUM, napDrift: drift };
    const v = Math.sqrt(2 * MEDIUM.rollingResistance * G * 1.5);
    const input = rollingScene({ x: v, y: 0 }, c, { x: 0.1, y: 1.2 });
    const end = restOf(simulate(input));
    expect(end.x - 0.1).toBeGreaterThan(1.45);
    expect(end.y - 1.2).toBeGreaterThan(0.01);
    expect(end.y - 1.2).toBeLessThan(0.05);
  });
});

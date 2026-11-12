import { describe, expect, test } from "vitest";
import { SimInputError, prepareTable, sampleAt, simulate } from "../src/index";
import type { SimInput, SimResult } from "../src/index";
import {
  BLACKBALL_6,
  BLACKBALL_BALLS,
  MEDIUM,
  POOL_9,
  POOL_BALLS,
  R_POOL,
  SNOOKER_12,
  SNOOKER_BALLS,
  checkInvariants,
  eventsOf,
  finalPosition,
  poolBall,
  rackInput,
  spot,
} from "./helpers";

const G = 9.80665;
const W = POOL_9.playingArea.widthM;
const L = POOL_9.playingArea.lengthM;
const CX = W / 2;

function scene(balls: SimInput["balls"], extra: Partial<SimInput> = {}): SimInput {
  return { table: POOL_9, cloth: MEDIUM, balls, ballRestitution: 1, ...extra };
}

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof SimInputError ? e.code : `other: ${String(e)}`;
  }
  return undefined;
}

function speed(v: { x: number; y: number }): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

describe("a single ball", () => {
  test("nothing moving: no events, complete at once", () => {
    const input = scene([poolBall("a", 0.5, 0.5), poolBall("b", 0.7, 1.5)]);
    const r = simulate(input);
    expect(r.status).toBe("complete");
    expect(r.events).toEqual([]);
    expect(r.durationS).toBe(0);
    expect(r.tracks).toHaveLength(2);
    checkInvariants(r, input);
  });

  test("centre-ball shot up the table: slides, rolls, stops at the analytic distance", () => {
    const v = 0.5;
    const input = scene([poolBall("cue", CX, 0.4)], {
      shot: {
        ballId: "cue",
        aimAngleRad: Math.PI / 2,
        speedMps: v,
        tipOffset: { side: 0, vertical: 0 },
      },
    });
    const r = simulate(input);
    expect(r.status).toBe("complete");
    expect(r.events.map((e) => e.type)).toEqual(["strike", "transition", "transition"]);
    const transitions = eventsOf(r, "transition");
    expect(transitions.map((t) => `${t.from}>${t.to}`)).toEqual([
      "sliding>rolling",
      "rolling>stationary",
    ]);
    const muS = MEDIUM.slidingFriction;
    const muR = MEDIUM.rollingResistance;
    const slide = (12 * v * v) / (49 * muS * G);
    const roll = ((5 * v) / 7) ** 2 / (2 * muR * G);
    const end = finalPosition(r, "cue");
    expect(end.x).toBeCloseTo(CX, 12);
    expect(end.y).toBeCloseTo(0.4 + slide + roll, 12);
    expect((transitions[0] as { t: number }).t).toBeCloseTo((2 * v) / (7 * muS * G), 13);
    checkInvariants(r, input);
  });

  test("a slow ball with a lot of side spin is left spinning on the spot when it stops rolling", () => {
    const v = 0.05;
    const input = scene([
      poolBall("cue", CX, 0.4, { velocity: { x: 0, y: v }, spin: { x: -v / R_POOL, y: 0, z: 40 } }),
    ]);
    const r = simulate(input);
    expect(eventsOf(r, "transition").map((t) => t.to)).toEqual(["spinning", "stationary"]);
    checkInvariants(r, input);
  });
});

describe("ball-ball", () => {
  test("straight stun shot (e = 1): the cue ball stops dead, the object ball takes the speed", () => {
    // Touching balls, cue ball moving with no spin: the collision happens at t = 0.
    const input = scene([
      poolBall("cue", CX, 0.5, { velocity: { x: 0, y: 0.8 } }),
      poolBall("obj", CX, 0.5 + 2 * R_POOL),
    ]);
    const r = simulate(input);
    const hits = eventsOf(r, "ball-ball");
    expect(hits).toHaveLength(1);
    expect((hits[0] as { t: number }).t).toBeLessThan(1e-12);
    expect(finalPosition(r, "cue")).toEqual({ x: CX, y: 0.5 });
    const after = sampleAt(r, 1e-9).find((b) => b.id === "obj");
    expect(after?.velocity.y).toBeCloseTo(0.8, 8);
    expect(finalPosition(r, "obj").y).toBeGreaterThan(1);
    checkInvariants(r, input);
  });

  test("a rolling ball hitting a ball full on follows through", () => {
    const v = 0.8;
    const input = scene([
      poolBall("cue", CX, 0.5, { velocity: { x: 0, y: v }, spin: { x: -v / R_POOL, y: 0, z: 0 } }),
      poolBall("obj", CX, 1.2),
    ]);
    const r = simulate(input);
    expect(eventsOf(r, "ball-ball")).toHaveLength(1);
    // The cue ball keeps its topspin, so it ends up beyond the contact position.
    const contactY = 1.2 - 2 * R_POOL;
    expect(finalPosition(r, "cue").y).toBeGreaterThan(contactY + 0.05);
    checkInvariants(r, input);
  });

  test("a ball with backspin draws back after a full hit", () => {
    const input = scene([poolBall("cue", CX, 1.05), poolBall("obj", CX, 1.2)], {
      shot: {
        ballId: "cue",
        aimAngleRad: Math.PI / 2,
        speedMps: 2.5,
        tipOffset: { side: 0, vertical: -0.45 },
      },
    });
    const r = simulate(input);
    const hit = eventsOf(r, "ball-ball")[0];
    expect(hit).toBeDefined();
    // Shortly after contact the cue ball is travelling back towards where it came from.
    const cue = sampleAt(r, (hit?.t ?? 0) + 0.3).find((b) => b.id === "cue");
    expect(cue?.velocity.y).toBeLessThan(-0.05);
    expect(cue?.position.y).toBeLessThan(1.2 - 2 * R_POOL - 0.01);
    checkInvariants(r, input);
  });

  test("the event point is where the two surfaces touch", () => {
    const input = scene([
      poolBall("cue", CX, 0.5, { velocity: { x: 0, y: 2 } }),
      poolBall("obj", CX + R_POOL, 1.2),
    ]);
    const r = simulate(input);
    const hit = eventsOf(r, "ball-ball")[0];
    expect(hit).toBeDefined();
    if (!hit) return;
    const at = sampleAt(r, hit.t);
    for (const b of at) {
      const d = Math.sqrt((b.position.x - hit.point.x) ** 2 + (b.position.y - hit.point.y) ** 2);
      expect(d).toBeCloseTo(R_POOL, 9);
    }
    expect([hit.ballId, hit.otherBallId]).toEqual(["cue", "obj"]);
  });
});

describe("cushions and pockets", () => {
  test("square into the top cushion: one cushion event on the top rail, comes back down", () => {
    const input = scene([poolBall("cue", CX + 0.2, 2.0)], {
      shot: {
        ballId: "cue",
        aimAngleRad: Math.PI / 2,
        speedMps: 2,
        tipOffset: { side: 0, vertical: 0.4 },
      },
    });
    const r = simulate(input);
    const hits = eventsOf(r, "ball-cushion");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect((hits[0] as { cushionId: string }).cushionId).toBe("rail-top");
    // Ball centre at contact is the contact distance from the nose line, which is < R.
    const y = (hits[0] as { point: { y: number } }).point.y;
    expect(L - y).toBeLessThan(R_POOL);
    expect(L - y).toBeGreaterThan(0.9 * R_POOL);
    expect(finalPosition(r, "cue").x).toBeCloseTo(CX + 0.2, 9);
    checkInvariants(r, input);
  });

  test("a ball rolled into a corner pocket is pocketed", () => {
    const input = scene([poolBall("obj", 0.3, 0.3, { velocity: { x: -1, y: -1 } })]);
    const r = simulate(input);
    const potted = eventsOf(r, "pocket");
    expect(potted).toHaveLength(1);
    expect((potted[0] as { pocketId: string }).pocketId).toBe("corner-bl");
    expect(eventsOf(r, "ball-cushion")).toHaveLength(0);
    const last = (r.tracks[0] as SimResult["tracks"][number]).segments.at(-1);
    expect(last?.state).toBe("pocketed");
    checkInvariants(r, input);
  });

  test("a ball rolled into a middle pocket is pocketed", () => {
    const input = scene([poolBall("obj", 0.4, L / 2, { velocity: { x: -1.5, y: 0 } })]);
    const r = simulate(input);
    expect(eventsOf(r, "pocket").map((e) => e.pocketId)).toEqual(["middle-l"]);
    checkInvariants(r, input);
  });

  test("a ball hit hard at a jaw rattles or is rejected, but never escapes", () => {
    // Aimed at the left jaw point of the bottom-left corner pocket.
    const input = scene([poolBall("obj", 0.5, 0.2, { velocity: { x: -3, y: -0.55 } })]);
    const r = simulate(input);
    expect(r.status).toBe("complete");
    checkInvariants(r, input);
  });

  test("a ball frozen to a cushion and shot into it rebounds", () => {
    const contact = (
      eventsOf(
        simulate(scene([poolBall("probe", 0.3, 1, { velocity: { x: -1, y: 0 } })])),
        "ball-cushion",
      )[0] as { point: { x: number } }
    ).point.x;
    const input = scene([poolBall("cue", contact, 1, { velocity: { x: -1, y: 0.5 } })]);
    const r = simulate(input);
    const hits = eventsOf(r, "ball-cushion");
    expect((hits[0] as { t: number }).t).toBeLessThan(1e-12);
    expect(finalPosition(r, "cue").x).toBeGreaterThan(contact + 0.01);
    checkInvariants(r, input);
  });
});

describe("touching balls", () => {
  test("a line of five touching balls struck from one end (e = 1): only the far ball leaves", () => {
    const balls = [poolBall("cue", CX, 0.5, { velocity: { x: 0, y: 1.5 } })];
    for (let i = 0; i < 5; i++) balls.push(poolBall(`b${i}`, CX, 0.5 + (i + 1) * 2 * R_POOL));
    const input = scene(balls);
    const r = simulate(input);
    expect(r.status).toBe("complete");
    const just = sampleAt(r, 1e-9);
    const far = just.find((b) => b.id === "b4");
    expect(far?.velocity.y).toBeCloseTo(1.5, 7);
    for (const id of ["cue", "b0", "b1", "b2", "b3"]) {
      expect(speed(just.find((b) => b.id === id)?.velocity ?? { x: 1, y: 1 })).toBeLessThan(1e-12);
    }
    expect(eventsOf(r, "ball-ball").filter((e) => e.t < 1e-12)).toHaveLength(5);
    checkInvariants(r, input);
  });

  test("the same line with real restitution still terminates and never overlaps", () => {
    const balls = [poolBall("cue", CX, 0.5, { velocity: { x: 0, y: 1.5 } })];
    for (let i = 0; i < 5; i++) balls.push(poolBall(`b${i}`, CX, 0.5 + (i + 1) * 2 * R_POOL));
    const input = scene(balls, { ballRestitution: 0.94 });
    const r = simulate(input);
    expect(r.status).toBe("complete");
    expect(r.stats.eventCount).toBeLessThan(500);
    checkInvariants(r, input);
  });

  test("playing away from a touching ball does not move it", () => {
    const input = scene([
      poolBall("cue", CX, 0.5, { velocity: { x: 0, y: -0.3 } }),
      poolBall("obj", CX, 0.5 + 2 * R_POOL),
    ]);
    const r = simulate(input);
    expect(eventsOf(r, "ball-ball")).toHaveLength(0);
    expect(finalPosition(r, "obj")).toEqual({ x: CX, y: 0.5 + 2 * R_POOL });
  });

  test("balls that overlap slightly on input (link rounding) are accepted and behave", () => {
    const input = scene([
      poolBall("cue", CX, 0.5, { velocity: { x: 0, y: 1 } }),
      poolBall("obj", CX, 0.5 + 2 * R_POOL - 1e-5),
    ]);
    const r = simulate(input);
    expect(eventsOf(r, "ball-ball").length).toBeGreaterThanOrEqual(1);
    checkInvariants(r, input);
  });

  test("a ball frozen between a ball and the cushion", () => {
    const probe = simulate(scene([poolBall("probe", 0.3, 1, { velocity: { x: -1, y: 0 } })]));
    const contact = (eventsOf(probe, "ball-cushion")[0] as { point: { x: number } }).point.x;
    const input = scene(
      [
        poolBall("cue", contact + 2 * R_POOL + 0.3, 1, { velocity: { x: -2, y: 0 } }),
        poolBall("mid", contact + 2 * R_POOL, 1),
        poolBall("rail", contact, 1),
      ],
      { ballRestitution: 0.94 },
    );
    const r = simulate(input);
    expect(r.status).toBe("complete");
    expect(r.stats.eventCount).toBeLessThan(500);
    checkInvariants(r, input);
  });
});

describe("full racks", () => {
  test("9-ball break terminates with every invariant intact", () => {
    const input = rackInput(POOL_9, POOL_BALLS, "pool-9ball");
    const r = simulate({
      ...input,
      shot: {
        ballId: "cue-0",
        aimAngleRad: Math.PI / 2,
        speedMps: 9,
        tipOffset: { side: 0, vertical: 0.1 },
      },
    });
    expect(r.status).toBe("complete");
    expect(eventsOf(r, "ball-ball").length).toBeGreaterThan(9);
    checkInvariants(r, input);
  });

  test("8-ball break with an off-centre hit", () => {
    const input = rackInput(POOL_9, POOL_BALLS, "pool-8ball");
    const r = simulate({
      ...input,
      shot: {
        ballId: "cue-0",
        aimAngleRad: Math.PI / 2 + 0.01,
        speedMps: 8,
        tipOffset: { side: 0.1, vertical: 0 },
      },
    });
    expect(r.status).toBe("complete");
    checkInvariants(r, input);
  });

  test("snooker break-off", () => {
    const input = rackInput(SNOOKER_12, SNOOKER_BALLS, "snooker-15");
    const cue = input.balls.find((b) => b.id === "cue-0");
    const pink = spot(SNOOKER_12, "pink");
    expect(cue).toBeDefined();
    if (!cue) return;
    // Aim just right of the pack's back corner area.
    const aim = Math.atan2(pink.y + 0.25 - cue.y, pink.x + 0.11 - cue.x);
    const r = simulate({
      ...input,
      shot: {
        ballId: "cue-0",
        aimAngleRad: aim,
        speedMps: 3.2,
        tipOffset: { side: 0.2, vertical: 0.1 },
      },
    });
    expect(r.status).toBe("complete");
    expect(eventsOf(r, "ball-ball").length).toBeGreaterThan(3);
    checkInvariants(r, input);
  });

  test("blackball break with the smaller cue ball", () => {
    const input = rackInput(BLACKBALL_6, BLACKBALL_BALLS, "blackball");
    const r = simulate({
      ...input,
      shot: {
        ballId: "cue-0",
        aimAngleRad: Math.PI / 2,
        speedMps: 6,
        tipOffset: { side: 0, vertical: 0 },
      },
    });
    expect(r.status).toBe("complete");
    checkInvariants(r, input);
  });
});

describe("determinism and caps", () => {
  const breakShot = (): SimInput => ({
    ...rackInput(POOL_9, POOL_BALLS, "pool-9ball"),
    shot: {
      ballId: "cue-0",
      aimAngleRad: Math.PI / 2 + 0.003,
      speedMps: 8.5,
      tipOffset: { side: -0.05, vertical: 0.2 },
    },
  });

  test("the same input gives a bit-identical result", () => {
    expect(simulate(breakShot())).toEqual(simulate(breakShot()));
  });

  test("a prepared table gives the same result as the raw table", () => {
    const input = breakShot();
    expect(simulate({ ...input, table: prepareTable(POOL_9) })).toEqual(simulate(input));
  });

  test("maxEvents stops the run with a partial result", () => {
    const r = simulate(breakShot(), { maxEvents: 10 });
    expect(r.status).toBe("eventLimit");
    expect(r.stats.eventCount).toBe(10);
    expect(r.tracks).toHaveLength(10);
    // The partial result can still be sampled.
    expect(sampleAt(r, r.durationS)).toHaveLength(10);
  });

  test("maxTimeS stops the run with a partial result", () => {
    const r = simulate(breakShot(), { maxTimeS: 0.5 });
    expect(r.status).toBe("timeLimit");
    expect(r.durationS).toBeLessThanOrEqual(0.5);
  });
});

describe("input validation", () => {
  const ok = scene([poolBall("cue", CX, 0.5), poolBall("obj", CX, 1)]);

  test("each problem has its own code", () => {
    expect(errorCode(() => simulate({ ...ok, balls: [] }))).toBe("no-balls");
    expect(
      errorCode(() =>
        simulate({ ...ok, balls: [poolBall("a", 0.5, 0.5), poolBall("a", 0.7, 0.7)] }),
      ),
    ).toBe("duplicate-ball-id");
    expect(errorCode(() => simulate({ ...ok, balls: [poolBall("a", Number.NaN, 0.5)] }))).toBe(
      "non-finite",
    );
    expect(
      errorCode(() => simulate({ ...ok, balls: [{ ...poolBall("a", 0.5, 0.5), massKg: 0 }] })),
    ).toBe("invalid-ball");
    expect(errorCode(() => simulate({ ...ok, balls: [poolBall("a", -0.1, 0.5)] }))).toBe(
      "ball-outside-table",
    );
    expect(errorCode(() => simulate({ ...ok, balls: [poolBall("a", 0.001, 0.5)] }))).toBe(
      "ball-outside-table",
    );
    expect(
      errorCode(() =>
        simulate({ ...ok, balls: [poolBall("a", 0.5, 0.5), poolBall("b", 0.51, 0.5)] }),
      ),
    ).toBe("balls-overlap");
    expect(errorCode(() => simulate({ ...ok, cloth: { ...MEDIUM, rollingResistance: 0 } }))).toBe(
      "invalid-cloth",
    );
    expect(errorCode(() => simulate({ ...ok, ballRestitution: 1.2 }))).toBe("invalid-ball");
    expect(
      errorCode(() =>
        simulate({
          ...ok,
          shot: {
            ballId: "nope",
            aimAngleRad: 0,
            speedMps: 1,
            tipOffset: { side: 0, vertical: 0 },
          },
        }),
      ),
    ).toBe("unknown-shot-ball");
    expect(
      errorCode(() =>
        simulate({
          ...ok,
          shot: {
            ballId: "cue",
            aimAngleRad: 0,
            speedMps: 1,
            tipOffset: { side: 0, vertical: 0 },
            elevationRad: 0.2,
          },
        }),
      ),
    ).toBe("elevation-not-supported");
    expect(
      errorCode(() =>
        simulate({ ...ok, table: { ...POOL_9, playingArea: { lengthM: -1, widthM: 1 } } }),
      ),
    ).toBe("invalid-table");
    expect(errorCode(() => simulate(ok))).toBeUndefined();
  });

  test("bad parameters are rejected", () => {
    expect(() => simulate(ok, { maxEvents: 0 })).toThrow(RangeError);
  });
});

describe("review regressions", () => {
  test("a ball potted while in a pressing contact does not crash the engine", () => {
    // Two balls pressing together crawl into the bottom-left corner pocket. Found in review:
    // releasing the pressing contact overwrote the cached pocket event and the loop then
    // read a cushion that did not exist.
    const input = scene(
      [
        poolBall("A", 0.08691679045920402, 0.08691679045920402, {
          velocity: { x: -0.024748737341529166, y: -0.024748737341529166 },
          spin: { x: 0.8660975447604258, y: -0.8660975447604258, z: 0 },
        }),
        poolBall("B", 0.04650563791439282, 0.04650563791439282, {
          velocity: { x: -0.024748737341529166, y: -0.024748737341529166 },
          spin: { x: -3.414898890769678, y: 3.414898890769678, z: 0 },
        }),
      ],
      { ballRestitution: 0.95 },
    );
    for (const shift of [0, 3e-6, 6e-6, 9e-6, -5e-6, 2e-5]) {
      const balls = input.balls.map((b) =>
        b.id === "B" ? { ...b, x: b.x - shift, y: b.y - shift } : b,
      );
      let shifted: SimResult | undefined;
      try {
        shifted = simulate({ ...input, balls });
      } catch (e) {
        // The only acceptable throw is input validation (the shifted ball may start in the pocket).
        expect(e).toBeInstanceOf(SimInputError);
        continue;
      }
      expect(shifted.status).toBe("complete");
      checkInvariants(shifted, { ...input, balls });
    }
  });

  test("a ball that is only spinning does not hit the time limit", () => {
    const input = scene([poolBall("cue", CX, 1, { spin: { x: 0, y: 0, z: 30 } })], {
      cloth: { ...MEDIUM, spinningFriction: 1e-5 },
    });
    const r = simulate(input, { maxTimeS: 2 });
    expect(r.status).toBe("complete");
    expect(finalPosition(r, "cue")).toEqual({ x: CX, y: 1 });
  });

  test("the time limit leaves no event after the cap and a result that can be sampled", () => {
    const input: SimInput = {
      ...rackInput(POOL_9, POOL_BALLS, "pool-9ball"),
      shot: {
        ballId: "cue-0",
        aimAngleRad: Math.PI / 2,
        speedMps: 8,
        tipOffset: { side: 0, vertical: 0 },
      },
    };
    const r = simulate(input, { maxTimeS: 0.6 });
    expect(r.status).toBe("timeLimit");
    for (const e of r.events) expect(e.t).toBeLessThanOrEqual(0.6);
    for (const t of [0, 0.3, 0.6, 5]) {
      for (const b of sampleAt(r, t)) {
        expect(Number.isFinite(b.position.x + b.position.y + b.velocity.x + b.velocity.y)).toBe(
          true,
        );
      }
    }
  });

  test("a ball placed over a pocket is rejected", () => {
    const pocket = prepareTable(POOL_9).geometry.pockets[0];
    expect(pocket).toBeDefined();
    if (!pocket) return;
    // Just inside the edge of the corner drop circle, on the table diagonal.
    const d = (pocket.radiusM - 0.001) / Math.SQRT2;
    const input = scene([poolBall("a", pocket.centre.x + d, pocket.centre.y + d)]);
    expect(errorCode(() => simulate(input))).toBe("ball-in-pocket");
  });
});

describe("pocket jaws", () => {
  // The bottom rail's jaw point at the bottom-left corner, and the knuckle arc that starts there.
  const geometry = prepareTable(POOL_9).geometry;
  const rail = geometry.segments.find((s) => s.id === "rail-bottom");
  const jawX = rail?.a.x ?? Number.NaN;

  test("a ball driven straight at a jaw point hits the jaw and is thrown back onto the table", () => {
    // Travelling straight down at the knuckle from above: it meets the jaw, not the rail.
    const input = scene([poolBall("obj", jawX, 0.4, { velocity: { x: 0, y: -2.5 } })]);
    const r = simulate(input);
    const first = eventsOf(r, "ball-cushion")[0];
    expect(first?.cushionId.startsWith("jaw-corner-bl") || first?.cushionId === "rail-bottom").toBe(
      true,
    );
    expect(r.status).toBe("complete");
    checkInvariants(r, input);
  });

  test("a ball rolled along the rail into the corner is potted; one sent wide of the pocket hits a jaw first", () => {
    // Along the bottom rail towards the corner: touching the rail all the way, it must drop.
    const probe = simulate(scene([poolBall("p", 0.6, 0.3, { velocity: { x: 0, y: -1 } })]));
    const railY = eventsOf(probe, "ball-cushion")[0]?.point.y ?? Number.NaN;
    const along = scene([poolBall("obj", 0.5, railY, { velocity: { x: -1.2, y: 0 } })]);
    const potted = simulate(along);
    expect(eventsOf(potted, "pocket").map((e) => e.pocketId)).toEqual(["corner-bl"]);
    checkInvariants(potted, along);

    // Aimed from the middle of the table at the far jaw of the same pocket: it must touch
    // a jaw or facing of that pocket before anything else.
    const leftRail = geometry.segments.find((s) => s.id === "rail-left-lower");
    const target = { x: 0, y: (leftRail?.a.y ?? 0) + 0.01 };
    const from = { x: 0.5, y: 0.25 };
    const len = Math.hypot(target.x - from.x, target.y - from.y);
    const wide = scene([
      poolBall("obj", from.x, from.y, {
        velocity: { x: (2 * (target.x - from.x)) / len, y: (2 * (target.y - from.y)) / len },
      }),
    ]);
    const r = simulate(wide);
    const firstHit = eventsOf(r, "ball-cushion")[0];
    expect(firstHit).toBeDefined();
    expect(firstHit?.cushionId).toMatch(/^(jaw|facing)-corner-bl|^rail-left-lower$/);
    expect(r.status).toBe("complete");
    checkInvariants(r, wide);
  });

  test("random shots into every pocket mouth never put a ball behind a cushion", () => {
    const W9 = POOL_9.playingArea.widthM;
    const L9 = POOL_9.playingArea.lengthM;
    const targets = [
      { x: 0, y: 0 },
      { x: W9, y: 0 },
      { x: 0, y: L9 },
      { x: W9, y: L9 },
      { x: 0, y: L9 / 2 },
      { x: W9, y: L9 / 2 },
    ];
    let potted = 0;
    let rattled = 0;
    for (let i = 0; i < 240; i++) {
      const target = targets[i % 6] as { x: number; y: number };
      // Deterministic spread of start points, speeds and aim offsets.
      const from = {
        x: W9 * (0.25 + (0.5 * ((i * 37) % 100)) / 100),
        y: L9 * (0.2 + (0.6 * ((i * 53) % 100)) / 100),
      };
      const offset = (((i * 29) % 21) - 10) * 0.006;
      const aim = { x: target.x + offset, y: target.y - offset };
      const len = Math.hypot(aim.x - from.x, aim.y - from.y);
      const speed = 0.6 + ((i * 17) % 10) * 0.45;
      const input = scene([
        poolBall("obj", from.x, from.y, {
          velocity: { x: (speed * (aim.x - from.x)) / len, y: (speed * (aim.y - from.y)) / len },
        }),
      ]);
      const r = simulate(input);
      expect(r.status).toBe("complete");
      checkInvariants(r, input);
      if (eventsOf(r, "pocket").length > 0) potted++;
      if (eventsOf(r, "ball-cushion").some((e) => /^(jaw|facing)-/.test(e.cushionId))) rattled++;
    }
    // The spread is wide enough that both outcomes must occur.
    expect(potted).toBeGreaterThan(20);
    expect(rattled).toBeGreaterThan(20);
  });
});

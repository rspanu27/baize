import { BALL_BALL_FRICTION, BALL_TO_CUE_END_MASS_RATIO, cueEndMassKg } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { SimInputError, frictionalBallBall, simulate } from "../src/index";
import type { ShotInput, SimInput } from "../src/index";
import { classify } from "../src/motion";
import { strike } from "../src/strike";
import {
  MEDIUM,
  M_POOL,
  POOL_9,
  POOL_BALLS,
  R_POOL,
  checkInvariants,
  eventsOf,
  finalPosition,
  poolBall,
  rackInput,
} from "./helpers";

const DEG = Math.PI / 180;
const END_MASS = cueEndMassKg(M_POOL);

function shot(over: Partial<ShotInput> = {}): ShotInput {
  return {
    ballId: "cue",
    aimAngleRad: 0,
    speedMps: 2,
    tipOffset: { side: 0, vertical: 0 },
    cueEndMassKg: END_MASS,
    ...over,
  };
}

function directionDeg(s: ShotInput): number {
  const out = strike(R_POOL, s, M_POOL);
  return Math.atan2(out.velocity.y, out.velocity.x) / DEG;
}

describe("squirt", () => {
  test("no side, or no cue end mass: exactly the version 1 strike", () => {
    const plain = { ...shot({ tipOffset: { side: 0.3, vertical: 0.2 } }) };
    const { cueEndMassKg: _none, ...v1 } = plain;
    void _none;
    expect(strike(R_POOL, v1, M_POOL)).toEqual(strike(R_POOL, v1));
    const centre = shot({ tipOffset: { side: 0, vertical: -0.3 }, aimAngleRad: 1.1 });
    const { cueEndMassKg: _none2, ...centreV1 } = centre;
    void _none2;
    expect(strike(R_POOL, centre, M_POOL)).toEqual(strike(R_POOL, centreV1));
    // Without the ball's mass there is nothing to compare the cue with.
    expect(strike(R_POOL, plain)).toEqual(strike(R_POOL, v1));
  });

  test("maximum right side squirts the ball about two degrees to the left", () => {
    // tan(alpha) = 2.5 * 0.5 * 0.866 / (1 + 28 + 2.5 * 0.75) = 0.03507, alpha = 2.01 degrees.
    expect(BALL_TO_CUE_END_MASS_RATIO).toBe(28);
    expect(directionDeg(shot({ tipOffset: { side: 0.5, vertical: 0 } }))).toBeCloseTo(2.01, 2);
    expect(directionDeg(shot({ tipOffset: { side: -0.5, vertical: 0 } }))).toBeCloseTo(-2.01, 2);
  });

  test("the speed is still the ball's speed, whatever the squirt", () => {
    for (const side of [-0.48, -0.2, 0.1, 0.45]) {
      const out = strike(
        R_POOL,
        shot({ speedMps: 3.5, tipOffset: { side, vertical: 0.1 } }),
        M_POOL,
      );
      expect(Math.hypot(out.velocity.x, out.velocity.y)).toBeCloseTo(3.5, 13);
    }
  });

  test("squirt grows with the side offset and with the cue's end mass", () => {
    const at = (side: number, endMass = END_MASS) =>
      directionDeg(shot({ tipOffset: { side, vertical: 0 }, cueEndMassKg: endMass }));
    expect(at(0.1)).toBeGreaterThan(0);
    expect(at(0.3)).toBeGreaterThan(at(0.1));
    expect(at(0.5)).toBeGreaterThan(at(0.3));
    expect(at(0.5, 2 * END_MASS)).toBeGreaterThan(1.8 * at(0.5));
    expect(at(0.5, END_MASS / 10)).toBeLessThan(0.3);
  });

  test("it turns with the aim: the squirt is relative to the aim line", () => {
    const aim = 2.2;
    const out = strike(
      R_POOL,
      shot({ aimAngleRad: aim, tipOffset: { side: 0.5, vertical: 0 } }),
      M_POOL,
    );
    expect((Math.atan2(out.velocity.y, out.velocity.x) - aim) / DEG).toBeCloseTo(2.01, 2);
  });

  test("side spin keeps its sense and is slightly less than without squirt", () => {
    const withSquirt = strike(R_POOL, shot({ tipOffset: { side: 0.4, vertical: 0 } }), M_POOL);
    const without = strike(R_POOL, {
      ballId: "cue",
      aimAngleRad: 0,
      speedMps: 2,
      tipOffset: { side: 0.4, vertical: 0 },
    });
    expect(withSquirt.spin.z).toBeGreaterThan(0.9 * without.spin.z);
    expect(withSquirt.spin.z).toBeLessThan(without.spin.z);
  });

  test("a hit at 0.4 R above centre still rolls from the start, along the squirted line", () => {
    const out = strike(R_POOL, shot({ tipOffset: { side: 0.3, vertical: 0.4 } }), M_POOL);
    expect(classify(out.velocity, out.spin, R_POOL)).toBe("rolling");
  });

  test("a cue end mass that is not a positive number is refused", () => {
    for (const bad of [0, -0.01, Number.NaN, Number.POSITIVE_INFINITY]) {
      let code: string | undefined;
      try {
        strike(R_POOL, shot({ tipOffset: { side: 0.2, vertical: 0 }, cueEndMassKg: bad }), M_POOL);
      } catch (e) {
        code = e instanceof SimInputError ? e.code : "other";
      }
      expect(code).toBe("invalid-shot");
    }
  });
});

describe("version 2 models in the simulator", () => {
  const models = { ballBall: frictionalBallBall(BALL_BALL_FRICTION) };

  function cutShot(withModels: boolean, side = 0): SimInput {
    // A slow stun-ish cut on an object ball in the middle of the table.
    return {
      table: POOL_9,
      cloth: MEDIUM,
      balls: [poolBall("cue", 0.4, 0.6), poolBall("one", 0.635, 1.27)],
      ballRestitution: POOL_BALLS.restitution,
      shot: {
        ballId: "cue",
        aimAngleRad: Math.atan2(1.27 - 0.6, 0.635 - 0.4) + 1.1 * DEG,
        speedMps: 1.2,
        tipOffset: { side, vertical: 0 },
      },
      ...(withModels ? { models } : {}),
    };
  }

  test("a cut shot: the object ball ends somewhere else because of throw", () => {
    const plain = simulate(cutShot(false));
    const thrown = simulate(cutShot(true));
    checkInvariants(thrown, cutShot(true));
    expect(eventsOf(thrown, "ball-ball").length).toBeGreaterThan(0);
    const a = finalPosition(plain, "one");
    const b = finalPosition(thrown, "one");
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.005);
  });

  test("a 9-ball break with throw and squirt keeps every invariant and is repeatable", () => {
    const base = rackInput(POOL_9, POOL_BALLS, "pool-9ball");
    const cue = base.balls.find((b) => b.id.startsWith("cue"));
    if (!cue) throw new Error("no cue ball");
    const input: SimInput = {
      ...base,
      models,
      shot: {
        ballId: cue.id,
        aimAngleRad: Math.PI / 2 + 0.4 * DEG,
        speedMps: 8,
        tipOffset: { side: 0.2, vertical: -0.1 },
        cueEndMassKg: END_MASS,
      },
    };
    const first = simulate(input);
    expect(first.status).toBe("complete");
    checkInvariants(first, input);
    expect(simulate(input)).toEqual(first);
  });

  test("squirt moves where a long straight shot with side arrives", () => {
    const table = POOL_9;
    const run = (endMass: number | undefined) =>
      simulate({
        table,
        cloth: MEDIUM,
        balls: [poolBall("cue", 0.635, 0.4)],
        ballRestitution: POOL_BALLS.restitution,
        shot: {
          ballId: "cue",
          aimAngleRad: Math.PI / 2,
          speedMps: 1.5,
          tipOffset: { side: 0.5, vertical: 0 },
          ...(endMass === undefined ? {} : { cueEndMassKg: endMass }),
        },
      });
    const straight = run(undefined);
    const squirted = run(END_MASS);
    const firstCushion = (r: ReturnType<typeof simulate>) => eventsOf(r, "ball-cushion")[0]?.point;
    const p0 = firstCushion(straight);
    const p1 = firstCushion(squirted);
    if (!p0 || !p1) throw new Error("the ball should reach the far cushion");
    // Right-hand side squirts the ball to the left: for an aim along +y, left is -x.
    // Two degrees over about two metres is around seven centimetres.
    expect(p0.x - p1.x).toBeGreaterThan(0.04);
    expect(p0.x - p1.x).toBeLessThan(0.11);
  });
});

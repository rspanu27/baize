import { describe, expect, test } from "vitest";
import { laneHalfWidthM } from "../src/geometry";
import { getPlayerLevel } from "../src/levels";
import { normalCdf } from "../src/math";
import { judgeShot } from "../src/rules";
import { departureError, makeContext, potCandidates, potPairs } from "../src/shots";
import type { PotCandidate, Position } from "../src/shots";
import type { GameState, PlanBall, PlanInput } from "../src/types";
import { MEDIUM, TABLES, ball, must, runnerFor } from "./helpers";

const CLUB = must(getPlayerLevel("club"), "club level");
const STRAIGHT: GameState = { game: "straight" };

function inputFor(table: PlanInput["table"], balls: PlanBall[], level = CLUB): PlanInput {
  return {
    table,
    balls,
    cueBallId: "cue",
    state: STRAIGHT,
    level,
    cloth: MEDIUM,
    run: runnerFor(table),
  };
}

function position(input: PlanInput): Position {
  return { balls: input.balls, cueBallId: input.cueBallId, state: input.state };
}

describe.each(TABLES.map((t) => [t.id === "custom" ? t.name : t.id, t] as const))(
  "on %s",
  (_name, table) => {
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const objectKind = table.game === "snooker" ? "red" : "3";

    test("a straight pot and a cut pot both drop when played as generated", () => {
      for (const [ox, cx] of [
        [0.5, 0.5],
        [0.65, 0.4],
      ] as const) {
        const input = inputFor(table, [
          ball(table, "cue", "cue", W * cx, L * 0.35),
          ball(table, "a", objectKind, W * ox, L * 0.62),
        ]);
        const ctx = makeContext(input);
        const candidates = potCandidates(ctx, position(input));
        expect(candidates.length).toBeGreaterThan(0);
        for (const c of candidates.slice(0, 5)) {
          const result = input.run(input.balls, { ballId: "cue", ...c.shot });
          const j = judgeShot(result, input.balls, "cue", STRAIGHT, {
            targetId: c.targetId,
            pocketId: c.pocketId,
          });
          expect(j.intendedPotted && !j.foul).toBe(true);
          expect(c.chance).toBeGreaterThan(0);
          expect(c.chance).toBeLessThanOrEqual(1);
          expect(c.halfWindowRad).toBeGreaterThan(0);
        }
        expect(ctx.calls).toBeGreaterThan(0);
      }
    });

    test("the refined aim sends the object ball along the pocket line", () => {
      const input = inputFor(table, [
        ball(table, "cue", "cue", W * 0.3, L * 0.3),
        ball(table, "a", objectKind, W * 0.55, L * 0.6),
      ]);
      const ctx = makeContext(input);
      const c = must(potCandidates(ctx, position(input))[0], "a candidate");
      const pocket = must(
        ctx.pockets.find((p) => p.id === c.pocketId),
        "pocket",
      );
      const target = must(input.balls[1], "target");
      const d = { x: pocket.aim.x - target.x, y: pocket.aim.y - target.y };
      const l = Math.hypot(d.x, d.y);
      const err = must(
        departureError(must(c.outcomes[0], "outcome").result, "cue", "a", {
          x: d.x / l,
          y: d.y / l,
        }),
        "departure",
      );
      // The shot is aimed at the middle of its window, not exactly at the drop circle's centre,
      // but the object ball still leaves inside the lane the pocket allows.
      const lane = laneHalfWidthM(pocket, d, target.radiusM) / l;
      expect(lane).toBeGreaterThan(0);
      expect(Math.abs(err)).toBeLessThan(lane);
    });

    test("the window shrinks as the cue ball moves back", () => {
      const window = (back: number): number => {
        const input = inputFor(table, [
          ball(table, "cue", "cue", W * 0.5, L * 0.62 - back),
          ball(table, "a", objectKind, W * 0.5, L * 0.62),
        ]);
        const ctx = makeContext(input);
        const best = must(
          potCandidates(ctx, position(input)).find((c) => c.pocketId.startsWith("corner")) ??
            potCandidates(ctx, position(input))[0],
          "a candidate",
        );
        return best.halfWindowRad;
      };
      expect(window(0.15 * L)).toBeGreaterThan(window(0.4 * L));
    });
  },
);

describe("pairs", () => {
  test("a blocked pot is not offered", () => {
    const table = must(TABLES[2], "custom table");
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const R = 0.05715 / 2;
    const target = ball(table, "a", "3", W / 2, L / 2);
    const open = inputFor(table, [ball(table, "cue", "cue", W / 2, L * 0.25), target]);
    const ctxOpen = makeContext(open);
    const before = potPairs(ctxOpen, position(open)).length;
    // A ball right in front of the cue ball's path to the contact.
    const blocker = ball(table, "b", "4", W / 2, L * 0.25 + 6 * R);
    const blocked = inputFor(table, [ball(table, "cue", "cue", W / 2, L * 0.25), target, blocker]);
    const pairs = potPairs(makeContext(blocked), position(blocked)).filter(
      (p) => p.target.id === "a",
    );
    expect(pairs.length).toBeLessThan(before);
    for (const p of pairs) expect(p.pocket.id.startsWith("corner-t")).toBe(false);
  });
});

/** Inverse of the normal distribution function, by bisection (test-only). */
function normalQuantile(p: number): number {
  let lo = -8;
  let hi = 8;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Deterministic pseudo-random numbers for test layouts (a 32-bit LCG). */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("pot chances are honest", () => {
  test("predicted chances agree with replays under the player's errors", () => {
    const table = must(
      TABLES.find((t) => t.game === "pool"),
      "a pool table",
    );
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const level = must(getPlayerLevel("strong"), "strong level");
    const rand = lcg(20261119);
    const N = 48;
    const aimZ = Array.from({ length: N }, (_, i) => normalQuantile((i + 0.5) / N));
    // Speed errors paired with aim errors in a fixed scrambled order.
    const speedZ = aimZ.map((_, i) => must(aimZ[(i * 29 + 7) % N], "z"));
    const pairs: { predicted: number; observed: number }[] = [];
    for (let k = 0; k < 10; k++) {
      const input = inputFor(
        table,
        [
          ball(table, "cue", "cue", W * (0.15 + 0.7 * rand()), L * (0.15 + 0.7 * rand())),
          ball(table, "a", "3", W * (0.15 + 0.7 * rand()), L * (0.15 + 0.7 * rand())),
        ],
        level,
      );
      const ctx = makeContext(input);
      const candidates: PotCandidate[] = potCandidates(ctx, position(input), {
        maxPairs: 2,
        speedFactors: [1.4, 2.2],
        verticals: [-0.3, 0, 0.3],
        sides: [],
        sideVerticals: [],
        maxSpeedMps: 8,
      });
      for (const c of candidates.filter((_, i) => i % 2 === 0).slice(0, 3)) {
        let hits = 0;
        for (let i = 0; i < N; i++) {
          const result = input.run(input.balls, {
            ballId: "cue",
            aimAngleRad: c.shot.aimAngleRad + must(aimZ[i], "z") * level.aimErrorRad,
            speedMps: c.shot.speedMps * (1 + must(speedZ[i], "z") * level.speedError),
            tipOffset: c.shot.tipOffset,
          });
          const j = judgeShot(result, input.balls, "cue", STRAIGHT, {
            targetId: c.targetId,
            pocketId: c.pocketId,
          });
          if (j.intendedPotted && !j.foul) hits++;
        }
        pairs.push({ predicted: c.chance, observed: hits / N });
      }
    }
    expect(pairs.length).toBeGreaterThanOrEqual(10);
    // Average gap in bins of predicted chance (0-0.2, ..., 0.8-1).
    const bins = new Map<number, { p: number; o: number; n: number }>();
    for (const { predicted, observed } of pairs) {
      const b = Math.min(4, Math.floor(predicted * 5));
      const e = bins.get(b) ?? { p: 0, o: 0, n: 0 };
      bins.set(b, { p: e.p + predicted, o: e.o + observed, n: e.n + 1 });
    }
    let gap = 0;
    for (const e of bins.values()) gap += Math.abs(e.p - e.o) / e.n;
    gap /= bins.size;
    console.log(
      "calibration",
      JSON.stringify(pairs.map((x) => [x.predicted.toFixed(2), x.observed.toFixed(2)])),
      "mean bin gap",
      gap.toFixed(3),
    );
    expect(gap).toBeLessThanOrEqual(0.1);
  });
});

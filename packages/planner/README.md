# @baize/planner

Position-play planner for Baize (SPEC section 10, ARCHITECTURE section 10): given a layout, it
searches over shots with the simulator for a route through the balls (which ball, which
pocket, how to hit it, where the cue ball should stop), suggests safety shots when no pot is
reasonable, and rates a shot set up by hand.

- Depends only on `@baize/physics` and `@baize/tables`; no runtime dependencies of its own.
- Deterministic like the physics (lint-enforced): no randomness, no clocks, no `Math`
  transcendentals. The search is limited by a count of simulator calls, not by time, so the
  same input gives the same route on every machine.
- It does not choose the physics. The caller hands it a `ShotRunner`, `(balls, shot) =>
SimResult`; the editor builds one with `editorRunner` in `apps/web/src/sim/simulator.ts`,
  so planned shots are exactly what the editor draws.

## Use

```ts
import { PLAYER_LEVELS, defaultGameState, planRoute, rateShot } from "@baize/planner";

const input = {
  table, // TableSpec
  balls, // { id, kind, x, y, radiusM, massKg }[]
  cueBallId: "cue",
  state: defaultGameState(ballSet, balls), // or e.g. { game: "nine-ball" }
  level: PLAYER_LEVELS[1], // club player
  cloth, // { slidingFriction, rollingResistance }
  run, // ShotRunner
};
const { best, safeties } = planRoute(input); // or iterate planRoutes(input) for progress
// best.steps[k]: { kind: "pot", targetId, pocketId, shot, chance, value, result, cueStop }
const rating = rateShot(input, { aimAngleRad, speedMps, tipOffset });
```

## How it works

| Module        | What it does                                                                                                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rules.ts`    | Balls on, values, the basic fouls judged from a `SimResult`, the next state, snooker respotting.                                                                                                                                             |
| `geometry.ts` | Pocket targets, ghost ball, blocked lines, cut, and the straight-line aim window.                                                                                                                                                            |
| `shots.ts`    | Pot candidates: aim refined with the simulator until the object ball leaves along the pocket line, the window of aims that pot found by bisection, then variants of speed and tip, each played at three speeds for the player's speed error. |
| `position.ts` | The value of the position a pot leaves: the best next pot by the geometric estimate, widened by the measured `GEOMETRIC_WINDOW_SCALE`.                                                                                                       |
| `search.ts`   | Beam search by expected value, one shot deeper at a time, with the best route reported as it goes.                                                                                                                                           |
| `safety.ts`   | Safeties scored by what the opponent is left, over aim and speed errors.                                                                                                                                                                     |
| `rate.ts`     | Rating of a hand-set shot, with the window searched around the user's own aim.                                                                                                                                                               |
| `levels.ts`   | Player levels: aim and speed error spreads (UNVERIFIED estimates).                                                                                                                                                                           |

Measured (2026-11-19, Node, development machine): a 3-shot route on the benchmark layouts in
0.3 to 1.7 s; a full snooker table (15 reds and the colours) in 2.6 s with the first route
after 0.4 s. Pot chances against replays with the player's errors: mean gap 0.03 per bin.

## Not modelled

Kicks off a cushion, combinations and plants; rules beyond the basic fouls (ball in hand,
push-outs, free balls); the opponent's reply beyond their next pot (safeties).

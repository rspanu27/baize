import { getTablePreset, spotsFor } from "@baize/tables";
import type { BallKind, TableSpec } from "@baize/tables";
import type { GameState, PlanBall } from "../src/index";
import { TABLES, ball, must } from "./helpers";

/**
 * Benchmark layouts for the planner (SPEC section 10): open-table pool endings, an eight-ball
 * ending, the snooker colours on their spots and a few reds with the colours. Positions are
 * shares of the playing area so each layout fits any table of its game.
 */
export interface Benchmark {
  readonly name: string;
  readonly table: TableSpec;
  readonly state: GameState;
  readonly balls: PlanBall[];
}

function at(
  table: TableSpec,
  list: readonly (readonly [string, BallKind, number, number])[],
): PlanBall[] {
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  return list.map(([id, kind, fx, fy]) => ball(table, id, kind, W * fx, L * fy));
}

const custom = must(TABLES[2], "custom pool table");
const smallest = must(TABLES[0], "smallest preset");
const snooker = must(getTablePreset("snooker-12@1"), "snooker 12 ft");

function colours(table: TableSpec): PlanBall[] {
  const kinds = ["yellow", "green", "brown", "blue", "pink", "black"] as const;
  return kinds.map((kind) => {
    const s = must(
      spotsFor(table).find((p) => p.name === kind),
      `${kind} spot`,
    );
    return ball(table, kind, kind, s.x, s.y);
  });
}

export const BENCHMARKS: readonly Benchmark[] = [
  {
    name: "nine-ball, three balls left",
    table: custom,
    state: { game: "nine-ball" },
    balls: at(custom, [
      ["cue", "cue", 0.5, 0.3],
      ["7", "7", 0.3, 0.6],
      ["8", "8", 0.7, 0.75],
      ["9", "9", 0.4, 0.85],
    ]),
  },
  {
    name: "nine-ball, five balls left",
    table: custom,
    state: { game: "nine-ball" },
    balls: at(custom, [
      ["cue", "cue", 0.55, 0.25],
      ["5", "5", 0.3, 0.45],
      ["6", "6", 0.75, 0.55],
      ["7", "7", 0.4, 0.7],
      ["8", "8", 0.65, 0.85],
      ["9", "9", 0.2, 0.9],
    ]),
  },
  {
    name: "blackball, reds to clear",
    table: smallest,
    state: { game: "eight-ball", group: smallest.game === "blackball" ? "reds" : "solids" },
    balls: at(smallest, [
      ["cue", "cue", 0.5, 0.25],
      ["r1", smallest.game === "blackball" ? "red" : "1", 0.3, 0.5],
      ["r2", smallest.game === "blackball" ? "red" : "2", 0.7, 0.65],
      ["r3", smallest.game === "blackball" ? "red" : "3", 0.45, 0.8],
      ["y1", smallest.game === "blackball" ? "yellow" : "9", 0.2, 0.3],
      ["y2", smallest.game === "blackball" ? "yellow" : "10", 0.8, 0.4],
      ["8", smallest.game === "blackball" ? "black" : "8", 0.6, 0.9],
    ]),
  },
  {
    name: "snooker, the colours on their spots",
    table: snooker,
    state: { game: "snooker", phase: "colours" },
    balls: (() => {
      const cs = colours(snooker);
      const yellow = must(cs[0], "yellow");
      return [ball(snooker, "cue", "cue", yellow.x - 0.15, yellow.y + 0.35), ...cs];
    })(),
  },
  {
    name: "snooker, three reds with the colours",
    table: snooker,
    state: { game: "snooker", phase: "red" },
    balls: [
      ...at(snooker, [
        ["cue", "cue", 0.3, 0.55],
        ["r1", "red", 0.4, 0.7],
        ["r2", "red", 0.62, 0.76],
        ["r3", "red", 0.35, 0.86],
      ]),
      ...colours(snooker),
    ],
  },
];

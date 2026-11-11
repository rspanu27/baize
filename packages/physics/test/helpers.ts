import {
  ballSizeOf,
  getBallSet,
  makeCloth,
  rackLayout,
  resolveCustomTable,
  spotsFor,
} from "@baize/tables";
import type { BallSetSpec, ClothSpec, Layout, RackKind, TableSpec } from "@baize/tables";
import { expect } from "vitest";
import { kineticEnergy, sampleAt } from "../src/index";
import type { BallInput, SimEvent, SimInput, SimResult } from "../src/index";

function ballSet(id: string): BallSetSpec {
  const set = getBallSet(id);
  if (!set) throw new Error(`missing ball set ${id}`);
  return set;
}

export const POOL_BALLS = ballSet("pool-57@1");
export const SNOOKER_BALLS = ballSet("snooker-52@1");
export const BLACKBALL_BALLS = ballSet("blackball-51@1");

export const POOL_9: TableSpec = resolveCustomTable(
  { game: "pool", lengthM: 2.54, widthM: 1.27, cornerMouthM: 0.1143, middleMouthM: 0.127 },
  POOL_BALLS.object.diameterM,
);
export const POOL_7: TableSpec = resolveCustomTable(
  { game: "pool", lengthM: 1.8796, widthM: 0.9398, cornerMouthM: 0.1143, middleMouthM: 0.127 },
  POOL_BALLS.object.diameterM,
);
export const SNOOKER_12: TableSpec = resolveCustomTable(
  { game: "snooker", lengthM: 3.569, widthM: 1.778, cornerMouthM: 0.086, middleMouthM: 0.105 },
  SNOOKER_BALLS.object.diameterM,
);
export const BLACKBALL_6: TableSpec = resolveCustomTable(
  { game: "blackball", lengthM: 1.829, widthM: 0.914, cornerMouthM: 0.085, middleMouthM: 0.095 },
  BLACKBALL_BALLS.object.diameterM,
);

export const MEDIUM: ClothSpec = makeCloth("#1f7a4d", "medium");
export const FAST: ClothSpec = makeCloth("#1f7a4d", "fast");
export const SLOW: ClothSpec = makeCloth("#1f7a4d", "slow");

export const R_POOL = POOL_BALLS.object.diameterM / 2;
export const M_POOL = POOL_BALLS.object.massKg;

/** A pool ball at rest (or with the given motion) for hand-built scenes. */
export function poolBall(
  id: string,
  x: number,
  y: number,
  extra: Partial<BallInput> = {},
): BallInput {
  return { id, radiusM: R_POOL, massKg: M_POOL, x, y, ...extra };
}

/** Turns a layout into simulator balls, with ids like "cue-0", "red-3". */
export function ballsFromLayout(layout: Layout, set: BallSetSpec): BallInput[] {
  return layout.balls.map((b, i) => {
    const size = ballSizeOf(set, b.kind);
    return {
      id: `${b.kind}-${i}`,
      radiusM: size.diameterM / 2,
      massKg: size.massKg,
      x: b.x,
      y: b.y,
    };
  });
}

export function rackInput(
  table: TableSpec,
  set: BallSetSpec,
  rack: RackKind,
  cloth: ClothSpec = MEDIUM,
): SimInput {
  return {
    table,
    cloth,
    balls: ballsFromLayout(rackLayout(table, set, rack), set),
    ballRestitution: set.restitution,
  };
}

export function spot(table: TableSpec, name: string): { x: number; y: number } {
  const s = spotsFor(table).find((p) => p.name === name);
  if (!s) throw new Error(`no spot ${name}`);
  return s;
}

export function eventsOf<T extends SimEvent["type"]>(
  result: SimResult,
  type: T,
): Extract<SimEvent, { type: T }>[] {
  return result.events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
}

export function finalPosition(result: SimResult, id: string): { x: number; y: number } {
  const b = sampleAt(result, result.durationS + 1).find((s) => s.id === id);
  if (!b) throw new Error(`no ball ${id}`);
  return b.position;
}

/**
 * Checks the invariants every simulation must satisfy:
 * events in time order, contiguous and continuous tracks, no energy gain, no overlapping
 * balls, every ball on the table or pocketed, and (when complete) everything at rest.
 */
export function checkInvariants(result: SimResult, input: SimInput, overlapTol = 3e-5): void {
  // Events in time order.
  for (let i = 1; i < result.events.length; i++) {
    expect((result.events[i] as SimEvent).t).toBeGreaterThanOrEqual(
      (result.events[i - 1] as SimEvent).t,
    );
  }
  // Tracks: one per ball, in order, contiguous in time, continuous in position.
  expect(result.tracks.map((t) => t.id)).toEqual(input.balls.map((b) => b.id));
  for (const track of result.tracks) {
    expect((track.segments[0] as { t0: number }).t0).toBe(0);
    for (let i = 0; i + 1 < track.segments.length; i++) {
      const s = track.segments[i] as (typeof track.segments)[number];
      const next = track.segments[i + 1] as (typeof track.segments)[number];
      expect(s.duration).toBeGreaterThan(0);
      expect(s.t0 + s.duration).toBeCloseTo(next.t0, 12);
      const endX = s.r0.x + s.duration * (s.v0.x + 0.5 * s.a.x * s.duration);
      const endY = s.r0.y + s.duration * (s.v0.y + 0.5 * s.a.y * s.duration);
      expect(Math.abs(endX - next.r0.x)).toBeLessThan(1e-9);
      expect(Math.abs(endY - next.r0.y)).toBeLessThan(1e-9);
    }
    const last = track.segments[track.segments.length - 1] as (typeof track.segments)[number];
    if (result.status === "complete") {
      expect(["stationary", "pocketed"]).toContain(last.state);
    }
  }
  // Sample times: every event time (just before and just after) plus a regular grid.
  const times = new Set<number>([0]);
  for (const e of result.events) {
    times.add(e.t);
    times.add(e.t + 1e-9);
    if (e.t > 1e-9) times.add(e.t - 1e-9);
  }
  const grid = 60;
  for (let i = 0; i <= grid; i++) times.add((i / grid) * result.durationS);
  const sorted = [...times].sort((a, b) => a - b);

  // Energy never increases. (Comparing just after each event with any earlier time.)
  let previous = Number.POSITIVE_INFINITY;
  for (const t of sorted) {
    const e = kineticEnergy(result, t);
    expect(e).toBeLessThanOrEqual(previous * (1 + 1e-9) + 1e-12);
    previous = e;
  }

  // No overlap beyond the tolerance, and every ball inside the table bounds.
  const table = "kind" in input.table ? input.table.table : input.table;
  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  const radius = new Map(input.balls.map((b) => [b.id, b.radiusM]));
  for (const t of sorted) {
    const balls = sampleAt(result, t).filter((b) => b.state !== "pocketed");
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i] as (typeof balls)[number];
      const ra = radius.get(a.id) ?? 0;
      expect(a.position.x).toBeGreaterThan(-0.2);
      expect(a.position.x).toBeLessThan(W + 0.2);
      expect(a.position.y).toBeGreaterThan(-0.2);
      expect(a.position.y).toBeLessThan(L + 0.2);
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j] as (typeof balls)[number];
        const dx = a.position.x - b.position.x;
        const dy = a.position.y - b.position.y;
        const gap = Math.sqrt(dx * dx + dy * dy) - ra - (radius.get(b.id) ?? 0);
        if (gap < -overlapTol) {
          throw new Error(`balls ${a.id} and ${b.id} overlap by ${-gap} m at t = ${t}`);
        }
      }
    }
  }
}

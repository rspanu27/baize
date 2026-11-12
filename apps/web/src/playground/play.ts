import { sampleAt } from "@baize/physics";
import type { BallInput, SimResult } from "@baize/physics";
import { ballSizeOf, rackLayout, sanitizeLayout, spotsFor } from "@baize/tables";
import type { BallKind, BallSetSpec, Layout, RackKind, TableSpec } from "@baize/tables";

/**
 * Turn-by-turn play for the playground: the table carries on from where the last shot left
 * it. Pure functions, no rules of any game: balls that drop stay down, and a potted cue ball
 * comes back on the head spot.
 */

export interface SceneBall extends BallInput {
  kind: BallKind;
}

export type RackChoice = RackKind | "two-balls";

/** Lower than every other ball, so that if the cue ball is in the way, it is the one moved. */
const CUE_PLACEMENT_CONFIDENCE = 0.5;

function toScene(layout: Layout, set: BallSetSpec, ids?: string[]): SceneBall[] {
  return layout.balls.map((b, i) => {
    const size = ballSizeOf(set, b.kind);
    return {
      id: ids?.[i] ?? `${b.kind}-${String(i)}`,
      kind: b.kind,
      radiusM: size.diameterM / 2,
      massKg: size.massKg,
      x: b.x,
      y: b.y,
    };
  });
}

/** Balls for a fresh rack, cue ball first. */
export function freshRack(table: TableSpec, set: BallSetSpec, rack: RackChoice): SceneBall[] {
  if (rack === "two-balls") {
    const { widthM, lengthM } = table.playingArea;
    return toScene(
      {
        balls: [
          { kind: "cue", x: widthM / 2, y: lengthM / 4 },
          { kind: "1", x: widthM * 0.62, y: lengthM * 0.7 },
        ],
      },
      set,
    );
  }
  return toScene(rackLayout(table, set, rack), set);
}

/**
 * Makes a set of balls a legal starting position: inside the cushions, off the pockets, not
 * overlapping. Balls keep their ids. `loose` names balls that should give way to the others.
 */
function settle(
  balls: SceneBall[],
  table: TableSpec,
  set: BallSetSpec,
  loose: ReadonlySet<string>,
): SceneBall[] {
  const result = sanitizeLayout(
    {
      balls: balls.map((b) => ({
        kind: b.kind,
        x: b.x,
        y: b.y,
        ...(loose.has(b.id) ? { confidence: CUE_PLACEMENT_CONFIDENCE } : {}),
      })),
    },
    table,
    set,
  );
  const removed = new Set(result.removed);
  const kept = balls.filter((_, i) => !removed.has(i));
  return kept.map((b, i) => {
    const placed = result.layout.balls[i];
    return placed ? { ...b, x: placed.x, y: placed.y } : b;
  });
}

export interface AfterShot {
  /** Balls on the table for the next shot, cue ball first. */
  balls: SceneBall[];
  /** Object balls that dropped on this shot, in the order they went down. */
  potted: BallKind[];
  /** True if the cue ball dropped; it has been put back on the head spot. */
  scratch: boolean;
}

/** The table after a shot has run to the end. */
export function layoutAfterShot(
  result: SimResult,
  balls: SceneBall[],
  table: TableSpec,
  set: BallSetSpec,
): AfterShot {
  const final = new Map(sampleAt(result, result.durationS + 1).map((b) => [b.id, b]));
  const kindOf = new Map(balls.map((b) => [b.id, b.kind]));
  const potted: BallKind[] = [];
  let scratch = false;
  for (const e of result.events) {
    if (e.type !== "pocket") continue;
    const kind = kindOf.get(e.ballId);
    if (kind === "cue") scratch = true;
    else if (kind) potted.push(kind);
  }

  const next: SceneBall[] = [];
  const loose = new Set<string>();
  for (const b of balls) {
    const end = final.get(b.id);
    if (!end) continue;
    if (end.state !== "pocketed") {
      next.push({ ...b, x: end.position.x, y: end.position.y });
    } else if (b.kind === "cue") {
      const head = spotsFor(table).find((s) => s.name === "head");
      next.push({
        ...b,
        x: head?.x ?? table.playingArea.widthM / 2,
        y: head?.y ?? table.playingArea.lengthM / 4,
      });
      loose.add(b.id);
    }
  }
  return { balls: settle(next, table, set, loose), potted, scratch };
}

/** Puts the cue ball at a point, nudged if needed so that it is on the table and clear. */
export function placeCueBall(
  balls: SceneBall[],
  point: { x: number; y: number },
  table: TableSpec,
  set: BallSetSpec,
): SceneBall[] {
  const cue = balls.find((b) => b.kind === "cue");
  if (!cue) return balls;
  const moved = balls.map((b) => (b.id === cue.id ? { ...b, x: point.x, y: point.y } : b));
  return settle(moved, table, set, new Set([cue.id]));
}

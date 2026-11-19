import { leaveValue, positionAfter } from "./position";
import { DEFAULT_SHOT_OPTIONS, makeContext, potCandidates } from "./shots";
import type { PlanContext, PotCandidate, Position, ShotOptions } from "./shots";
import type { PlanInput, PlanProgress, PlannedShot, Route } from "./types";

/**
 * Beam search over shot sequences (task 6.6).
 *
 * A node is a position reached by a route of planned pots. Each node is expanded into its best
 * pots; a route is scored by its expected value, the sum over its shots of (the chance of
 * getting that far, all pots in a row) times (what the shot is worth), plus the chance of
 * getting to the end times the value of the position left there (the geometric estimate of
 * the next shot). The search goes one shot deeper at a time and keeps the best `beamWidth`
 * routes at each depth, so a usable route exists after the first level. It stops at a budget of
 * simulator calls, never at a time, so the result is the same on every machine.
 */

export interface SearchOptions {
  readonly maxDepth: number;
  readonly beamWidth: number;
  /** How many pots of each node are followed. */
  readonly branching: number;
  /** Simulator calls allowed in all. */
  readonly budget: number;
  readonly shot: ShotOptions;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  maxDepth: 3,
  beamWidth: 4,
  branching: 4,
  budget: 20_000,
  shot: DEFAULT_SHOT_OPTIONS,
};

interface Node {
  readonly pos: Position;
  readonly steps: readonly PlannedShot[];
  /** Chance that every shot so far succeeds. */
  readonly reach: number;
  /** Expected value collected so far. */
  readonly collected: number;
  /** Value of the position left, given it is reached (geometric estimate). */
  readonly leave: number;
  /** The rack is over: nothing follows. */
  readonly terminal: boolean;
}

function score(n: Node): number {
  return n.collected + n.reach * n.leave;
}

function routeOf(n: Node): Route {
  return { steps: n.steps, expectedValue: score(n) };
}

function plannedShot(ctx: PlanContext, pos: Position, c: PotCandidate): PlannedShot {
  const planned = c.outcomes[0];
  if (!planned) throw new Error("a candidate without its planned outcome");
  const after = positionAfter(ctx, pos, planned);
  const cue = after.balls.find((b) => b.id === pos.cueBallId);
  return {
    kind: "pot",
    targetId: c.targetId,
    pocketId: c.pocketId,
    shot: c.shot,
    chance: c.chance,
    value: c.value,
    result: planned.result,
    cueStop: cue ? { x: cue.x, y: cue.y } : { x: Number.NaN, y: Number.NaN },
  };
}

/** The children of a node: its best pots, by chance times (value plus the position left). */
function expand(ctx: PlanContext, node: Node, options: SearchOptions): Node[] {
  const scored = potCandidates(ctx, node.pos, options.shot).map((c, i) => {
    const leave = leaveValue(ctx, node.pos, c);
    return { c, leave, s: c.chance * (c.value + leave), i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  // One way of playing each pot at most per pocket and ball would hide position play: keep
  // the best variants overall, whatever pot they play.
  return scored.slice(0, options.branching).map(({ c, leave }) => {
    const planned = c.outcomes[0];
    if (!planned) throw new Error("a candidate without its planned outcome");
    const reach = node.reach * c.chance;
    return {
      pos: positionAfter(ctx, node.pos, planned),
      steps: [...node.steps, plannedShot(ctx, node.pos, c)],
      reach,
      collected: node.collected + reach * c.value,
      leave: planned.judgement.finished ? 0 : leave,
      terminal: planned.judgement.finished,
    };
  });
}

/**
 * Plans a route step by step. Each value yielded reports the search so far, with the best
 * route found yet; the last one has `done: true`. A caller in a worker can post each one.
 */
export function* planRoutes(
  input: PlanInput,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): Generator<PlanProgress, PlanProgress> {
  const ctx = makeContext(input);
  const root: Node = {
    pos: { balls: input.balls, cueBallId: input.cueBallId, state: input.state },
    steps: [],
    reach: 1,
    collected: 0,
    leave: 0,
    terminal: false,
  };
  let best: Node | undefined;
  let frontier: Node[] = [root];
  let depth = 0;
  let outOfBudget = false;
  const consider = (n: Node) => {
    if (n.steps.length > 0 && (!best || score(n) > score(best))) best = n;
  };
  const progress = (done: boolean): PlanProgress => ({
    depth,
    runnerCalls: ctx.calls,
    ...(best ? { best: routeOf(best) } : {}),
    done,
  });

  while (depth < options.maxDepth && frontier.length > 0 && !outOfBudget) {
    const children: Node[] = [];
    for (const node of frontier) {
      if (ctx.calls >= options.budget) {
        outOfBudget = true;
        break;
      }
      for (const child of expand(ctx, node, options)) {
        children.push(child);
        consider(child);
      }
      yield progress(false);
    }
    if (outOfBudget && children.length === 0) break;
    depth++;
    // Best routes go on; finished racks have nothing to expand.
    frontier = children
      .map((n, i) => ({ n, i }))
      .sort((a, b) => score(b.n) - score(a.n) || a.i - b.i)
      .map(({ n }) => n)
      .filter((n) => !n.terminal)
      .slice(0, options.beamWidth);
  }
  return progress(true);
}

/** Runs the search to the end and returns the best route, if any pot was found. */
export function planRoute(
  input: PlanInput,
  options: SearchOptions = DEFAULT_SEARCH_OPTIONS,
): PlanProgress {
  const it = planRoutes(input, options);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

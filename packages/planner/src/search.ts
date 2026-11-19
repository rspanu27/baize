import { leaveValue, positionAfter } from "./position";
import { DEFAULT_SAFETY_OPTIONS, safetyShotSteps } from "./safety";
import type { SafetyOptions } from "./safety";
import { DEFAULT_SHOT_OPTIONS, makeContext, potCandidateSteps, remeasureChance } from "./shots";
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
  /** Safeties are looked for when the best route's first pot is less likely than this. */
  readonly safetyBelow: number;
  readonly safety: SafetyOptions;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  maxDepth: 3,
  beamWidth: 4,
  branching: 4,
  budget: 20_000,
  shot: DEFAULT_SHOT_OPTIONS,
  safetyBelow: 0.4,
  safety: DEFAULT_SAFETY_OPTIONS,
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

/**
 * The children of a node: its best pots, by chance times (value plus the position left). The
 * shots kept have their chance measured again with their own window. Yields between pieces of
 * work so a caller on the page can pause.
 */
function* expand(
  ctx: PlanContext,
  node: Node,
  options: SearchOptions,
): Generator<undefined, Node[], undefined> {
  const candidates = yield* potCandidateSteps(ctx, node.pos, options.shot);
  const scored = candidates.map((c, i) => {
    const leave = leaveValue(ctx, node.pos, c);
    return { c, leave, s: c.chance * (c.value + leave), i };
  });
  scored.sort((a, b) => b.s - a.s || a.i - b.i);
  // The best variants overall, whatever pot they play: one per pot would hide position play.
  const kept: typeof scored = [];
  for (const k of scored.slice(0, options.branching)) {
    yield;
    const c = remeasureChance(ctx, node.pos, k.c);
    kept.push({ ...k, c, s: c.chance * (c.value + k.leave) });
  }
  kept.sort((a, b) => b.s - a.s || a.i - b.i);
  return kept.map(({ c, leave }) => {
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
      const it = expand(ctx, node, options);
      let r = it.next();
      while (!r.done) {
        yield progress(false);
        r = it.next();
      }
      for (const child of r.value) {
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
  const first = best?.steps[0];
  if (!first || first.chance < options.safetyBelow) {
    const it = safetyShotSteps(ctx, root.pos, options.safety);
    let r = it.next();
    while (!r.done) {
      yield progress(false);
      r = it.next();
    }
    if (r.value.length > 0) return { ...progress(true), safeties: r.value };
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

import { sampleAt } from "@baize/physics";
import type { PocketId, SimResult } from "@baize/physics";
import { spotsFor } from "@baize/tables";
import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import type { GameState, PlanBall } from "./types";

/*
 * The minimal game rules the planner needs (SPEC section 10, "Games"): which balls are on, what
 * a pot is worth, whether a simulated shot was a foul, and the position and state after it.
 * This is not rule enforcement for the editor; rules beyond these (ball in hand, push-outs,
 * free balls, nominating, misses) are not modelled.
 */

/** Snooker colours, lowest value first. */
const SNOOKER_COLOURS = ["yellow", "green", "brown", "blue", "pink", "black"] as const;
type SnookerColour = (typeof SNOOKER_COLOURS)[number];

/** Snooker values (the rules of snooker: red 1, yellow 2, ... black 7). */
const SNOOKER_VALUE: Readonly<Record<SnookerColour | "red", number>> = {
  red: 1,
  yellow: 2,
  green: 3,
  brown: 4,
  blue: 5,
  pink: 6,
  black: 7,
};

function isColour(kind: BallKind): kind is SnookerColour {
  return (SNOOKER_COLOURS as readonly string[]).includes(kind);
}

/** The pool number of a ball, or 0 for a ball that has none. */
function poolNumber(kind: BallKind): number {
  const n = Number(kind);
  return Number.isInteger(n) && n >= 1 && n <= 15 ? n : 0;
}

type EightBallGroup = Extract<GameState, { game: "eight-ball" }>["group"];

function inGroup(kind: BallKind, group: EightBallGroup): boolean {
  const n = poolNumber(kind);
  switch (group) {
    case "solids":
      return n >= 1 && n <= 7;
    case "stripes":
      return n >= 9 && n <= 15;
    case "reds":
      return kind === "red";
    case "yellows":
      return kind === "yellow";
  }
}

function gameBall(group: EightBallGroup): BallKind {
  return group === "solids" || group === "stripes" ? "8" : "black";
}

/** A ball that is an object ball: not the cue ball. */
function isObject(ball: PlanBall, cueBallId: string): boolean {
  return ball.id !== cueBallId && ball.kind !== "cue";
}

/** Object balls the player may legally hit first now, in input order. */
export function ballsOn(
  balls: readonly PlanBall[],
  cueBallId: string,
  state: GameState,
): PlanBall[] {
  const objects = balls.filter((b) => isObject(b, cueBallId));
  switch (state.game) {
    case "snooker": {
      if (state.phase === "red") return objects.filter((b) => b.kind === "red");
      if (state.phase === "colour") return objects.filter((b) => isColour(b.kind));
      for (const colour of SNOOKER_COLOURS) {
        const on = objects.filter((b) => b.kind === colour);
        if (on.length > 0) return on;
      }
      return [];
    }
    case "nine-ball": {
      let lowest = 0;
      for (const b of objects) {
        const n = poolNumber(b.kind);
        if (n > 0 && (lowest === 0 || n < lowest)) lowest = n;
      }
      return lowest === 0 ? [] : objects.filter((b) => poolNumber(b.kind) === lowest);
    }
    case "eight-ball": {
      const group = objects.filter((b) => inGroup(b.kind, state.group));
      if (group.length > 0) return group;
      const game = gameBall(state.group);
      return objects.filter((b) => b.kind === game);
    }
    case "straight":
      return objects;
  }
}

/**
 * The balls the player can still pot in this game: every object ball, except in eight-ball,
 * where it is the player's own group and the game ball (the opponent's balls are not theirs to
 * pot). This is what the game-winning ball is worth (`potValue`).
 */
export function ballsLeftFor(
  balls: readonly PlanBall[],
  cueBallId: string,
  state: GameState,
): number {
  const objects = balls.filter((b) => isObject(b, cueBallId));
  if (state.game !== "eight-ball") return objects.length;
  const game = gameBall(state.group);
  return objects.filter((b) => b.kind === game || inGroup(b.kind, state.group)).length;
}

/**
 * Points (snooker) or balls (pool) a legal pot of this ball is worth in this state.
 * `objectBallsLeft` = the balls the player can still pot before the shot (`ballsLeftFor`); the
 * game-winning ball (the 9 in nine-ball, the 8 or black in eight-ball) is worth all of them.
 */
export function potValue(kind: BallKind, state: GameState, objectBallsLeft: number): number {
  if (kind === "cue") return 0;
  switch (state.game) {
    case "snooker":
      return kind === "red" || isColour(kind) ? SNOOKER_VALUE[kind] : 0;
    case "nine-ball": {
      const n = poolNumber(kind);
      if (n === 9) return objectBallsLeft;
      return n > 0 ? 1 : 0;
    }
    case "eight-ball":
      if (kind === gameBall(state.group)) return objectBallsLeft;
      return inGroup(kind, state.group) ? 1 : 0;
    case "straight":
      return 1;
  }
}

export type FoulReason =
  "no-contact" | "wrong-ball-first" | "cue-potted" | "ball-not-on-potted" | "no-rail";

export interface ShotJudgement {
  /** Id of the first ball the cue ball touched, if any. */
  readonly firstHitId?: string;
  /** Object ball ids potted, in event order. */
  readonly potted: readonly string[];
  readonly cuePotted: boolean;
  readonly foul: boolean;
  readonly reason?: FoulReason;
  /** The intended ball dropped in the intended pocket (when an intention is given). */
  readonly intendedPotted: boolean;
  /** Points or balls scored by this shot if it is not a foul (sum of potValue of legal pots), else 0. */
  readonly scored: number;
  /** The player keeps the table: no foul and at least one legal pot. For pool, potting the game-winning ball also counts. */
  readonly continues: boolean;
  /** The frame/rack is over for the planner: the 9 (nine-ball), the 8/black after the group (eight-ball), or the black in the colours phase (snooker) was potted legally; or the 8/black potted early (lost). */
  readonly finished: boolean;
}

/** What happened in a simulated shot, read from its events. */
interface ShotFacts {
  readonly firstHitId?: string;
  readonly potted: readonly string[];
  readonly cuePotted: boolean;
  /** Pool: after the cue ball's first contact, a ball was potted or touched a cushion. */
  readonly railAfterContact: boolean;
}

function readFacts(result: SimResult, cueBallId: string): ShotFacts {
  let firstHitId: string | undefined;
  let firstHitIndex = -1;
  const potted: string[] = [];
  let cuePotted = false;
  let railAfterContact = false;
  for (let i = 0; i < result.events.length; i++) {
    const e = result.events[i] as SimResult["events"][number];
    if (e.type === "ball-ball" && firstHitId === undefined) {
      if (e.ballId === cueBallId) firstHitId = e.otherBallId;
      else if (e.otherBallId === cueBallId) firstHitId = e.ballId;
      if (firstHitId !== undefined) firstHitIndex = i;
    } else if (e.type === "pocket") {
      if (e.ballId === cueBallId) cuePotted = true;
      else potted.push(e.ballId);
    }
    if (
      firstHitIndex >= 0 &&
      i > firstHitIndex &&
      (e.type === "pocket" || e.type === "ball-cushion")
    ) {
      railAfterContact = true;
    }
  }
  return {
    ...(firstHitId === undefined ? {} : { firstHitId }),
    potted,
    cuePotted,
    railAfterContact,
  };
}

/** First foul of a shot, checked in the order of `FoulReason`. */
function firstFoul(
  facts: ShotFacts,
  kindOf: (id: string) => BallKind | undefined,
  onIds: readonly string[],
  state: GameState,
  intended: { readonly targetId: string } | undefined,
): FoulReason | undefined {
  const first = facts.firstHitId;
  if (first === undefined) return "no-contact";
  if (!onIds.includes(first)) return "wrong-ball-first";
  if (
    state.game === "snooker" &&
    state.phase === "colour" &&
    intended !== undefined &&
    first !== intended.targetId
  ) {
    return "wrong-ball-first";
  }
  if (facts.cuePotted) return "cue-potted";
  if (state.game === "snooker") {
    for (const id of facts.potted) {
      const kind = kindOf(id);
      const legal =
        state.phase === "red"
          ? kind === "red"
          : state.phase === "colour"
            ? id === first
            : onIds.includes(id);
      if (!legal) return "ball-not-on-potted";
    }
    return undefined;
  }
  if (!facts.railAfterContact) return "no-rail";
  return undefined;
}

export function judgeShot(
  result: SimResult,
  balls: readonly PlanBall[],
  cueBallId: string,
  state: GameState,
  intended?: { readonly targetId: string; readonly pocketId?: PocketId },
): ShotJudgement {
  const kinds = new Map<string, BallKind>();
  for (const b of balls) kinds.set(b.id, b.kind);
  const kindOf = (id: string): BallKind | undefined => kinds.get(id);
  const objectBallsLeft = ballsLeftFor(balls, cueBallId, state);
  const onIds = ballsOn(balls, cueBallId, state).map((b) => b.id);
  const facts = readFacts(result, cueBallId);

  let reason = firstFoul(facts, kindOf, onIds, state, intended);
  let finished = false;

  if (state.game === "eight-ball") {
    // The game ball potted while the group remains, or on a foul, loses the rack.
    const game = gameBall(state.group);
    const gamePotted = facts.potted.some((id) => kindOf(id) === game);
    if (gamePotted) {
      const groupLeft = balls.some((b) => isObject(b, cueBallId) && inGroup(b.kind, state.group));
      if (groupLeft || reason !== undefined) reason = "ball-not-on-potted";
      finished = true;
    }
  }

  const foul = reason !== undefined;
  let scored = 0;
  let counting = 0;
  if (!foul) {
    for (const id of facts.potted) {
      const kind = kindOf(id);
      if (kind === undefined) continue;
      const value = potValue(kind, state, objectBallsLeft);
      scored += value;
      if (value > 0) counting++;
    }
    // The game-winning ball is worth all the balls left, which already include any potted with it.
    if (state.game !== "snooker" && scored > objectBallsLeft) scored = objectBallsLeft;
    if (state.game === "nine-ball") {
      finished = facts.potted.some((id) => kindOf(id) === "9");
    } else if (state.game === "snooker") {
      finished = state.phase === "colours" && facts.potted.some((id) => kindOf(id) === "black");
    }
  }

  const intendedPotted =
    intended !== undefined &&
    result.events.some(
      (e) =>
        e.type === "pocket" &&
        e.ballId === intended.targetId &&
        (intended.pocketId === undefined || e.pocketId === intended.pocketId),
    );

  return {
    ...(facts.firstHitId === undefined ? {} : { firstHitId: facts.firstHitId }),
    potted: facts.potted,
    cuePotted: facts.cuePotted,
    foul,
    ...(reason === undefined ? {} : { reason }),
    intendedPotted,
    scored,
    continues: !foul && counting > 0,
    finished,
  };
}

/** Clearance below which two balls count as touching, metres. Design tolerance (task 6.2). */
const TOUCH_EPS_M = 1e-6;

/** Step along the spot line when every spot is taken, metres. Design choice (task 6.2): 1 mm. */
const RESPOT_STEP_M = 0.001;

function isFree(x: number, y: number, radiusM: number, placed: readonly PlanBall[]): boolean {
  for (const b of placed) {
    const dx = b.x - x;
    const dy = b.y - y;
    if (Math.sqrt(dx * dx + dy * dy) < b.radiusM + radiusM + TOUCH_EPS_M) return false;
  }
  return true;
}

/**
 * Where a potted snooker colour goes back: its own spot; else the highest-value free spot; else
 * the nearest free point above its spot (towards the top cushion); else the nearest below.
 * Undefined if the table has no spot for it or there is no room at all.
 */
function respotPosition(
  colour: SnookerColour,
  radiusM: number,
  table: TableSpec,
  placed: readonly PlanBall[],
): { x: number; y: number } | undefined {
  const spots = spotsFor(table);
  const own = spots.find((s) => s.name === colour);
  if (own === undefined) return undefined;
  if (isFree(own.x, own.y, radiusM, placed)) return { x: own.x, y: own.y };
  for (let i = SNOOKER_COLOURS.length - 1; i >= 0; i--) {
    const spot = spots.find((s) => s.name === SNOOKER_COLOURS[i]);
    if (spot !== undefined && isFree(spot.x, spot.y, radiusM, placed)) {
      return { x: spot.x, y: spot.y };
    }
  }
  const top = table.playingArea.lengthM - radiusM;
  for (let k = 1; own.y + k * RESPOT_STEP_M <= top; k++) {
    const y = own.y + k * RESPOT_STEP_M;
    if (isFree(own.x, y, radiusM, placed)) return { x: own.x, y };
  }
  for (let k = 1; own.y - k * RESPOT_STEP_M >= radiusM; k++) {
    const y = own.y - k * RESPOT_STEP_M;
    if (isFree(own.x, y, radiusM, placed)) return { x: own.x, y };
  }
  return undefined;
}

function atRest(ball: PlanBall, x: number, y: number): PlanBall {
  return { id: ball.id, kind: ball.kind, radiusM: ball.radiusM, massKg: ball.massKg, x, y };
}

/**
 * Positions and game state after a shot: final positions from the result, potted balls removed
 * (the cue ball too), snooker colours respotted, and the next state. Balls keep their input
 * order. A colour that cannot be respotted (the table has no spot for it) stays off.
 */
export function afterShot(
  result: SimResult,
  balls: readonly PlanBall[],
  cueBallId: string,
  state: GameState,
  table: TableSpec,
  judgement: ShotJudgement,
): { readonly balls: PlanBall[]; readonly state: GameState } {
  const finals = sampleAt(result, result.durationS);
  const pottedIds = new Set<string>(judgement.potted);
  if (judgement.cuePotted) pottedIds.add(cueBallId);

  // Where each ball ends, by input index; undefined while it is off the table.
  const ends: (PlanBall | undefined)[] = balls.map((ball, i) => {
    if (pottedIds.has(ball.id)) return undefined;
    const indexed = finals[i];
    const sample = indexed?.id === ball.id ? indexed : finals.find((s) => s.id === ball.id);
    if (sample === undefined) return atRest(ball, ball.x, ball.y);
    if (sample.state === "pocketed") return undefined;
    return atRest(ball, sample.position.x, sample.position.y);
  });

  if (
    state.game === "snooker" &&
    (judgement.foul || state.phase === "red" || state.phase === "colour")
  ) {
    // Respot the highest-value colour first.
    for (let c = SNOOKER_COLOURS.length - 1; c >= 0; c--) {
      const colour = SNOOKER_COLOURS[c] as SnookerColour;
      balls.forEach((ball, i) => {
        if (ball.kind !== colour || ends[i] !== undefined || !pottedIds.has(ball.id)) return;
        const placed = ends.filter((b): b is PlanBall => b !== undefined);
        const at = respotPosition(colour, ball.radiusM, table, placed);
        if (at !== undefined) ends[i] = atRest(ball, at.x, at.y);
      });
    }
  }

  const after = ends.filter((b): b is PlanBall => b !== undefined);
  return { balls: after, state: nextState(state, judgement, after, cueBallId) };
}

function nextState(
  state: GameState,
  judgement: ShotJudgement,
  after: readonly PlanBall[],
  cueBallId: string,
): GameState {
  if (state.game !== "snooker" || !judgement.continues) return state;
  if (state.phase === "red") return { game: "snooker", phase: "colour" };
  if (state.phase === "colour") {
    const redsLeft = after.some((b) => isObject(b, cueBallId) && b.kind === "red");
    return { game: "snooker", phase: redsLeft ? "red" : "colours" };
  }
  return state;
}

/**
 * The default game for a ball set and the balls on the table: snooker sets play snooker (phase
 * "red" if any red is on the table, else "colours"); the blackball set plays eight-ball with the
 * reds; a pool set plays nine-ball if every object ball is numbered 1 to 9, otherwise eight-ball
 * with the solids. The panel lets the user change it.
 */
export function defaultGameState(ballSet: BallSetSpec, balls: readonly PlanBall[]): GameState {
  const objects = balls.filter((b) => b.kind !== "cue");
  switch (ballSet.game) {
    case "snooker":
      return {
        game: "snooker",
        phase: objects.some((b) => b.kind === "red") ? "red" : "colours",
      };
    case "blackball":
      return { game: "eight-ball", group: "reds" };
    case "pool": {
      const nineBall = objects.every((b) => {
        const n = poolNumber(b.kind);
        return n >= 1 && n <= 9;
      });
      return nineBall ? { game: "nine-ball" } : { game: "eight-ball", group: "solids" };
    }
  }
}

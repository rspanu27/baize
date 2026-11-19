import { PLAYER_LEVELS } from "@baize/planner";
import type { FoulReason, GameState, PlannedShot } from "@baize/planner";
import { useCallback, useEffect, useId, useRef } from "react";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { createPlanner } from "../planner/plannerClient";
import type { PlannerClient } from "../planner/plannerClient";
import {
  DEPTHS,
  gameStateFor,
  levelPhrase,
  percent,
  pocketWords,
  valueWords,
} from "../planner/plannerModel";
import { canUseShots, nextStepOf, planFor, ratingFor, usePlanner } from "../planner/plannerStore";
import type { Plan, Rating } from "../planner/plannerStore";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import { ballName } from "../view/ballLook";
import { EDITOR_ORIENTATION } from "../view/transform";
import type { Orientation } from "../view/transform";
import "./PlannerPanel.css";

export interface PlannerPanelActions {
  setState: (state: GameState) => void;
  setLevel: (levelId: string) => void;
  setDepth: (depth: number) => void;
  find: () => void;
  stop: () => void;
  select: (index: number) => void;
  useShot: (kind: "route" | "safety", index: number) => void;
  nextShot: () => void;
  rate: () => void;
}

export interface PlannerPanelViewProps {
  doc: DiagramDoc;
  scene: Scene | undefined;
  /** The game the planner plays (chosen or inferred). */
  state: GameState | undefined;
  levelId: string;
  maxDepth: number;
  /** The plan, only if it belongs to `doc`. */
  plan: Plan | undefined;
  /** The rating, only if it is of `doc`. */
  rating: Rating | undefined;
  orientation: Orientation;
  actions: PlannerPanelActions;
}

const PHASES: readonly { value: "red" | "colour" | "colours"; label: string }[] = [
  { value: "red", label: "A red" },
  { value: "colour", label: "A colour (after a red)" },
  { value: "colours", label: "The colours in order" },
];

const POOL_GAMES: readonly { value: "nine-ball" | "eight-ball" | "straight"; label: string }[] = [
  { value: "nine-ball", label: "9-ball" },
  { value: "eight-ball", label: "8-ball" },
  { value: "straight", label: "Straight pool" },
];

const FOULS: Record<FoulReason, string> = {
  "no-contact": "the cue ball hits no ball",
  "wrong-ball-first": "the first ball hit is not a ball on",
  "cue-potted": "the cue ball is potted",
  "ball-not-on-potted": "a ball that is not on is potted",
  "no-rail": "no ball reaches a cushion or a pocket after the contact",
};

/** Expected value of a route: points for snooker, balls for pool. */
function expectedWords(value: number, state: GameState): string {
  if (state.game === "snooker") return valueWords(value, state);
  return `${value.toFixed(1)} balls`;
}

function GameFields({
  id,
  scene,
  state,
  onChange,
}: {
  id: string;
  scene: Scene;
  state: GameState;
  onChange: (state: GameState) => void;
}) {
  const game = scene.ballSet.game;
  if (game === "snooker") {
    const phase = state.game === "snooker" ? state.phase : "red";
    return (
      <div className="planner-field">
        <label htmlFor={`${id}-phase`}>Ball on</label>
        <select
          id={`${id}-phase`}
          value={phase}
          onChange={(e) => {
            const value = PHASES.find((p) => p.value === e.target.value)?.value ?? "red";
            onChange({ game: "snooker", phase: value });
          }}
        >
          {PHASES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const groups =
    game === "blackball"
      ? ([
          ["reds", "Reds"],
          ["yellows", "Yellows"],
        ] as const)
      : ([
          ["solids", "Solids (1 to 7)"],
          ["stripes", "Stripes (9 to 15)"],
        ] as const);
  const group = state.game === "eight-ball" ? state.group : groups[0][0];
  return (
    <>
      {game === "pool" ? (
        <div className="planner-field">
          <label htmlFor={`${id}-game`}>Game</label>
          <select
            id={`${id}-game`}
            value={state.game}
            onChange={(e) => {
              const value = e.target.value;
              if (value === "eight-ball") onChange({ game: "eight-ball", group: "solids" });
              else if (value === "straight") onChange({ game: "straight" });
              else onChange({ game: "nine-ball" });
            }}
          >
            {POOL_GAMES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="planner-fixed">Game: blackball</p>
      )}
      {state.game === "eight-ball" ? (
        <div className="planner-field">
          <label htmlFor={`${id}-group`}>Your group</label>
          <select
            id={`${id}-group`}
            value={group}
            onChange={(e) => {
              const value = groups.find(([g]) => g === e.target.value)?.[0] ?? groups[0][0];
              onChange({ game: "eight-ball", group: value });
            }}
          >
            {groups.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
  );
}

/** One step in words: "9 ball, top-left corner, 72%", with points for snooker. */
export function stepWords(
  step: PlannedShot,
  kindOf: ReadonlyMap<string, string>,
  state: GameState,
  orientation: Orientation,
): string {
  const ball = ballName(kindOf.get(step.targetId) ?? step.targetId);
  const pocket = step.pocketId ? `, ${pocketWords(step.pocketId, orientation)}` : "";
  const points =
    state.game === "snooker"
      ? `, ${String(step.value)} ${step.value === 1 ? "point" : "points"}`
      : "";
  return `${ball}${pocket}, ${percent(step.chance)}${points}`;
}

function RatingView({
  rating,
  kindOf,
  orientation,
}: {
  rating: Rating;
  kindOf: ReadonlyMap<string, string>;
  orientation: Orientation;
}) {
  if (rating.error !== undefined) {
    return (
      <p className="planner-error" role="alert">
        {rating.error}
      </p>
    );
  }
  const r = rating.rating;
  if (!r) return null;
  if (r.judgement.foul) {
    const reason = r.judgement.reason ? FOULS[r.judgement.reason] : "the shot is not legal";
    return <p className="planner-rating">Foul: {reason}.</p>;
  }
  if (!r.potted) return <p className="planner-rating">Pots nothing.</p>;
  const ball = ballName(kindOf.get(r.potted.targetId) ?? r.potted.targetId);
  return (
    <dl className="planner-rating shot-result">
      <dt>Pots</dt>
      <dd>
        the {ball} in the {pocketWords(r.potted.pocketId, orientation)}
      </dd>
      <dt>Chance</dt>
      <dd>
        {percent(r.chance)} for {levelPhrase(rating.levelId)}
      </dd>
      <dt>Position left</dt>
      <dd>
        {r.judgement.finished
          ? "the rack is over"
          : `next pot worth ${valueWords(r.leaves, rating.state)}`}
      </dd>
    </dl>
  );
}

/** The planner panel: the game, the player, a route through the balls, safeties, and a rating. */
export function PlannerPanelView({
  doc,
  scene,
  state,
  levelId,
  maxDepth,
  plan,
  rating,
  orientation,
  actions,
}: PlannerPanelViewProps) {
  const id = useId();
  const hasCue = scene?.balls.some((b) => b.kind === "cue") === true;
  if (!scene || !state || !hasCue) {
    return (
      <section className="planner-panel">
        <h2>Plan</h2>
        <p className="shot-hint">Add a cue ball and some object balls to plan a route.</p>
      </section>
    );
  }

  const kindOf = new Map<string, string>((plan?.planDoc ?? doc).balls.map((b) => [b.id, b.kind]));
  const ratedKinds = new Map<string, string>(doc.balls.map((b) => [b.id, b.kind]));
  const route = plan?.route;
  const steps = route?.steps ?? [];
  const usable = plan ? canUseShots(plan, doc) : false;
  const next = plan ? nextStepOf(plan, doc) : undefined;
  const planState = plan?.state ?? state;

  return (
    <section className="planner-panel" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>Plan</h2>

      <div className="planner-settings">
        <GameFields id={id} scene={scene} state={state} onChange={actions.setState} />
        <div className="planner-field">
          <label htmlFor={`${id}-level`}>Player level</label>
          <select
            id={`${id}-level`}
            value={levelId}
            onChange={(e) => {
              actions.setLevel(e.target.value);
            }}
          >
            {PLAYER_LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <div className="planner-field">
          <label htmlFor={`${id}-depth`}>Shots ahead</label>
          <select
            id={`${id}-depth`}
            value={maxDepth}
            onChange={(e) => {
              actions.setDepth(Number(e.target.value));
            }}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="planner-row">
        {plan?.running ? (
          <button type="button" onClick={actions.stop}>
            Stop
          </button>
        ) : (
          <button type="button" className="shot-primary" onClick={actions.find}>
            Find a route
          </button>
        )}
      </div>

      <p className="planner-status" aria-live="polite">
        {plan?.running
          ? `Searching: ${String(plan.depth)} of ${String(maxDepth)} shots deep done` +
            (route ? `, best so far ${expectedWords(route.expectedValue, planState)}.` : ".")
          : plan && plan.error === undefined
            ? `Searched ${String(plan.depth)} ${plan.depth === 1 ? "shot" : "shots"} deep.`
            : ""}
      </p>

      {plan?.error !== undefined ? (
        <p className="planner-error" role="alert">
          {plan.error}
        </p>
      ) : null}

      {route && steps.length > 0 ? (
        <div className="planner-group">
          <h3>Route</h3>
          <p className="shot-hint">
            Expected: {expectedWords(route.expectedValue, planState)}. Choose a step to see it on
            the table.
          </p>
          <ol className="planner-route" aria-label="Route">
            {steps.map((step, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={plan?.selected === i}
                  onClick={() => {
                    actions.select(i);
                  }}
                >
                  {stepWords(step, kindOf, planState, orientation)}
                </button>
              </li>
            ))}
          </ol>
          <div className="planner-row">
            <button
              type="button"
              disabled={!usable}
              onClick={() => {
                actions.useShot("route", 0);
              }}
            >
              Use this shot
            </button>
            <button type="button" disabled={next === undefined} onClick={actions.nextShot}>
              {next === undefined
                ? "Next shot"
                : `Next shot (${String(next + 1)} of ${String(steps.length)})`}
            </button>
          </div>
          <p className="shot-hint">
            "Use this shot" puts shot 1 into the diagram; "Next shot" moves the balls to where it
            leaves them and sets up the following one.
          </p>
        </div>
      ) : null}

      {plan && !plan.running && plan.error === undefined && steps.length === 0 && !plan.safeties ? (
        <p className="shot-hint">No route found: no ball on can be potted from here.</p>
      ) : null}

      {plan?.safeties && plan.safeties.length > 0 ? (
        <div className="planner-group">
          <h3>No good pot: safeties</h3>
          <ol className="planner-safeties" aria-label="Safeties">
            {plan.safeties.map((s, i) => (
              <li key={i}>
                <span>
                  Hit the {ballName(kindOf.get(s.targetId) ?? s.targetId)}: leaves the opponent{" "}
                  {valueWords(s.leaves ?? 0, planState)}
                </span>
                <button
                  type="button"
                  disabled={!usable}
                  aria-label={`Use safety ${String(i + 1)}`}
                  onClick={() => {
                    actions.useShot("safety", i);
                  }}
                >
                  Use this shot
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="planner-group">
        <h3>Your shot</h3>
        <button type="button" disabled={doc.shot === undefined} onClick={actions.rate}>
          Rate my shot
        </button>
        {doc.shot === undefined ? (
          <p className="shot-hint">Set up a shot to rate it against the planner.</p>
        ) : null}
        {rating ? (
          <RatingView rating={rating} kindOf={ratedKinds} orientation={orientation} />
        ) : null}
      </div>
    </section>
  );
}

export interface PlannerPanelProps {
  /** Makes the planner client; the worker client by default. Tests pass a main-thread one. */
  createClient?: () => PlannerClient;
}

/** The planner panel, wired to the editor and planner stores. */
export function PlannerPanel({ createClient = createPlanner }: PlannerPanelProps) {
  const doc = useDoc();
  const planner = usePlanner();
  const clientRef = useRef<PlannerClient | undefined>(undefined);
  const scene = simulationFor(doc).scene;
  const { docChanged } = planner;

  const client = useCallback((): PlannerClient => {
    clientRef.current ??= createClient();
    return clientRef.current;
  }, [createClient]);

  // The plan and the rating belong to the document they were made for.
  useEffect(() => {
    docChanged(doc, clientRef.current);
  }, [doc, docChanged]);

  // The client is created on first use and closed with the panel.
  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = undefined;
    },
    [],
  );

  return (
    <PlannerPanelView
      doc={doc}
      scene={scene}
      state={scene ? gameStateFor(scene, planner.chosenState) : undefined}
      levelId={planner.levelId}
      maxDepth={planner.maxDepth}
      plan={planFor(planner.plan, doc)}
      rating={ratingFor(planner.rating, doc)}
      orientation={EDITOR_ORIENTATION}
      actions={{
        setState: planner.setChosenState,
        setLevel: planner.setLevel,
        setDepth: planner.setDepth,
        find: () => {
          void planner.findRoute(client());
        },
        stop: () => {
          planner.stop(clientRef.current);
        },
        select: planner.select,
        useShot: planner.useShot,
        nextShot: planner.nextShot,
        rate: planner.rateCurrentShot,
      }}
    />
  );
}

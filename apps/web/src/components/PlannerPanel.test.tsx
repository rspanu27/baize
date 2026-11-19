import { rateShot } from "@baize/planner";
import type { PlanProgress, PlannedShot } from "@baize/planner";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { placeBall, setStyle } from "../doc/ops";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc, DocBall } from "../doc/types";
import { planInputOf } from "../planner/planInput";
import { mainThreadPlanner } from "../planner/plannerClient";
import type { PlannerClient } from "../planner/plannerClient";
import { gameStateFor, pocketWords, shotPatch, valueWords } from "../planner/plannerModel";
import { planFor, ratingFor, usePlanner } from "../planner/plannerStore";
import { editorRunner } from "../sim/simulator";
import { NO_TUNING, useTuningStore } from "../sim/tuning";
import { simulationFor } from "../sim/useSimulation";
import { useEditor } from "../store/store";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { PlannerPanelView } from "./PlannerPanel";
import { RouteLayerView, routeArt } from "./RouteLayer";

type Placed = readonly [string, DocBall["kind"], number, number];

/** A document on a preset table with balls at shares of the playing area. */
function docWith(tablePreset: string, balls: readonly Placed[], ballSet?: string): DiagramDoc {
  const base = newDoc(tablePreset);
  const withSet = ballSet ? { ...base, ballSet: { preset: ballSet } } : base;
  const resolved = resolveDoc(withSet);
  if (!resolved.ok) throw new Error(resolved.problems.join(" "));
  const { widthM, lengthM } = resolved.scene.table.playingArea;
  return {
    ...withSet,
    balls: balls.map(([id, kind, fx, fy]) => ({ id, kind, x: widthM * fx, y: lengthM * fy })),
  };
}

function sceneOf(doc: DiagramDoc): Scene {
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

/** A nine-ball ending: the 8 then the 9, both in open positions. */
const NINE_BALL_ENDING: readonly Placed[] = [
  ["cue", "cue", 0.5, 0.25],
  ["8", "8", 0.4, 0.5],
  ["9", "9", 0.55, 0.75],
];

/** The planner on this thread with a small budget, so tests are quick and deterministic. */
function fastClient(): PlannerClient {
  const inner = mainThreadPlanner();
  return {
    plan: (req, onProgress) =>
      inner.plan({ ...req, options: { ...req.options, budget: 1_500 } }, onProgress),
    cancel: inner.cancel,
    dispose: inner.dispose,
  };
}

/** A client that answers every plan with the given final progress. */
function fixedClient(progress: PlanProgress): PlannerClient {
  return {
    plan: (_req, onProgress) => {
      onProgress(progress);
      return Promise.resolve(progress);
    },
    cancel: () => undefined,
    dispose: () => undefined,
  };
}

function present(): DiagramDoc {
  return useEditor.getState().history.present;
}

/** The panel for the current document and planner state, as static markup. */
function panelMarkup(): string {
  const doc = present();
  const s = usePlanner.getState();
  const scene = resolveDoc(doc);
  const sc = scene.ok ? scene.scene : undefined;
  const markup = renderToStaticMarkup(
    <PlannerPanelView
      doc={doc}
      scene={sc}
      state={sc ? gameStateFor(sc, s.chosenState) : undefined}
      levelId={s.levelId}
      maxDepth={s.maxDepth}
      plan={planFor(s.plan, doc)}
      rating={ratingFor(s.rating, doc)}
      orientation="landscape"
      actions={{
        setState: () => undefined,
        setLevel: () => undefined,
        setDepth: () => undefined,
        find: () => undefined,
        stop: () => undefined,
        select: () => undefined,
        useShot: () => undefined,
        nextShot: () => undefined,
        rate: () => undefined,
      }}
    />,
  );
  // Text joined from several parts may carry empty comments; they are not part of what is read.
  return markup.replaceAll("<!-- -->", "");
}

beforeEach(() => {
  useTuningStore.getState().reset();
  usePlanner.getState().reset();
  useEditor.getState().openDoc(docWith("pool-9@1", NINE_BALL_ENDING));
});

afterEach(() => {
  usePlanner.getState().reset();
});

describe("the game the planner plays", () => {
  test("is inferred from the ball set and the balls", () => {
    const nine = sceneOf(docWith("pool-9@1", NINE_BALL_ENDING));
    expect(gameStateFor(nine, undefined)).toEqual({ game: "nine-ball" });
    const eight = sceneOf(
      docWith("pool-9@1", [
        ["cue", "cue", 0.5, 0.2],
        ["3", "3", 0.3, 0.5],
        ["12", "12", 0.7, 0.6],
        ["8", "8", 0.5, 0.8],
      ]),
    );
    expect(gameStateFor(eight, undefined)).toEqual({ game: "eight-ball", group: "solids" });
    const reds = sceneOf(
      docWith("snooker-12@1", [
        ["cue", "cue", 0.5, 0.2],
        ["r1", "red", 0.4, 0.7],
        ["bk", "black", 0.5, 0.9],
      ]),
    );
    expect(gameStateFor(reds, undefined)).toEqual({ game: "snooker", phase: "red" });
    const colours = sceneOf(
      docWith("snooker-12@1", [
        ["cue", "cue", 0.5, 0.2],
        ["bk", "black", 0.5, 0.9],
      ]),
    );
    expect(gameStateFor(colours, undefined)).toEqual({ game: "snooker", phase: "colours" });
    const blackball = sceneOf(
      docWith(
        "blackball-7@1",
        [
          ["cue", "cue", 0.5, 0.2],
          ["y", "yellow", 0.4, 0.6],
        ],
        "blackball-51@1",
      ),
    );
    expect(gameStateFor(blackball, undefined)).toEqual({ game: "eight-ball", group: "reds" });
  });

  test("the user's choice wins, unless it does not fit the ball set", () => {
    const nine = sceneOf(docWith("pool-9@1", NINE_BALL_ENDING));
    expect(gameStateFor(nine, { game: "straight" })).toEqual({ game: "straight" });
    expect(gameStateFor(nine, { game: "snooker", phase: "red" })).toEqual({ game: "nine-ball" });
    expect(gameStateFor(nine, { game: "eight-ball", group: "reds" })).toEqual({
      game: "nine-ball",
    });
  });

  test("the panel offers the fields of the ball set's games", () => {
    const pool = panelMarkup();
    expect(pool).toContain(">Game</label>");
    expect(pool).toContain("9-ball");
    expect(pool).toContain("Straight pool");
    expect(pool).not.toContain("Your group");
    expect(pool).toContain(">Player level</label>");
    expect(pool).toMatch(/<option value="club" selected="">Club player<\/option>/);
    expect(pool).toMatch(/<option value="3" selected="">3<\/option>/);

    usePlanner.getState().setChosenState({ game: "eight-ball", group: "solids" });
    const eight = panelMarkup();
    expect(eight).toContain(">Your group</label>");
    expect(eight).toContain("Stripes (9 to 15)");

    useEditor.getState().openDoc(
      docWith("snooker-12@1", [
        ["cue", "cue", 0.5, 0.2],
        ["r1", "red", 0.4, 0.7],
      ]),
    );
    const snooker = panelMarkup();
    expect(snooker).toContain(">Ball on</label>");
    expect(snooker).toMatch(/<option value="red" selected="">A red<\/option>/);
    expect(snooker).not.toContain(">Game</label>");
  });

  test("without a cue ball the panel says what to do", () => {
    useEditor.getState().openDoc(docWith("pool-9@1", [["9", "9", 0.5, 0.5]]));
    expect(panelMarkup()).toContain("Add a cue ball");
  });
});

describe("words", () => {
  test("pockets are named as the table is drawn", () => {
    expect(pocketWords("corner-bl", "landscape")).toBe("top-left corner");
    expect(pocketWords("corner-br", "landscape")).toBe("bottom-left corner");
    expect(pocketWords("corner-tr", "landscape")).toBe("bottom-right corner");
    expect(pocketWords("middle-l", "landscape")).toBe("top middle");
    expect(pocketWords("middle-r", "landscape")).toBe("bottom middle");
    expect(pocketWords("corner-bl", "portrait")).toBe("bottom-left corner");
    expect(pocketWords("middle-l", "portrait")).toBe("left middle");
  });

  test("values are points for snooker, chances or balls for pool", () => {
    expect(valueWords(0.123, { game: "nine-ball" })).toBe("12%");
    expect(valueWords(2.5, { game: "nine-ball" })).toBe("2.5 balls");
    expect(valueWords(3.21, { game: "snooker", phase: "red" })).toBe("3.2 points");
  });
});

describe("finding a route", () => {
  test("shows the route as numbered steps with ball, pocket and chance", async () => {
    await usePlanner.getState().findRoute(fastClient());
    const plan = usePlanner.getState().plan;
    expect(plan?.running).toBe(false);
    expect(plan?.error).toBeUndefined();
    const steps = plan?.route?.steps ?? [];
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]?.targetId).toBe("8");
    const markup = panelMarkup();
    expect(markup).toMatch(/<ol class="planner-route" aria-label="Route">/);
    expect(markup).toMatch(
      /<li><button type="button" aria-pressed="false">8 ball, [a-z-]+ (corner|middle), \d+%<\/button><\/li>/,
    );
    expect(markup).toContain("Use this shot");
    expect(markup).toContain("Searched");
  });

  test("progress shows the best route so far while the search runs", async () => {
    const seen: (number | undefined)[] = [];
    const inner = fastClient();
    const watching: PlannerClient = {
      ...inner,
      plan: (req, onProgress) =>
        inner.plan(req, (p) => {
          onProgress(p);
          const plan = usePlanner.getState().plan;
          if (plan?.running) seen.push(plan.route?.steps.length);
        }),
    };
    await usePlanner.getState().findRoute(watching);
    expect(seen.some((n) => n !== undefined)).toBe(true);
  });

  test("errors are shown in plain words", async () => {
    useEditor.getState().openDoc(docWith("pool-9@1", [["9", "9", 0.5, 0.5]]));
    await usePlanner.getState().findRoute(fastClient());
    expect(usePlanner.getState().plan?.error).toBe("There is no cue ball on the table.");
  });

  test("the route is drawn: numbers, pocket lines, cue paths and stops, not catching pointers", async () => {
    await usePlanner.getState().findRoute(fastClient());
    const plan = usePlanner.getState().plan;
    if (!plan?.route) throw new Error("no route");
    const scene = sceneOf(present());
    const kindOf = new Map(plan.planDoc.balls.map((b) => [b.id, b.kind] as const));
    const art = routeArt(plan.route.steps, scene, plan.cueBallId, kindOf);
    expect(art[0]?.pocket).toBeDefined();
    expect(art[0]?.cuePieces.length).toBeGreaterThan(0);
    const view = makeViewTransform(scene.table.playingArea, "landscape");
    const markup = renderToStaticMarkup(
      <ViewTransformContext.Provider value={view}>
        <svg>
          <RouteLayerView art={art} selected={0} cueRadiusM={0.028} ballRadiusM={0.028} />
        </svg>
      </ViewTransformContext.Provider>,
    );
    expect(markup).toContain('pointer-events="none"');
    expect(markup).toContain('data-route-step="1" data-selected="true"');
    expect(markup).toContain("data-route-pocket-line");
    expect(markup).toContain("data-route-cue-path");
    expect(markup).toContain("data-route-stop");
    expect(markup).toContain("Shot 1: 8 ball");
  });
});

describe("using the route", () => {
  test("Use this shot sets the document's shot to step 1 as one undo step, as planned", async () => {
    await usePlanner.getState().findRoute(fastClient());
    const plan = usePlanner.getState().plan;
    const step = plan?.route?.steps[0];
    if (!plan || !step) throw new Error("no route");
    const pastBefore = useEditor.getState().history.past.length;
    usePlanner.getState().useShot("route", 0);
    const doc = present();
    expect(doc.shot).toEqual(shotPatch("cue", step));
    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1);
    // The editor's own simulation of the used shot is the planned one.
    expect(simulationFor(doc, NO_TUNING).outcome.result).toEqual(step.result);
    // The route stays, step 1 is highlighted, and undo goes back to the planned document.
    expect(planFor(usePlanner.getState().plan, doc)?.selected).toBe(0);
    useEditor.getState().undo();
    expect(present()).toBe(plan.planDoc);
    expect(planFor(usePlanner.getState().plan, present())).toBeDefined();
  });

  test("Next shot continues from the result and sets step 2", async () => {
    usePlanner.getState().setDepth(2);
    await usePlanner.getState().findRoute(fastClient());
    const steps = usePlanner.getState().plan?.route?.steps ?? [];
    expect(steps.length).toBe(2);
    const [first, second] = steps;
    if (!first || !second) throw new Error("no two steps");
    expect(panelMarkup()).toMatch(/<button type="button" disabled="">Next shot<\/button>/);

    usePlanner.getState().useShot("route", 0);
    expect(panelMarkup()).toContain("Next shot (2 of 2)");
    const pastBefore = useEditor.getState().history.past.length;
    usePlanner.getState().nextShot();
    const doc = present();
    expect(useEditor.getState().history.past.length).toBe(pastBefore + 1);
    expect(doc.balls.map((b) => b.id)).toEqual(["cue", "9"]);
    expect(doc.shot).toEqual(shotPatch("cue", second));
    expect(simulationFor(doc, NO_TUNING).outcome.result).toEqual(second.result);
    expect(planFor(usePlanner.getState().plan, doc)?.selected).toBe(1);
    // At the last step there is no next one, and step 1 cannot be used on this layout.
    const markup = panelMarkup();
    expect(markup).toMatch(/<button type="button" disabled="">Next shot<\/button>/);
    expect(markup).toMatch(/<button type="button" disabled="">Use this shot<\/button>/);
  });

  test("any change to the document but style clears the route and cancels a search", async () => {
    await usePlanner.getState().findRoute(fastClient());
    expect(planFor(usePlanner.getState().plan, present())).toBeDefined();

    // Style only: kept.
    const styled = setStyle(present(), { theme: "dark" });
    useEditor.getState().replaceDoc(styled);
    usePlanner.getState().docChanged(present(), undefined);
    expect(usePlanner.getState().plan?.route).toBeDefined();

    // A ball moved: gone, and not drawn even before the panel notices.
    useEditor.getState().placeBall("9", { x: 0.4, y: 1.5 });
    expect(planFor(usePlanner.getState().plan, present())).toBeUndefined();
    usePlanner.getState().docChanged(present(), undefined);
    expect(usePlanner.getState().plan).toBeUndefined();
    expect(panelMarkup()).not.toContain("planner-route");

    // A running search is cancelled.
    let cancelled = 0;
    const inner = fastClient();
    const client: PlannerClient = {
      ...inner,
      cancel: () => {
        cancelled++;
        inner.cancel();
      },
    };
    const running = usePlanner.getState().findRoute(client);
    expect(usePlanner.getState().plan?.running).toBe(true);
    useEditor.getState().replaceDoc(placeBall(present(), "8", { x: 0.5, y: 1.0 }));
    usePlanner.getState().docChanged(present(), client);
    await running;
    expect(cancelled).toBe(1);
    expect(usePlanner.getState().plan).toBeUndefined();
  });

  test("nothing of the planner goes into the document", async () => {
    const before = present();
    await usePlanner.getState().findRoute(fastClient());
    expect(present()).toBe(before);
  });
});

describe("safeties", () => {
  test("are listed with the ball to hit and what they leave, and can be used", async () => {
    const doc = present();
    const scene = sceneOf(doc);
    const shot = { aimAngleRad: 1.2, speedMps: 1.5, tipOffset: { side: 0, vertical: 0 } };
    const result = editorRunner(scene)(scene.balls, { ballId: "cue", ...shot });
    const safety: PlannedShot = {
      kind: "safety",
      targetId: "9",
      shot,
      chance: 1,
      value: 0,
      result,
      cueStop: { x: 0.5, y: 0.5 },
      leaves: 0.12,
    };
    await usePlanner
      .getState()
      .findRoute(fixedClient({ depth: 1, runnerCalls: 10, done: true, safeties: [safety] }));
    const markup = panelMarkup();
    expect(markup).toContain("No good pot: safeties");
    expect(markup).toContain("Hit the 9 ball: leaves the opponent 12%");
    expect(markup).toContain('aria-label="Use safety 1"');
    expect(markup).not.toContain("No route found");

    usePlanner.getState().useShot("safety", 0);
    expect(present().shot).toEqual({ cueBallId: "cue", ...shot });
    expect(planFor(usePlanner.getState().plan, present())).toBeDefined();
  });
});

describe("rating the user's shot", () => {
  /** Cue ball, 9 and the corner at the far end on screen right, top: one straight line. */
  function straightPot(): DiagramDoc {
    const doc = docWith("pool-9@1", [["9", "9", 0.5, 0.5]]);
    const { lengthM } = sceneOf(doc).table.playingArea;
    return {
      ...doc,
      balls: [
        { id: "cue", kind: "cue", x: 0.6, y: lengthM - 0.6 },
        { id: "9", kind: "9", x: 0.3, y: lengthM - 0.3 },
      ],
      shot: {
        cueBallId: "cue",
        aimAngleRad: (3 * Math.PI) / 4,
        speedMps: 2,
        tipOffset: { side: 0, vertical: 0 },
      },
    };
  }

  test("shows the pot and the chance for the level, matching rateShot", () => {
    const doc = straightPot();
    useEditor.getState().openDoc(doc);
    usePlanner.getState().rateCurrentShot();
    const rating = ratingFor(usePlanner.getState().rating, present());
    const r = rating?.rating;
    if (!r) throw new Error("no rating");
    const scene = sceneOf(doc);
    const expected = rateShot(
      planInputOf({ scene, tuning: NO_TUNING, state: { game: "nine-ball" }, levelId: "club" }),
      { aimAngleRad: (3 * Math.PI) / 4, speedMps: 2, tipOffset: { side: 0, vertical: 0 } },
    );
    expect(r.potted).toEqual({ targetId: "9", pocketId: "corner-tl" });
    expect(r.chance).toBe(expected.chance);
    expect(r.leaves).toBe(expected.leaves);
    expect(r.chance).toBeGreaterThan(0.3);
    const markup = panelMarkup();
    expect(markup).toContain("the 9 ball in the top-right corner");
    expect(markup).toMatch(new RegExp(`${String(Math.round(r.chance * 100))}% for a club player`));
    expect(markup).toContain("the rack is over");
  });

  test("says when the shot pots nothing or fouls, and is cleared by a change", () => {
    useEditor.getState().openDoc(straightPot());
    useEditor.getState().setShot({ aimAngleRad: Math.PI / 4 });
    usePlanner.getState().rateCurrentShot();
    expect(panelMarkup()).toMatch(/Foul: |Pots nothing\./);

    useEditor.getState().setShot({ speedMps: 1 });
    expect(ratingFor(usePlanner.getState().rating, present())).toBeUndefined();
    usePlanner.getState().docChanged(present(), undefined);
    expect(usePlanner.getState().rating).toBeUndefined();
  });
});

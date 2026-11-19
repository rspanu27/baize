import type { PlanProgress } from "@baize/planner";
import { afterEach, describe, expect, test, vi } from "vitest";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import { NO_TUNING } from "../sim/tuning";
import type { PlanRequest } from "./planInput";
import { createPlanner } from "./plannerClient";
import type { PlannerWorkerReply, PlannerWorkerRequest } from "./plannerClient";

/** A nine-ball ending on a 9 ft table: the cue ball and two object balls in open positions. */
function openScene(): Scene {
  const base = newDoc("pool-9@1");
  const blank = resolveDoc(base);
  if (!blank.ok) throw new Error("the 9 ft table does not resolve");
  const { widthM: W, lengthM: L } = blank.scene.table.playingArea;
  const r = resolveDoc({
    ...base,
    balls: [
      { id: "cue", kind: "cue", x: W * 0.5, y: L * 0.3 },
      { id: "8", kind: "8", x: W * 0.3, y: L * 0.6 },
      { id: "9", kind: "9", x: W * 0.6, y: L * 0.8 },
    ],
  });
  if (!r.ok) throw new Error(r.problems.join(" "));
  return r.scene;
}

const REQUEST: PlanRequest = {
  scene: openScene(),
  tuning: NO_TUNING,
  state: { game: "nine-ball" },
  levelId: "strong",
  options: { maxDepth: 2, budget: 1_500 },
};

/** A stand-in for the browser's Worker: records what it is sent, replies when told to. */
class FakeWorker {
  static last: FakeWorker | undefined;
  sent: PlannerWorkerRequest[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<PlannerWorkerReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: PlannerWorkerRequest) {
    this.sent.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(reply: PlannerWorkerReply) {
    this.onmessage?.({ data: reply } as MessageEvent<PlannerWorkerReply>);
  }
  fail() {
    this.onerror?.({ preventDefault: () => undefined } as unknown as ErrorEvent);
  }
}

function progress(runnerCalls: number, done = false): PlanProgress {
  return { depth: done ? 1 : 0, runnerCalls, done };
}

function lastPlanId(w: FakeWorker): number {
  const plans = w.sent.filter((m) => m.type === "plan");
  return plans.at(-1)?.id ?? -1;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  FakeWorker.last = undefined;
});

describe("the planner worker's messages, from the page", () => {
  test("a plan is posted with the request, and its progress is relayed until done", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const seen: PlanProgress[] = [];
    const plan = planner.plan(REQUEST, (p) => seen.push(p));
    expect(w.sent).toEqual([{ type: "plan", id: 1, request: REQUEST }]);
    w.reply({ id: 1, progress: progress(10) });
    w.reply({ id: 1, progress: progress(20) });
    w.reply({ id: 1, progress: progress(30, true) });
    const last = await plan;
    expect(seen.map((p) => p.runnerCalls)).toEqual([10, 20, 30]);
    expect(last).toEqual(progress(30, true));
  });

  test("a second plan cancels the first, and replies for the first are ignored", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const firstSeen: PlanProgress[] = [];
    const first = planner.plan(REQUEST, (p) => firstSeen.push(p));
    w.reply({ id: 1, progress: progress(5) });
    const secondSeen: PlanProgress[] = [];
    const second = planner.plan(REQUEST, (p) => secondSeen.push(p));
    expect(w.sent.map((m) => [m.type, m.id])).toEqual([
      ["plan", 1],
      ["cancel", 1],
      ["plan", 2],
    ]);
    await expect(first).rejects.toThrow(/^cancelled$/);
    // Late replies for the first plan, which the worker sent before it saw the cancel.
    w.reply({ id: 1, progress: progress(6) });
    w.reply({ id: 1, error: "too late" });
    w.reply({ id: 2, progress: progress(7, true) });
    expect((await second).runnerCalls).toBe(7);
    expect(firstSeen.map((p) => p.runnerCalls)).toEqual([5]);
    expect(secondSeen.map((p) => p.runnerCalls)).toEqual([7]);
  });

  test("cancel posts a cancel message and rejects the plan", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const plan = planner.plan(REQUEST, () => undefined);
    planner.cancel();
    expect(w.sent.at(-1)).toEqual({ type: "cancel", id: 1 });
    await expect(plan).rejects.toThrow(/^cancelled$/);
    // With nothing running, cancel sends nothing.
    planner.cancel();
    expect(w.sent).toHaveLength(2);
  });

  test("an error reply rejects the plan with its message; the next plan works", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const plan = planner.plan(REQUEST, () => undefined);
    w.reply({ id: 1, error: "Two balls overlap. Move one of them." });
    await expect(plan).rejects.toThrow("Two balls overlap. Move one of them.");
    const next = planner.plan(REQUEST, () => undefined);
    expect(w.sent.map((m) => m.type)).toEqual(["plan", "plan"]);
    w.reply({ id: lastPlanId(w), progress: progress(1, true) });
    expect((await next).done).toBe(true);
  });

  test("dispose ends the worker, cancels the running plan and refuses later ones", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const plan = planner.plan(REQUEST, () => undefined);
    planner.dispose();
    expect(w.terminated).toBe(true);
    await expect(plan).rejects.toThrow(/^cancelled$/);
    await expect(planner.plan(REQUEST, () => undefined)).rejects.toThrow("closed");
    expect(w.sent.map((m) => m.type)).toEqual(["plan", "cancel"]);
  });

  test("when a worker cannot be started, the page does the planning", async () => {
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          throw new Error("no workers here");
        }
      },
    );
    const planner = createPlanner();
    const last = await planner.plan(REQUEST, () => undefined);
    expect(last.done).toBe(true);
    expect(last.best?.steps.length).toBeGreaterThan(0);
  });

  test("when the worker fails, the running plan starts again on the page", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const planner = createPlanner();
    const w = FakeWorker.last as FakeWorker;
    const plan = planner.plan(REQUEST, () => undefined);
    w.fail();
    expect(w.terminated).toBe(true);
    const last = await plan;
    expect(last.done).toBe(true);
    // Later plans run on the page too; nothing more goes to the failed worker.
    const again = await planner.plan(REQUEST, () => undefined);
    expect(again.runnerCalls).toBe(last.runnerCalls);
    expect(w.sent).toHaveLength(1);
  });
});

describe("the planner worker itself", () => {
  /** Loads the worker module against a fake worker scope; returns what it posts. */
  async function loadWorker() {
    const posted: PlannerWorkerReply[] = [];
    const scope: {
      onmessage: ((e: MessageEvent<PlannerWorkerRequest>) => void) | null;
      postMessage: (m: PlannerWorkerReply) => void;
    } = {
      onmessage: null,
      postMessage: (m) => posted.push(m),
    };
    vi.stubGlobal("self", scope);
    await import("./plannerWorker");
    const send = (message: PlannerWorkerRequest) => {
      scope.onmessage?.({ data: message } as MessageEvent<PlannerWorkerRequest>);
    };
    return { posted, send };
  }

  async function until(check: () => boolean) {
    for (let i = 0; i < 2_000 && !check(); i++) await new Promise((r) => setTimeout(r, 1));
    expect(check()).toBe(true);
  }

  test("posts each step of the search, the last with done", async () => {
    const { posted, send } = await loadWorker();
    send({ type: "plan", id: 3, request: REQUEST });
    await until(() => posted.some((m) => "progress" in m && m.progress.done));
    expect(posted.length).toBeGreaterThan(1);
    expect(posted.every((m) => m.id === 3 && "progress" in m)).toBe(true);
    const last = posted.at(-1);
    expect(last && "progress" in last && last.progress.best).toBeTruthy();
  });

  test("a cancel stops the plan; a new plan replaces the one running", async () => {
    const { posted, send } = await loadWorker();
    send({ type: "plan", id: 1, request: REQUEST });
    await until(() => posted.length > 0);
    send({ type: "cancel", id: 1 });
    const afterCancel = posted.length;
    await new Promise((r) => setTimeout(r, 20));
    expect(posted).toHaveLength(afterCancel);

    send({ type: "plan", id: 2, request: REQUEST });
    await until(() => posted.length > afterCancel);
    send({ type: "plan", id: 4, request: REQUEST });
    await until(() => posted.some((m) => m.id === 4 && "progress" in m && m.progress.done));
    const doneFor2 = posted.some((m) => m.id === 2 && "progress" in m && m.progress.done);
    expect(doneFor2).toBe(false);
  });

  test("an error is posted in plain words", async () => {
    const { posted, send } = await loadWorker();
    send({ type: "plan", id: 5, request: { ...REQUEST, levelId: "wizard" } });
    await until(() => posted.length > 0);
    expect(posted).toEqual([{ id: 5, error: "The player level is not known: wizard." }]);
  });
});

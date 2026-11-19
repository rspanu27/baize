import type { PlanProgress } from "@baize/planner";
import { planErrorMessage, runPlanInSlices } from "./planInput";
import type { PlanRequest } from "./planInput";

/** Messages to the planner worker. */
export type PlannerWorkerRequest =
  { type: "plan"; id: number; request: PlanRequest } | { type: "cancel"; id: number };

/** Replies from the planner worker: each step of the search (the last has `done: true`), or why it stopped. */
export type PlannerWorkerReply =
  { id: number; progress: PlanProgress } | { id: number; error: string };

/** Runs the position-play planner for the panel. One plan at a time. */
export interface PlannerClient {
  /**
   * Starts a plan. Any plan still running is cancelled first (its promise rejects with an Error
   * whose message is "cancelled"). `onProgress` gets every `PlanProgress` of the search, in
   * order; the promise resolves with the last one (`done: true`).
   */
  plan(req: PlanRequest, onProgress: (p: PlanProgress) => void): Promise<PlanProgress>;
  /** Cancels the running plan, if any. */
  cancel(): void;
  /** Ends the worker; later `plan()` calls reject. */
  dispose(): void;
}

const CANCELLED = "cancelled";

function closedError(): Error {
  return new Error("The planner has been closed.");
}

/**
 * The planner on the page, used where workers are not available (and in unit tests). The search
 * runs one step at a time with a macrotask between steps, so clicks (a cancel among them) and
 * paints get through while it runs.
 */
export function mainThreadPlanner(): PlannerClient {
  let disposed = false;
  let stopRunning: (() => void) | undefined;
  const cancel = () => {
    const stop = stopRunning;
    stopRunning = undefined;
    stop?.();
  };
  return {
    plan(req, onProgress) {
      if (disposed) return Promise.reject(closedError());
      cancel();
      return new Promise<PlanProgress>((resolve, reject) => {
        let cancelled = false;
        const stop = () => {
          cancelled = true;
          reject(new Error(CANCELLED));
        };
        stopRunning = stop;
        const finish = () => {
          if (stopRunning === stop) stopRunning = undefined;
        };
        runPlanInSlices(req, () => cancelled, onProgress).then(
          (last) => {
            if (cancelled || !last) return;
            finish();
            resolve(last);
          },
          (e: unknown) => {
            if (cancelled) return;
            finish();
            reject(new Error(planErrorMessage(e)));
          },
        );
      });
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
    },
  };
}

interface Running {
  id: number;
  request: PlanRequest;
  onProgress: (p: PlanProgress) => void;
  resolve: (p: PlanProgress) => void;
  reject: (e: Error) => void;
}

/**
 * The planner in a worker, so that the page stays responsive while it searches. Falls back to
 * the main thread when a worker cannot be started, or when the worker fails (a browser that
 * cannot load module workers reports that as an error, not by throwing); a plan running then is
 * started again on the page, so its progress starts again from the beginning.
 */
export function createPlanner(): PlannerClient {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./plannerWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return mainThreadPlanner();
  }
  let nextId = 0;
  let running: Running | undefined;
  let fallback: PlannerClient | undefined;
  let disposed = false;
  const post = (message: PlannerWorkerRequest) => {
    worker.postMessage(message);
  };

  worker.onmessage = (event: MessageEvent<PlannerWorkerReply>) => {
    const reply = event.data;
    const r = running;
    // Replies for a plan that was cancelled or replaced are dropped.
    if (!r || reply.id !== r.id) return;
    if ("error" in reply) {
      running = undefined;
      r.reject(new Error(reply.error));
      return;
    }
    r.onProgress(reply.progress);
    if (reply.progress.done) {
      running = undefined;
      r.resolve(reply.progress);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    worker.terminate();
    const page = mainThreadPlanner();
    fallback = page;
    const r = running;
    running = undefined;
    if (r) page.plan(r.request, r.onProgress).then(r.resolve, r.reject);
  };

  const cancel = () => {
    if (fallback) {
      fallback.cancel();
      return;
    }
    const r = running;
    if (!r) return;
    running = undefined;
    post({ type: "cancel", id: r.id });
    r.reject(new Error(CANCELLED));
  };

  return {
    plan(req, onProgress) {
      if (disposed) return Promise.reject(closedError());
      if (fallback) return fallback.plan(req, onProgress);
      cancel();
      const id = ++nextId;
      return new Promise<PlanProgress>((resolve, reject) => {
        try {
          post({ type: "plan", id, request: req });
        } catch {
          reject(new Error("The layout could not be sent to the planner."));
          return;
        }
        running = { id, request: req, onProgress, resolve, reject };
      });
    },
    cancel,
    dispose() {
      cancel();
      disposed = true;
      if (fallback) fallback.dispose();
      else worker.terminate();
    },
  };
}

import { importPhoto } from "@baize/vision";
import type { ImportOptions, ImportResult, PhotoImage } from "@baize/vision";
import type { BallSetSpec, TableSpec } from "@baize/tables";
import { afterPaint } from "./decode";

/** Messages to the import worker. */
export type WorkerRequest =
  | { type: "image"; image: PhotoImage }
  | { type: "drop" }
  | {
      type: "run";
      id: number;
      table: TableSpec;
      ballSet: BallSetSpec;
      options: Pick<ImportOptions, "corners">;
    };

/** Replies from the import worker. */
export type WorkerReply = { id: number; result: ImportResult } | { id: number; error: string };

/** Runs the photo import for one photo under review. */
export interface PhotoAnalyser {
  run(
    table: TableSpec,
    ballSet: BallSetSpec,
    options?: Pick<ImportOptions, "corners">,
  ): Promise<ImportResult>;
  /** Drops the photo and ends the worker. Runs still waiting are rejected. */
  dispose(): void;
}

/** The import on the main thread: used where workers are not available (and in unit tests). */
export function mainThreadAnalyser(image: PhotoImage): PhotoAnalyser {
  let disposed = false;
  return {
    async run(table, ballSet, options = {}) {
      if (disposed) throw new Error("The photo has been closed.");
      // Let the busy message show before the page is blocked.
      await afterPaint();
      return importPhoto(image, table, ballSet, { ...options, now: () => performance.now() });
    },
    dispose() {
      disposed = true;
    },
  };
}

/**
 * The import in a worker, so that the page stays responsive. The photo's pixels are copied to
 * the worker once; each run then sends only the table, the ball set and any corners. Falls
 * back to the main thread when a worker cannot be started.
 */
export function createAnalyser(image: PhotoImage): PhotoAnalyser {
  let worker: Worker;
  try {
    worker = new Worker(new URL("./importWorker.ts", import.meta.url), { type: "module" });
  } catch {
    return mainThreadAnalyser(image);
  }
  let nextId = 0;
  const waiting = new Map<
    number,
    { resolve: (r: ImportResult) => void; reject: (e: Error) => void }
  >();
  let failed: Error | undefined;
  const failAll = (error: Error) => {
    failed = error;
    for (const w of waiting.values()) w.reject(error);
    waiting.clear();
  };
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const reply = event.data;
    const w = waiting.get(reply.id);
    if (!w) return;
    waiting.delete(reply.id);
    if ("result" in reply) w.resolve(reply.result);
    else w.reject(new Error(reply.error));
  };
  worker.onerror = (event) => {
    event.preventDefault();
    failAll(new Error("The photo could not be analysed."));
  };
  const request: WorkerRequest = { type: "image", image };
  worker.postMessage(request);
  return {
    run(table, ballSet, options = {}) {
      if (failed) return Promise.reject(failed);
      const id = ++nextId;
      return new Promise<ImportResult>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        const run: WorkerRequest = { type: "run", id, table, ballSet, options };
        worker.postMessage(run);
      });
    },
    dispose() {
      const drop: WorkerRequest = { type: "drop" };
      worker.postMessage(drop);
      worker.terminate();
      failAll(new Error("The photo has been closed."));
    },
  };
}

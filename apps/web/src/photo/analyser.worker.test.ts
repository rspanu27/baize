import { TABLE_PRESETS, getBallSet } from "@baize/tables";
import type { ImportResult, PhotoImage } from "@baize/vision";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createAnalyser } from "./analyser";
import type { WorkerReply, WorkerRequest } from "./analyser";

const table = TABLE_PRESETS.find((t) => t.id === "pool-9@1");
const ballSet = table ? getBallSet(table.defaultBallSetId) : undefined;
if (!table || !ballSet) throw new Error("no 9 ft table");

/** A stand-in for the browser's Worker: records what it is sent, replies when told to. */
class FakeWorker {
  static last: FakeWorker | undefined;
  static failPost = false;
  sent: { message: WorkerRequest; transfer: Transferable[] | undefined }[] = [];
  terminated = false;
  onmessage: ((e: MessageEvent<WorkerReply>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(message: WorkerRequest, transfer?: Transferable[]) {
    if (FakeWorker.failPost) throw new DOMException("could not clone", "DataCloneError");
    this.sent.push({ message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(reply: WorkerReply) {
    this.onmessage?.({ data: reply } as MessageEvent<WorkerReply>);
  }
  fail() {
    this.onerror?.({ preventDefault: () => undefined } as unknown as ErrorEvent);
  }
}

function photo(): PhotoImage {
  return { widthPx: 8, heightPx: 6, data: new Uint8ClampedArray(8 * 6 * 4).fill(100) };
}

const RESULT: ImportResult = {
  problem: "table-not-found",
  layout: { balls: [] },
  diagnostics: { cornersDetected: true, timingsMs: {} },
};

afterEach(() => {
  vi.unstubAllGlobals();
  FakeWorker.last = undefined;
  FakeWorker.failPost = false;
});

describe("the import worker's messages", () => {
  test("the pixels are handed over once, not copied, and each run gets its own answer", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const image = photo();
    const analyser = createAnalyser(image);
    const w = FakeWorker.last as FakeWorker;
    expect(w.sent[0]?.message.type).toBe("image");
    expect(w.sent[0]?.transfer).toEqual([image.data.buffer]);
    const first = analyser.run(table, ballSet);
    const second = analyser.run(table, ballSet, {
      corners: [
        { u: 1, v: 5 },
        { u: 7, v: 5 },
        { u: 6, v: 1 },
        { u: 2, v: 1 },
      ],
    });
    const ids = w.sent.slice(1).map((s) => (s.message.type === "run" ? s.message.id : -1));
    expect(ids).toHaveLength(2);
    // Answers in the other order, and one for an id nobody waits for, which is ignored.
    w.reply({ id: 999, result: RESULT });
    w.reply({ id: ids[1] as number, result: { ...RESULT, problem: "corners-invalid" } });
    w.reply({ id: ids[0] as number, result: RESULT });
    expect((await first).problem).toBe("table-not-found");
    expect((await second).problem).toBe("corners-invalid");
  });

  test("an error reply rejects only that run", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const analyser = createAnalyser(photo());
    const w = FakeWorker.last as FakeWorker;
    const run = analyser.run(table, ballSet);
    const id = w.sent[1]?.message.type === "run" ? w.sent[1].message.id : -1;
    w.reply({ id, error: "No photo to analyse." });
    await expect(run).rejects.toThrow("No photo to analyse.");
    const next = analyser.run(table, ballSet);
    const nextId = w.sent[2]?.message.type === "run" ? w.sent[2].message.id : -1;
    w.reply({ id: nextId, result: RESULT });
    expect((await next).problem).toBe("table-not-found");
  });

  test("closing drops the photo, ends the worker and rejects runs still waiting", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const analyser = createAnalyser(photo());
    const w = FakeWorker.last as FakeWorker;
    const waiting = analyser.run(table, ballSet);
    analyser.dispose();
    expect(w.sent.at(-1)?.message.type).toBe("drop");
    expect(w.terminated).toBe(true);
    await expect(waiting).rejects.toThrow("closed");
    await expect(analyser.run(table, ballSet)).rejects.toThrow("closed");
  });

  test("a worker that fails rejects what is waiting and every later run", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const analyser = createAnalyser(photo());
    const w = FakeWorker.last as FakeWorker;
    const waiting = analyser.run(table, ballSet);
    w.fail();
    await expect(waiting).rejects.toThrow("could not be analysed");
    await expect(analyser.run(table, ballSet)).rejects.toThrow("could not be analysed");
  });

  test("when the pixels cannot be handed over, the worker is ended and the page does the work", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    FakeWorker.failPost = true;
    const image = photo();
    const analyser = createAnalyser(image);
    expect(FakeWorker.last?.terminated).toBe(true);
    // The pixels are still here, and the import runs on them.
    expect(image.data.length).toBe(8 * 6 * 4);
    const result = await analyser.run(table, ballSet);
    expect(result.problem).toBe("table-not-found");
  });
});

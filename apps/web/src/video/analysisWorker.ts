import { createAnalysis } from "./analysisCore";
import type { AnalysisSession } from "./analysisCore";
import type { AnalysisReply, AnalysisRequest } from "./analysis";

/**
 * The clip analysis off the main thread: the page decodes frames and hands each one's pixels
 * over; this tracks them, then finds and fits the shots. Every frame is acknowledged, so the
 * page sends the next only when this one is done and never piles frames up in memory. Nothing
 * here sends anything anywhere else or stores anything.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalysisRequest>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage: (message: AnalysisReply) => void;
}

const scope = self as unknown as WorkerScope;
let session: AnalysisSession | undefined;

const errorText = (e: unknown) =>
  e instanceof Error && e.message ? e.message : "The clip could not be analysed.";

// A request that cannot be read: say so, so the page does not wait for ever.
scope.onmessageerror = () => {
  session = undefined;
  scope.postMessage({ type: "error", message: "The clip analysis could not read a frame." });
};

scope.onmessage = (event) => {
  const m = event.data;
  try {
    if (m.type === "init") {
      session = createAnalysis(m.init);
      scope.postMessage({ type: "ready" });
    } else if (m.type === "frame") {
      if (!session) throw new Error("The analysis has not started.");
      session.push(m.image, m.timeS);
      scope.postMessage({ type: "ack" });
    } else {
      if (!session) throw new Error("The analysis has not started.");
      const out = session.finish((done, total) => {
        scope.postMessage({ type: "fitting", done, total });
      });
      session = undefined;
      scope.postMessage({ type: "done", output: out });
    }
  } catch (e) {
    session = undefined;
    scope.postMessage({ type: "error", message: errorText(e) });
  }
};

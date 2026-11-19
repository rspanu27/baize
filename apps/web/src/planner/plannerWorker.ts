import { planErrorMessage, runPlanInSlices } from "./planInput";
import type { PlanRequest } from "./planInput";
import type { PlannerWorkerReply, PlannerWorkerRequest } from "./plannerClient";

/**
 * The position-play planner, run off the main thread so that the page stays responsive while
 * it searches (it runs thousands of simulations). One plan at a time: a new plan replaces the
 * one running, and a cancel stops it. Between steps of the search the worker waits for a
 * macrotask, so that a cancel or a new plan gets in. Nothing here sends or stores anything.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<PlannerWorkerRequest>) => void) | null;
  postMessage: (message: PlannerWorkerReply) => void;
}

const scope = self as unknown as WorkerScope;
/** The id of the plan running, if any. */
let current: number | undefined;

async function run(id: number, request: PlanRequest): Promise<void> {
  const stopped = () => current !== id;
  try {
    await runPlanInSlices(request, stopped, (progress) => {
      scope.postMessage({ id, progress });
    });
  } catch (e) {
    if (!stopped()) scope.postMessage({ id, error: planErrorMessage(e) });
  }
  if (current === id) current = undefined;
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "cancel") {
    if (current === message.id) current = undefined;
    return;
  }
  current = message.id;
  void run(message.id, message.request);
};

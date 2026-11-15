import { importPhoto } from "@baize/vision";
import type { PhotoImage } from "@baize/vision";
import type { WorkerReply, WorkerRequest } from "./analyser";

/**
 * The photo import, run off the main thread so that the page stays responsive while a photo
 * is analysed (it takes seconds on a slow phone). The worker keeps the one photo under
 * review in memory, and nothing else; it is dropped when the review closes, and the worker
 * itself is ended then. Nothing here sends or stores anything.
 */

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerReply) => void;
}

const scope = self as unknown as WorkerScope;
let image: PhotoImage | undefined;

scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "image") {
    image = message.image;
    return;
  }
  if (message.type === "drop") {
    image = undefined;
    return;
  }
  if (!image) {
    scope.postMessage({ id: message.id, error: "No photo to analyse." });
    return;
  }
  try {
    const result = importPhoto(image, message.table, message.ballSet, {
      ...message.options,
      now: () => performance.now(),
    });
    scope.postMessage({ id: message.id, result });
  } catch (e) {
    scope.postMessage({
      id: message.id,
      error: e instanceof Error ? e.message : "The photo could not be analysed.",
    });
  }
};

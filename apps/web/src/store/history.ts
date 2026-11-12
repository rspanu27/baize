/**
 * Undo/redo history as plain data and pure functions.
 *
 * Two ways to change the present:
 *  - `commit`: one undoable step.
 *  - `live`: for continuous gestures such as dragging a ball. The first live change of a
 *    gesture records an undo step; the following ones replace the present without adding
 *    steps, so a whole drag is undone at once. `endGesture` closes the gesture.
 */

export interface History<T> {
  readonly past: readonly T[];
  readonly present: T;
  readonly future: readonly T[];
  /** True while a live gesture is in progress. */
  readonly gesture: boolean;
}

/** Most undo steps kept. Design limit: documents are small, so this is cheap. */
export const HISTORY_LIMIT = 200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], gesture: false };
}

function pushPast<T>(past: readonly T[], value: T): T[] {
  const next = [...past, value];
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
}

/** One undoable step. A change to the same value is ignored. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h.gesture ? { ...h, gesture: false } : h;
  return { past: pushPast(h.past, h.present), present: next, future: [], gesture: false };
}

/** A change inside a continuous gesture: the whole gesture is one undo step. */
export function live<T>(h: History<T>, next: T): History<T> {
  if (next === h.present) return h;
  if (h.gesture) return { ...h, present: next };
  return { past: pushPast(h.past, h.present), present: next, future: [], gesture: true };
}

export function endGesture<T>(h: History<T>): History<T> {
  return h.gesture ? { ...h, gesture: false } : h;
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

export function undo<T>(h: History<T>): History<T> {
  const previous = h.past[h.past.length - 1];
  if (previous === undefined) return endGesture(h);
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
    gesture: false,
  };
}

export function redo<T>(h: History<T>): History<T> {
  const next = h.future[0];
  if (next === undefined) return endGesture(h);
  return {
    past: pushPast(h.past, h.present),
    present: next,
    future: h.future.slice(1),
    gesture: false,
  };
}

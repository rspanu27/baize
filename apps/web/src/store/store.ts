import type { BallKind, ClothSpec, Layout } from "@baize/tables";
import { create } from "zustand";
import {
  addBall,
  addMeasure,
  clearAnnotations,
  removeAnnotation,
  clearBalls,
  clearShot,
  continueFromShot,
  loadLayout,
  placeBall,
  removeBall,
  setBallSet,
  setCloth,
  setShot,
  setStyle,
  setTable,
} from "../doc/ops";
import type { LoadLayoutOptions, ShotFinal } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc, DiagramStyle, DocBallSet, DocShot, DocTable } from "../doc/types";
import { commit, createHistory, endGesture, live, redo, undo } from "./history";
import type { History } from "./history";

/**
 * The editor store. The document (with its undo history) is the only state that is shared or
 * saved; selection and the active tool are transient.
 *
 * Actions that can be part of a drag take `mode`: "live" while the pointer is down (the whole
 * drag becomes one undo step), "commit" for a single change.
 */

export type ChangeMode = "commit" | "live";
export type Tool = "select" | "aim" | "measure";

/** Table the editor opens on. */
export const DEFAULT_TABLE_PRESET = "pool-9@1";

export interface EditorState {
  history: History<DiagramDoc>;
  selectedBallId: string | undefined;
  tool: Tool;

  /** Replaces the document and clears the history (opening a link, starting a new diagram). */
  openDoc: (doc: DiagramDoc) => void;
  /** Replaces the document as one undoable step (unlike `openDoc`, the history is kept). */
  replaceDoc: (doc: DiagramDoc) => void;
  undo: () => void;
  redo: () => void;
  /** Ends a drag, so the next live change starts a new undo step. */
  endGesture: () => void;

  placeBall: (id: string, point: { x: number; y: number }, mode?: ChangeMode) => void;
  addBall: (kind: BallKind, point: { x: number; y: number }) => void;
  removeBall: (id: string) => void;
  clearBalls: () => void;
  /** Puts a rack, template or imported layout on the table as one undoable step. */
  loadLayout: (layout: Layout, options: LoadLayoutOptions) => void;
  setShot: (patch: Partial<Omit<DocShot, "elevationRad">>, mode?: ChangeMode) => void;
  clearShot: () => void;
  setTable: (table: DocTable, ballSet?: DocBallSet) => void;
  setBallSet: (ballSet: DocBallSet) => void;
  setCloth: (cloth: ClothSpec, mode?: ChangeMode) => void;
  setStyle: (patch: DiagramStyle) => void;

  /** How far along the aim line the aim handle sits, in metres (not part of the document). */
  aimHandleM: number;
  setAimHandle: (distanceM: number) => void;
  /** Replaces the layout with where a shot left the balls, as one undoable step. */
  continueFromShot: (finals: readonly ShotFinal[]) => void;

  addMeasure: (from: { x: number; y: number }, to: { x: number; y: number }) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;

  select: (id: string | undefined) => void;
  setTool: (tool: Tool) => void;
}

export const useEditor = create<EditorState>((set) => {
  /** Applies a document operation as one step or as part of a gesture. */
  const change = (op: (doc: DiagramDoc) => DiagramDoc, mode: ChangeMode = "commit"): void => {
    set((state) => {
      const next = op(state.history.present);
      const history = mode === "live" ? live(state.history, next) : commit(state.history, next);
      if (history === state.history) return state;
      // A selected ball that no longer exists is deselected.
      const selected =
        state.selectedBallId !== undefined &&
        history.present.balls.some((b) => b.id === state.selectedBallId)
          ? state.selectedBallId
          : undefined;
      return { history, selectedBallId: selected };
    });
  };
  const stillSelected = (state: EditorState, doc: DiagramDoc): string | undefined =>
    state.selectedBallId !== undefined && doc.balls.some((b) => b.id === state.selectedBallId)
      ? state.selectedBallId
      : undefined;

  return {
    history: createHistory(newDoc(DEFAULT_TABLE_PRESET)),
    selectedBallId: undefined,
    tool: "select",

    openDoc: (doc) => {
      set({ history: createHistory(doc), selectedBallId: undefined });
    },
    replaceDoc: (doc) => {
      change(() => doc);
    },
    undo: () => {
      set((state) => {
        const history = undo(state.history);
        return { history, selectedBallId: stillSelected(state, history.present) };
      });
    },
    redo: () => {
      set((state) => {
        const history = redo(state.history);
        return { history, selectedBallId: stillSelected(state, history.present) };
      });
    },
    endGesture: () => {
      set((state) => ({ history: endGesture(state.history) }));
    },

    placeBall: (id, point, mode) => {
      change((doc) => placeBall(doc, id, point), mode);
    },
    addBall: (kind, point) => {
      change((doc) => addBall(doc, kind, point));
    },
    removeBall: (id) => {
      change((doc) => removeBall(doc, id));
    },
    clearBalls: () => {
      change(clearBalls);
    },
    loadLayout: (layout, options) => {
      change((doc) => loadLayout(doc, layout, options));
    },
    setShot: (patch, mode) => {
      change((doc) => setShot(doc, patch), mode);
    },
    clearShot: () => {
      change(clearShot);
    },
    setTable: (table, ballSet) => {
      change((doc) => setTable(doc, table, ballSet));
    },
    setBallSet: (ballSet) => {
      change((doc) => setBallSet(doc, ballSet));
    },
    setCloth: (cloth, mode) => {
      change((doc) => setCloth(doc, cloth), mode);
    },
    setStyle: (patch) => {
      change((doc) => setStyle(doc, patch));
    },

    aimHandleM: 0.35,
    setAimHandle: (distanceM) => {
      set({ aimHandleM: distanceM });
    },
    continueFromShot: (finals) => {
      change((doc) => continueFromShot(doc, finals));
    },

    addMeasure: (from, to) => {
      change((doc) => addMeasure(doc, from, to));
    },
    removeAnnotation: (id) => {
      change((doc) => removeAnnotation(doc, id));
    },
    clearAnnotations: () => {
      change(clearAnnotations);
    },

    select: (id) => {
      set({ selectedBallId: id });
    },
    setTool: (tool) => {
      set({ tool });
    },
  };
});

/** The current document. */
export function useDoc(): DiagramDoc {
  return useEditor((s) => s.history.present);
}

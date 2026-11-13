import { drillLayout, rackLayout } from "@baize/tables";
import type { BallKind, RackKind } from "@baize/tables";
import { useEffect, useId, useState } from "react";
import { nextBallId } from "../doc/ops";
import type { Scene } from "../doc/resolve";
import { simulationFor } from "../sim/useSimulation";
import { canRedo, canUndo } from "../store/history";
import { useDoc, useEditor } from "../store/store";
import { BallBody } from "./BallBody";
import {
  drillEntries,
  historyShortcut,
  isTypingTarget,
  paletteEntries,
  rackEntries,
  tableCentre,
} from "./ToolbarModel";
import type { DrillEntry } from "./ToolbarModel";
import "./Toolbar.css";

export interface ToolbarViewProps {
  scene: Scene | undefined;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAddBall: (kind: BallKind) => void;
  onRemoveSelected: () => void;
  onClear: () => void;
  onRack: (rack: RackKind) => void;
  onDrill: (drillId: string) => void;
}

/** Choosing a practice drill: its description is shown before it replaces the balls. */
function DrillPicker({
  drills,
  onDrill,
}: {
  drills: readonly DrillEntry[];
  onDrill: (drillId: string) => void;
}) {
  const id = useId();
  const [chosen, setChosen] = useState("");
  // The list changes with the table; a drill that is no longer offered is not kept.
  const drill = drills.find((d) => d.id === chosen);
  if (drills.length === 0) return null;
  return (
    <div className="toolbar-group">
      <h2 id={`${id}-title`}>Drills</h2>
      <div className="toolbar-row">
        <select
          aria-labelledby={`${id}-title`}
          aria-describedby={drill ? `${id}-about` : undefined}
          value={drill ? drill.id : ""}
          onChange={(e) => {
            setChosen(e.target.value);
          }}
        >
          <option value="">Choose a drill</option>
          {drills.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!drill}
          onClick={() => {
            if (drill) onDrill(drill.id);
          }}
        >
          Put on the table
        </button>
      </div>
      {drill ? (
        <p id={`${id}-about`} className="toolbar-note">
          {drill.description} Replaces the balls on the table; Undo brings them back.
        </p>
      ) : null}
    </div>
  );
}

/** The toolbar's markup; `Toolbar` connects it to the store. */
export function ToolbarView(props: ToolbarViewProps) {
  const { scene } = props;
  return (
    <div className="toolbar-panel">
      <div className="toolbar-row" role="group" aria-label="History">
        <button type="button" onClick={props.onUndo} disabled={!props.canUndo}>
          Undo
        </button>
        <button type="button" onClick={props.onRedo} disabled={!props.canRedo}>
          Redo
        </button>
      </div>
      {scene ? (
        <>
          <div className="toolbar-group">
            <h2>Add a ball</h2>
            <div className="toolbar-palette" role="group" aria-label="Ball palette">
              {paletteEntries(scene).map((entry) => (
                <button
                  key={entry.kind}
                  type="button"
                  aria-label={`Add ${entry.name}`}
                  title={entry.remaining > 0 ? `Add ${entry.name}` : `No more ${entry.name}s`}
                  disabled={entry.remaining === 0}
                  data-kind={entry.kind}
                  onClick={() => {
                    props.onAddBall(entry.kind);
                  }}
                >
                  <svg className="toolbar-swatch" viewBox="-1 -1 2 2" aria-hidden="true">
                    <BallBody kind={entry.kind} r={0.95} />
                  </svg>
                </button>
              ))}
            </div>
          </div>
          <div className="toolbar-group">
            <h2>Balls</h2>
            <div className="toolbar-row">
              <button type="button" onClick={props.onRemoveSelected} disabled={!props.hasSelection}>
                Remove ball
              </button>
              <button type="button" onClick={props.onClear} disabled={scene.balls.length === 0}>
                Clear table
              </button>
            </div>
          </div>
          <div className="toolbar-group">
            <h2>Racks</h2>
            <div className="toolbar-row">
              {rackEntries(scene).map((entry) => (
                <button
                  key={entry.rack}
                  type="button"
                  disabled={!entry.fits}
                  title={entry.reason}
                  onClick={() => {
                    props.onRack(entry.rack);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>
          <DrillPicker drills={drillEntries(scene)} onDrill={props.onDrill} />
        </>
      ) : null}
    </div>
  );
}

/** Undo and redo, the ball palette, removing and clearing balls, and racks. */
export function Toolbar() {
  const doc = useDoc();
  const scene = simulationFor(doc).scene;
  const history = useEditor((s) => s.history);
  const selectedBallId = useEditor((s) => s.selectedBallId);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target as { tagName?: string; isContentEditable?: boolean } | null)) {
        return;
      }
      const action = historyShortcut(e);
      if (!action) return;
      e.preventDefault();
      (action === "undo" ? undo : redo)();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [undo, redo]);

  return (
    <ToolbarView
      scene={scene}
      canUndo={canUndo(history)}
      canRedo={canRedo(history)}
      hasSelection={selectedBallId !== undefined}
      onUndo={undo}
      onRedo={redo}
      onAddBall={(kind) => {
        if (!scene) return;
        const state = useEditor.getState();
        const id = nextBallId(state.history.present.balls);
        state.addBall(kind, tableCentre(scene));
        // The new ball is selected, if it was added (the set may have had none left).
        if (useEditor.getState().history.present.balls.some((b) => b.id === id)) {
          useEditor.getState().select(id);
        }
      }}
      onRemoveSelected={() => {
        const id = useEditor.getState().selectedBallId;
        if (id !== undefined) useEditor.getState().removeBall(id);
      }}
      onClear={() => {
        useEditor.getState().clearBalls();
      }}
      onRack={(rack) => {
        if (!scene) return;
        useEditor.getState().loadLayout(rackLayout(scene.table, scene.ballSet, rack), {
          source: "rack",
          mode: "replace",
        });
      }}
      onDrill={(drillId) => {
        if (!scene) return;
        const layout = drillLayout(scene.table, scene.ballSet, drillId);
        if (!layout) return;
        useEditor.getState().loadLayout(layout, { source: "template", mode: "replace" });
      }}
    />
  );
}

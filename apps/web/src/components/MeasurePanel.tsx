import type { Annotation } from "../doc/types";
import { distance } from "../geometry/aim";
import { useDoc, useEditor } from "../store/store";
import { formatDistance } from "../units/units";
import type { UnitSystem } from "../units/units";
import { useUnitSystem } from "../units/usePreference";
import "./MeasureLayer.css";

export interface MeasurePanelViewProps {
  measuring: boolean;
  annotations: readonly Annotation[];
  units: UnitSystem;
  onToggle: () => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

/** The measuring tool's switch and the list of measurements. */
export function MeasurePanelView({
  measuring,
  annotations,
  units,
  onToggle,
  onRemove,
  onClear,
}: MeasurePanelViewProps) {
  return (
    <section className="measure-panel">
      <h2>Measure</h2>
      <div className="measure-row">
        <button type="button" aria-pressed={measuring} onClick={onToggle}>
          {measuring ? "Measuring: drag on the table" : "Measure a distance"}
        </button>
        {annotations.length > 1 ? (
          <button type="button" onClick={onClear}>
            Remove all
          </button>
        ) : null}
      </div>
      {measuring ? (
        <p className="shot-hint">
          Ends dropped on a ball snap to its centre. Press the button again to go back to moving
          balls and aiming.
        </p>
      ) : null}
      {annotations.length > 0 ? (
        <ul>
          {annotations.map((a, i) => (
            <li key={a.id}>
              <span>
                Line {i + 1}: {formatDistance(distance(a.from, a.to), units)}
              </span>
              <button
                type="button"
                aria-label={`Remove line ${String(i + 1)}`}
                onClick={() => {
                  onRemove(a.id);
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function MeasurePanel() {
  const doc = useDoc();
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const removeAnnotation = useEditor((s) => s.removeAnnotation);
  const clearAnnotations = useEditor((s) => s.clearAnnotations);
  const [units] = useUnitSystem();
  return (
    <MeasurePanelView
      measuring={tool === "measure"}
      annotations={doc.annotations}
      units={units}
      onToggle={() => {
        setTool(tool === "measure" ? "select" : "measure");
      }}
      onRemove={removeAnnotation}
      onClear={clearAnnotations}
    />
  );
}

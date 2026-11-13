import { useId, useState } from "react";
import type { Scene } from "../doc/resolve";
import type { SimOutcome } from "../sim/simulator";
import {
  TUNING_FIELDS,
  acceptTuning,
  isTuned,
  useTuning,
  useTuningStore,
  withTuning,
} from "../sim/tuning";
import type { Tuning, TuningField } from "../sim/tuning";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import "./DebugPanel.css";

/** A number without trailing noise, short enough for an input. */
export function formatTuning(value: number): string {
  return String(Number(value.toPrecision(6)));
}

interface FieldRowProps {
  field: TuningField;
  value: number;
  standard: number;
  onChange: (value: number) => void;
}

function FieldRow({ field, value, standard, onChange }: FieldRowProps) {
  const id = useId();
  // What the person has typed; kept while it is not yet a usable number.
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const draftBad =
    draft !== undefined &&
    (draft.trim() === "" || acceptTuning(field, Number(draft)) === undefined);
  // The typed text is shown while it is unfinished or still says what the value is; once the
  // value has been changed from elsewhere (the reset button), the value is shown again.
  const useDraft = draft !== undefined && (draftBad || Number(draft) === value);
  const shown = useDraft ? draft : formatTuning(value);
  const invalid = useDraft && draftBad;
  const changed = value !== standard;
  return (
    <div className="debug-field">
      <label htmlFor={id}>{field.label}</label>
      <input
        id={id}
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={field.step}
        value={shown}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        className={changed ? "debug-changed" : undefined}
        onChange={(e) => {
          const text = e.target.value;
          // The typed text stays as it is until the field is left, so that "0." on the way
          // to "0.5" is not rewritten under the person's fingers.
          setDraft(text);
          const accepted = text.trim() === "" ? undefined : acceptTuning(field, Number(text));
          if (accepted !== undefined) onChange(accepted);
        }}
        onBlur={() => {
          setDraft(undefined);
        }}
      />
      <p id={`${id}-hint`} className="debug-hint">
        {field.hint} Standard: {formatTuning(standard)}.
        {invalid ? ` Enter a number from ${String(field.min)} to ${String(field.max)}.` : ""}
      </p>
    </div>
  );
}

export interface DebugPanelViewProps {
  scene: Scene;
  tuning: Tuning;
  outcome: SimOutcome;
  onChange: (tuning: Tuning) => void;
  onReset: () => void;
}

/** Physics numbers that can be tried out live. Nothing here is saved with the diagram. */
export function DebugPanelView({ scene, tuning, outcome, onChange, onReset }: DebugPanelViewProps) {
  const tuned = isTuned(tuning);
  const result = outcome.result;
  return (
    <details className="debug-panel">
      <summary>Physics numbers{tuned ? " (changed)" : ""}</summary>
      <p className="debug-note">
        For trying things out. Changes here are not saved in the link or the undo history and are
        gone when the page is reloaded. Cloth friction is under Setup.
      </p>
      {tuned ? (
        <p className="debug-warning" role="status">
          Paths are drawn with changed numbers. Someone opening your link will see the standard
          ones.
        </p>
      ) : null}
      {TUNING_FIELDS.map((field) => {
        const standard = field.standard(scene);
        return (
          <FieldRow
            key={field.key}
            field={field}
            value={tuning[field.key] ?? standard}
            standard={standard}
            onChange={(value) => {
              onChange(withTuning(tuning, field, value, scene));
            }}
          />
        );
      })}
      <button type="button" disabled={!tuned} onClick={onReset}>
        Back to standard numbers
      </button>
      <p className="debug-stats">
        {result
          ? `Last shot: ${String(result.stats.eventCount)} steps, ${result.durationS.toFixed(1)} s on the table, computed in ${outcome.ms.toFixed(1)} ms${result.status === "complete" ? "" : " (stopped early)"}.`
          : "No shot to simulate."}
      </p>
    </details>
  );
}

export function DebugPanel() {
  const doc = useDoc();
  const tuning = useTuning();
  const setTuning = useTuningStore((s) => s.setTuning);
  const reset = useTuningStore((s) => s.reset);
  const simulation = simulationFor(doc, tuning);
  if (!simulation.scene) return null;
  return (
    <DebugPanelView
      scene={simulation.scene}
      tuning={tuning}
      outcome={simulation.outcome}
      onChange={setTuning}
      onReset={reset}
    />
  );
}

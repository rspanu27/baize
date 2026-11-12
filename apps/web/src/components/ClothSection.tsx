import { useEffect, useId, useRef, useState } from "react";
import { CLOTH_COLOURS, CLOTH_SPEEDS } from "@baize/tables";
import type { ClothSpec, ClothSpeed } from "@baize/tables";
import {
  napLevelOf,
  parseCoefficient,
  sameColour,
  withCoefficient,
  withColour,
  withNap,
  withSpeed,
} from "../setup/cloth";
import type { CoefficientKey, NapLevel } from "../setup/cloth";
import { useEditor } from "../store/store";

const SPEEDS: readonly { value: ClothSpeed; label: string }[] = [
  { value: "slow", label: "Slow" },
  { value: "medium", label: "Medium" },
  { value: "fast", label: "Fast" },
];

const COEFFICIENTS: readonly { key: CoefficientKey; label: string }[] = [
  { key: "slidingFriction", label: "Sliding friction" },
  { key: "rollingResistance", label: "Rolling resistance" },
  { key: "spinningFriction", label: "Spinning friction" },
];

const NAPS: readonly { value: NapLevel; label: string }[] = [
  { value: "none", label: "None" },
  { value: "light", label: "Light" },
  { value: "heavy", label: "Heavy" },
];

const COEFFICIENT_MESSAGE = "Enter a number greater than zero, such as 0.2.";

function ColourPicker({ cloth }: { cloth: ClothSpec }) {
  const setCloth = useEditor((s) => s.setCloth);
  const endGesture = useEditor((s) => s.endGesture);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  // The native `change` event (picker closed) ends the drag, so one pick is one undo step.
  // React's onChange fires on every `input` event, which is the live part.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const done = () => {
      endGesture();
    };
    el.addEventListener("change", done);
    return () => {
      el.removeEventListener("change", done);
    };
  }, [endGesture]);

  return (
    <div className="setup-field">
      <span id={`${id}-label`} className="setup-label">
        Colour
      </span>
      <div className="setup-swatches" role="group" aria-labelledby={`${id}-label`}>
        {CLOTH_COLOURS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="setup-swatch"
            style={{ background: c.hex }}
            aria-label={c.name}
            title={c.name}
            aria-pressed={sameColour(cloth.colour, c.hex)}
            onClick={() => {
              setCloth(withColour(cloth, c.hex));
            }}
          />
        ))}
        <input
          ref={inputRef}
          type="color"
          className="setup-colour-input"
          aria-label="Custom colour"
          value={cloth.colour}
          onChange={(e) => {
            setCloth(withColour(cloth, e.target.value), "live");
          }}
          onBlur={endGesture}
        />
      </div>
    </div>
  );
}

function CoefficientInput({
  cloth,
  field,
}: {
  cloth: ClothSpec;
  field: (typeof COEFFICIENTS)[number];
}) {
  const setCloth = useEditor((s) => s.setCloth);
  const id = useId();
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const text = draft ?? String(cloth[field.key]);
  const bad = draft !== undefined && parseCoefficient(draft) === undefined;

  const commit = () => {
    if (draft === undefined) return;
    const value = parseCoefficient(draft);
    if (value === undefined) return; // keep the text and the message
    const next = withCoefficient(cloth, field.key, value);
    if (next && value !== cloth[field.key]) setCloth(next);
    setDraft(undefined);
  };

  return (
    <div className="setup-field">
      <label htmlFor={id}>{field.label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={text}
        aria-invalid={bad}
        aria-describedby={bad ? `${id}-msg` : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      {bad && (
        <p id={`${id}-msg`} className="setup-msg setup-error" role="alert">
          {COEFFICIENT_MESSAGE}
        </p>
      )}
    </div>
  );
}

/** Cloth colour, speed, friction numbers and nap. */
export function ClothSection({ cloth }: { cloth: ClothSpec }) {
  const setCloth = useEditor((s) => s.setCloth);
  const napId = useId();
  return (
    <fieldset className="setup-group">
      <legend>Cloth</legend>
      <ColourPicker cloth={cloth} />
      <div className="setup-field">
        <span className="setup-label" id={`${napId}-speed`}>
          Speed
        </span>
        <div className="setup-segmented" role="group" aria-labelledby={`${napId}-speed`}>
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              type="button"
              aria-pressed={cloth.speedPreset === s.value}
              title={`Sliding ${String(CLOTH_SPEEDS[s.value].slidingFriction)}, rolling ${String(CLOTH_SPEEDS[s.value].rollingResistance)}`}
              onClick={() => {
                setCloth(withSpeed(cloth, s.value));
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <details className="setup-advanced">
        <summary>Advanced</summary>
        {COEFFICIENTS.map((f) => (
          <CoefficientInput key={f.key} cloth={cloth} field={f} />
        ))}
      </details>
      <div className="setup-field">
        <label htmlFor={`${napId}-nap`}>Nap</label>
        <select
          id={`${napId}-nap`}
          value={napLevelOf(cloth)}
          onChange={(e) => {
            setCloth(withNap(cloth, e.target.value as NapLevel));
          }}
        >
          {NAPS.map((n) => (
            <option key={n.value} value={n.value}>
              {n.label}
            </option>
          ))}
        </select>
        <p className="setup-note">Nap is saved with the diagram but does not affect paths yet.</p>
      </div>
    </fieldset>
  );
}

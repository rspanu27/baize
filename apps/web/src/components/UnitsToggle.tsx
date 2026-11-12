import type { UnitSystem } from "../units/units";

const OPTIONS: readonly { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric" },
  { value: "imperial", label: "Imperial" },
];

interface Props {
  value: UnitSystem;
  onChange: (system: UnitSystem) => void;
}

/** Metric / Imperial. Changes how lengths are shown, never the document. */
export function UnitsToggle({ value, onChange }: Props) {
  return (
    <div className="setup-segmented" role="group" aria-label="Units">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => {
            if (value !== o.value) onChange(o.value);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

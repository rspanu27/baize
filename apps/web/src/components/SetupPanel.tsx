import { TABLE_PRESETS, getTablePreset } from "@baize/tables";
import { useDoc, useEditor } from "../store/store";

/** Placeholder: a table preset picker. Task 2.9 replaces this with the full setup panel. */
export function SetupPanel() {
  const doc = useDoc();
  const setTable = useEditor((s) => s.setTable);
  const current = "preset" in doc.table ? doc.table.preset : "custom";
  return (
    <section className="panel-section">
      <h2>Table</h2>
      <select
        aria-label="Table"
        value={current}
        onChange={(e) => {
          const preset = getTablePreset(e.target.value);
          if (preset) setTable({ preset: preset.id }, { preset: preset.defaultBallSetId });
        }}
      >
        {TABLE_PRESETS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </section>
  );
}

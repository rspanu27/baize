import type { TableSpec } from "../types";

/** All table presets. Every number carries a source comment. Filled in by task 1.2. */
export const TABLE_PRESETS: readonly TableSpec[] = [];

export function getTablePreset(id: string): TableSpec | undefined {
  return TABLE_PRESETS.find((t) => t.id === id);
}

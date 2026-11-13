import { SCHEMA_VERSION } from "./types";

/**
 * Upgrades the compact payload of an older link to the current format, one version at a time.
 *
 * Adding a schema version means: bump SCHEMA_VERSION, change the encoder and decoder in
 * `codec.ts`, and add ONE function here under the key of the old version that turns its
 * payload into the next version's. Old links then keep opening.
 */

export type MigrationResult = { ok: true; compact: unknown } | { ok: false; problem: string };

/** `MIGRATIONS[n]` upgrades a version n payload to version n + 1. */
export type MigrationTable = Readonly<Record<number, (compact: unknown) => unknown>>;

/**
 * 1 -> 2: version 2 added optional style fields (theme, path line and weight, ball labels,
 * caption) under `y`. A version 1 payload has none of them and is already a valid version 2
 * payload, so it passes through unchanged and is drawn with the defaults, as it always was.
 */
export const MIGRATIONS: MigrationTable = {
  1: (compact) => compact,
};

const NEWER = "This link was made by a newer version of Baize.";
const UNKNOWN = "This link was made by a version of Baize that is not recognised.";

/** The migration loop, with the table and the target version as parameters so it can be tested. */
export function runMigrations(
  table: MigrationTable,
  target: number,
  version: number,
  compact: unknown,
): MigrationResult {
  if (!Number.isInteger(version) || version < 1) return { ok: false, problem: UNKNOWN };
  if (version > target) return { ok: false, problem: NEWER };
  let current = compact;
  for (let v = version; v < target; v++) {
    const step = table[v];
    if (!step) return { ok: false, problem: UNKNOWN };
    try {
      current = step(current);
    } catch {
      return { ok: false, problem: "This link is damaged or was cut short." };
    }
  }
  return { ok: true, compact: current };
}

/** Brings a compact payload of the given version up to the current schema version. */
export function migrate(version: number, compact: unknown): MigrationResult {
  return runMigrations(MIGRATIONS, SCHEMA_VERSION, version, compact);
}

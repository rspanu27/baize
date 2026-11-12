import { useSyncExternalStore } from "react";
import { defaultUnitSystem } from "./units";
import type { UnitSystem } from "./units";

/** Display units are a per-browser preference, never part of the document. */

export const UNITS_STORAGE_KEY = "baize.units";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored choice if there is a valid one, otherwise the locale's default. Never throws. */
export function loadUnitPreference(storage: StorageLike | undefined, locale?: string): UnitSystem {
  try {
    const stored = storage?.getItem(UNITS_STORAGE_KEY);
    if (stored === "metric" || stored === "imperial") return stored;
  } catch {
    // Storage blocked: use the default.
  }
  return defaultUnitSystem(locale);
}

/** Stores the choice; returns false (and does nothing else) if storage is unavailable. */
export function saveUnitPreference(storage: StorageLike | undefined, system: UnitSystem): boolean {
  try {
    if (!storage) return false;
    storage.setItem(UNITS_STORAGE_KEY, system);
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): StorageLike | undefined {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage;
  } catch {
    return undefined;
  }
}

// In-memory copy: the source of truth for this page, so a failing storage still works.
let current: UnitSystem | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): UnitSystem {
  current ??= loadUnitPreference(browserStorage());
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setUnitSystem(system: UnitSystem): void {
  current = system;
  saveUnitPreference(browserStorage(), system);
  for (const l of listeners) l();
}

/** The display unit system, and a setter that remembers the choice. */
export function useUnitSystem(): [UnitSystem, (system: UnitSystem) => void] {
  const system = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [system, setUnitSystem];
}

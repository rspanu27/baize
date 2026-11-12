import { describe, expect, test } from "vitest";
import { UNITS_STORAGE_KEY, loadUnitPreference, saveUnitPreference } from "../units/usePreference";
import type { StorageLike } from "../units/usePreference";

function memory(initial?: string): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(UNITS_STORAGE_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
  };
}

const broken: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("unit preference", () => {
  test("defaults from the locale", () => {
    expect(loadUnitPreference(memory(), "en-US")).toBe("imperial");
    expect(loadUnitPreference(memory(), "en-GB")).toBe("metric");
    expect(loadUnitPreference(undefined, "en-US")).toBe("imperial");
  });

  test("a stored value wins over the locale", () => {
    expect(loadUnitPreference(memory("metric"), "en-US")).toBe("metric");
    expect(loadUnitPreference(memory("imperial"), "en-GB")).toBe("imperial");
  });

  test("an invalid stored value is ignored", () => {
    expect(loadUnitPreference(memory("furlongs"), "en-GB")).toBe("metric");
  });

  test("storage failure falls back without throwing", () => {
    expect(loadUnitPreference(broken, "en-US")).toBe("imperial");
    expect(saveUnitPreference(broken, "metric")).toBe(false);
    expect(saveUnitPreference(undefined, "metric")).toBe(false);
  });

  test("save then load round trips", () => {
    const s = memory();
    expect(saveUnitPreference(s, "imperial")).toBe(true);
    expect(loadUnitPreference(s, "en-GB")).toBe("imperial");
  });
});

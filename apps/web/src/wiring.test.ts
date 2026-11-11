import { expect, test } from "vitest";
import { wiringSummary } from "./wiring";

test("workspace packages are wired in", () => {
  expect(wiringSummary()).toBe("baize-physics + baize-tables");
});

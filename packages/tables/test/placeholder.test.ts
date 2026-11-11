import { expect, test } from "vitest";
import { TABLES_PLACEHOLDER } from "../src/index";

test("exports the placeholder", () => {
  expect(TABLES_PLACEHOLDER).toBe("baize-tables");
});

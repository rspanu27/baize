import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("physics has no runtime dependencies", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    expect(pkg[field], field).toBeUndefined();
  }
});

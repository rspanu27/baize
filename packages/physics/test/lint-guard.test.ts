import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });
const filePath = "packages/physics/src/__guard__.ts";

async function errors(source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}

describe("physics lint guard", () => {
  const banned: [string, string][] = [
    ["Math.random()", "export const a = Math.random();\n"],
    ["Math.sin", "export const a = Math.sin(1);\n"],
    ["Math.hypot", "export const a = Math.hypot(3, 4);\n"],
    ["destructured Math.cos", "const { cos } = Math;\nexport const a = cos(1);\n"],
    ["Date.now()", "export const a = Date.now();\n"],
    ["new Date", "export const a = new Date();\n"],
    ["performance.now()", "export const a = performance.now();\n"],
    ["** operator", "export const a = 2 ** 3;\n"],
    ["bare package import", 'import { x } from "@baize/tables";\nexport const a = x;\n'],
    ["node: import", 'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n'],
  ];

  test.each(banned)("rejects %s", async (_name, source) => {
    expect((await errors(source)).length).toBeGreaterThan(0);
  });

  test("allows Math.sqrt and relative imports", async () => {
    const source =
      'import { y } from "./other.js";\nexport const a = Math.sqrt(y) + Math.abs(y);\n';
    const messages = await errors(source);
    // Unresolved relative file is not a lint concern; no guard errors expected.
    expect(messages).toEqual([]);
  });

  test("guard does not apply outside physics src", async () => {
    const [result] = await eslint.lintText("export const a = Math.random();\n", {
      filePath: "packages/physics/test/__guard__.ts",
    });
    expect(result?.messages.filter((m) => m.severity === 2)).toEqual([]);
  });
});

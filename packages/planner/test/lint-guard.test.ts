import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

/**
 * The planner must give the same route on every machine, so its source follows the physics'
 * determinism rules. This proves the lint rules that enforce them on `packages/planner/src`.
 */

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });
const filePath = "packages/planner/src/__guard__.ts";

async function errors(source: string, path = filePath): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}

describe("planner lint guard", () => {
  const banned: [string, string][] = [
    ["Math.random", "export const a = Math.random();\n"],
    ["Date.now", "export const a = Date.now();\n"],
    ["new Date", "export const a = new Date();\n"],
    ["performance.now", "export const a = performance.now();\n"],
    ["Math.atan2", "export const a = Math.atan2(1, 2);\n"],
    ["Math.exp", "export const a = Math.exp(1);\n"],
    ["Math.cos", "export const a = Math.cos(1);\n"],
    ["**", "export const a = 2 ** 3;\n"],
    ["computed Math access", 'export const a = Math["random"]();\n'],
    ["destructured Math.sin", "const { sin } = Math;\nexport const a = sin(1);\n"],
    [
      "a package other than physics and tables",
      'import { x } from "react";\nexport const a = x;\n',
    ],
    ["node: import", 'import { writeFileSync } from "node:fs";\nexport const a = writeFileSync;\n'],
    ["require", 'export const a = require("node:fs");\n'],
    ["fetch", 'export const a = fetch("/x");\n'],
    ["localStorage", 'export const a = localStorage.getItem("x");\n'],
  ];

  test.each(banned)("rejects %s", async (_name, source) => {
    expect((await errors(source)).length).toBeGreaterThan(0);
  });

  test("allows physics, tables, relative imports and exact maths", async () => {
    const source =
      'import { simulate } from "@baize/physics";\nimport type { TableSpec } from "@baize/tables";\nimport { y } from "./other";\nexport const a = simulate;\nexport type T = TableSpec;\nexport const b = Math.sqrt(y) + Math.abs(-1);\n';
    expect(await errors(source)).toEqual([]);
  });

  test("the guard does not apply to tests", async () => {
    const messages = await errors(
      "export const a = Math.random() + Math.atan2(1, 1);\n",
      "packages/planner/test/__guard__.ts",
    );
    expect(messages).toEqual([]);
  });
});

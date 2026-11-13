import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

/**
 * Photos must be processed in the browser only and never uploaded or stored. This proves the
 * lint rules that keep `packages/vision/src` from reaching the network, storage or the page.
 */

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });
const filePath = "packages/vision/src/__guard__.ts";

async function errors(source: string, path = filePath): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath: path });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}

describe("vision lint guard", () => {
  const banned: [string, string][] = [
    ["fetch", 'export const a = fetch("https://example.test/upload");\n'],
    ["XMLHttpRequest", "export const a = new XMLHttpRequest();\n"],
    ["WebSocket", 'export const a = new WebSocket("wss://example.test");\n'],
    ["navigator.sendBeacon", 'export const a = navigator.sendBeacon("/x");\n'],
    ["localStorage", 'export const a = localStorage.getItem("photo");\n'],
    ["sessionStorage", "export const a = sessionStorage.length;\n"],
    ["indexedDB", 'export const a = indexedDB.open("photos");\n'],
    ["caches", 'export const a = caches.open("photos");\n'],
    ["globalThis.fetch", 'export const a = globalThis.fetch("/x");\n'],
    ["self.indexedDB", "export const a = self.indexedDB;\n"],
    ["document", "export const a = document.cookie;\n"],
    [
      "a package other than tables",
      'import { simulate } from "@baize/physics";\nexport const a = simulate;\n',
    ],
    ["node: import", 'import { writeFileSync } from "node:fs";\nexport const a = writeFileSync;\n'],
    ["dynamic import of a package", 'export const a = import("onnxruntime-web");\n'],
  ];

  test.each(banned)("rejects %s", async (_name, source) => {
    expect((await errors(source)).length).toBeGreaterThan(0);
  });

  test("allows relative imports, @baize/tables and plain maths", async () => {
    const source =
      'import type { Layout } from "@baize/tables";\nimport { y } from "./other.js";\nexport const a: Layout = { balls: [] };\nexport const b = Math.atan2(y, 1);\n';
    expect(await errors(source)).toEqual([]);
  });

  test("the guard does not apply to tests", async () => {
    const messages = await errors(
      'import { readFileSync } from "node:fs";\nexport const a = readFileSync;\n',
      "packages/vision/test/__guard__.ts",
    );
    expect(messages).toEqual([]);
  });
});

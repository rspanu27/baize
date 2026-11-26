import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";
import { describe, expect, test } from "vitest";

/**
 * The lint rules that guard the video screen (Phase 7 review findings 10 and 12): Mediabunny
 * (MPL-2.0) is reached only through `src/video/media.ts`, however it is imported, and the video
 * screen never touches browser storage, so a clip is never kept.
 */

const eslint = new ESLint({ cwd: fileURLToPath(new URL("../../..", import.meta.url)) });

async function errors(source: string, filePath: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? []).filter((m) => m.severity === 2).map((m) => m.message);
}

describe("Mediabunny only through media.ts", () => {
  const imports: [string, string][] = [
    ["a static import", 'import { Input } from "mediabunny";\nexport const a = Input;\n'],
    [
      "a file inside it",
      'import { Input } from "mediabunny/dist/modules/src/index.js";\nexport const a = Input;\n',
    ],
    ["a dynamic import", 'export const a = import("mediabunny");\n'],
    ["a dynamic import of a file inside it", 'export const a = import("mediabunny/dist/x.js");\n'],
    ["a dynamic import with a template", "export const a = import(`mediabunny`);\n"],
  ];

  test.each(imports)("rejects %s elsewhere in the app", async (_name, source) => {
    for (const path of [
      "apps/web/src/video/__guard__.ts",
      "apps/web/src/components/__guard__.tsx",
    ]) {
      expect((await errors(source, path)).join("\n")).toMatch(/media\.ts/);
    }
  });

  test.each(imports)("allows %s in media.ts", async (_name, source) => {
    expect(await errors(source, "apps/web/src/video/media.ts")).toEqual([]);
  });
});

describe("the video screen stores nothing", () => {
  const banned: [string, string][] = [
    ["indexedDB", 'export const a = indexedDB.open("clips");\n'],
    ["window.indexedDB", 'export const a = window.indexedDB.open("clips");\n'],
    ["caches", 'export const a = caches.open("clips");\n'],
    ["self.caches", 'export const a = self.caches.open("clips");\n'],
    ["localStorage", 'export const a = localStorage.setItem("clip", "x");\n'],
    ["globalThis.localStorage", 'export const a = globalThis.localStorage.getItem("clip");\n'],
    ["sessionStorage", "export const a = sessionStorage.length;\n"],
    ["navigator.storage", "export const a = navigator.storage.getDirectory();\n"],
    ["window.navigator.storage", "export const a = window.navigator.storage.persist();\n"],
  ];

  test.each(banned)("rejects %s", async (_name, source) => {
    expect((await errors(source, "apps/web/src/video/__guard__.ts")).length).toBeGreaterThan(0);
    expect(
      (await errors(source, "apps/web/src/video/overlay/__guard__.tsx")).length,
    ).toBeGreaterThan(0);
  });

  test("the rest of the editor may keep its preferences", async () => {
    const source = 'export const a = localStorage.getItem("units");\n';
    expect(await errors(source, "apps/web/src/units/__guard__.ts")).toEqual([]);
  });

  test("the video screen may still use the page and its own memory", async () => {
    const source =
      'export const a = document.createElement("canvas");\nexport const b = new Map<string, number>();\nexport const c = navigator.userAgent;\n';
    expect(await errors(source, "apps/web/src/video/__guard__.ts")).toEqual([]);
  });
});

// Checks the production build for Mediabunny's MPL-2.0 conditions (Phase 7 review finding 11).
// Run after `pnpm --filter web build`: node apps/web/scripts/check-build.mjs
//
// - Mediabunny is in a chunk of its own (dist/assets/mediabunny-*.js) that keeps its licence
//   header (the Mozilla Public License and its copyright holder, Vanilagy);
// - the notices file is served with the site (dist/third-party-notices.txt);
// - the editor's main chunk (index-*.js) carries none of Mediabunny's code.
// Exits non-zero, saying what is wrong, otherwise.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const assets = `${dist}assets/`;
const problems = [];

if (!existsSync(assets)) {
  console.error(`No build at ${dist}. Run "pnpm --filter web build" first.`);
  process.exit(1);
}

const files = readdirSync(assets).filter((f) => f.endsWith(".js"));
const read = (f) => readFileSync(`${assets}${f}`, "utf8");

const chunks = files.filter((f) => /^mediabunny-[\w-]+\.js$/.test(f));
if (chunks.length === 0) {
  problems.push("no dist/assets/mediabunny-*.js chunk: Mediabunny is not in a chunk of its own");
}
// The header is a block comment, so its words may be split by a line break and a "*".
const HEADER = [
  ["Mozilla Public License", /Mozilla\s+(?:\*\s*)?Public\s+(?:\*\s*)?License/],
  ["Vanilagy", /Vanilagy/],
];
for (const chunk of chunks) {
  const code = read(chunk);
  for (const [name, pattern] of HEADER) {
    if (!pattern.test(code)) problems.push(`${chunk} lacks "${name}" (licence header lost)`);
  }
}

if (!existsSync(`${dist}third-party-notices.txt`)) {
  problems.push("dist/third-party-notices.txt is missing");
}

const mains = files.filter((f) => /^index-[\w-]+\.js$/.test(f));
if (mains.length === 0) problems.push("no dist/assets/index-*.js main chunk");
for (const main of mains) {
  if (read(main).includes("Vanilagy")) {
    problems.push(`${main} contains Mediabunny code: it must stay in its own chunk`);
  }
}

if (problems.length > 0) {
  console.error(`Build check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Build check passed: ${chunks.join(", ")} keeps the MPL-2.0 header, the notices are served, and ${mains.join(", ")} has no Mediabunny code.`,
);

// Decodes a folder of JPEG or PNG pictures to raw pixels, for the real-photo evaluation in
// packages/vision (see its README). It uses the Chromium that Playwright installs for the
// end-to-end tests, so that the project needs no image decoder of its own. Nothing is sent
// anywhere: the browser is given each picture as a data URL and never opens a network page.
//
//   node apps/web/scripts/decode-photos.mjs <folder of pictures> <output folder>
//
// Each picture becomes <name>.rgba.gz: gzip of 4 bytes width, 4 bytes height (little endian),
// then RGBA rows from the top. The output folder must be outside the repository.
/* global createImageBitmap, document -- used inside the browser page, not in Node */
import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { gzipSync } from "node:zlib";

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: decode-photos.mjs <folder of pictures> <output folder>");
  process.exit(2);
}
mkdirSync(output, { recursive: true });
const types = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
const names = readdirSync(input)
  .filter((n) => extname(n).toLowerCase() in types)
  .sort();

const browser = await chromium.launch();
const page = await browser.newPage();
let done = 0;
for (const name of names) {
  const target = join(output, `${name}.rgba.gz`);
  if (existsSync(target)) continue;
  const type = types[extname(name).toLowerCase()];
  const b64 = readFileSync(join(input, name)).toString("base64");
  const result = await page.evaluate(
    async ({ data, mime }) => {
      const blob = await (await fetch(`data:${mime};base64,${data}`)).blob();
      const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const pixels = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < pixels.length; i += chunk) {
        binary += String.fromCharCode.apply(null, pixels.subarray(i, i + chunk));
      }
      return { width: bitmap.width, height: bitmap.height, data: btoa(binary) };
    },
    { data: b64, mime: type },
  );
  const head = Buffer.alloc(8);
  head.writeUInt32LE(result.width, 0);
  head.writeUInt32LE(result.height, 4);
  writeFileSync(
    target,
    gzipSync(Buffer.concat([head, Buffer.from(result.data, "base64")]), { level: 1 }),
  );
  done += 1;
}
await browser.close();
console.log(`${done} decoded, ${names.length - done} already there`);

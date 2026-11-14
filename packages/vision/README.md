# @baize/vision

Turns one photo of a table into a `Layout` of balls, entirely in the browser.

Rules of this package (enforced by lint, see `test/lint-guard.test.ts`):

- A photo is pixels in memory, passed in by the caller. Nothing here reads files, talks to the
  network, or stores anything: no `fetch`, no `XMLHttpRequest`, no `WebSocket`, no storage.
- The only package it may import is `@baize/tables`.

Units: image points are pixels, `u` to the right and `v` down from the top-left corner of the
photo. Table points are metres in the table's own coordinates (see `@baize/tables`): origin at
the baulk/head-end left corner of the playing area, `x` across, `y` along, `z` up from the cloth.

## Evaluation

`scorePhoto` and `summarise` (in `src/evaluate.ts`) turn found balls and true balls into the
figures the targets are stated in: share of balls found, share named, position error as a
share of the table length (median and 95th percentile), and false balls per photo.

`test/evaluation.test.ts` runs them on a fixed set of synthetic photos as part of the test
suite. Set `BAIZE_EVAL_REPORT=<file>` to have the figures written to a file.

### Labels for real photos

Real photos are not in this repository. When the project has them, each photo gets a label
file beside it with the same name and `.json`:

```json
{
  "schema": 1,
  "photo": "IMG_0123.jpg",
  "table": "pool-9@1",
  "ballSet": "pool-57@1",
  "balls": [
    { "kind": "cue", "x": 0.635, "y": 0.635 },
    { "kind": "8", "x": 0.635, "y": 1.905 }
  ],
  "corners": [
    [412, 2210],
    [3310, 2105],
    [2650, 640],
    [1180, 655]
  ],
  "notes": "evening, lamps on, taken from the baulk-left corner"
}
```

- `table` is a preset id, or the custom table's fields as the editor stores them.
- `balls` are the true positions in table coordinates, metres (see the units above). The
  cheapest way to know them is to put balls on spots and racks, or to measure from two
  cushions with a tape.
- `corners` is optional: the four corners of the playing area in photo pixels, in the order
  baulk left, baulk right, top right, top left. With it the ball finder can be scored apart
  from the table finder.

Running the evaluation on real photos needs a JPEG decoder for Node, which this package does
not have (it has no dependencies beyond `@baize/tables`); that runner is part of stage B.

### Real pictures with marked sights

`test/realSet.test.ts` measures the import on pictures of pool tables in which the balls
and the sights (diamonds) are marked in YOLO format, such as the public pix2pockets set
(see `docs/DATASETS.md`). The pictures are never put in the repository. The true camera,
and with it the true place of every ball, is worked out from the sights (`test/sights.ts`).

1. Decode the pictures once, to a folder outside the repository (this uses the browser
   installed for the end-to-end tests, so no image decoder is needed):

   ```
   node apps/web/scripts/decode-photos.mjs <folder of pictures> <folder for pixels>
   ```

2. Run the measurement:

   ```
   BAIZE_REAL_LABELS=<folder of label files> BAIZE_REAL_PIXELS=<folder for pixels> \
   BAIZE_EVAL_REPORT=<report file> pnpm --filter @baize/vision exec vitest run test/realSet.test.ts
   ```

Without those variables the test is skipped, so `pnpm check` and CI do not need the
pictures.

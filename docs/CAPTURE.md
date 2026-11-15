# Photographing and labelling tables (task 5.10)

What to photograph, and how to label the photos so that the photo import can be measured on
them and, later, a ball detector trained on them. Written 2026-11-15. The photos are yours:
they never go into this repository or onto the site.

## What to photograph

Aim for variety, because the public pictures we have are all broadcast frames of clean
tournament tables. The photos that help most are the ones nobody else has.

- **Tables:** pool (7, 8 and 9 ft), snooker and blackball if you can reach them; bar tables
  and home tables as well as club tables.
- **Cloths:** any colour; note faded, stained or patterned cloths.
- **Light:** club lighting, bar lamps with coloured light, daylight, a dim room, glare.
- **Where you stand:** at a corner and at the middle of an end, at standing height (as the
  editor's guidance says), and some lower or higher. A few with one corner just out of the
  photo, since the import now accepts that.
- **Balls:** spread layouts, clusters, balls frozen to cushions and near pockets, a rack, and
  an empty table. Balls of the cloth's own colour (a blue ball on a blue cloth) are the
  hardest and the most useful.
- **How many:** at least 100 photos across at least 5 different tables (the done-check of
  task 5.10). Twenty photos of one table teach less than five photos of each of four tables.

Take the photo with the phone's normal camera, not zoomed, without filters. Save it as
JPEG: an iPhone saves HEIC by default, which the tools here cannot read (Settings, Camera,
Formats, "Most Compatible"). Keep the original file (it holds the orientation).

## Labelling: pool tables with diamonds (preferred)

For a pool table with diamonds (sights), the true position of every ball can be worked out from
the diamonds, so nothing needs measuring. Mark them, and the balls, as boxes:

| Class (in this order) | What to box |
|---|---|
| `Black` | the 8 ball |
| `Cue` | the cue ball |
| `Dot` | each diamond on the rails that you can see, as a small box around it |
| `Solid` | balls 1 to 7 |
| `Striped` | balls 9 to 15 |

This is the class list of the public pix2pockets set, so its files and yours can be used
together. Keep the classes in exactly this order in the tool: the label files store each
class as its number (0 for `Black`, 2 for `Dot` and so on). If your tool numbers them
differently, give the order to the measurement with `BAIZE_REAL_CLASSES`, for example
`BAIZE_REAL_CLASSES=Cue,Black,Dot,Solid,Striped`. Export in **YOLO format** (one `.txt` per photo, each line
`class x_centre y_centre width height` as shares of the photo's width and height).

A free tool that runs in the browser: [makesense.ai](https://www.makesense.ai/) (it says the
photos stay on your computer; check this before you use it). Label Studio and CVAT also work
and can run on your own machine. Roboflow works too, but it uploads the photos to its
servers.

Tips:
- Box the whole ball, edge to edge; the measurement uses the middle of the box.
- Mark every diamond you can see, on all four rails. The truth needs at least two on each
  rail; ten or more in all.
- If a diamond is hidden by a hand or a ball, leave it out rather than guess.

## Labelling: other tables (snooker, blackball)

The measuring tool handles pool tables only for now: it picks the table size among the pool
presets and names balls by number.

The true positions have to be known another way. The cheapest is to place the balls
yourself: on their spots, in a rack, or at distances measured from two cushions with a tape.
Then write a small JSON file per photo in the format described in
`packages/vision/README.md` ("Labels for real photos"). There is no runner for that format
yet; it will come when there are photos for it.

## Measuring the import on your photos

1. Put the photos in one folder and their YOLO label files in another, **outside** this
   repository: for example `baize-data/mine/images` and `baize-data/mine/labels` in the
   folder that holds the repository (next to it, as the public set is now). The label file
   of `IMG_1234.JPG` is `IMG_1234.txt`.
2. Decode the photos once. From the repository's folder, `..` is the folder next to it; the
   script refuses an output folder inside the repository:

   ```
   node apps/web/scripts/decode-photos.mjs ../baize-data/mine/images ../baize-data/mine/pixels
   ```

3. Run the measurement. Give **full paths**: the test runs from `packages/vision`, so a
   relative path would point somewhere else.

   ```
   BAIZE_REAL_LABELS=/full/path/to/baize-data/mine/labels \
   BAIZE_REAL_PIXELS=/full/path/to/baize-data/mine/pixels \
   BAIZE_EVAL_REPORT=/full/path/to/baize-data/mine/report.txt \
   pnpm --filter @baize/vision exec vitest run test/realSet.test.ts
   ```

The report gives the share of balls found and named, the position error and the false balls,
with corners given and with nothing given, in the same terms as `docs/DATASETS.md`. A `.csv`
beside it has one line per photo. On PowerShell set the variables with `$env:NAME="..."`
first.

## Privacy

The photos and labels stay on your machine. Do not add them to this repository: keep them in
a folder outside it (the `baize-data` folder next to the repository is where the public set
lives now). The measuring tools read them from there and write only figures. As a second
guard, a `baize-data` folder inside the repository is ignored by git, and the decoding script
will not write into the repository.

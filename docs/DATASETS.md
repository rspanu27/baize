# Public photo datasets for the photo import

Survey of 2026-11-14, made to see whether public data can stand in for the project's own
labelled photos (task 5.10) while those are being collected. Every entry was opened and a
sample of its pictures looked at. Only pix2pockets has been downloaded, to a folder outside
the repository; no image from any of these sets is in the repository.

## Result in one paragraph

No public set matches what the photo import receives: one phone photo of a whole table,
taken by a player standing at it, in an ordinary room. What exists is of three kinds:
frames from television broadcasts, pictures from a fixed camera above one table, and
close-ups of balls. One set (pix2pockets) is useful for **testing** the import, because it
has whole tables from many angles and carries the diamonds of the table, which give the
true position of every ball. Two more are useful for **training the naming of balls**.
None removes the need for the project's own photos; they reduce how many are needed.

## The sets

| Set | Pictures | Labels | Licence shown | What the pictures are | Use here |
|---|---|---|---|---|---|
| [pix2pockets, "8-Ball Pool"](https://universe.roboflow.com/bachelorthesis/8-ball-pool-l530o) ([paper](https://arxiv.org/abs/2504.12045), [project page](https://pix2pockets.compute.dtu.dk/)) | 247 (195 in the paper, plus pictures of the same layouts from top, front and diagonal) | Boxes: Dot (diamond), Cue, Black, Solid, Striped | CC BY 4.0 | Frames from videos of professional 8-ball events; blue and green cloths, many camera angles, whole table in view | **Test set for geometry and for finding balls.** Naming only to the level cue / black / solid / striped |
| [Pool Doublecam](https://universe.roboflow.com/bachelorthesis/pool-doublecam) (same authors) | 52 | Same five classes | CC BY 4.0 | The same tables from two angles | Check that two views of one layout give one answer |
| [pool ball detection (Ben Gann)](https://universe.roboflow.com/ben-gann-lscqy/pool-ball-detection) | 986 | Boxes: 1 to 15, cue | CC BY 4.0 | Phone photos, but mostly close-ups: balls in trays and racks, a few on a table | **Training the naming of numbered balls** |
| [Pool Balls (Bastogne Billiards)](https://universe.roboflow.com/bastogne-billiards/pool-balls-uibmm) | 774 | Boxes: 1 to 15, cue | CC BY 4.0 | One ball at a time from above, one teal cloth, hard shadows | Naming of numbered balls; one table only, so limited |
| [Pool balls (dapeef)](https://universe.roboflow.com/dapeef/pool-balls-qko5z) | 441 | Boxes: 1 to 15, cue, red, yellow, rack | CC BY 4.0 | Fixed wide-angle camera above one green table | Blackball reds and yellows are labelled, which is rare; one camera only |
| [Pool Billiard](https://universe.roboflow.com/nidacorian-protonmail-com/pool-billiard) | 488 | Cue ball and numbered balls | CC BY 4.0 | Frames from one broadcast, one blue table, one camera | Little: one view |
| [Snooker Ball Detection](https://universe.roboflow.com/snooker-acvs8/snooker-ball-detection-rnhxo) | 2,416 | Boxes: the eight snooker colours | CC BY 4.0 | Frames from the standard television camera at one end of the table | Naming of snooker colours; one view only |
| [Snooker pocket and ball detection](https://universe.roboflow.com/nxera/snooker-pocket-and-ball-detection) | 6,589 | The eight colours and pockets | CC BY 4.0 | The same television view | As above, with pockets |
| [Pool Balls (Pool Tracking)](https://universe.roboflow.com/pool-tracking/pool-balls-rpx9d) | 69 | 1 to 9, cue | CC BY 4.0 | Not looked at | Too small |
| [Snooker Vision](https://universe.roboflow.com/morgan-lewis/snooker-vision) | 281 | Two classes named "0" and "1" | MIT | Not looked at | Labels not usable as they are |

Also found and not usable: a Kaggle "Sports Ball" set (pictures of balls for
classification, no positions), and several sets on Roboflow and Ultralytics with no
description. A Hugging Face set (`nhantu2107/pool-detection`, under 1,000 pictures) was not
opened.

## Cautions

- **Licence of the pictures.** Most of these are frames from broadcasts or online videos.
  The person who published a set can license their labels, but probably does not own the
  footage. For this project that means: use them to test and to train, never copy the
  pictures into the repository or the site, and say in the model's training record which
  sets were used. Attribution is required by CC BY 4.0 in any case.
- **Roboflow needs a free account** to download a set. The pix2pockets authors also keep a
  copy of their set as a zip file in their [code repository](https://github.com/viktorseba/pix2pockets),
  which has no licence file of its own.
- **Broadcast pictures are not phone pictures.** They are taken from higher up, with long
  lenses, under even studio light, on clean tournament tables. Results on them say little
  about a bar table under a coloured lamp. The project's own photos remain the real test.
- **No set gives ball positions on the table.** For pix2pockets they can be worked out from
  the labelled diamonds (the authors report 0.4 cm with their method), which is what makes
  it usable for measuring position error. For the others only "found or not" and "named
  right or not" can be measured.

## First measurement on pix2pockets (2026-11-14)

The set was downloaded to a folder outside the repository (the zip in the authors' code
repository, 41 MB) and the import as it stood at commit `6bc1a5c` was run on all 247
pictures with `packages/vision/test/realSet.test.ts`. The truth comes from the marked
sights (`packages/vision/test/sights.ts`): good to about a centimetre, balls known only as
cue, black, solid or striped. A truth was made for 231 pictures (median distance between a
sight and its mark 1.0 pixel); 16 were left out because a rail had too few sights in view
or the fit was doubtful.

|                                 | Target | Corners given | Nothing given, table right |
| ------------------------------- | ------ | ------------- | -------------------------- |
| Pictures                        |        | 231           | 140                        |
| Balls found                     | 95 %   | 82.6 %        | 78.6 %                     |
| Named (to the group)            | 90 %   | 85.0 %        | 84.3 %                     |
| Position error, median          | 0.6 %  | 0.20 %        | 0.70 %                     |
| Position error, 95th percentile | 1.5 %  | 0.96 %        | 1.82 %                     |
| False balls per picture         | 0      | 3.5           | 4.2                        |

- **Finding the table alone:** a table was reported in 213 of 231 pictures and was the
  right one (every corner within 3 % of the table length) in 140, which is 61 %. So in
  four pictures of ten the person would have to move the corners.
- **Position is good when the corners are right** (median 0.20 % of the table length, the
  target is 0.6 %), and three to four times worse with the corners the finder gives. The
  geometry is sound; the corner finder is the weak part of it.
- **False balls are the largest fault.** There are none in the 25 pictures taken from
  straight above and 3.5 to 4 per picture in every angled view, so they come from what an
  angled view shows beside the cloth: cushion faces, pockets, rails.
- **One ball in six is missed**, more on the small bar tables (76 % found on the 7 ft
  Valley size) where a ball is about 8 pixels across.
- Only 14 of 231 pictures came out with every ball found and none invented.

These figures are the base line for task 5.11. The time for all the pictures, both ways,
was 2.5 minutes.

## After the first round of fixes (2026-11-15)

The same 231 pictures, after the changes recorded in the decisions log in
`docs/ARCHITECTURE.md` (ball finder, then table finder).

|                                 | Target | Corners given, before | Corners given, now | Nothing given, before | Nothing given, now |
| ------------------------------- | ------ | --------------------- | ------------------ | --------------------- | ------------------ |
| Table found right               |        |                       |                    | 61 %                  | 78.4 %             |
| Balls found                     | 95 %   | 82.6 %                | 89.9 %             | 78.6 %                | 87.9 %             |
| Named (to the group)            | 90 %   | 85.0 %                | 81.9 %             | 84.3 %                | 84.4 %             |
| Position error, median          | 0.6 %  | 0.20 %                | 0.19 %             | 0.70 %                | 0.44 %             |
| Position error, 95th percentile | 1.5 %  | 0.96 %                | 0.94 %             | 1.82 %                | 1.70 %             |
| False balls per picture         | 0      | 3.5                   | 0.43               | 4.2                   | 0.95               |

"Nothing given" counts only the pictures where the table was found right (140 before, 181
now). The share named fell with corners given because more balls are found, and the ones
added are the hard ones (dark balls, balls on the far side); in number, more balls are
named right than before (1963 against 1872).

What is left:

- **Racks.** Most of the balls still missed are in racks, where balls hide each other.
- **Tables that are small in the picture.** 18 pictures get no table. 12 of them are wide
  shots in which the playing area covers under 5 % of the picture (three of those also
  touch its edge), which is refused on purpose. The other 6 (pictures 6, 7, 14a, 15, 15a
  and 181, 5.5 to 16 % of the picture) should have been found and were not.
- **Corners off by 3 to 13 % of the length** in about 30 pictures: the long sides are
  found but the ends are placed wrong, mostly in views from low along the table.
- On synthetic photos the 95th percentile of position error rose from 0.58 % to 0.80 %
  (0.09 points from the wider cushion band the renderer now draws, the rest from the new
  table finder); still inside the 1.5 % target.

## What this changes in the plan

- Task 5.11 (measure stage A on real photos) can start on pix2pockets before the project's
  own set exists.
- Task 5.10 (the project's own photos) can be smaller, and should concentrate on what no
  public set has: ordinary rooms, low phone angles, snooker and blackball tables from the
  player's side, coloured light, corners out of frame.
- Task 5.12 (training) has material for naming numbered pool balls and snooker colours.

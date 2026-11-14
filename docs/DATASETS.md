# Public photo datasets for the photo import

Survey of 2026-11-14, made to see whether public data can stand in for the project's own
labelled photos (task 5.10) while those are being collected. Every entry was opened and a
sample of its pictures looked at. Nothing here has been downloaded, and no image from any
of these sets is in the repository.

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

## What this changes in the plan

- Task 5.11 (measure stage A on real photos) can start on pix2pockets before the project's
  own set exists.
- Task 5.10 (the project's own photos) can be smaller, and should concentrate on what no
  public set has: ordinary rooms, low phone angles, snooker and blackball tables from the
  player's side, coloured light, corners out of frame.
- Task 5.12 (training) has material for naming numbered pool balls and snooker colours.

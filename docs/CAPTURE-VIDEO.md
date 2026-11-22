# Filming and labelling clips (task 7.3)

What to film, and how the clips will be labelled, so that the video overlays (SPEC section 11)
can be measured on them: is each moving ball tracked, are the start and end of each shot found,
is the shot's speed right. Written 2026-11-23. The clips are yours: they never go into this
repository or onto the site.

You can start filming now. The labelling step needs a frame-extraction script that comes with
the measurement (task 7.11); until then, just keep the clips and the notes file described
below.

## How to film

The first version of the overlays needs a camera that does not move during the clip.

- **Hold the phone still:** on a small tripod, a clamp, or propped on a shelf or a stack of
  books. Not in your hand, even for a short clip.
- **The whole table in the picture:** all six pockets and, on a pool table, the diamonds on all
  four rails. Landscape.
- **From above if you can:** from a shelf, a high stool or a step ladder at the end or a corner
  of the table, higher than standing height. The higher the camera, the less the balls hide
  each other and the player hides the balls. Standing height also works.
- **Normal camera, no zoom, no filters.** 1080p is enough; 4K is fine but larger.
- **Lock focus and exposure** (on most phones: touch and hold on the table until it says
  locked), so the picture does not brighten or darken when you walk into it.
- **iPhone:** set Settings, Camera, Formats to "Most Compatible" so clips are saved as H.264.
  The default (HEVC) is fine in Safari but cannot be decoded by Chrome or Firefox on most
  computers.
- **Frame rate:** most clips at the normal 30 or 60 frames a second, and about a third in
  slow motion (120 or 240), because the shot's speed is measured on those.

## What to film

- **Each clip:** one shot, from a second before you strike until every ball has stopped, then a
  second more. Three to fifteen seconds. Several shots in one clip are fine too, with a few
  still seconds between them.
- **Shots:** stun, draw, follow and side; soft and hard (a break or two); shots off one or more
  cushions; pots and misses; a ball running past others; a cluster split.
- **You in the picture:** in most clips your body or cue will hide part of the table for a
  moment. That is what the tracking has to cope with, so it is wanted. A few clips with the
  view kept clear help too.
- **Variety:** different tables, cloths and lights if you can reach them; at least two places
  to put the camera.
- **How many:** at least 30 clips, about 10 of them in slow motion, on at least two tables.

## The notes file

Keep one plain text or spreadsheet file next to the clips, one line per clip:

| clip file | table (e.g. 9 ft pool, 7 ft bar table) | cloth colour | frame rate | notes |
|---|---|---|---|---|
| `IMG_1234.MOV` | 9 ft pool | blue | 240 | draw shot, I block the view at the end |

## How the clips will be labelled (task 7.11)

The truth comes from the clip itself, like the photos (docs/CAPTURE.md):

1. **The table:** on the first still frame of each clip, box every diamond you can see, as for
   the photos. The camera does not move, so that frame fixes the table for the whole clip. Pool
   tables with diamonds only, for now, as for the photos.
2. **The balls:** a script will cut about ten frames from each clip, spread over the shot (more
   where balls move fast), as JPEG files. Box the balls on those frames in YOLO format with the
   same classes as the photos (`Black`, `Cue`, `Dot`, `Solid`, `Striped`). A blurred ball is a
   streak: box the whole streak.
3. **The shot:** for each shot, write down the frame numbers where the cue ball starts to move
   and where the last ball stops. The script prints frame numbers and times to make this easy.
4. **The speed:** comes from the slow-motion clips, from where the cue ball is on the frames
   just after the strike. Nothing extra to label.

## Privacy

Only film people who agree to it. The clips, frames and labels stay on your machine, in a
folder outside this repository (for example `baize-data/clips` next to it, where the photos
go). A `baize-data` folder inside the repository is ignored by git as a second guard. When the
overlays are built, clips are processed in the browser only and never uploaded, like photos.

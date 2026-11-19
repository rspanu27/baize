# Baize task board

Status: `todo`, `doing`, `done`, `blocked`. Update a task's status when it starts and when it finishes.

Owners: **L** = lead (main session), **I** = implementer, **U** = ui-builder, **R** = reviewer, **You** = project owner.

Each task is sized at 30 to 90 minutes. Every task ends with `pnpm check` green and a commit. Tasks named in the same parallel group touch different files and can run at the same time.

## Phase 0: foundations

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 0.1 | Write ARCHITECTURE.md, TASKS.md, PROGRESS.md, LICENSE | L | - | Files committed | done |
| 0.2 | Monorepo scaffold: pnpm workspace, strict TS, Vitest, stub `physics` and `tables`, Vite + React placeholder, `pnpm check` | I | 0.1 | `pnpm check` and `pnpm --filter web build` pass | done |
| 0.3 | ESLint + Prettier, physics purity rules | I | 0.2 | A banned call in `packages/physics/src` fails lint; `pnpm check` passes | done |
| 0.4 | GitHub Actions: one job, install, check, build | I | 0.2 | Run is green on GitHub | done: Actions works again since 2026-11-14; every push runs install, check, build and the end-to-end tests |
| 0.5 | `docs/DEPLOY.md` with exact Cloudflare Pages settings | I | 0.2 | You connect the repo; the placeholder URL loads | done: connected through the Workers flow in DEPLOY.md; every push to `main` publishes the site |

Parallel: 0.3, 0.4, 0.5.

## Phase 1: physics core v1

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 1.1 | Type contracts in both packages, stub modules and index files | L | 0.3 | Typecheck passes; type-level compatibility test passes | done |
| 1.2 | Table presets (11) with sources; numbers shown to You for sign-off before encoding | I, You | 1.1 | Every preset passes validation; sign-off noted in PROGRESS | done (11 presets, not 13; sizes signed off 2026-11-12 with owner-supplied blackball sizes) |
| 1.3 | Ball sets and cloth presets (speeds with sources, colours) | I | 1.1 | Preset tests pass; every number has a source comment | done |
| 1.4 | Custom table validation and derived defaults, plain-word messages | I | 1.1 | Unit tests for each rule and message | done |
| 1.5 | Markings and spots per game | I | 1.1 | Snooker spots match the rules on 12 ft; scale on other sizes | done |
| 1.6 | Racks, `sanitizeLayout` | I | 1.5 | Racks have no overlaps; sanitize property tests pass | done (rack rules still to verify against sources) |
| 1.7 | Maths core: vectors, `sinCos`, stable quadratic | L | 1.1 | Unit tests; `sinCos` within 1e-15 of reference | done |
| 1.8 | `firstDownCrossing` root finder | L | 1.7 | Property test against dense sampling on random polynomials; degenerate cases | done |
| 1.9 | Motion segments, transitions, state classification | L | 1.7 | Analytic slide and roll distances match; energy never rises within a segment | done |
| 1.10 | Table geometry from spec | L | 1.1 | Closed-boundary and symmetry tests on fixtures and random custom tables | done |
| 1.11 | Event time functions: ball-ball, segment, arc, pocket, contact rule | L | 1.8, 1.9, 1.10 | Hand-computed cases; touching and grazing cases | done |
| 1.12 | Ball-ball v1 model and cue strike | L | 1.9 | Momentum exact, energy non-increasing, unequal masses | done |
| 1.13 | Han 2005 cushion model and interface | L | 1.9 | No energy gain over a parameter sweep; no-spin and side-spin directions correct | done |
| 1.14 | Event loop: scheduler, cache, caps, result assembly | L | 1.11, 1.12, 1.13 | Two-ball and one-cushion shots produce the expected event lists | done |
| 1.15 | Same-instant and touching-ball handling | L | 1.14 | Frozen pair, ball frozen to cushion, line of touching balls, full racks all terminate | done |
| 1.16 | Public API, input validation, `sampleAt`, README | L | 1.14 | API tests; README example runs | done |
| 1.17 | Verification suite (SPEC 5.8) on smallest, largest and random tables | L | 1.16, 1.2, 1.3 | 90 degree rule, 30 degree rule, stop shot, roll transition, cushion angle, cloth monotonic | done (on presets and custom tables) |
| 1.18 | Property tests: determinism, energy, termination, no overlap, in bounds | L | 1.16, 1.4 | fast-check suite passes at raised run counts | done (12,000 scenes) |
| 1.19 | Golden snapshots, benchmark, profiling, broad-phase tuning | L | 1.17 | Snooker break-off and 9-ball break under 50 ms in Node | done (about 1 ms) |
| 1.20 | Independent review, fixes, PROGRESS entry | R, L | 1.17, 1.18, 1.19 | Reviewer findings closed; `pnpm check` passes | done (1 blocker and 6 should-fix findings fixed; see PROGRESS) |

Parallel: the tables track (1.2, 1.3, 1.4, 1.5, then 1.6; one file each) runs alongside the physics track (1.7 to 1.16), which the lead does in sequence.

## Phase 2: editor MVP

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 2.1 | `DiagramDoc`, `resolveDoc`, store with undo/redo, `loadLayout` | L | 1.16, 1.6 | Store unit tests: undo/redo; loadLayout is one step | done |
| 2.2 | URL codec and migration scaffold | I | 2.1 | Round-trip property test; bad input gives a clear error | done |
| 2.3 | Unit formatting and parsing (metric/imperial) | I | 0.3 | Unit tests | done |
| 2.4 | Aim geometry: ghost ball, cut angle, line angles, distances | I | 0.3 | Unit tests with known angles | done |
| 2.5 | Table SVG: cloth, cushions and jaws from engine geometry, pockets, markings, view transform | U | 2.1, 1.5, 1.10 | Component test renders every preset and a custom table | done |
| 2.6 | Ball rendering for all kinds, low-confidence marker | U | 2.5 | Component test | done |
| 2.7 | Drag, snap to spots, no-overlap placement | U | 2.6 | Interaction test: drag updates the doc, snaps, cannot overlap | done |
| 2.8 | Add/remove balls, racks, undo/redo controls | U | 2.7 | Interaction test | done |
| 2.9 | Setup panel: presets, custom dimensions with messages, jaw shape, ball set, cloth, units | U | 2.1, 2.3, 1.4 | Entering a custom table re-renders it; invalid input shows its message | done |
| 2.10 | Simulation integration: frame-coalesced re-simulation, timing, path model | L | 2.1 | Unit tests for the path model; re-simulation time measured during a drag | done (no frame coalescing needed: a drag step costs well under a frame) |
| 2.11 | Shot controls: aim drag and click, ghost ball, tip widget, speed slider with stops | U | 2.7, 2.4 | Interaction test updates the shot in the doc | done |
| 2.12 | Path drawing: emphasis rules, collision marks, final positions, show-all, "physics v1" note | U | 2.10 | Component test on a fixed shot | done |
| 2.13 | Share button and load from URL hash | U | 2.2 | A link reopens an identical doc | done |
| 2.13a | Bug fixes from first use: path drawing hardened, aim by dragging on the cloth, table always in view, play bar with playback and continue-from-result | L | 2.11 to 2.13 | `pnpm check`; browser check of play, scrub, continue, panel scroll | done |
| 2.14 | Measuring tool, cut-angle and travel readouts | U | 2.4, 2.12 | Readout matches helper output | done |
| 2.15 | SVG and PNG export | I | 2.12 | Exported SVG parses; PNG has the expected size | done |
| 2.16 | Mobile layout, portrait and landscape, touch drag | U | 2.9, 2.11 | Manual check at phone sizes | done |
| 2.17 | Playwright smoke test of the Phase 2 acceptance flow | I | 2.13 | Test passes in CI | done |
| 2.18 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | done |

Parallel groups: (2.2, 2.3, 2.4, 2.5) after 2.1; (2.9, 2.10) alongside 2.6 to 2.8; (2.13, 2.14, 2.15) after 2.12.

Slip first if the week runs short: 2.14, 2.15, 2.16.

### Notes from the project owner for Phase 2

- **Aiming must be smooth (for 2.11).** In the playground the aim slider jumps by about 0.7 degrees per step because a 360 degree range is squeezed into a short slider. The editor needs aiming that can reach any angle: drag on the table without rounding, plus a fine adjustment (arrow keys or a fine-tune control) down to at least 0.01 degrees. Reported 2026-11-12.

## Phase 3: physics v2 (spin realism and nap)

The version 2 models are opt-in in `packages/physics` (through `SimInput.models` and `ShotInput.cueEndMassKg`), so every version 1 test and golden snapshot stays as it is. The editor uses the version 2 models.

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 3.1 | Deterministic `expNeg`; ball-ball model with speed-dependent friction (throw, spin transfer) | L | 1.12 | Hand-computed throw at a half-ball stun shot; gearing side cancels throw; momentum exact and energy never gained over random collisions | done |
| 3.2 | Squirt in the cue strike, from the cue's end mass | L | 1.12 | About 2 degrees at maximum side; mirror symmetry; speed unchanged; long straight shot arrives off line by the expected amount | done |
| 3.3 | Contact values in `packages/tables` (ball-ball friction, cue end-mass ratio) with sources | L | 3.1, 3.2 | Every number has a source comment; unverified ones say so | done |
| 3.4 | Random-scene invariants with the version 2 models; soak run | L | 3.1, 3.2 | 6000-scene soak passes | done |
| 3.5 | Editor simulates with the version 2 models; notes updated | L | 3.1 to 3.3 | `pnpm check` and the smoke test pass | done |
| 3.6 | Mathavan 2010 cushion model behind `CushionModel`, checked against pooltool's implementation | L | 1.13 | Reference fixture from pooltool matches within a stated tolerance; no energy gain over a sweep; deterministic | done |
| 3.7 | Nap: direction-dependent drift at low speed, as piecewise constant acceleration with re-evaluation events | L | 1.9, 1.14 | Drift in the known direction and rough size on snooker cloth; all invariants hold; decision recorded | done |
| 3.8 | Editor: aim guide shows the squirted line (the nap setting already takes effect, done with 3.7) | U | 3.2, 3.7 | Component tests | done |
| 3.9 | Debug panel to change coefficients live (cloth, ball-ball friction, cue end mass, cushion) | U | 3.5 | Changing a value re-simulates; values are not stored in the link | done |
| 3.10 | Swerve with cue elevation (optional in the spec) | L | 3.2 | Only if the rest is solid | skipped: needs cue elevation, which the editor has no control for and the engine rejects |
| 3.11 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | done |

## Phase 4: playback and polish

Playback itself (real time, half and quarter speed, scrubbing, continue from the result) shipped in Phase 2; this phase polishes it and adds styling and drills.

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 4.1 | Style in the document: theme, path line style, label options. `schemaVersion` 2 with a migration from 1 | L | 2.2 | Version 1 links open unchanged; round-trip property test covers the new fields | done |
| 4.2 | Drawing and exports follow the style; style panel in the editor | U | 4.1 | Component tests per theme and option; exported SVG carries the theme | done |
| 4.3 | Drill templates in `packages/tables`: classic drills per game, placed from spots and table size so they fit any table | I | 1.5, 1.6 | Every drill on every preset and on random custom tables: no overlaps, all balls inside the cushions, or the drill reports that it does not fit | done |
| 4.4 | Drills in the editor: pick one, it loads as one undo step | U | 4.3 | Interaction test; drills that do not fit are not offered | done |
| 4.5 | Playback polish: tenth speed, space bar to play and pause, repeat | U | 2.13a | Component and hook tests | done |
| 4.6 | Stretch: save the animation as a WebM video, in the browser only | I | 4.2, 4.5 | A file is produced in Chromium; unsupported browsers get a plain message | skipped: stretch item; works in some browsers only |
| 4.7 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | done |

## Phase 5: photo to diagram

Split in two stages. Stage A needs no training data and gives a usable import (the person may have to fix more balls by hand). Stage B adds the learned ball detector and needs the project's own labelled photos, which only the project owner can take.

Fixed at kickoff: one photo through the system camera or file picker; automatic table detection needs all four corners, otherwise four corner handles that may sit off the image (since 2026-11-15, by the user's decision: one corner may be out of frame); position error at most 0.6 % of the table length at the median and 1.5 % at the 95th percentile; at most 3 s with WebGPU and 8 s without. The photo is processed in the browser only and is never uploaded, stored, or put in the document, the link or the undo history.

### Stage A: no training data needed

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 5.1 | `packages/vision`: scaffold with no runtime dependencies, the `importPhoto(image, table, ballSet)` contract and result types, lint rules as for physics (no network, no storage) | L | 1.1 | Typecheck and lint pass; a lint test proves `fetch`, `XMLHttpRequest`, `localStorage` and `indexedDB` are refused in the package | done |
| 5.2 | Geometry core: homography from four corners, camera position recovered from it, projection of a point at a height above the cloth, and height correction of a ball's seen centre | L | 5.1 | For random synthetic cameras and exact corners, ball positions are recovered within 1 mm; a stated error budget for corner error of a few pixels | done |
| 5.3 | Synthetic photo renderer for tests: a table and balls drawn through a known camera into a pixel buffer, with exact ground truth | I | 5.2 | Rendered corners and ball centres match the camera model to a pixel | done |
| 5.4 | Table finder: cloth-colour model that adapts to any cloth, the cloth region, and a four-corner fit; says so when it is not confident | L | 5.3 | Found on every synthetic photo with all four corners in view, for every cloth colour preset; refuses when a corner is cut off | done; since 2026-11-15 one corner out of frame is found, two are refused |
| 5.5 | Ball finder without a model: things on the cloth that are not cloth, sized against the known ball diameter, centred with height correction, named by colour against the ball set, each with a confidence; then `sanitizeLayout` | L | 5.2, 5.4 | On synthetic photos: recall, position error and identity reported per game; touching balls and balls on a cushion covered | done |
| 5.6 | Evaluation script and label format: position error as a share of table length (median, 95th percentile), recall, identity, time; runs on synthetic photos in `pnpm check` and on real labelled photos by hand | I | 5.5 | Script prints the table of metrics; a small synthetic subset runs in the test suite | done for synthetic photos; the runner for real photos (needs a JPEG decoder) moves to 5.11 |
| 5.7 | Editor: "Import from photo" (camera on a phone, file picker on desktop), the guidance text, and the review screen: photo with the table outline and balls drawn over it, corner handles that can be dragged (also off the image), re-run when a corner moves | U | 5.5 | Component and browser tests with a synthetic photo; the photo is only in component state (test that the document, link and storage never hold it) | done |
| 5.8 | Review edits: change a ball's identity, add a missed ball, delete a false one; confirm loads the layout as one undo step with `source: photo` and confidences | U | 5.7 | Interaction test; uncertain balls are marked after confirming | done |
| 5.9 | Speed: downscaling, and a worker if the main thread is blocked too long | L | 5.7 | Time for a 12-megapixel photo measured and inside the 8 s limit on a throttled CPU | done (2026-11-15): a real photo at 12 MP takes 0.74 s, 2.6 s and 4.1 s with the CPU slowed 1x, 4x and 6x (`apps/web/scripts/measure-photo-speed.mjs`); the analysis now runs in a worker, and the page is blocked at most 0.16 s, 0.62 s and 0.96 s at a time. Not measured on a real phone |
| 5.9a | Independent review of stage A, fixes, PROGRESS entry | R, L | 5.1-5.9 | Findings closed; `pnpm check` passes | done (2026-11-15): see PROGRESS |

### Stage B: needs the project's own photos

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 5.10 | Capture protocol and the labelled set: what to photograph, how the true ball positions are known (balls on spots and racks, plus measured or top-down reference), the label file format | You, L | 5.6 | At least 100 photos across tables, cloth colours, lighting and angles, with labels | protocol written: docs/CAPTURE.md (what to photograph, labelling with diamonds in YOLO format, measuring); the photos are the owner's to take |
| 5.11 | Measure stage A on the real set and decide what the learned detector must fix | L | 5.10 | Metrics table in PROGRESS; decision recorded | started: runner, first figures and a first round of fixes on pix2pockets (docs/DATASETS.md: false balls 3.5 to 0.43 per picture, table found unaided 61 % to 78 %); the project's own photos and the decision are still to come |
| 5.12 | Train a small detector (YOLO family) on public data plus the project's photos; licences of data and code checked and recorded; export to ONNX. Training on free compute only | L, You | 5.10 | Model file with its training record; recall and identity on a held-out part of the set | todo |
| 5.13 | Run the model in the browser with ONNX Runtime Web (WebGPU, falling back to WASM), loaded only when a photo is imported, served as a static file | I | 5.12 | Targets met or the shortfall stated; time limits met; the app works with the model missing | todo |
| 5.14 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | todo |


## Phase 6: position-play planner

SPEC section 10, ARCHITECTURE section 10. The planner is handed a shot runner built with the editor's own physics, so its routes are what the editor draws. Benchmark layouts are kept as fixtures in `packages/planner/test`.

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 6.1 | `packages/planner` scaffold: types, `ShotRunner` contract, deterministic `atan2` and normal distribution function, lint guards as for physics; the editor's runner built by the same code as its simulator | L | 3.5 | Typecheck and lint pass; a lint test proves the bans; the editor's runner gives the same result as the editor's simulator for a fixed shot | done |
| 6.2 | Rules: balls on per game, values, basic fouls judged from a `SimResult`, next state, snooker respotting | I | 6.1 | Unit tests per game and per foul; respotting covers an occupied own spot and all spots taken | done |
| 6.3 | Geometry: pocket aim points, ghost ball, blocked lines, cut angle, geometric pot-chance estimate | L | 6.1 | Unit tests with known angles; on any table; the estimate falls with cut angle and distance | done |
| 6.4 | Shots: aim refined with the runner, pot window by bisection, variants of speed and tip, pot chance against a player level; player levels with a source note | L | 6.2, 6.3 | A refined straight and a refined cut shot pot in the runner; window shrinks with distance; calibration test against replays with fixed noise offsets within 10 points | done: calibration against replays with the player's errors, mean gap 0.03 per bin (limit 0.10) |
| 6.5 | Position: cue-ball stopping place under speed error and its value | L | 6.4 | Unit tests; a shot that leaves an easy next ball scores above one that leaves none | done: the geometric estimate is widened by 1.8, the measured median of the simulator's windows over it (1.5 to 2.2 by table) |
| 6.6 | Search: beam search with a runner-call budget, routes by expected value, best route so far reported; benchmark fixtures | L | 6.5 | Every step of every benchmark route pots its ball without a foul when replayed; same input gives the same route; runs on the smallest and largest presets and a random custom table | done: five benchmark layouts; a 3-shot route takes 1,400 to 5,000 simulator calls, 0.3 to 1.7 s in Node |
| 6.7 | Safety suggestions when no pot is reasonable | L | 6.6 | On safety fixtures the best suggestion is legal and leaves the opponent less than the position as it stands would; offered when the route's first pot is below 40 % | done |
| 6.8 | Planner worker in the editor, with progress and a main-thread fallback | I | 6.6 | Worker message tests; the page is never blocked more than 100 ms while planning (measured) | done |
| 6.9 | Planner panel and route layer: game, ball on, group and level; find a route; numbered steps with chances; use this shot; play the route | U | 6.8 | Interaction tests; e2e: a 9-ball ending gives a route and "Use this shot" pots the first ball | done |
| 6.10 | Rating of the user's own shot (pot chance, position left) | U | 6.5, 6.9 | Component test; the rating matches `rate` for a fixed shot | done |
| 6.11 | Speed in the browser: first route and 3-shot route timed on a production build | I | 6.9 | Measured within 1 s and 5 s on a desktop, or the shortfall stated | done (2026-11-19, `apps/web/scripts/planner-speed.config.ts`): first route 0.24 to 0.37 s; 3-shot route 1.2 s for a 9-ball ending and 2.2 to 2.9 s for a full snooker table; no long task on the page (none of 50 ms or more). Chromium's CPU slow-down does not reach the worker, so slow phones are not measured |
| 6.12 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | todo |

Parallel: 6.2 alongside 6.3; 6.10 alongside 6.11.

## Phase 7: video overlays

SPEC section 11, ARCHITECTURE section 11. Tasks after 7.1 are refined when 7.1 is done.

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 7.1 | Decisions: decoding (WebCodecs or video element) per browser, muxer and its licence, size and frame-rate limits; ARCHITECTURE section 11 completed | L | 5.9 | Decisions recorded; a frame read and a frame encoded in Chromium in a spike | todo |
| 7.2 | Synthetic clips: a simulated shot drawn through a known camera frame by frame, with motion blur and a moving occluder, with exact truth | I | 7.1 | Rendered ball centres match the simulation to a pixel on every frame | todo |
| 7.3 | Clip capture protocol and the labelled clips | You, L | 7.1 | At least 30 clips with ball positions on sampled frames and shot start and end marked | todo |
| 7.4 | Video loading in the browser and first-frame calibration with the photo-import tools | U | 7.1 | Browser test: a clip loads, the table is found or corners placed, nothing is uploaded | todo |
| 7.5 | Ball tracking: still-table model, moving balls from the difference, a motion model, blur streaks, hidden balls | L | 7.2 | On synthetic clips every moving ball within two radii in 95 % of visible frames | todo |
| 7.6 | Shot start and end | L | 7.5 | Synthetic clips: start within 2 frames, end within 0.5 s | todo |
| 7.7 | Physics fit: the strike that makes the simulated shot match the tracks | L | 7.5 | Synthetic clips: speed within 5 %, direction within 0.5 degrees | todo |
| 7.8 | Overlay renderer: trails, ghost ball, minimap, speed, slow motion around the contact, themes | U | 7.7 | Component tests per overlay; frames with overlays match the editor's drawing | todo |
| 7.9 | Video export in the browser: encoder and muxer, MediaRecorder fallback | I | 7.1, 7.8 | A playable file is produced in Chromium; other browsers get a plain message or the fallback | todo |
| 7.10 | Video screen: load, calibrate, pick shot and overlays, preview, save; "Open in editor" | U | 7.4, 7.8, 7.9 | Interaction tests; e2e on a synthetic clip | todo |
| 7.11 | Measurement on the labelled clips | L | 7.3, 7.7 | Metrics table in PROGRESS; shortfalls stated | todo |
| 7.12 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | todo |

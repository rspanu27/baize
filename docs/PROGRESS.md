# Baize progress log

One short entry at the end of each phase, newest first.

## 2026-11-12: Phase 1, physics core v1

**What exists**

- `@baize/physics`: event-based simulator with zero runtime dependencies. `simulate`, `sampleAt`, `kineticEnergy`, `prepareTable`, `buildTableGeometry`, `strike`. Sliding, rolling and spinning motion; frictionless ball-ball collisions with restitution and unequal balls; a cushion model with spin and nose height; real pocket jaws; level-cue strike with follow, draw and side.
- `@baize/tables`: 11 table presets, 5 ball sets, 7 cloth colours, 3 cloth speeds, custom-table validation with plain-word messages, markings and spots, racks, layout sanitising.
- Tests: 293 in physics, 162 in tables. `pnpm check` is green locally.

**Evidence**

- Verification (SPEC 5.8) on the smallest and largest presets, a rounded-jaw pool preset, custom-built tables and random tables: stop shot exact; 90 degree rule to 1e-9; 30 degree rule matches the analytic 33.7 degrees on a half-ball hit; roll transition time, place and speed to 1e-12; cloth ordering; mirror symmetry.
- Properties (SPEC 5.7): 12,000 random scenes terminate, are bit-identical on a second run, never gain energy, never overlap, never put a ball behind a cushion, and conserve momentum in ordinary collisions.
- Every rack of every preset is broken on three cloths with all invariants checked.
- Speed: 9-ball break 0.6 ms, snooker break-off 0.8 ms, hard snooker pack split 1.0 ms (medians in Node; the limit is 50 ms).

**What testing found and changed**

- Touching balls needed a real solver. Profiling and soak runs found three ways for balls in contact to trade thousands of microscopic collisions (a struck pack, a ball grazing a cushion, a row of balls frozen to a rail). Slow contacts are now solved per touching cluster, and balls below 1 cm/s after a collision are stopped.
- The independent review found one crash (a ball in a pressing contact reaching a pocket) and six should-fix items, all fixed: the pocket drop circle is now measured from the pocket origin, validation uses the real jaw cut-backs, balls over a pocket are rejected or moved out, racks that do not fit are refused.

**Honest limits**

- The cushion model matches pooltool's Han 2005 implementation to rounding error (checked 2026-11-12 on 1,080 impacts). It has not been checked against Han's paper, which is paywalled. Against pooltool's more detailed Mathavan model it is typically within 2.4 % in rebound speed and 2.6 degrees in direction, and up to about 10 degrees off in the worst cases with the default cushion values; see the decisions log.
- No published figures exist for pocket jaw shape, slate cut, or cushion bounce and grip on any preset; those are modelling choices. Snooker 6 ft, bar-box and blackball pocket openings are assumptions. Details and open questions: `docs/research/table-presets.md`.
- Rack arrangements and the masses of the smaller ball sets were not checked against sources (web access was rate-limited) and are marked `UNVERIFIED` in the code.
- Simultaneous multi-ball contacts are resolved in a fixed order; results near pocket jaws are approximate; there is no throw, squirt, swerve or nap yet (Phase 3).
- CI has not run: GitHub Actions is unavailable on the account until the student benefits return. The gate is local `pnpm check`.

## 2026-11-11: Phase 0, local parts complete

- Monorepo scaffolded: `packages/physics`, `packages/tables`, `apps/web` (Vite + React placeholder). TypeScript 7 strict, Vitest 5, pnpm 11, Node 24.
- ESLint + Prettier in place. Physics purity rules (relative imports only; no randomness, clocks, `Math` transcendentals or `**`) are enforced by lint and proven by `packages/physics/test/lint-guard.test.ts`.
- `pnpm check` (typecheck, lint, test) and `pnpm --filter web build` pass locally.
- CI workflow committed and pushed, but **not green**: GitHub fails every run at startup with zero jobs, including a one-line test workflow on a throwaway branch (since deleted). The cause is outside the repo; the project owner needs to check Actions billing and spending limits for the private repo.
- Cloudflare Pages: [DEPLOY.md](DEPLOY.md) written; the dashboard connection is the project owner's step.
- Notes: typescript-eslint 8 does not support TypeScript 7 yet, so linting is not type-aware. Vitest 5 benchmarks use the `test(..., ({ bench }) => ...)` form.
- Phase 0 is not closed until CI is green and the placeholder page is live.

## 2026-11-11: kickoff

- Kickoff interview held; every open decision in SPEC section 10 (now section 12) is settled and recorded in the decisions log in [ARCHITECTURE.md](ARCHITECTURE.md).
- Architecture written. Phases 0 to 2 broken into tasks in [TASKS.md](TASKS.md).
- No code yet.

## Phase 2: editor MVP (finished 2026-11-13)

Done: every task 2.1 to 2.18. The editor at the site root sets up any preset or custom table, places and drags balls, racks, aims (drag on the cloth or the handle, to any angle), sets tip and speed, draws the simulated paths, plays the shot back, continues from the result, measures distances, shows the cut angle, exports PNG and SVG, and shares the whole diagram in a link.

Checks: `pnpm check` (tables 162, physics 297, web 423 tests) and the Playwright smoke test (`pnpm --filter web test:e2e`: custom table, rack, aim, measure, play, export, share, reopen identical; phone layout).

Found on first use by the project owner and fixed: the table replaced by a huge black and white shape at some aim angles in Chrome (paths are now polylines, labels use normal font sizes; confirmed gone), aim drags getting stuck, the table scrolling out of view, and no visible way to play a shot.

Independent review (2.18): no blockers and no hard-rule violations. Fixed from it: playback returning after undo and redo; Copy link adding an empty undo step because documents were compared with field order; the table hiding its balls from screen readers (`role="img"`); no keyboard control for the tip position; exported labels losing their outline; stuck ball drags; aim slider values out of range; the aim handle drawn off a smaller table.

Known gaps carried forward:
- Clicking an object ball does not aim at it directly (select it, then "Aim at the selected ball").
- Two quick link changes in the address bar can resolve out of order; the older one may win.
- CI has not run: GitHub Actions is unavailable on the account for now. The local checks above are the gate.
- The playground page (`?playground`) still draws paths as curves.
- Physics v1 limits are unchanged: no throw, squirt, swerve or nap; cushion model as measured in Phase 1.

## Phase 3: physics v2 (finished 2026-11-13)

Done: tasks 3.1 to 3.9 and 3.11. Task 3.10 (swerve) is skipped: the spec marks it optional and it needs cue elevation, which the editor has no control for and the engine rejects.

What the editor now models:
- **Throw:** friction between balls, stronger at low rubbing speed, with spin transfer.
- **Squirt:** with side, the cue ball leaves off the aim line. The ghost ball, cut angle and distance follow the real line; the dashed aim line stays where the cue points.
- **Cushions:** the Mathavan (2010) model, integrated through the impact. Against pooltool's implementation on 1,080 impacts: velocity within 0.06 % of the incoming speed at the median, 1.4 % at worst.
- **Nap:** a constant push along the nap on rolling balls, followed in constant-acceleration pieces; within 1 % of the nap's effect against a fine integration of the exact equation.
- **Debug panel ("Physics numbers"):** eight values can be changed live. They are never saved in the link.

The version 2 models are opt-in in the engine, so no version 1 test or golden snapshot changed.

Checks: `pnpm check` (tables 166, physics 401, web 453 tests), the Playwright smoke test, and a 6,000-run soak of the random-scene tests with all the new models.

Engine bugs found by random runs and by the review, all fixed with regression tests:
- A slow touch on a ball spinning on the spot wound its spin back up (energy rose).
- A spinning ball squeezed between a rail and another ball sank into the rail 0.1 micrometres per cycle.
- A hold on a rail outlasted the rail: a ball could cross a pocket mouth in a straight line.
- On a napped cloth a ball rolling along a rail broke into hundreds of microscopic slides.

Independent review (3.11): no blockers and no hard-rule violations. Besides the two rail findings above, fixed from it: balls starting on a rail were not held; the shot panel read the tuning store during render; the nap limit was written twice; `strike` checked the cue end mass only on shots with side; one unchecked value lacked its UNVERIFIED mark.

Known gaps carried forward:
- Three numbers are estimates with no measured source, marked UNVERIFIED in `packages/tables`: the cue end-mass ratio (squirt size), the nap push, and the slow/fast sliding friction offsets. The ball-ball friction fit was read from pooltool, not from the original proof.
- Not modelled: swerve, and the effect of side spin on a napped cloth.
- The playground page (`?playground`) still uses the version 1 models.
- Results near pocket jaws remain approximate, as before.
- CI still has not run; the local checks are the gate.

## Phase 4: playback and polish (finished 2026-11-13)

Done: tasks 4.1 to 4.5 and 4.7. Task 4.6 (saving the animation as a video) is skipped: it is a stretch item and would work in some browsers only.

What is new:
- **Look:** three themes (table colours, print on white, dark), solid, dashed or dotted paths in three weights, numbers on balls on or off, and a caption under the table. Exports carry all of it.
- **Drills:** nine drills (four snooker, four pool, one blackball) in `packages/tables`, placed from the table's spots and size; the editor offers the ones that fit and loads one as a single undo step.
- **Playback:** tenth speed, repeat, and the space bar to play and pause.
- **Link format:** `schemaVersion` 2 for the new style fields. Version 1 links open as the same diagram (a recorded one is a test fixture).

Checks: `pnpm check` (tables 216, physics 401, web 522 tests) and three Playwright tests (the acceptance flow, the Look panel with a saved SVG, the phone layout).

Independent review (4.7): no blockers and no hard-rule violations. Fixed from it: a link could carry a caption with characters that broke the exported file; the stop-shot ladder's description did not match how it can be played; turning ball numbers off also hid the marks on uncertain balls; every caption key press re-ran the physics and a theme change stopped playback; drill descriptions named a corner by a screen position that the editor draws elsewhere; missing tests for loading a drill and for the saved picture. Smaller ones: the caption counter and limit now count the same way, a trailing space is dropped when the box is left, and the three-quarter-ball drill is right for a cue ball of a different size.

Known gaps carried forward:
- Drill spacings are this project's own layout of the common drills; no coaching text was consulted.
- In the print and dark themes some ball paths share a colour (for example yellow, orange and pink are the same grey in print).
- Dashed and dotted paths do not show where a ball slides and where it rolls.
- The repeat hold and the print-theme export were checked by tests and one look in the browser, not on a phone.
- No video export. CI still has not run; the local checks are the gate.

## Phase 5, stage A: photo import without a trained model (finished 2026-11-15)

Done: tasks 5.1 to 5.9 and the stage A review. Task 5.11 (measurement on real photos) has started on a public set; the project's own photos (5.10) and stage B (5.12 to 5.14) are still to come.

What is new:
- **Import from photo** in the editor: the photo is read in the page, the table and balls are found, and a review screen lets the person move corners, turn the table round, rename, add and remove balls before the layout is loaded as one undo step. The photo never leaves the device.
- **Table finder** from the cloth colour, for any cloth; one corner may be out of frame (the owner's decision, 2026-11-15). **Ball finder** from what is on the cloth and not cloth, sized and placed through the recovered camera, with corners at cushion-nose height.
- **Analysis in a worker**, so the page stays responsive.
- **Measurement on real pictures:** 231 pictures of the public pix2pockets set, with the true positions worked out from the table's sights (`docs/DATASETS.md`), and a script for speed.

Figures. Real pictures, corners given: 90.2 % of balls found, 83.5 % named to the group (cue, black, solid, striped), position error median 0.16 % and 95th percentile 0.87 % of the table length, 0.49 false balls per picture. Nothing given: the table is found right in 78 % of pictures (probably about 83 %: some of the misses are errors of the truth on bar tables). Synthetic photos: 94.8 % found, 99.4 % named, no false balls. Speed for a 12-megapixel photo: 0.74 s, 2.6 s and 4.1 s with the CPU slowed 1x, 4x and 6x, against an 8 s limit.

Checks: `pnpm check` (tables 220, physics 401, vision 120, web 554 tests) and seven Playwright tests; CI runs on every push since 2026-11-14.

Independent review (stage A): two correctness bugs and some gaps, all closed. A corner dragged inwards, or three corners in a line, had been accepted with a meaningless camera; now refused. The ball finder had worked one step coarser than intended; fixed and re-measured (balls found and named both up on real pictures). Also: the upload guard is tighter (only short script fetches from the site after a photo is chosen, and no sizeable WebSocket messages); the pixels are handed to the worker instead of copied; a failed re-run is shown and blocks confirming; tests for the worker messages, the dark-ball pass and the review status; two more lint bans in `packages/vision`.

Later the same day, balls were placed through the corners' own perspective instead of the recovered camera alone: on real pictures with nothing given, 92.6 % of balls found, 0.37 false balls per picture and a median error of 0.22 %, with the table found right in 81 % (see `docs/DATASETS.md`).

Known gaps carried forward:
- Targets not met on real pictures: 95 % of balls found (92.5 % with corners given, 94.2 % unaided where the table is found right) and the table found unaided in 90 % of photos (81 %). Naming reached 90 % on the same pictures after the black ball was treated by how it is seen, but that was measured on the pictures it was tuned on. Racks are found poorly; tables whose surroundings share the cloth's colour, or that are not in the middle of the picture, are often not found.
- Measured on broadcast pictures and one real phone photo only; no real-phone timing. The project's own photos are needed.
- With corners found automatically, the user's photo shows two doubled balls; placing the corners by hand avoids them. The dark-ball pass can add a false ball on a red cloth.
- `CUSHION_TOP_DEPTH_M` is one constant, not a table field, and is a seen value; balls are placed through a camera that cannot match four imperfect corners exactly.
- Unverified numbers remain in `packages/tables` (marked).

## Phase 6: position-play planner (finished 2026-11-19)

Done: tasks 6.1 to 6.12. The vision's planner (SPEC section 1) became SPEC section 10 and this phase, with the video overlays as Phase 7.

What is new:
- **`@baize/planner`**, a package that depends only on the physics and tables and follows the physics' determinism rules. Given a layout it plans a route a few shots deep: which ball, which pocket, how hard, with what tip, and where the cue ball should stop. Games: snooker break-building, 9-ball, 8-ball and blackball, straight pool, with the basic fouls and snooker respotting.
- **Shots are played through the editor's own physics** (a shot runner built by the editor), so throw, squirt, the cushion model and nap are all allowed for, and a planned shot is exactly what the editor draws.
- **Pot chances** come from the window of aims that still pot, searched with the simulator, against a player level's aim and speed error. Against replays of the same shots with the player's errors, predicted and observed rates agree to a mean of 0.005 to 0.034 per bin across four tables, levels and spins (target 0.10). The player levels are estimates (UNVERIFIED).
- **Safeties** when the best pot is under 40 %: legal shots ranked by what they leave the opponent.
- **In the editor**: a Plan panel (game, ball on, level, depth), Find a route in a worker with the best route shown as it improves, the route drawn on the table, "Use this shot" and "Next shot", safeties, and "Rate my shot" for a hand-set shot.

Speed (production build, Chromium, desktop): first route in 0.24 to 0.37 s; a 3-shot route in 1.2 s for a 9-ball ending and 2.2 to 2.9 s for a full snooker table; the page never blocked by a long task.

Checks: `pnpm check` (tables 220, physics 402, vision 124, planner 124, web 607 tests) and eight Playwright tests, including the planner's (a route found, its first shot used and played, the planned ball potted).

Independent review (6.12): no hard-rule violations; fixed from it: the easiest pots got a chance of 0 (the window search started past its own limit); a shot used during a search could be followed by a step from a later route; "Next shot" could add duplicate balls when the editor's result differed at all; the 8 and the black counted the opponent's balls; the faster speed node was clamped back to the planned speed at the speed limit; settings and debug-panel changes did not drop a route; the planner could take an object ball as the cue ball; a rating took an opponent's ball as the pot; the search did not pause between pots for a page fallback. After the fixes, a two-ball 9-ball ending was planned as one shot (a short route's score ended in an optimistic estimate); routes are now compared only where the search really ended.

Known gaps carried forward:
- Player levels and the geometric window scale are estimates or measured on this project's own simulator, not on real players.
- Not planned: kicks, combinations, plants; ball in hand, push-outs, free balls; the opponent's reply beyond their next pot.
- On the main-thread fallback (no worker) the page is blocked for up to one pot's simulations at a time; the 100 ms target holds with the worker.
- Slow phones are not measured (Chromium's CPU slow-down does not reach the worker).

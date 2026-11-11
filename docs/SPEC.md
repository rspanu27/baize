# Baize — Project Spec

> Working name. "Baize" is the cloth on a billiards table. Rename freely before the first public release.

## 1. Vision

An open-source, browser-based **shot diagram editor with a real physics engine** for pool and snooker, on **any table size and cloth**.

Coaches, content creators and players place balls on a correctly scaled table, set up a shot (aim, cue tip position, speed) and see where every ball actually goes: cut angles, throw, cue-ball path after contact, cushion rebounds, spin effects. Diagrams are shared as a link or exported as an image or animation.

A headline feature after the editor: **snap a photo of your own table (even a mediocre phone photo) and get the real ball positions in the editor**, ready to analyse.

Longer term, the same table model and simulator power:
1. **Photo → diagram** (Phase 5, specified below).
2. **Video overlays**: broadcast-style ball trails and minimaps on creators' own footage.
3. **Position-play planner**: search over shots using the simulator to suggest a clearance route (snooker break-building, 9-ball runouts).

Video overlays and the planner are out of scope for this spec. Photo import is in scope as Phase 5, and Phases 1–2 must be designed so it plugs in without rewrites.

### Why this exists
- Existing ball-tracking apps (DrillRoom, Railbird) target players logging stats. They are closed, paid and iOS-only.
- Coaches and creators still draw diagrams by hand, in old desktop tools, or by screenshotting. A popular iOS diagram app (Cue Lab) was pulled, and forum users keep asking for one with accurate dimensions, angle readouts and physically correct paths.
- No mainstream tool runs a proper spin-aware simulation in the browser for free.
- Players use every kind of table: full-size match tables, 7 ft bar boxes, 10 ft snooker tables at home, worn pub cloth. A tool that only models one regulation table is less useful to most people.

### Principles
- **Runs entirely in the browser.** Static site, no backend, no accounts, zero running cost. Photos and data never leave the user's device.
- **Physics is the core asset.** It is a standalone, dependency-free, well-tested TypeScript package that the UI consumes. Someone should be able to `npm install` it and use it in their own project.
- **Correct before pretty.** A physically wrong path is worse than no path.
- **Any table, any cloth.** Tables, balls, pockets and cloth are data with presets plus a fully custom option, never hard-coded.
- **Automation with a human in the loop.** Anything detected automatically (photo import) is shown with its confidence and is trivially correctable by dragging.

## 2. Users and core use cases

| User | Wants to | Key features |
|---|---|---|
| Coach | Explain a shot or drill to a student | Accurate layout, cue-ball path with spin, angle readouts, shareable link |
| Content creator | Make thumbnails, explainers, shorts | Clean PNG/SVG export, animated GIF/WebM of the shot, styling options |
| Player | Practise and understand position play on their own table | Custom table and cloth settings, photo import of a real layout, "what happens if I hit it with more draw" experimentation |

## 3. Scope

### In scope (Phases 0–4)
- **Tables:** presets for snooker 12 ft, snooker 10 ft, snooker 6 ft, pool 9 ft, pool 8 ft, pool 7 ft. Plus a **custom table** where the user sets playing-area length and width, ball diameter, pocket mouth widths (corner and middle separately), and optionally cushion height. Custom tables are saved in the diagram and the URL.
- **Ball sets:** snooker (15 reds + 6 colours + cue; also 10-red and 6-red variants), pool (1–15 + cue, 9-ball and 8-ball racks). Ball diameter follows the table preset or the custom setting.
- **Cloth:**
  - Colour: presets (green, blue, tournament blue, red, grey, black, purple) plus a custom colour picker. Visual only in the editor.
  - Speed: presets (slow / medium / fast, e.g. worn napped cloth, average club cloth, new worsted tournament cloth) plus advanced manual coefficients. Changes the physics friction parameters.
  - Nap (snooker cloth): a setting stored from v1, modelled in Phase 3.
- **Editor:** place, drag, remove balls; snap to spots (snooker) and rack positions; undo/redo.
- **Shot setup:** aim direction (drag a cue line or click the object ball), ghost ball, cue tip offset (top/bottom/side on a ball-face widget), cue speed, optional cue elevation (stretch goal).
- **Simulation:** full event-based physics (section 5), run on every change, results drawn as ball paths.
- **Readouts:** cut angle, angle between any two lines (measuring tool), distances, cue-ball travel distance.
- **Sharing:** entire diagram encoded in the URL hash. No server.
- **Export:** PNG and SVG of the current diagram.
- **Playback:** animate the simulated shot in real time and slow motion.

### In scope (Phase 5)
- **Photo → diagram import** (section 9).

### Stretch (only if the above is solid)
- Animated GIF/WebM export.
- Drill library: classic drills as built-in templates.
- Annotations: text labels, arrows, numbered target zones.
- Multi-shot sequences.

### Explicitly out of scope for now
- Video analysis and overlays.
- Planner / AI shot suggestions.
- Accounts, cloud storage, any backend.
- Native mobile apps. The site must work well on mobile browsers (including camera capture for Phase 5) and be installable as a PWA later.
- Game rules enforcement (fouls, scoring).

## 4. Tech stack

- **Language:** TypeScript (strict mode) everywhere.
- **Repo:** pnpm workspaces monorepo.
  - `packages/physics` — the simulator. Zero runtime dependencies. Pure functions where possible.
  - `packages/tables` — table, ball, pocket and cloth presets as typed data, plus validation for custom tables.
  - `packages/vision` — added in Phase 5. Photo → layout pipeline. Allowed dependencies: ONNX Runtime Web, and OpenCV.js only if a specific step needs it.
  - `apps/web` — the editor.
- **Web app:** Vite + React. Diagram rendered as **SVG** (crisp at any size, trivial vector export, easy hit-testing). Use `<canvas>` only if animation performance demands it.
- **State:** a small store (Zustand or similar). The diagram document is a plain serialisable object with a schema version.
- **Tests:** Vitest. Physics gets heavy unit + property-based tests (fast-check). Web app gets component tests for critical interactions and one Playwright smoke test. Vision gets an evaluation script over a labelled photo set.
- **Quality:** ESLint + Prettier, `tsc --noEmit` in CI.
- **CI/CD:** GitHub Actions (typecheck, lint, test, build). Deploy `apps/web` to Cloudflare Pages.
- **License:** MIT (decide before first public release).

## 5. Physics engine design

This is the technically hardest and most important part of the project.

### 5.1 Approach: event-based simulation, not fixed time steps
Fixed time-step integration causes tunnelling (fast balls passing through each other), non-determinism across frame rates and accumulated error. Instead, use an **event-based** simulator, following the approach in Leckie & Greenspan, *An Event-Based Pool Physics Simulator* (2006), which is also what the open-source Python simulator **pooltool** (Evan Kiefl) builds on.

Core idea:
- Between events, each ball's motion has a **closed-form** solution (position is polynomial in time for each motion state).
- The simulator repeatedly finds the **earliest next event** among all balls, advances every ball analytically to that time, resolves the event, and repeats until all balls are stationary or pocketed.
- Result: an ordered list of events plus each ball's trajectory segments, which can be sampled at any time for drawing or animation.

### 5.2 Ball motion states
`stationary`, `spinning` (in place, about vertical axis), `sliding`, `rolling`, `pocketed`.
Each state has analytic equations for position, velocity and angular velocity over time, governed by:
- sliding friction coefficient (ball–cloth),
- rolling resistance coefficient,
- spinning (vertical-axis) friction coefficient.

These coefficients come from the **cloth model** (5.5), not from constants in the engine.

### 5.3 Events
| Event | How the time is found |
|---|---|
| Sliding → rolling transition | Closed form |
| Rolling → spinning or stationary | Closed form |
| Spinning → stationary | Closed form |
| Ball–ball collision | Smallest positive real root of a **quartic** in t (both positions are quadratic in t). Needs a robust quartic solver plus tolerance handling. |
| Ball–cushion collision | Root of a quadratic per cushion segment. Cushions are line segments; pocket jaws are line segments + arcs. |
| Ball–pocket | Ball centre enters pocket capture region |

All geometry (cushion segments, jaws, pocket regions) is **generated from the table spec**, so presets and custom tables use identical code paths.

### 5.4 Collision models (staged)
- **v1:** ball–ball as instantaneous, frictionless, (near) elastic with configurable restitution. Cushion as restitution + simple spin interaction.
- **v2:** add **throw** (collision-induced and spin-induced, per Dr. Dave Alciatore's model), cushion model with spin and cushion height (Mathavan et al. 2010 or Han 2005), **squirt** (cue ball deflection from side spin) and optionally **swerve** with cue elevation.

### 5.5 Cloth model
- A `ClothSpec` holds: display colour, sliding friction, rolling resistance, spinning friction, and nap (direction + strength, default none).
- Speed presets (slow / medium / fast) map to coefficient sets. Pick defaults from published measurements (Alciatore, pooltool defaults) and document sources.
- The simulator takes the cloth spec as input. Changing cloth speed must visibly change roll distance and how quickly draw/follow converts to natural roll.
- **Nap (Phase 3):** on snooker cloth, a slow-moving ball drifts depending on its direction relative to the nap (towards the baulk end vs away from it). Model as a direction-dependent lateral force that matters mainly at low speed. Must keep determinism and closed-form-or-bounded motion segments; if nap breaks closed-form motion, document the approach chosen (e.g. piecewise approximation with bounded error) in ARCHITECTURE.md.

### 5.6 Cue strike
Input: aim direction, tip offset (a, b) on the ball face, cue speed, optional elevation. Output: initial linear velocity and angular velocity of the cue ball (standard impulse model), plus squirt angle in v2.

### 5.7 Non-negotiable engine properties
- **Deterministic:** same input → bit-identical event list, on every run.
- **No tunnelling,** even at break speed with tightly packed racks.
- **No energy gain:** total kinetic energy never increases across any event (within float tolerance).
- **Momentum conserved** in ball–ball collisions (v1 frictionless model).
- **Terminates:** hard caps on event count and simulated time, with a clear error if hit.
- **Fast:** a full snooker break-off or 9-ball break must simulate in well under 50 ms in the browser, so the UI can re-simulate on every drag. Profile it.
- **Robust to touching balls** (snooker frozen balls, racked balls): explicit handling of simultaneous and near-simultaneous collisions.
- **Table-agnostic:** every test that is not specific to one table runs against at least the smallest and largest presets plus a random valid custom table.

### 5.8 Verification
- **90° rule:** stun shot (no spin at contact), cue ball and object ball separate at 90°.
- **30° rule:** rolling cue ball on a half-ball hit deflects ~30° from its original path.
- Pure rolling transition happens at the analytically expected distance for a given initial stun/draw and cloth.
- Straight stun shot: cue ball stops dead.
- Cushion angle in vs out matches the model for a no-spin ball.
- Faster cloth → longer roll for the same shot, monotonic across presets.
- Property-based: random layouts, shots, tables and cloths never break determinism, energy, termination or the no-overlap invariant.
- Golden tests: saved shots whose full event lists are snapshot-tested.
- Later: compare against pooltool on identical shots as an external reference (optional, offline script).

## 6. Data model (sketch — refine in ARCHITECTURE.md)

```ts
type GameType = 'snooker' | 'pool';

interface TableSpec {
  id: string;                    // preset id, or 'custom'
  game: GameType;
  playingArea: { lengthM: number; widthM: number };
  ballDiameterM: number;
  pockets: { cornerMouthM: number; middleMouthM: number; /* jaw geometry params */ };
  cushionHeightM?: number;
  markings: Marking[];           // spots, baulk line, D, head string... generated per game
}

interface ClothSpec {
  colour: string;                // hex
  speedPreset: 'slow' | 'medium' | 'fast' | 'custom';
  slidingFriction: number;
  rollingResistance: number;
  spinningFriction: number;
  nap?: { directionRad: number; strength: number };
}

interface DiagramDoc {
  schemaVersion: 1;
  table: TableSpec;              // embedded in full when custom; presets may be referenced by id
  cloth: ClothSpec;
  balls: { id: string; x: number; y: number; confidence?: number }[];  // metres, table coords
  shot?: {
    cueBallId: string;
    aimAngleRad: number;
    tipOffset: { side: number; vertical: number };   // fraction of ball radius
    speedMps: number;
    elevationRad?: number;
  };
  annotations: Annotation[];
  source?: { kind: 'manual' | 'photo' };            // photo import never stores the image itself
  style?: DiagramStyle;
}
```

- All physics in **SI units**. Converting to mm/px happens only at the UI boundary.
- `confidence` on balls exists from v1 so photo-imported layouts can show uncertain balls without a schema change.
- The URL encodes `DiagramDoc` compactly (compressed JSON, base64url) with `schemaVersion` so old links keep working.

## 7. Table and ball presets (verify before encoding)
Encode in `packages/tables` with a source comment on every number. Verify against current WPBSA (snooker) and WPA (pool) equipment specifications and manufacturer data rather than trusting these values:
- Snooker 12 ft: playing area about 3569 × 1778 mm; ball diameter 52.5 mm; baulk line, D and spot positions from the rules.
- Snooker 10 ft and 6 ft: common home sizes; dimensions vary by manufacturer. Document the chosen values. Markings scale proportionally unless a source says otherwise.
- Pool 9 ft: playing surface 100 × 50 in (2540 × 1270 mm); ball diameter 2.25 in (57.15 mm).
- Pool 8 ft and 7 ft: dimensions vary by manufacturer; pick common values and document them.
- Pocket mouth widths and jaw geometry: approximate from specs; keep configurable.
- Custom tables: validate sane ranges (e.g. aspect ratio near 2:1 warning, pockets wider than a ball, ball diameter within 45–65 mm) and explain problems in plain words in the UI.

## 8. Phases and acceptance criteria

Each phase ends with: all checks green in CI, a short demo note in `docs/PROGRESS.md`, and a commit.

### Phase 0 — Foundations
- Monorepo, TypeScript strict, ESLint/Prettier, Vitest, GitHub Actions running typecheck + lint + test + build.
- `apps/web` deploys to Cloudflare Pages (placeholder page is fine).
- `docs/ARCHITECTURE.md` written: module boundaries, data model, physics API surface, how photo import will plug in, decisions log.
**Done when:** `pnpm check` (typecheck + lint + test) passes locally and in CI.

### Phase 1 — Physics core v1
- Table geometry generated from `TableSpec` (cushion segments, pockets) for any valid table.
- Ball state, motion equations for all states, coefficients from `ClothSpec`.
- Event loop with all events in 5.3, v1 collision models.
- Public API, e.g. `simulate(table, cloth, balls, shot, params) → SimResult` and `sampleAt(result, t) → BallPositions`.
- All table and cloth presets encoded in `packages/tables`.
- Full test suite from 5.8 (except v2-only items).
**Done when:** all 5.7 properties are covered by passing tests across presets and random custom tables, and a snooker break-off simulates in < 50 ms in a Node benchmark.

### Phase 2 — Editor MVP
- Render any table (all presets + custom) accurately in SVG with cloth colour, cushions, pockets and correct markings per game.
- Table setup panel: choose preset or custom dimensions, ball set, cloth colour and speed.
- Drag balls, snap to spots, add/remove balls, undo/redo. Balls with `confidence` below a threshold are visibly marked (needed later for photo import).
- Shot controls: aim (drag or click object ball), ghost ball, tip offset widget, speed slider.
- Live simulation on change; draw all ball paths, mark collision points.
- Angle measurement tool and cut-angle readout.
- Share via URL; PNG + SVG export.
- Usable on a phone in portrait and landscape.
**Done when:** a user can set up their own table by entering its dimensions, recreate a standard coaching diagram on it in under a minute, share the link, and it reopens identically.

### Phase 3 — Physics v2 (spin realism + nap)
- Throw, spin-aware cushion model, squirt, (optional) swerve with elevation.
- Snooker nap model (5.5).
- A debug panel in the web app to tweak coefficients live.
- Tests for each new effect in its known qualitative direction and approximate magnitude.
**Done when:** side-spin, throw and nap visibly and correctly change paths, all earlier invariants still hold.

### Phase 4 — Playback and polish
- Real-time and slow-motion animation of the shot.
- Styling options for exports (themes, line styles, labels).
- Built-in drill templates.
- Stretch: GIF/WebM export.

### Phase 5 — Photo → diagram (section 9)

## 9. Photo → diagram import (Phase 5)

### User flow
1. User picks a table (preset or custom) and taps "Import from photo". On a phone, this opens the camera; on desktop, a file picker.
2. The app shows guidance before capture: stand at a corner at roughly standing height, keep all six pockets in frame, avoid direct glare.
3. The pipeline runs **entirely in the browser**. The photo is never uploaded or stored.
4. The app shows the detected table outline and balls over the photo. The user can drag any of the four table corners if detection was off.
5. Detected balls appear on the diagram, each with an identity and confidence. Uncertain balls are highlighted. The user can drag balls, change a ball's identity, add missed balls or delete false ones.
6. The user confirms and continues in the normal editor.

### Pipeline
1. **Table localisation:** find the playing-surface boundary (cushion noses or pocket positions) and its four corners. Use cloth-colour segmentation with an adaptive colour model (works on any cloth colour), with a learned fallback if needed. Manual corner adjustment is always available.
2. **Homography:** map image coordinates to table-plane coordinates using the four corners and the known table dimensions from the selected `TableSpec`.
3. **Ball detection and identification:** a small object detector (YOLO-family, exported to ONNX, run with ONNX Runtime Web) trained on mixed public datasets plus the project's own photos. Classes per game (pool: cue, 1–15; snooker: cue, red, six colours). Identification of striped vs solid and numbers is best-effort; colour solids and snooker balls are the reliable cases.
4. **Height correction:** a ball's visible centre is one radius above the cloth. Project from the camera geometry implied by the homography (or approximate via the ball's contact point at its visible bottom) so far-end balls are not displaced. Without this, errors at the far end are large.
5. **Snap and sanity checks:** enforce no overlapping balls, keep balls inside the cushions, resolve duplicate identities by confidence.

### Accuracy targets (on a "decent phone photo" set)
- Table found automatically in ≥ 90% of photos where all four corners/pockets are visible.
- Ball position error: median ≤ 1.5 cm, 95th percentile ≤ 4 cm after height correction.
- Ball detection recall ≥ 95%; identity correct for ≥ 90% of solids/snooker balls; stripes may need manual confirmation.
- Whole pipeline ≤ 3 s on a mid-range phone.

### Evaluation
- Build a labelled set of at least 100 photos across different tables, cloth colours, lighting and angles (including deliberately poor ones), with ground-truth ball positions measured on the table or from a top-down reference shot.
- An evaluation script in `packages/vision` reports the metrics above. CI runs it on a small subset; the full run is manual.

### What Phases 1–2 must already provide
- `TableSpec` with exact playing-area dimensions (needed for the homography).
- `confidence` on balls in `DiagramDoc` and the UI treatment for low-confidence balls.
- A clean "load a layout into the editor" API, so photo import is just another layout source.

## 10. Open decisions (resolve in the kickoff interview)
1. Final project name and license.
2. Exact dimensions for the 10 ft and 6 ft snooker and 8 ft and 7 ft pool presets.
3. Which custom-table fields are required vs advanced (e.g. cushion height, jaw shape).
4. Cloth speed presets: how many, what to call them, which published values to base them on.
5. Whether nap is modelled at all in v1 physics, or only stored until Phase 3 (default: stored only).
6. React vs a lighter framework (default: React).
7. Whether the v1 cushion model includes spin, or is restitution-only until Phase 3.
8. How much cue elevation to support in v1 (default: none).
9. Coordinate origin and orientation convention (default: origin at bottom-left of playing surface, x along the long side, baulk/head at the bottom).
10. Photo import: whether to start collecting and labelling photos early (during Phases 2–4), since data is the slowest part of Phase 5.
11. Photo import: what to do when not all four corners are visible (refuse with guidance, or attempt with fewer constraints).

## 11. References
- Leckie, W. & Greenspan, M. (2006). *An Event-Based Pool Physics Simulator.*
- pooltool (Evan Kiefl), open-source Python billiards simulator, as design and numerical reference.
- Dr. Dave Alciatore's technical proofs on billiards physics (throw, squirt, 30° and 90° rules, cloth friction measurements).
- Mathavan, Jackson & Parkin (2010), ball–cushion impact dynamics.
- Han (2005), dynamics of carom billiards cushion impact.
- WPBSA and WPA official equipment specifications.
- Public pool/snooker ball datasets on Roboflow Universe (check each dataset's license; many are narrow, e.g. one table, top-down, green cloth only).

Treat these as starting points to read and verify, not as sources to copy code from. Note any license constraints if borrowing algorithms, constants or data.

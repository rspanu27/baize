# Baize architecture

Companion to [SPEC.md](SPEC.md). Where this file and the spec disagree, this file wins; every such difference is in the [decisions log](#10-decisions-log).

## 1. Package layout and module boundaries

```
packages/tables   No dependencies at all. Types, preset data, pure helpers.
packages/physics  No runtime dependencies. devDependencies: @baize/tables (tests only), vitest, fast-check.
packages/vision   Phase 5. Depends on @baize/tables (types). ONNX Runtime Web allowed.
apps/web          Vite + React + Zustand. Depends on physics and tables (vision later).
```

Dependency direction: `web -> physics`, `web -> tables`, `vision -> tables`. Nothing depends on `web`. `physics` never imports `tables` from `src/`.

### packages/tables

| Module | Contents |
|---|---|
| `types.ts` | `TableSpec`, `BallSetSpec`, `ClothSpec`, `BallKind`, `Layout`, `CustomTableFields`, `ValidationIssue` |
| `presets/tables.ts` | Table presets. A source comment on every number. |
| `presets/balls.ts` | Ball sets. |
| `presets/cloth.ts` | Cloth colour presets and speed presets. |
| `validate.ts` | `validateTable`, `resolveCustomTable` (fills derived defaults). Plain-word messages. |
| `markings.ts` | `markingsFor(table)`, `spotsFor(table)`. Derived, never stored. |
| `racks.ts` | `rackLayout(table, ballSet, rack)`. |
| `layout.ts` | `sanitizeLayout(layout, table, ballSet)`: no overlaps, inside cushions, duplicate identities resolved by confidence. |

### packages/physics

| Module | Contents |
|---|---|
| `types.ts` | Input and result types (section 3). |
| `math/vec.ts`, `math/trig.ts`, `math/quadratic.ts`, `math/roots.ts` | Vector helpers, deterministic `sinCos`, stable quadratic, `firstDownCrossing`. |
| `motion.ts` | Segment construction, evaluation, transition times, state classification. |
| `geometry.ts` | `buildTableGeometry`. |
| `detect.ts` | Event time functions and the contact rule. |
| `models/ballBall.ts`, `models/cushionHan.ts`, `strike.ts` | Collision models and cue strike. |
| `simulate.ts` | Scheduler, same-instant resolution, caps, result assembly. |
| `sample.ts` | `sampleAt`, `kineticEnergy`. |
| `index.ts` | Public API only. |

`physics` declares its own minimal input interfaces (`TableInput`, `ClothInput`, `BallInput`). The `tables` types are structural supersets; a type-level test in `packages/physics/test` proves `TableSpec extends TableInput` and `ClothSpec extends ClothInput`. This keeps `physics` installable alone and avoids a dependency cycle.

Lint guards on `packages/physics/src`: relative imports only; `Math.random`, `Date.now`, `performance.now` and every `Math` transcendental (`sin`, `cos`, `tan`, `atan2`, `acos`, `asin`, `atan`, `pow`, `exp`, `log`, `cbrt`, `hypot`) are banned. `Math.sqrt`, `Math.abs`, `Math.min`, `Math.max`, `Math.floor` are allowed.

### apps/web

```
src/doc/        DiagramDoc, resolveDoc, URL codec, migrations. Pure, no React.
src/store/      Zustand store: doc + undo/redo, ui state, loadLayout.
src/sim/        Simulator interface, frame-coalesced re-simulation, path model.
src/geometry/   Ghost ball, cut angle, line angles, distances. Pure.
src/units/      Metric/imperial formatting and parsing. Pure.
src/components/ Table, balls, paths, shot controls, panels.
src/export/     SVG and PNG export.
```

## 2. Coordinates and units

- SI everywhere in `physics`, `tables` and `DiagramDoc`: metres, seconds, radians, kilograms.
- Origin at the baulk/head-end left corner of the playing area, which is the cushion-nose rectangle. `x` runs across the width (`0..W`), `y` along the length (`0..L`) towards the top/foot end, `z` up. Right-handed.
- Angles are measured counter-clockwise from `+x`. An aim of `pi/2` points straight up the table.
- Screen orientation (portrait or landscape) is a single view transform in `apps/web`. Conversion to mm, inches or pixels happens only there.

## 3. Data model

```ts
// packages/tables
type GameType = 'snooker' | 'pool' | 'blackball';      // drives markings and default ball set

interface TableSpec {
  id: string;                                          // 'snooker-12@1', ... or 'custom'
  name: string;
  game: GameType;
  playingArea: { lengthM: number; widthM: number };    // cushion nose to cushion nose
  pockets: {
    cornerMouthM: number;
    middleMouthM: number;
    jaw: { style: 'angled' | 'rounded'; angleRad?: number; radiusM?: number };
    dropRadiusM: number;                               // derived for custom tables
    dropSetbackM: number;                              // derived for custom tables
  };
  cushion: { noseHeightM: number; restitution: number; friction: number };
  defaultBallSetId: string;
}

interface BallSetSpec {
  id: string;
  kinds: BallKind[];
  object: { diameterM: number; massKg: number };
  cue?: { diameterM: number; massKg: number };         // only when the cue ball differs
  restitution: number;                                 // ball-ball
}

interface ClothSpec {
  colour: string;                                      // hex, visual only
  speedPreset: 'slow' | 'medium' | 'fast' | 'custom';
  slidingFriction: number;
  rollingResistance: number;
  spinningFriction: number;
  nap?: { directionRad: number; strength: number };    // stored from v1, ignored until Phase 3
}

interface Layout {
  balls: { kind: BallKind; x: number; y: number; confidence?: number }[];
}

// apps/web/src/doc
interface DiagramDoc {
  schemaVersion: 1;
  table: { preset: string } | { custom: CustomTableFields };
  ballSet: { preset: string; diameterM?: number; cueDiameterM?: number };
  cloth: ClothSpec;
  balls: { id: string; kind: BallKind; x: number; y: number; confidence?: number }[];
  shot?: {
    cueBallId: string;
    aimAngleRad: number;
    tipOffset: { side: number; vertical: number };     // fraction of ball radius
    speedMps: number;                                  // cue-ball speed just after the strike
    elevationRad?: number;                             // reserved; must be 0 or absent in v1
  };
  annotations: Annotation[];
  source?: { kind: 'manual' | 'photo' };
  style?: DiagramStyle;
}
```

`CustomTableFields` holds only what the user enters: game, length, width, corner mouth, middle mouth, and optionally jaw shape. `resolveCustomTable` turns it into a full `TableSpec`.

`resolveDoc(doc)` produces the scene the renderer and the simulator use: `{ table: TableSpec, ballSet: BallSetSpec, cloth: ClothSpec, balls }`.

### URL format

`#v1.<c|u>.<payload>`. The doc is written as compact JSON with positions quantised to 0.01 mm, then deflated with the built-in `CompressionStream` (`c`) or left uncompressed (`u`, fallback), then base64url. No dependency. Any change to the format needs a `schemaVersion` bump and a migration in `src/doc/migrations.ts`.

Preset ids are immutable once the project is public. A corrected preset gets a new revision (`pool-9@2`); the old one stays resolvable so old links never change meaning.

## 4. Physics API

```ts
prepareTable(table: TableInput): PreparedTable      // geometry + derived constants; reuse across drags
buildTableGeometry(table: TableInput): TableGeometry
strike(ball: BallInput, shot: ShotInput): BallKinematics
simulate(input: SimInput, params?: Partial<SimParams>): SimResult
sampleAt(result: SimResult, t: number): BallSample[]
kineticEnergy(result: SimResult, t: number): number

interface SimInput {
  table: TableInput | PreparedTable;
  cloth: ClothInput;
  balls: BallInput[];        // id, radiusM, massKg, x, y, optional initial velocity and spin
  shot?: ShotInput;          // ballId, aimAngleRad, speedMps, tipOffset, elevationRad
  models?: { ballBall?: BallBallModel; cushion?: CushionModel };
}

interface SimParams { gravity: number; maxEvents: number; maxTimeS: number; /* tolerances */ }

interface SimResult {
  status: 'complete' | 'eventLimit' | 'timeLimit';
  events: SimEvent[];        // ordered; type, time, ball ids, geometry id, contact point
  tracks: BallTrack[];       // one per ball, in input order
  durationS: number;
  stats: SimStats;           // event counts, root-finder calls
}

interface Segment {
  t0: number;                // absolute start time
  state: 'stationary' | 'spinning' | 'sliding' | 'rolling' | 'pocketed';
  r0: Vec2; v0: Vec2; a: Vec2;          // position = r0 + v0*tau + a*tau^2/2
  omega0: Vec3; alpha: Vec3;            // spin, linear in tau, vertical component clamped at zero
}
```

- Invalid input (overlapping balls beyond tolerance, ball outside the table, non-zero elevation, tip offset past the miscue limit, non-finite numbers) throws `SimInputError` with a code.
- Hitting a cap does not throw. The result carries what was simulated plus `status`, so the editor can draw it with a warning.
- Every path piece is a parabola, so it converts exactly to an SVG quadratic Bezier with control point `r0 + v0*T/2`.

## 5. Motion model

Ball: radius `R`, mass `m`, inertia `2/5 m R^2`. Slip of the contact point on the cloth: `u = v + R (z x omega)`.

| State | Acceleration | Ends at |
|---|---|---|
| sliding | `-mu_s g u_hat`, direction constant for the whole slide | `2 |u0| / (7 mu_s g)`, then rolling |
| rolling | `-mu_r g v_hat` | `|v0| / (mu_r g)`, then spinning or stationary |
| spinning | none | `2 R |omega_z| / (5 mu_sp g)`, then stationary |
| stationary, pocketed | none | never |

- Vertical spin decays linearly at `5 mu_sp g / (2R)` in every state and is clamped at zero. It does not affect translation in v1 (no swerve).
- `mu_s`, `mu_r`, `mu_sp` come from `ClothInput`. `g` is `SimParams.gravity`. The engine holds no cloth or table constants.
- State after any impulse is classified from `|v|`, `|u|` and `|omega_z|` against tolerances.

**The one structural rule: constant acceleration vector per segment.** Positions are therefore quadratic in time for every state, which is all the event maths assumes.

### Nap (Phase 3 plan)

Nap adds a direction-dependent change to rolling resistance and a small lateral acceleration, both evaluated from the heading at segment start. Because heading then changes within a segment, a "re-evaluate" event ends the segment when the heading has turned by more than a set bound or the speed has dropped by a set factor. Error is bounded by those bounds; segments stay quadratic; collision maths is untouched. Direction is fixed baulk to top in the UI; the stored angle is kept for the future.

### Cue strike (v1)

Level cue. `speedMps` is the cue-ball speed after the strike, along the aim direction. Spin follows from the impulse acting at the tip offset `(a, b)` (fractions of `R`): roll-axis spin `5 v b / (2R)`, vertical spin `5 v a / (2R)` with sign by the coordinate convention. `b = 0.4` gives natural roll. Offsets beyond the miscue limit are rejected. Squirt arrives with v2.

## 6. Table geometry

`buildTableGeometry` turns any valid `TableInput` into:

- **Segments:** one-sided lines with an inward normal (rails and jaw facings).
- **Arcs:** convex circular arcs (jaw knuckles). Radius 0 is a sharp jaw point.
- **Pocket zones:** one drop circle per pocket.

Rails are cut back at each pocket by the mouth width. Jaw facings and knuckles are generated from mouth width and jaw shape: `angled` for pool, `rounded` for snooker, blackball and Chinese 8-ball. Middle pockets sit on the long rails (`x = 0` and `x = W`) at `y = L/2`. Order and ids are stable (`rail:left-lower`, `jaw:corner-bl:a`, ...).

Cushion contact uses the real nose: a ball touches a nose of height `h` when its centre is `sqrt(R^2 - (h - R)^2)` from the nose line, computed per ball.

Guarantees, tested on every preset and on random custom tables: the boundary is closed (a ball of the smallest radius in play cannot leave without hitting a primitive or a drop circle), and the geometry is mirror-symmetric. The engine also fails loudly if a ball centre ever leaves the outer bounds.

A ball is potted when its centre crosses a drop circle. There is no slate-edge or shelf physics; results close to the jaws are approximate and documented as such.

## 7. Events and numerical strategy

### Root finding

One routine, `firstDownCrossing(poly, T, accept)`, for a polynomial of degree at most 4 on `[0, T]`:

1. Roots of `f''` (quadratic, stable closed form) split the window into monotone pieces of `f'`.
2. Each piece gives at most one root of `f'`, found by safeguarded Newton/bisection.
3. Roots of `f'` split the window into monotone pieces of `f`. Pieces where `f` decreases are scanned in order.
4. A crossing is refined by safeguarded Newton/bisection until the bracket cannot shrink. Iterations are capped.

No complex arithmetic and no Ferrari formula. A vanishing leading coefficient needs no special case. The window is always finite: `T` is the earliest segment end of the balls involved, and at least one of them is moving. `accept` lets the caller reject a crossing (for example, outside an arc's angular range) and continue to the next.

Users: ball-ball (`|dr(t)|^2 - (R1+R2)^2`), ball-arc and ball-pocket (`|r(t) - c|^2 - rho^2`). Ball-segment is the degree-2 case plus a check that the contact lies within the segment.

### Contact rule

With `f` the gap function:

- A collision is the first time `f <= 0` while `f' < 0`.
- A pair that starts in contact and is separating is ignored until it has separated.
- A pair that starts in contact and is closing collides immediately.
- A pair in contact with zero closing speed collides only once it has penetrated by a tiny bound. This prevents zero-time loops.

The engine never moves a ball to fix an overlap. Collisions change velocities only.

### Same-instant resolution

After any collision, every touching neighbour of the affected balls (balls and cushion primitives) with closing speed is resolved at the same time, in a fixed order (ball index, then geometry index), until none remain. Closing speeds below a threshold are resolved as perfectly inelastic along the normal, so the loop always ends. This is how frozen balls and tight racks are handled.

### Scheduler

- Each ball has one current segment. Only balls involved in an event get a new segment; nothing else is re-based, so there is no drift and tracks stay minimal.
- Cached per ball: transition time. Cached per pair and per ball-primitive: next event time. A cache entry is recomputed only when one of its balls gets a new segment.
- The next event is a linear scan (at most 22 balls). Ties are broken by (time, event type rank, ball index, other index).
- Broad phase: bounding boxes of the paths over the search window reject most pairs; a ball whose box stays well inside the playing rectangle skips all cushion, jaw and pocket tests.
- Caps: `maxEvents` and `maxTimeS`.

### Determinism

- The core uses only `+ - * /` and `Math.sqrt`, which are bit-exact on every JavaScript engine. `Math.sin` and friends are not, so the aim angle goes through the in-package `sinCos`, and the cushion model gets its angle from `sqrt`.
- No `Math.random`, no clocks, no iteration over unordered collections in the loop. Balls are processed in input order.

### Collision models

Both are pure functions behind interfaces, and both are tested for no energy gain.

- `BallBallModel` v1: instantaneous, frictionless, restitution from the ball set, unequal masses supported. Spins are unchanged. Momentum is conserved exactly.
- `CushionModel` v1: Han 2005, with cushion height and spin. Implemented from the paper's equations, not from another code base. The vertical velocity it produces is discarded because there is no airborne state; that only removes energy.

## 8. Editor architecture

- Store: `doc` (the only persisted, shareable state) with snapshot undo/redo; separate transient `ui` state (selection, tool, panels). Unit preference lives in `localStorage`, not in the doc.
- `loadLayout(layout, { source, mode })` is the single entry point for putting balls on the table and is one undoable step.
- Simulation is derived from the resolved scene, recomputed at most once per animation frame during drags, behind a `Simulator` interface so it can move to a Worker if measurements call for it.
- The table SVG draws the engine's own geometry in table coordinates under one view transform.
- Paths: cue ball and first object ball drawn strongly, others faint, final positions as outlines, with a show-all toggle. A "physics v1: no throw or squirt" note is shown in the editor and in exports until Phase 3.

## 9. Photo import integration points

Phase 5 must be additive. These pieces exist from Phases 1-2:

| Need | Provided by |
|---|---|
| Exact playing area for the homography | `TableSpec.playingArea` |
| Nose height and ball radius for height correction | `TableSpec.cushion.noseHeightM`, `BallSetSpec` |
| A layout exchange type | `Layout` in `tables` |
| Snap and sanity checks (pipeline step 5) | `sanitizeLayout` in `tables` |
| Loading a layout into the editor | `loadLayout` store action |
| Uncertain balls | `confidence` on balls, low-confidence marker in the ball renderer; dragging a ball clears its confidence |

`packages/vision` will export `importPhoto(image, table, ballSet) -> { corners, layout, diagnostics }`. The review screen keeps the photo in component state only. It never enters the store, the undo history, the URL or any storage. `source.kind` becomes `'photo'`.

Phase 5 parameters fixed at kickoff: single photo through the system camera or file picker; automatic table detection needs all four corners, otherwise the user places four corner handles, which may sit outside the image; position targets scale with table length (median <= 0.6%, 95th percentile <= 1.5%); time <= 3 s with WebGPU, <= 8 s on WASM. Photo collection starts in Phase 5.

## 10. Decisions log

| Date | Decision | Why |
|---|---|---|
| 2026-11-11 | Name stays "Baize" / `@baize/*` for now. License MIT from the first commit. | Kickoff interview. pooltool is Apache-2.0: used as a reference only, no code copied. |
| 2026-11-11 | Snooker 10 ft and 6 ft dimensions are researched from manufacturers and signed off by the project owner before encoding. | Sizes vary by maker; no numbers from memory. |
| 2026-11-11 | Pool presets: 9 ft, 8 ft (88x44 in), 8 ft pro (92x46 in), 7 ft (78x39 in), 7 ft Valley (74x37 in). Extra presets: UK blackball 7 ft and 6 ft, Chinese 8-ball 9 ft. | Interview. |
| 2026-11-11 | Custom table: required fields are game, length, width, ball diameter, corner mouth, middle mouth. Advanced: jaw shape only. Cushion height, drop geometry and ball mass are derived. | Interview. |
| 2026-11-11 | Ball size moves from `TableSpec` to `BallSetSpec`; the engine supports per-ball radius and mass. | Some setups (blackball, bar boxes) have a different cue ball. Cheap now, costly to retrofit. Differs from the spec sketch. |
| 2026-11-11 | Ball sets: snooker 15/10/6 red; pool 8-ball, 9-ball, straight 15 rack; blackball reds and yellows. No 10-ball rack. | Interview. |
| 2026-11-11 | Cloth: three speed presets plus raw coefficients. Seven colour presets plus custom. Rails follow the cloth; no second stored colour. | Interview. |
| 2026-11-11 | Nap is stored only until Phase 3. UI will offer none / light / heavy with direction fixed baulk to top. | Interview; no validated nap coefficients yet. |
| 2026-11-11 | React + Zustand. | Spec default; matches the `ui-builder` agent. |
| 2026-11-11 | v1 cushion model is Han 2005 behind `CushionModel`. | Restitution-only would draw wrong paths for side spin and rolling balls, against "correct before pretty". |
| 2026-11-11 | v1 ball-ball stays frictionless behind `BallBallModel`; the editor labels the missing throw and squirt. | Keeps exact conservation tests simple; honest labelling instead of silent error. |
| 2026-11-11 | No cue elevation in v1. Field reserved; non-zero values rejected. | Spec default. |
| 2026-11-11 | Coordinates: corner origin at the baulk/head end, `x` across, `y` along the length. | The spec default was ambiguous. All-positive coordinates, matches common references. |
| 2026-11-11 | Pockets: real jaw geometry, simple drop circle, no shelf physics. | Rattles and rejections matter; full pocket physics is research-grade. |
| 2026-11-11 | `shot.speedMps` is cue-ball speed after the strike, not cue speed. | It is what players and readouts mean, and removes cue mass from v1. |
| 2026-11-11 | Markings are derived, not stored on `TableSpec`. Balls in `DiagramDoc` carry a `kind`. | Smaller URLs, no stale data; the spec sketch had no ball identity. |
| 2026-11-11 | `DiagramDoc` and the URL codec live in `apps/web/src/doc`, `Layout` lives in `tables`. | Vision needs `Layout` without importing the app; a fifth package is not justified yet. |
| 2026-11-11 | Preset ids are immutable once public; corrections get a new revision. | Old links must keep their meaning. |
| 2026-11-11 | Physics input types are declared in `physics`; `tables` types are structural supersets, checked by a type-level test. | Physics stays dependency-free and installable alone, with no cycle. |
| 2026-11-11 | Roots by derivative bracketing, not Ferrari or companion-matrix eigenvalues. | Robust, sqrt-only (bit-exact), handles degenerate leading coefficients, finds the first crossing directly. |
| 2026-11-11 | Core arithmetic limited to `+ - * /` and `sqrt`; own `sinCos`. | Bit-identical results across browsers, so a shared link shows the same paths everywhere. |
| 2026-11-11 | Simultaneous contacts are resolved pairwise in a fixed order; sub-threshold closing speeds are inelastic. | Deterministic and energy-safe. Known limitation: for exactly simultaneous multi-ball contact the outcome depends on that order. |
| 2026-11-11 | Caps return a partial result with a status; invalid input throws. | The editor can still draw something useful. |
| 2026-11-11 | Cushion contact distance uses the nose height, per ball. | About 1 mm on a snooker ball; free to do correctly. |
| 2026-11-11 | Deployment by Cloudflare Pages Git integration. Running cost target is zero. | Interview: free tiers only, no paid services, no analytics, one lean CI job. |
| 2026-11-11 | Units: metric/imperial toggle as a browser preference. Speed slider with named stops. Path emphasis on cue ball and first object ball. | Interview. |
| 2026-11-11 | Priority if time is short: physics correctness first; export, measuring tool and mobile polish slip first. | Interview. |
| 2026-11-11 | Photo import: collection starts in Phase 5; manual corner handles may sit off-image; accuracy targets scale with table length; single photo through the system camera. | Interview. |

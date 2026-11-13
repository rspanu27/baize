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
| `models/ballBall.ts`, `models/cushion.ts`, `strike.ts` | Collision models and cue strike. |
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
  pockets: { corner: PocketSpec; middle: PocketSpec };
  cushion: { noseHeightM: number; restitution: number; friction: number };
  defaultBallSetId: string;
}

interface PocketSpec {
  mouthM: number;            // width of the opening where the two jaw facings begin (after the knuckle arcs)
  jawRadiusM: number;        // knuckle arc radius; 0 = sharp point
  facingAngleRad: number;    // angle between rail nose line and jaw facing; pi/2 = square
  dropRadiusM: number;       // drop circle (the slate cut): a ball is potted when its centre enters
  dropSetbackM: number;      // drop circle centre, measured outwards from the pocket origin along the pocket axis; may be 0
}

interface BallSetSpec {
  id: string;
  kinds: { kind: BallKind; count: number }[];
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

`CustomTableFields` holds only what the user enters: game, length, width, corner mouth, middle mouth, and optionally jaw style (`angled` or `rounded`). `resolveCustomTable` turns it into a full `TableSpec`.

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

### Nap

Nap is a constant push b along the nap on every rolling ball (`ClothInput.napDrift`: direction, and size as a fraction of g), as if the bed sloped very slightly down towards the top cushion. One vector gives the three things players report: a ball runs further with the nap than against it; a ball crossing the nap drifts the way the nap runs; a ball going against the nap at an angle falls away from its line, while one going with it is straightened. Sliding balls and balls at rest are not affected, and the push must stay below 0.8 of the rolling resistance.

The exact motion, v' = -mu_r g v_hat + b, is not a polynomial in time, so a roll on a napped cloth is followed in pieces. Each piece is an ordinary constant-acceleration segment, -mu_r g h + b, with h the heading predicted for the middle of the piece (midpoint rule). A piece ends when the heading has turned by 0.03 rad or the speed has fallen to 85 % of what it was; the next piece starts from the velocity actually reached. When less than 10 micrometres of roll is left, the last piece is straight. Against a fine numerical integration of the exact equation the stopping point is within 1 % of the nap's whole effect, for pushes from 1 % to 80 % of the rolling resistance. Speed falls throughout every piece, so the energy invariant holds. Pieces of one roll are segments in the track but not events. Collision maths is untouched.

The document stores a strength from 0 to 1; `napDrift()` in `packages/tables` turns it into the push (0.03 of the rolling resistance at full strength, UNVERIFIED). Direction is fixed baulk to top in the UI; the stored angle is kept for the future. Not modelled: the effect of side spin on a napped cloth (side "taking" one way with the nap and the other way against it).

### Cue strike (v1)

Level cue. `speedMps` is the cue-ball speed after the strike, along the aim direction. Spin follows from the impulse acting at the tip offset `(a, b)` (fractions of `R`): roll-axis spin `5 v b / (2R)`, vertical spin `5 v a / (2R)` with sign by the coordinate convention. `b = 0.4` gives natural roll. Offsets beyond the miscue limit are rejected. Squirt arrives with v2.

## 6. Table geometry

`buildTableGeometry` turns any valid `TableInput` into:

- **Segments:** one-sided lines with an inward normal (rails and jaw facings).
- **Arcs:** convex circular arcs (jaw knuckles). Radius 0 is a sharp jaw point.
- **Pocket zones:** one drop circle per pocket.

Rails are cut back at each pocket by the mouth width. Each jaw is a knuckle arc (`jawRadiusM`, turning from the rail direction to the facing direction) followed by a straight facing that runs until it meets the drop circle, so the boundary is closed by construction. Pool jaws have a near-zero radius; snooker, blackball and Chinese 8-ball jaws have a large one. The custom-table jaw style only picks defaults for these numbers. Middle pockets sit on the long rails (`x = 0` and `x = W`) at `y = L/2`. Order and ids are stable (`rail:left-lower`, `jaw:corner-bl:a`, ...).

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

After any collision the affected balls' event times are recomputed. A touching neighbour that is now being closed on reports an event at the same instant, and that is resolved next, in the fixed scan order. Two rules make such chains end:

- Closing speeds below `INELASTIC_SPEED` (1 cm/s) are resolved with no rebound.
- A ball that leaves a collision with both speed and slip below `REST_SPEED` (1 cm/s) is put to rest. If that leaves its partner still closing on it, the remaining closing speed is taken out of the partner.

This is how frozen balls and tight racks are handled.

### Slow contacts and pressing: the cluster solver

A collision closing slower than `INELASTIC_SPEED` is not resolved as a lone pair. A line or pack of touching balls would need hundreds of pairwise events to agree on a common speed, and balls pushed together by friction (a rolling ball behind a sliding one, a train of balls pushed along a rail) would trade microscopic collisions for as long as they stay together. Instead, `resolveCluster` takes the pair and every ball touching it, directly or through a chain, and solves the cluster in one event, by relaxation in a fixed order:

1. **Speeds.** Closing speeds between touching balls are removed (no rebound). Momentum is kept between sliding balls; a rolling ball keeps rolling, so the cloth takes part of the impulse and the pair's momentum changes by a small amount (at most about a sixth of the closing speed, which is itself below 1 cm/s). A ball left below the rest threshold is stopped and then treated as immovable. A ball whose slip is below the threshold is put into natural roll.
2. **Accelerations.** Where friction would push two touching balls together, they get the mean acceleration along their line of centres, which is what the contact force between them does.

A rolling ball stays rolling through all of this, so part of every push goes into its rotation: along the line of centres it behaves like a mass of 7/5 m and its spin follows its velocity. A sliding ball takes the push on its velocity alone.

The shared accelerations keep every segment a constant-acceleration segment, conserve momentum and cannot add energy (the weighted mean of squares is never below the square of the weighted mean). They last until the earliest of: a rolling ball's natural stop, a pushed-back ball turning round, a sliding ball's slip running out, 50 ms (the lines of centres turn as balls move), or anything else happening to a ball in the group. Then the group is released and each ball is re-classified from its actual velocity and spin.

Contacts closing faster than `INELASTIC_SPEED` are never touched by the solver; they come back from the event loop as ordinary collisions.

A ball left with no speed into a cushion but with friction pushing it in is held by the cushion in the same spirit: the inward part of its acceleration is removed.

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
- `CushionModel` v1 (`noseImpulseCushion`): an impulse at the cushion nose with restitution and Coulomb friction, sticking or sliding, accounting for spin and nose height. It uses Han's (2005) formulation of the contact but is derived from first principles in `models/cushion.ts`, not transcribed from the paper or from another code base. The vertical velocity it produces is discarded because there is no airborne state; that only removes energy.

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
| 2026-11-11 | Pockets are described per type by five numbers (`mouthM`, `jawRadiusM`, `facingAngleRad`, `dropRadiusM`, `dropSetbackM`); jaw style is only a custom-table input that picks defaults. Facings run until they meet the drop circle. | One geometry code path for angled and rounded jaws; closure is guaranteed by construction instead of by a separate facing-length number. Replaces the `jaw: { style, ... }` sketch. |
| 2026-11-11 | Ball-ball restitution is a required `SimInput` field, taken from the ball set. | The engine holds no material constants. |
| 2026-11-11 | The v1 cushion model is a first-principles nose-impulse model in Han's formulation, not a transcription of Han 2005. In the sliding case friction opposes the actual slip direction. | The paper was not available to check equation by equation, and copying another project's implementation was ruled out. For a sphere the slip direction cannot change during the impact, so this is the exact Coulomb result under the same assumptions, and it passes a no-energy-gain property test. To be compared against the paper and pooltool in Phase 3. |
| 2026-11-11 | `mouthM` is the opening where the jaw facings begin (the ends of the knuckle arcs). | Equals the point-to-point mouth on pool tables and the end-of-curve opening on snooker tables, which is how each is conventionally measured. |
| 2026-11-11 | Contact tolerances: 0.1 um penetration bound, 1e-9 m/s closing-speed bound (later 1e-6, see below), 20 um input overlap allowed (`TOUCH_TOLERANCE_M`). | Link positions are quantised to 10 um, so touching balls can reload slightly overlapping. |
| 2026-11-11 | Rest threshold: a ball leaving a collision below 1 cm/s in both speed and slip is stopped; closing speeds below 1 cm/s do not rebound. | Found by profiling a snooker break: without it, balls nudged inside the pack traded thousands of microscopic collisions and the run never finished. At 1 cm/s a rolling ball would travel about 0.5 mm more, so the visible error is negligible. It only removes energy. |
| 2026-11-11 | Pressing contact: a touching pair pushed together by friction shares its acceleration along the line of centres until either segment ends. | Impulses cannot represent a sustained contact force; this keeps segments quadratic, conserves momentum and cannot add energy. |
| 2026-11-11 | Closing-speed tolerance for pairs that start in contact raised to 1e-6 m/s. | Supersedes the earlier 1e-9 m/s; values below it are rounding noise after a no-rebound contact. |
| 2026-11-12 | "Touching" in the contact rule means a gap of at most 0.1 um, not exactly zero. A ball left with no speed into a cushion but with friction pushing it in is held by the cushion (that part of its acceleration is removed). | Found by a verification test: a slow ball grazing a rail left it by a rounding error and re-touched it every two nanoseconds until the event cap. |
| 2026-11-12 | Slow contacts are solved per touching cluster in one event (`resolveCluster`), with rolling balls treated as 7/5 m along the push. A slip below 1 cm/s is settled straight to natural roll. | Found by a 12,000-scene soak run: a row of balls frozen to a rail and each other, struck along the rail, took thousands of pairwise events. Now 15. Supersedes the pairwise pressing rule added the day before. |
| 2026-11-12 | Break shots simulate in about 1 ms (9-ball break 0.6 ms, snooker break-off 0.8 ms, hard snooker pack split 1.0 ms; medians in Node on the development machine), so simulation stays on the main thread. | The spec limit is 50 ms. No Worker is needed for Phase 2. |
| 2026-11-12 | `dropSetbackM` is measured from the pocket origin (the corner of the nose rectangle, or the middle of the opening on the nose line), not from the line joining the facing starts. Defaults: 0 for corners, half the mouth for middles. | Review finding: with rounded jaws the old reference sat a ball radius behind the nose, so balls came to rest inside the pocket without being potted. |
| 2026-11-12 | A ball placed over a drop circle is rejected (`ball-in-pocket`), and `sanitizeLayout` moves such balls out. Input overlap tolerance raised to 50 um. | Review findings: a resting ball over a pocket was never potted until touched; a sanitised layout could fail validation after a link round-trip. |
| 2026-11-12 | Spin decaying on the spot does not count against `maxTimeS`. | Review finding: every ball was already in its final place, yet the run reported `timeLimit`. |
| 2026-11-12 | Known limits kept after the Phase 1 review: a ball can come to rest hanging on a jaw, slightly outside the nose rectangle (a later shot must sanitise it first); closure for ball centres is tested by simulation, not proved for hand-written presets with unusual drop circles; tunnelling is checked by the root finder's own tests plus sampling inside every segment, not by an analytic minimum-distance check. | Recorded so they are not mistaken for guarantees. |
| 2026-11-12 | Cushion model validated against pooltool. It matches pooltool 0.6.0's Han 2005 implementation to rounding error (1e-15 relative) on 1,080 impacts, and the result is pinned by `test/models/cushion-reference.test.ts` with data from `scripts/pooltool_cushion_reference.py`. No change to the model was needed. | Requested by the project owner before Phase 2. pooltool is Apache-2.0; only numbers produced by running it are stored. |
| 2026-11-12 | Han's paper itself could not be read (paywalled). From the pooltool author's notes on it, the paper's sliding case directs friction by the incidence angle of the ball, and his 2020 write-up compares the stick impulse with the normal impulse without the friction coefficient. Baize and current pooltool both use the Coulomb forms instead: friction opposes the actual slip at the contact point, and the contact sticks only if the impulse needed is within friction times the normal impulse. | The Coulomb forms are the physically correct ones (with the paper's form, side spin would not affect a sliding contact). Recorded because "matches Han" here means "matches Han as implemented and corrected in pooltool", not "checked against the paper". |
| 2026-11-12 | Measured distance from pooltool's Mathavan 2010 model (which integrates through the impact and includes the table's friction), over the same impacts: rebound speed differs by a median of 2.4 % of the incoming speed (90th percentile 9.6 %), rebound direction by a median of 2.6 degrees (90th percentile 8.4, worst 19). With Baize's default cushion values the worst cases are 9 % and 10 degrees. A plain rolling ball with no side: 1.1 % and 1.9 degrees at the median. The gap is largest for square-on impacts (speed), mid angles with backspin or heavy check side (direction), and high cushion noses. | This is the known error of the v1 cushion model. Mathavan is planned for Phase 3; the test pins the gap so it cannot grow unnoticed. |
| 2026-11-13 | Ball paths are drawn as polylines within 0.1 mm of the exact parabolas, not as SVG quadratic curves; ball labels are drawn at a normal font size inside a scaled group. | A user saw the table replaced by a huge black and white shape at some aim angles in Chrome. It could not be reproduced locally, so the two riskiest things in a drawing made in metres were removed: degenerate quadratics (control point on the end point, hairpins) under a dashed round stroke, and font sizes of a few hundredths of a unit. The path model still holds the exact curves. |
| 2026-11-13 | The editor page never scrolls: play bar and table on one side, panels scrolling on their own. Playback state lives in the editor shell, keyed by the document, so any edit ends it. "Continue from result" is a document operation (`continueFromShot`) and one undo step. | The table must stay in view while using the panel, and playing a shot must be findable without scrolling. |
| 2026-11-13 | The editor always draws the table lengthways, on phones too; the portrait view transform stays in the code but is unused. | With the table fixed at the top and the panels below, a lengthways table on an upright phone is larger (full width) and leaves more room for the panels than an upright one. |
| 2026-11-13 | "Copy link" replaces the document with the one the link carries (one undo step) when they differ. | A link stores positions to 0.01 mm. A hard shot into a pack is sensitive even to that, so without this the receiver could see different paths from the sender. Found by the Playwright smoke test. The URL format is unchanged. |
| 2026-11-13 | The end-to-end test (`pnpm --filter web test:e2e`, Playwright, headless Chromium) is separate from `pnpm check`. | It needs a browser download and a dev server; `pnpm check` stays fast and dependency-free. CI runs both. |
| 2026-11-13 | Physics version 2 models are opt-in in the engine (`SimInput.models`, `ShotInput.cueEndMassKg`); the engine's defaults stay version 1. The editor always simulates with the newest models, and the document does not record which. | No existing physics test or golden snapshot had to change. A link stores the setup, not the result, and both ends run the same deployed app, so they still see the same shot; an old link may show a different result after a physics upgrade, which is the intent. |
| 2026-11-13 | Throw: ball-ball friction as a single impulse against the relative surface velocity at the contact point, with a speed-dependent coefficient mu = a + b exp(-c v) and a cap at the impulse that stops the rubbing. The vertical part of the friction impulse changes spins but not velocities. | Matches the standard treatment (Alciatore TP A.14, pooltool's frictional model). The cap is what makes outside "gearing" side give no throw and guarantees no energy gain. Balls cannot leave the bed in this engine, so the vertical impulse is dropped from the velocities, which only loses energy. |
| 2026-11-13 | `expNeg` (exp(-x) by range reduction and a Taylor kernel) joins `sinCos` as an in-package deterministic function. | `Math.exp` is not bit-identical across engines; the friction law needs an exponential. |
| 2026-11-13 | Squirt formula derived in `strike.ts` from a no-slip tip and a cue end mass: tan(alpha) = (5/2) s c / (1 + m/m_e + (5/2) c^2). `speedMps` remains the ball's speed. The cue end-mass ratio (28) is marked UNVERIFIED in `packages/tables`. | The source (Alciatore TP A.31) could not be fetched, so the derivation is written out where it can be checked. The ratio was chosen to give about 2 degrees at maximum side, the commonly reported middle value; it needs a measured source. |
| 2026-11-13 | Bug fix in the slow-contact (cluster) solver: the spin of a ball spinning on the spot is read at the present time. | It was read at the start of the ball's spinning segment, so a slow touch wound its spin back up and total energy rose. Found by a random property run (seed -1565606891); pinned in `test/regressions.test.ts`. The property tests now accept `BAIZE_PROPERTY_SEED` to replay a reported failure. |
| 2026-11-13 | Cushion version 2: the Mathavan, Jackson and Parkin (2010) model, integrated in 400 fixed impulse steps per compression with exact end-of-phase steps, behind the same `CushionModel` interface (which gained an optional fourth argument, the cloth, for the bed's friction). Opt-in in the engine; the editor uses it. | It follows the slip directions at the nose and at the bed through the impact, which the single-impulse model cannot. Measured against pooltool's implementation of the same paper on the 1080-impact fixture: velocity within 0.06 % of the incoming speed at the median and 1.4 % at worst, direction within 1.1 degrees at worst. A full break with all version 2 models takes 1 to 3 ms. |
| 2026-11-13 | In the Mathavan integration, friction at a contact point that is about to stop slipping is scaled down so the step ends the slip instead of reversing it; a point with no slip gets no friction; the bed's reaction is never negative. | pooltool applies full friction in an arbitrary direction there. On a square, spin-free impact that chatter fed a little energy in (found by the property test). These are the cases where the two implementations differ most. |
| 2026-11-13 | Nap is a constant push along the nap on rolling balls, followed in constant-acceleration pieces by a midpoint rule (see "Nap"). The engine reads a new physical field, `ClothInput.napDrift`; the stored `nap.strength` (0 to 1) is left as it is and converted in `packages/tables`. | One vector reproduces the direction of every plain-ball nap effect in the coaching notes found (Frank Callan, "The Nap of the Cloth"); no measurement of its size was found, so the size is marked UNVERIFIED. A separate field means the link format does not change and a `ClothSpec` passed straight to the engine cannot be misread as a physical coefficient. Heading-at-start pieces (the Phase 3 plan) were tried on paper and rejected: their error is of first order, about 20 % of the drift for a weak nap. |
| 2026-11-13 | A ball resting against a straight rail is held from the start of every new segment (after a collision, a release, the slow-contact solver, or a natural transition), not only after a slow cushion contact. In the slow-contact solver a rail that a ball touches is a fixed contact: it takes slow closing speeds and pushes, like a ball that has been put to rest. A velocity below the rest tolerance is not given a time-to-reverse. | A spinning ball squeezed between a rail and another ball lost the rail's hold each time it got a new segment and sank 0.1 micrometres per cycle (found by a random run, seed 2004746535; pinned in `test/regressions.test.ts`). The second rule stops a held ball with a rounding-noise velocity from being given segments 1e-17 s long. No golden snapshot changed. |
| 2026-11-13 | Debug panel ("Physics numbers"): cushion bounce and friction, ball bounce, the three ball-ball friction numbers, the cue end-mass ratio and the heavy-nap push can be changed live. The changes live in their own small store (`sim/tuning.ts`), are passed to the simulator beside the scene, and are part of the simulation cache key. They are never written to the document, the link or the undo history; the panel warns while any is changed and exports made then say "non-standard physics numbers". Cloth friction is not in the panel because it already is part of the diagram (Setup). | These numbers are the same for everyone who opens a link, so a link must not carry them: two people would otherwise see different shots from the same link without knowing why. Keeping them out of the document also means no schema change. |
| 2026-11-13 | Aim guide with side: the dashed aim line and the handle stay where the cue points (that is what the document stores and what a player lines up); the ghost ball, the target ball, the cut angle and the distance are taken along the line the cue ball actually leaves on. That direction comes from the physics' own `strike`, so the guide cannot disagree with the simulation. | Moving the aim line itself would make the handle and the stored angle mean something a player cannot point a cue at. The ghost ball is the thing that must be right, and a test checks it against the simulated first contact to a micrometre. |
| 2026-11-13 | Holds on cushions end where the cushion does. A ball held on a straight rail is released when it passes the end of the rail; a ball held on a curved jaw keeps one hold only while its line of contact turns by 0.1 rad, and repeated holds on the same cushion are one `ball-cushion` event. A rolling ball that is held keeps rolling (its spin follows the held acceleration). A ball that starts on a rail, driven into it, is held from t = 0. When `restart` stops a creep into a rail slower than 1 cm/s, no cushion event is recorded. | Review of Phase 3: a held segment used to keep its hold for its whole length, so a ball running up a rail with spin into it crossed the mouth of the middle pocket in a straight line (about 6 mm of error there); and on a napped cloth a ball rolling along a rail was broken into hundreds of microscopic slides. Pinned in `test/regressions.test.ts` and `test/nap.test.ts`. No golden snapshot changed. |
| 2026-11-13 | `schemaVersion` 2: the style gains theme (table, print, dark), path line (solid, dashed, dotted), path weight, ball labels on or off, and a caption of up to 140 characters. Links are written as `v2.`; the migration from 1 passes the payload through unchanged. | Every new field is optional with the old look as its default, so a version 1 payload is already a valid version 2 payload and old links are drawn exactly as before (a recorded version 1 link is a test fixture). The version is bumped anyway, as the hard rule requires, so that an older copy of the app says "made by a newer version" instead of silently dropping the style. |
| 2026-11-13 | Themes are drawn, not stored as colours: `view/theme.ts` holds one colour set per theme, `TableView` provides it to the layers through a context, and the document's cloth colour is never changed by a theme. Print and dark draw an opaque sheet behind the table so exports have a background; the table theme stays transparent. A caption is svg text in a band below the table inside the same svg, so it is part of every export. | The export copies computed styles from the live svg, so anything drawn on screen is in the picture with no second code path. With no style set the drawing is meant to be unchanged, so old links look the same: tests show that an absent style, an empty style and explicit defaults give identical markup, and the existing component tests pass unchanged; there is no recorded copy of the earlier markup to compare with. |
| 2026-11-13 | One `cleanCaption` defines what a caption may be (one line, no control characters, nothing an XML file cannot hold, at most 140 UTF-16 units without cutting a character). `setStyle` applies it, the link writer applies it and drops the trailing space, and the link reader refuses any caption that is not already clean. | Review of Phase 4: a crafted link could carry a control character that the editor showed but that made the exported SVG malformed. Refusing on read keeps the rule "a link holds only what the editor could have written". |
| 2026-11-13 | A change of style alone (`sameExceptStyle`: every other field of the document is the same object) reuses the last simulation and does not end a playback. | Typing a caption created a new document per key press and re-ran the physics each time; changing the theme stopped the animation. Annotations and source are part of the comparison so that undo and redo of anything else still end a playback. |
| 2026-11-13 | The mark on an uncertain ball is always drawn; "Numbers on balls" hides only the numbers. Dashed and dotted path lines replace the sliding/rolling distinction of the solid line (a path is drawn as one run). | The mark is a warning about a photo-imported position, not a label, and the setting travels in the link. The second is a known trade-off of the line styles. |
| 2026-11-13 | Phase 5 is built in two stages. Stage A: geometry (homography, camera recovery, height correction), a cloth-colour table finder and a ball finder that uses no trained model, tested against synthetic photos rendered through a known camera. Stage B: the learned detector, once the project has its own labelled photos. | The geometry and the review screen do not depend on a model and are where most position error comes from; synthetic photos give exact ground truth for them without waiting for data. The detector needs real photos to train and to be judged, and those must come from the project owner. Stage A also keeps `packages/vision` free of runtime dependencies until a model is really needed. |
| 2026-11-13 | `packages/vision` may import `@baize/tables` (not only its types) and nothing else; lint bans the network, storage and the page (`fetch`, `XMLHttpRequest`, `WebSocket`, `navigator`, the storage globals, `document`, `window`) in its source, proven by a lint test. | Pipeline step 5 needs `sanitizeLayout` and ball sizes from tables. The ban turns the hard rule "photos are processed in the browser only, never uploaded or stored" into something a careless change cannot break silently. A later model runtime (ONNX) will need an explicit exception recorded here. |
| 2026-11-13 | Ball positions from a photo use the recovered camera, not the cloth homography alone: the camera (focal length, rotation, position) is solved from the four corners assuming square pixels and the principal point at the middle of the photo, and a ball is placed where the ray through its image meets the plane one ball radius above the cloth. When the view does not determine the focal length (looking straight down) a phone value of 0.72 of the long side is assumed and flagged. | Mapping a ball's image with the homography puts it too far from the camera by distance x radius / camera height: 7 cm at the far end of a 12 ft table from standing height, several times the target. With exact corners the recovered positions are exact (tested on 500 random camera positions); with corners 2 px off on a 12 megapixel photo the error stays a small part of the budget. |


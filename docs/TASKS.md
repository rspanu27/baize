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
| 0.4 | GitHub Actions: one job, install, check, build | I | 0.2 | Run is green on GitHub | blocked: workflow committed; every run fails at startup, even a one-line workflow, so it is an account-level Actions problem (You) |
| 0.5 | `docs/DEPLOY.md` with exact Cloudflare Pages settings | I | 0.2 | You connect the repo; the placeholder URL loads | doc done; waiting for You to connect the repo |

Parallel: 0.3, 0.4, 0.5.

## Phase 1: physics core v1

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 1.1 | Type contracts in both packages, stub modules and index files | L | 0.3 | Typecheck passes; type-level compatibility test passes | done |
| 1.2 | Table presets (13) with sources; numbers shown to You for sign-off before encoding | I, You | 1.1 | Every preset passes validation; sign-off noted in PROGRESS | todo |
| 1.3 | Ball sets and cloth presets (speeds with sources, colours) | I | 1.1 | Preset tests pass; every number has a source comment | done |
| 1.4 | Custom table validation and derived defaults, plain-word messages | I | 1.1 | Unit tests for each rule and message | done |
| 1.5 | Markings and spots per game | I | 1.1 | Snooker spots match the rules on 12 ft; scale on other sizes | done |
| 1.6 | Racks, `sanitizeLayout` | I | 1.5 | Racks have no overlaps; sanitize property tests pass | todo |
| 1.7 | Maths core: vectors, `sinCos`, stable quadratic | L | 1.1 | Unit tests; `sinCos` within 1e-15 of reference | done |
| 1.8 | `firstDownCrossing` root finder | L | 1.7 | Property test against dense sampling on random polynomials; degenerate cases | done |
| 1.9 | Motion segments, transitions, state classification | L | 1.7 | Analytic slide and roll distances match; energy never rises within a segment | todo |
| 1.10 | Table geometry from spec | L | 1.1 | Closed-boundary and symmetry tests on fixtures and random custom tables | todo |
| 1.11 | Event time functions: ball-ball, segment, arc, pocket, contact rule | L | 1.8, 1.9, 1.10 | Hand-computed cases; touching and grazing cases | todo |
| 1.12 | Ball-ball v1 model and cue strike | L | 1.9 | Momentum exact, energy non-increasing, unequal masses | todo |
| 1.13 | Han 2005 cushion model and interface | L | 1.9 | No energy gain over a parameter sweep; no-spin and side-spin directions correct | todo |
| 1.14 | Event loop: scheduler, cache, caps, result assembly | L | 1.11, 1.12, 1.13 | Two-ball and one-cushion shots produce the expected event lists | todo |
| 1.15 | Same-instant and touching-ball handling | L | 1.14 | Frozen pair, ball frozen to cushion, line of touching balls, full racks all terminate | todo |
| 1.16 | Public API, input validation, `sampleAt`, README | L | 1.14 | API tests; README example runs | todo |
| 1.17 | Verification suite (SPEC 5.8) on smallest, largest and random tables | L | 1.16, 1.2, 1.3 | 90 degree rule, 30 degree rule, stop shot, roll transition, cushion angle, cloth monotonic | todo |
| 1.18 | Property tests: determinism, energy, termination, no overlap, in bounds | L | 1.16, 1.4 | fast-check suite passes at raised run counts | todo |
| 1.19 | Golden snapshots, benchmark, profiling, broad-phase tuning | L | 1.17 | Snooker break-off and 9-ball break under 50 ms in Node | todo |
| 1.20 | Independent review, fixes, PROGRESS entry | R, L | 1.17, 1.18, 1.19 | Reviewer findings closed; `pnpm check` passes | todo |

Parallel: the tables track (1.2, 1.3, 1.4, 1.5, then 1.6; one file each) runs alongside the physics track (1.7 to 1.16), which the lead does in sequence.

## Phase 2: editor MVP

| ID | Task | Owner | Deps | Done-check | Status |
|---|---|---|---|---|---|
| 2.1 | `DiagramDoc`, `resolveDoc`, store with undo/redo, `loadLayout` | L | 1.16, 1.6 | Store unit tests: undo/redo; loadLayout is one step | todo |
| 2.2 | URL codec and migration scaffold | I | 2.1 | Round-trip property test; bad input gives a clear error | todo |
| 2.3 | Unit formatting and parsing (metric/imperial) | I | 0.3 | Unit tests | todo |
| 2.4 | Aim geometry: ghost ball, cut angle, line angles, distances | I | 0.3 | Unit tests with known angles | todo |
| 2.5 | Table SVG: cloth, cushions and jaws from engine geometry, pockets, markings, view transform | U | 2.1, 1.5, 1.10 | Component test renders every preset and a custom table | todo |
| 2.6 | Ball rendering for all kinds, low-confidence marker | U | 2.5 | Component test | todo |
| 2.7 | Drag, snap to spots, no-overlap placement | U | 2.6 | Interaction test: drag updates the doc, snaps, cannot overlap | todo |
| 2.8 | Add/remove balls, racks, undo/redo controls | U | 2.7 | Interaction test | todo |
| 2.9 | Setup panel: presets, custom dimensions with messages, jaw shape, ball set, cloth, units | U | 2.1, 2.3, 1.4 | Entering a custom table re-renders it; invalid input shows its message | todo |
| 2.10 | Simulation integration: frame-coalesced re-simulation, timing, path model | L | 2.1 | Unit tests for the path model; re-simulation time measured during a drag | todo |
| 2.11 | Shot controls: aim drag and click, ghost ball, tip widget, speed slider with stops | U | 2.7, 2.4 | Interaction test updates the shot in the doc | todo |
| 2.12 | Path drawing: emphasis rules, collision marks, final positions, show-all, "physics v1" note | U | 2.10 | Component test on a fixed shot | todo |
| 2.13 | Share button and load from URL hash | U | 2.2 | A link reopens an identical doc | todo |
| 2.14 | Measuring tool, cut-angle and travel readouts | U | 2.4, 2.12 | Readout matches helper output | todo |
| 2.15 | SVG and PNG export | I | 2.12 | Exported SVG parses; PNG has the expected size | todo |
| 2.16 | Mobile layout, portrait and landscape, touch drag | U | 2.9, 2.11 | Manual check at phone sizes | todo |
| 2.17 | Playwright smoke test of the Phase 2 acceptance flow | I | 2.13 | Test passes in CI | todo |
| 2.18 | Independent review, fixes, PROGRESS entry | R, L | all | Findings closed; `pnpm check` passes | todo |

Parallel groups: (2.2, 2.3, 2.4, 2.5) after 2.1; (2.9, 2.10) alongside 2.6 to 2.8; (2.13, 2.14, 2.15) after 2.12.

Slip first if the week runs short: 2.14, 2.15, 2.16.

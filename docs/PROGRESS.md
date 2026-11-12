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

- The cushion model is derived from first principles in Han's formulation; it has not been compared against the paper or pooltool.
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

- Kickoff interview held; every open decision in SPEC section 10 is settled and recorded in the decisions log in [ARCHITECTURE.md](ARCHITECTURE.md).
- Architecture written. Phases 0 to 2 broken into tasks in [TASKS.md](TASKS.md).
- No code yet.

# Baize progress log

One short entry at the end of each phase, newest first.

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

# Baize

Browser-based pool/snooker shot diagram editor with an event-based physics engine. Full spec: @docs/SPEC.md. Architecture and decisions: docs/ARCHITECTURE.md. Task board: docs/TASKS.md. Progress log: docs/PROGRESS.md.

## Commands
- `pnpm install` — install
- `pnpm check` — typecheck + lint + test, all packages. Must pass before any commit.
- `pnpm --filter @baize/physics test` — physics tests only
- `pnpm --filter @baize/physics bench` — simulation benchmarks
- `pnpm --filter web dev` — run the editor locally

## Hard rules
- `packages/physics` has ZERO runtime dependencies and never imports from `apps/` or any UI code.
- Physics uses SI units (m, s, rad) internally. Convert to mm/px only in the UI layer.
- The simulator must stay deterministic: no `Math.random`, no `Date.now`, no iteration over unordered collections where order affects results.
- Every physics change ships with tests. Never weaken, skip or delete an existing physics test to make a change pass; if a test is wrong, explain why in the commit message.
- Table, ball, pocket and cloth values live in `packages/tables` with a source comment on every number. Nothing else hard-codes a dimension or friction coefficient; every feature must work for any valid custom table and cloth.
- Photos for import are processed in the browser only. Never upload or persist them.
- The `DiagramDoc` URL format is versioned. Never change it without bumping `schemaVersion` and adding a migration.

## Working style
- Small, focused commits with descriptive messages. Commit at the end of every completed task.
- Update docs/TASKS.md when a task starts or finishes, and add a short entry to docs/PROGRESS.md at the end of each phase.
- Record any non-obvious design decision in the decisions log in docs/ARCHITECTURE.md.

## Delegation (main session is the orchestrator)
- The main session owns architecture, the physics core (event loop, collision maths, motion equations) and final review.
- Delegate well-specified, self-contained work to subagents in `.claude/agents/`: `implementer` for non-physics code, `ui-builder` for React/SVG editor work, `reviewer` for independent review before a phase is marked done.
- A delegation prompt must be self-contained: goal, files involved, interfaces to use, what is out of scope, and the exact check that proves it works.
- Commit before delegating so subagents start from a clean tree. Don't run two subagents that edit the same files at the same time.

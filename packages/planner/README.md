# @baize/planner

Position-play planner for Baize (SPEC section 10, ARCHITECTURE section 10): given a layout, it
searches over shots with the simulator for a route through the balls, and suggests safety shots
when no pot is on.

- Depends only on `@baize/physics` and `@baize/tables`; no runtime dependencies of its own.
- Deterministic like the physics (lint-enforced): no randomness, no clocks, no `Math`
  transcendentals. The same input gives the same route on every machine.
- It does not choose the physics. The caller hands it a `ShotRunner`, `(balls, shot) =>
SimResult`; the editor builds one with `editorRunner` in `apps/web/src/sim/simulator.ts`,
  so planned shots are exactly what the editor draws.

Status: scaffold (task 6.1). Rules, shots, scoring and search follow in tasks 6.2 to 6.7.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Planner tests run many simulations each. The limit is only a guard against a hang, set
    // like the other packages' after `pnpm check` timed out on a busy machine (2026-11-14).
    testTimeout: 30_000,
  },
});

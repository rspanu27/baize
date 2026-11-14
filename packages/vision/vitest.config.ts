import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // These tests render a photo and search it, pixel by pixel. They take a second or two
    // each on an idle machine and went past the default 5 s when `pnpm check` ran while the
    // machine was busy (2026-11-14). The limit is only a guard against a hang.
    testTimeout: 30_000,
  },
});

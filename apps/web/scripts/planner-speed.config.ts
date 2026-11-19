import { defineConfig, devices } from "@playwright/test";

/**
 * Timing of the planner in a production build (task 6.11). Not part of the test suites:
 *
 *   pnpm --filter web build
 *   pnpm --filter web exec playwright test -c scripts/planner-speed.config.ts
 *
 * It serves the built app with `vite preview` and prints the times; it fails only if a route
 * is not found at all. Timing on a shared machine varies: run it on an idle one.
 */
const PORT = 5197;

export default defineConfig({
  testDir: ".",
  testMatch: "planner-speed.measure.ts",
  reporter: "list",
  timeout: 300_000,
  use: { baseURL: `http://localhost:${String(PORT)}` },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite preview --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    // The app (and its dist folder) is one level up from this config.
    cwd: "..",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

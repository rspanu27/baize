import { defineConfig, devices } from "@playwright/test";

/** The end-to-end smoke test: `pnpm --filter web test:e2e`. It starts its own dev server. */
const PORT = 5199;

export default defineConfig({
  testDir: "e2e",
  // Named so that Vitest, which owns *.test.ts, never picks these up.
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: "list",
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The lint guard test starts ESLint, which took just over the default 5 s on a busy
    // machine (2026-11-14 and 2026-11-15) and failed `pnpm check` with a timeout, not a wrong
    // result. No assertion depends on this limit; it only guards against a hang.
    testTimeout: 30_000,
  },
});

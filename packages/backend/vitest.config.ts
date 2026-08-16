/**
 * Vitest config for this package.
 *
 * `exclude`: the package's own build output contains compiled copies of the
 * test files (`dist/**​/*.test.js`). Without an explicit exclude they were
 * collected *in addition to* `src/**​/*.test.ts`, so every test ran twice —
 * once against the source and once against possibly-stale build output.
 * `packages/provider` never hit this because its build emits no test files.
 * Measured 2026-08-16: core 148 duplicate cases, backend 47.
 */

import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})

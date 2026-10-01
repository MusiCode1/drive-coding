/**
 * Vitest config for this package.
 *
 * `exclude`: the package's own build output contains compiled copies of the
 * test files (`dist/**​/*.test.js`). Without an explicit exclude they were
 * collected *in addition to* `src/**​/*.test.ts`, so every test ran twice —
 * once against the source and once against possibly-stale build output.
 * `packages/provider` was the exception until 2026-09-29 — its `dist` was not
 * built at all. The `typecheck-gate` slice referenced it from the root
 * `tsconfig.json`, `tsc --build` started emitting it, and it now carries the
 * same exclude.
 * Measured 2026-08-16: core 148 duplicate cases, backend 47.
 */

import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})

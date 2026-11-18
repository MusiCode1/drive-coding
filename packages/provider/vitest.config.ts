/**
 * Vitest config for this package.
 *
 * `exclude`: the package's own build output contains compiled copies of the
 * test files (`dist/**​/*.test.js`). Without an explicit exclude they are
 * collected *in addition to* `src/**​/*.test.ts`, so every test runs twice —
 * once against the source and once against possibly-stale build output.
 *
 * 🔴 This package was the exception until 2026-09-29 — its `dist` was never
 * built, because the root `tsconfig.json` did not reference it. The
 * `typecheck-gate` slice added that reference (so provider's *test* files
 * would be type-checked at all), `tsc --build` began emitting
 * `packages/provider/dist`, and the whole suite immediately doubled:
 * 407 → 444 test files. The sibling configs in core/backend/acp-wire already
 * carried this exclude; provider was simply the one nothing had built yet.
 */

import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/dist/**"],
  },
})

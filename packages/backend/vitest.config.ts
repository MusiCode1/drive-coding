/**
 * Vitest config for this package.
 *
 * `exclude`: the package's own build output contains compiled copies of the
 * test files (`dist/**​/*.test.js`). Without an explicit exclude they were
 * collected *in addition to* `src/**​/*.test.ts`, so every test ran twice —
 * once against the source and once against possibly-stale build output.
 * `packages/provider` never hit this because its build emits no test files.
 * Measured 2026-08-16: core 148 duplicate cases, backend 47.
 *
 * `env.AGENTS_STORE_FILE`: tests that boot the real server through createDeps
 * would otherwise write the agent snapshot into ~/.config/drive-coding/agents/,
 * i.e. into the state of the deployments running on this machine. Measured
 * 2026-09-08: a suite run left a 45307.json there with three crashed opencode
 * rows. Same class as bug #66 — a test reading or writing real machine state.
 */

import { tmpdir } from "node:os"
import { join } from "node:path"
import { configDefaults, defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/dist/**"],
    env: {
      AGENTS_STORE_FILE: join(tmpdir(), `dc-test-agents-${process.pid}.json`),
    },
  },
})

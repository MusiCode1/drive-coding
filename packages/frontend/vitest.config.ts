/**
 * Vitest config for the frontend package.
 *
 * Why a separate file from the root `vitest.config.ts`:
 *   The FE has `.svelte.ts` files (view-models with $state runes) that need
 *   the `@sveltejs/vite-plugin-svelte` preprocessor. The root config covers
 *   only `packages/core` + `packages/backend` (plain TS, no runes).
 *
 * Why we don't use `sveltekit()` here:
 *   The SvelteKit plugin pulls in SSR/server bootstrap that doesn't run in
 *   vitest (and would fail without `.svelte-kit/` sync). The bare
 *   `svelte()` plugin compiles `.svelte` + `.svelte.ts/js` files, which is
 *   all the view-model tests need.
 *
 * `environment: "node"` — Settings doesn't touch the DOM directly. localStorage
 * is mocked per-test via `vi.stubGlobal()`.
 *
 * `resolve.conditions: ["browser"]` — slice/msg-diagrams Commit 0ב. Without it,
 * `mount()` from `svelte` on a `.svelte` component fails with
 * `lifecycle_function_unavailable — mount(...) is not available on the server`
 * (Svelte resolves the server-side build by default under vitest/node). This
 * makes component-mount tests possible (needed for DoD 6 — MessageBubble must be
 * mounted for real, not just its markdown util). Measured against the full FE
 * suite before merging: 104 files / 1153 tests, all green (baseline 103/1152) —
 * see brief-msg-diagrams.md §4 Commit 0ב. If the full suite ever goes red because
 * of this line — that is an escalation to מרדכי (brief §7 trigger 5), not a fix
 * to other tests.
 */

import { defineConfig } from "vitest/config"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import path from "node:path"

export default defineConfig({
  plugins: [svelte({ hot: false })],
  resolve: {
    // `$lib/*` is the SvelteKit alias for `src/lib/*`. SvelteKit sets it
    // up automatically in `dev`/`build`; here we mirror it for tests.
    alias: {
      $lib: path.resolve(__dirname, "src/lib"),
    },
    conditions: ["browser"],
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,svelte.ts}"],
  },
})

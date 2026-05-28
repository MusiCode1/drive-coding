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
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,svelte.ts}"],
  },
})

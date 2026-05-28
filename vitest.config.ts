import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // frontend has no tests yet — add here when it does (with sveltekit() plugin in its own vitest.config.ts).
    projects: ["packages/core", "packages/backend"],
  },
})

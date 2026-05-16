import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // packages/frontend has its own vitest.config.ts with sveltekit() plugin
    projects: ["packages/core", "packages/backend", "packages/frontend"],
  },
})

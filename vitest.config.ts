import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The frontend has its own vitest.config.ts (svelte plugin required for
    // `.svelte.ts` runes — see packages/frontend/vitest.config.ts).
    projects: ["packages/core", "packages/backend", "packages/frontend", "packages/provider", "scripts"],
  },
})

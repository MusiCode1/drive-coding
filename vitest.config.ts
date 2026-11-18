import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // The frontend has its own vitest.config.ts (svelte plugin required for
    // `.svelte.ts` runes — see packages/frontend/vitest.config.ts).
    projects: [
      "packages/core",
      "packages/backend",
      "packages/provider",
      "packages/acp-wire",
      "packages/frontend",
      "scripts",
    ],
  },
})

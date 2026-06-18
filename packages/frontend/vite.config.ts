import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// BE port — defaults to 4000, override with BE_PORT=4001 for parallel worktrees.
// See root AGENTS.md → Ports + "Running parallel worktrees" if exists.
const BE_PORT = Number(process.env.BE_PORT ?? 4000)

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    // Source maps for the minified prod build — lets DevTools map hashed chunks
    // (e.g. DFDqgTZT.js:1) back to source when profiling jank/Violations.
    // Env-gated: ON only in the dev/staging deployment
    // (Environment=FE_SOURCEMAP=true in voice-acp-dev.service). OFF in main/prod
    // so public bundles don't ship source maps or bloat. Local debug: build with
    // FE_SOURCEMAP=true. See docs/running-locally.md.
    sourcemap: process.env.FE_SOURCEMAP === "true",
  },
  server: {
    // port: OS-assigned. Vite prints chosen port at startup.
    allowedHosts: [".tuns.sh", ".trycloudflare.com", "localhost"],
    proxy: {
      "/api": `http://localhost:${BE_PORT}`,
      "/proxy": `http://localhost:${BE_PORT}`,
      "/ws": { target: `ws://localhost:${BE_PORT}`, ws: true },
    },
  },
})

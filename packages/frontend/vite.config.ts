import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// ─── build-env profile ───────────────────────────────────────────────────────
// FE_ENV ∈ { "dev" | "preview" | "prod" } (default "prod").
// Controls both the app title badge and source-map generation.
// Overrides: FE_TITLE (base title) · FE_SOURCEMAP (source maps on/off).
// See docs/running-locally.md for the three profiles.
type FeEnv = "dev" | "preview" | "prod"
const FE_ENV = (process.env.FE_ENV ?? "prod") as FeEnv
const BADGES: Record<FeEnv, string> = { dev: " Dev", preview: " Preview", prod: "" }
// base-title: FE_TITLE override wins; otherwise "Drive Coding" + badge per env.
const BASE_TITLE = process.env.FE_TITLE ?? `Drive Coding${BADGES[FE_ENV] ?? ""}`
// Expose to SvelteKit so that:
//  (a) %sveltekit.env.PUBLIC_APP_TITLE% in app.html is replaced at build time.
//  (b) $env/dynamic/public.PUBLIC_APP_TITLE is available at runtime.
// Must be set before the SvelteKit plugin reads the environment.
process.env.PUBLIC_APP_TITLE = BASE_TITLE
// source-maps: explicit FE_SOURCEMAP wins; otherwise ON for non-prod envs.
const SOURCEMAP =
  process.env.FE_SOURCEMAP != null ? process.env.FE_SOURCEMAP === "true" : FE_ENV !== "prod"

// BE port — defaults to 4000, override with BE_PORT=4001 for parallel worktrees.
// See root AGENTS.md → Ports + "Running parallel worktrees" if exists.
const BE_PORT = Number(process.env.BE_PORT ?? 4000)

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    sourcemap: SOURCEMAP,
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

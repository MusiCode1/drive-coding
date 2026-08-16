import { sveltekit } from "@sveltejs/kit/vite"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"

// ─── build-env profile ───────────────────────────────────────────────────────
// FE_ENV ∈ { "dev" | "preview" | "prod" } (default "prod").
// Controls both the app title badge and source-map generation.
// Overrides: FE_TITLE (whole base title) · FE_SOURCEMAP (source maps on/off).
// FE_PREVIEW_LABEL: a preview-subject tag so several preview tabs are distinguishable.
// The env badge (Dev/Preview) + label are PREFIXED before "Drive Coding" so they stay
// visible when the browser truncates a narrow tab. e.g. "Preview · title+cli · Drive Coding".
// prod has no badge → plain "Drive Coding".
type FeEnv = "dev" | "preview" | "prod"
const FE_ENV = (process.env.FE_ENV ?? "prod") as FeEnv
const BADGES: Record<FeEnv, string> = { dev: "Dev", preview: "Preview", prod: "" }
// optional preview-subject label — distinguishes multiple preview tabs.
const PREVIEW_LABEL = process.env.FE_PREVIEW_LABEL?.trim()
// badge + label prefixed (before "Drive Coding"), joined by " · ".
const PREFIX_PARTS = [BADGES[FE_ENV], PREVIEW_LABEL].filter(Boolean)
const PREFIX = PREFIX_PARTS.length > 0 ? `${PREFIX_PARTS.join(" · ")} · ` : ""
// base-title: FE_TITLE override wins; otherwise "<badge> · <label> · Drive Coding".
const BASE_TITLE = process.env.FE_TITLE ?? `${PREFIX}Drive Coding`
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

// ─── slice view-switch C2 / transport-polish C2: session-transport build-env plumbing ───
// FE_SESSION_TRANSPORT ∈ { "ws" | "http" } (default "ws" — resolveSessionTransport's
// own env-level fallback). Exposed as PUBLIC_SESSION_TRANSPORT so $env/dynamic/public can
// read it at runtime (same precedent as PUBLIC_APP_TITLE above — must be set before the
// SvelteKit plugin reads the environment). ⚠️ $env/static/public has no `env` export —
// breaks the build; use $env/dynamic/public only (see +layout.svelte).
process.env.PUBLIC_SESSION_TRANSPORT = process.env.FE_SESSION_TRANSPORT ?? "ws"

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  build: {
    sourcemap: SOURCEMAP,
  },
  server: {
    // port: OS-assigned. Vite prints chosen port at startup.
    allowedHosts: true,
    proxy: {
      "/api": `http://localhost:${BE_PORT}`,
      "/proxy": `http://localhost:${BE_PORT}`,
      "/ws": { target: `ws://localhost:${BE_PORT}`, ws: true },
    },
  },
})

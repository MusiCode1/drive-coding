import type { Hono } from "hono"
import { resolveAppVersion } from "../app-version.js"
// slice liveness C2: short response cache + no-store on GET /api/health.
import { httpCacheGet, httpCacheSet } from "./http-cache.js"

export function registerHttp(app: Hono): void {
  // Resolve once at route-registration (boot) time — no per-request fs read,
  // no import side effect. Was hardcoded "0.0.0" (a scaffolding placeholder).
  const version = resolveAppVersion()
  app.get("/api/health", (c) => {
    c.header("Cache-Control", "no-store")
    const cached = httpCacheGet("health")
    if (cached !== undefined) return c.json(cached)
    const body = { status: "ok", version, uptime: process.uptime() }
    httpCacheSet("health", body)
    return c.json(body)
  })
}

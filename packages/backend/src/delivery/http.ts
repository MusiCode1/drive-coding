import type { Hono } from "hono"
import { resolveAppVersion } from "../app-version.js"

export function registerHttp(app: Hono): void {
  // Resolve once at route-registration (boot) time — no per-request fs read,
  // no import side effect. Was hardcoded "0.0.0" (a scaffolding placeholder).
  const version = resolveAppVersion()
  app.get("/api/health", (c) => c.json({ status: "ok", version, uptime: process.uptime() }))
}

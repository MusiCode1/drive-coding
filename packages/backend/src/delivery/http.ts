import type { Hono } from "hono"

export function registerHttp(app: Hono): void {
  app.get("/api/health", (c) =>
    c.json({ status: "ok", version: "0.0.0", uptime: process.uptime() }),
  )
}

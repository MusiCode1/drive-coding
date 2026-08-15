import { Hono } from "hono"
import { describe, expect, it } from "vitest"
import { registerHttp } from "../src/delivery/http"

function makeApp() {
  const app = new Hono()
  registerHttp(app)
  return app
}

describe("HTTP GET /api/health", () => {
  it("returns 200 + { status: 'ok', version, uptime }", async () => {
    const app = makeApp()
    const res = await app.request("/api/health")
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; version: string; uptime: number }
    expect(body.status).toBe("ok")
    // version must be a real semver string, never "unknown" — "unknown" means the binary
    // failed to resolve package.json and silently degraded. A semver regex catches
    // truncation bugs too (e.g. "0.28" instead of "0.28.2" from a missing JSON.stringify).
    expect(body.version).not.toBe("unknown")
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/)
    expect(typeof body.uptime).toBe("number")
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})

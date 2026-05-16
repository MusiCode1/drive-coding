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
    expect(typeof body.version).toBe("string")
    expect(typeof body.uptime).toBe("number")
    expect(body.uptime).toBeGreaterThanOrEqual(0)
  })
})

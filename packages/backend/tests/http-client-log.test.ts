/**
 * Tests for POST /api/client-log — Phase 5 remote sink endpoint.
 */

import type { LogEntry } from "@drive-coding/core/log"
import { addSink, initLogger } from "@drive-coding/core/log"
import { Hono } from "hono"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { registerClientLogHttp } from "../src/delivery/http-client-log"

// Silence pino output in tests
vi.spyOn(process.stdout, "write").mockReturnValue(true)
vi.spyOn(process.stderr, "write").mockReturnValue(true)

function makeApp() {
  const app = new Hono()
  registerClientLogHttp(app)
  return app
}

async function post(app: Hono, body: unknown) {
  const req = new Request("http://localhost/api/client-log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return app.fetch(req)
}

describe("POST /api/client-log", () => {
  let app: Hono

  beforeEach(() => {
    // Re-init logger before each test to ensure trace level + all ns
    initLogger({ level: "trace", ns: "*", format: "json", remote: false })
    app = makeApp()
  })

  it("valid payload → 204 + logs emitted under client.*", async () => {
    const emitted: LogEntry[] = []
    const remove = addSink((e) => emitted.push(e))

    const res = await post(app, {
      entries: [
        {
          ts: Date.now(),
          level: "info",
          ns: "fe.audio.player",
          msg: "enqueue",
          fields: { bytes: 1234 },
        },
        { ts: Date.now(), level: "warn", ns: "fe.voice", msg: "test warn" },
      ],
    })
    remove()

    expect(res.status).toBe(204)
    const clientEntries = emitted.filter((e) => e.ns.startsWith("client."))
    expect(clientEntries.length).toBeGreaterThanOrEqual(2)
    expect(clientEntries.some((e) => e.ns === "client.fe.audio.player")).toBe(true)
    expect(clientEntries.some((e) => e.ns === "client.fe.voice")).toBe(true)
  })

  it("bad JSON body → 400", async () => {
    const req = new Request("http://localhost/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    })
    const res = await app.fetch(req)
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe("bad json")
  })

  it("invalid entry schema (level 'verbose') → 400", async () => {
    const res = await post(app, {
      entries: [{ ts: Date.now(), level: "verbose", ns: "fe.voice", msg: "test" }],
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBeTruthy()
  })

  it("missing entries field → 400", async () => {
    const res = await post(app, { data: [] })
    expect(res.status).toBe(400)
  })

  it("501st entry from same IP → 429", async () => {
    const uniqueIp = `10.0.0.${Math.floor(Math.random() * 200) + 50}`

    async function postWithIp(body: unknown) {
      const req = new Request("http://localhost/api/client-log", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": uniqueIp },
        body: JSON.stringify(body),
      })
      return app.fetch(req)
    }

    // First: 500 entries (should succeed)
    const entries = Array.from({ length: 500 }, (_, i) => ({
      ts: Date.now(),
      level: "info" as const,
      ns: "fe.test",
      msg: `msg ${i}`,
    }))
    const res1 = await postWithIp({ entries })
    expect(res1.status).toBe(204)

    // Second batch (1 entry): should be rate limited
    const res2 = await postWithIp({
      entries: [{ ts: Date.now(), level: "info", ns: "fe.test", msg: "one more" }],
    })
    expect(res2.status).toBe(429)
  })

  it("ns prefix: fe.audio.player → client.fe.audio.player", async () => {
    const emitted: LogEntry[] = []
    const remove = addSink((e) => emitted.push(e))

    await post(app, {
      entries: [{ ts: Date.now(), level: "debug", ns: "fe.audio.player", msg: "test" }],
    })
    remove()

    expect(emitted.some((e) => e.ns === "client.fe.audio.player")).toBe(true)
  })
})

/**
 * http-reload-config.test.ts — integration test for POST /api/reload-config
 * (slice cli-specs-hot-reload, Commit 1).
 *
 * Verifies the manual reload endpoint: 200 { ok: true }, and that it goes through
 * invalidateCache() — which emits to onConfigChange listeners (the single broadcast
 * path that server.ts wires to broadcastConfigChanged). The endpoint must NOT call
 * broadcast itself, or config changes would be sent twice.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const NO_OVERRIDE_FILE = "/tmp/no-such-cli-specs-reload-test-99999.jsonc"

beforeEach(() => {
  vi.resetModules()
  // Point at a missing dir so the lazy watcher (started by onConfigChange) never fires.
  process.env.CLI_SPECS_FILE = NO_OVERRIDE_FILE
})

afterEach(() => {
  vi.resetModules()
  delete process.env.CLI_SPECS_FILE
})

async function makeApp() {
  const { Hono } = await import("hono")
  const { registerReloadConfigHttp } = await import("../src/delivery/http-reload-config.js")
  const app = new Hono()
  registerReloadConfigHttp(app)
  return app
}

describe("POST /api/reload-config", () => {
  it("returns 200 { ok: true }", async () => {
    const app = await makeApp()
    const res = await app.request("/api/reload-config", { method: "POST" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it("emits config-change via invalidateCache (single broadcast path)", async () => {
    const { onConfigChange } = await import("@drive-coding/provider/config")
    const app = await makeApp()
    const cb = vi.fn()
    const unsub = onConfigChange(cb)

    const res = await app.request("/api/reload-config", { method: "POST" })
    expect(res.status).toBe(200)
    expect(cb).toHaveBeenCalledTimes(1)

    unsub()
  })
})

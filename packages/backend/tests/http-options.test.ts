import * as os from "node:os"
import { describe, expect, it } from "vitest"

const { Hono } = await import("hono")
const { registerHttpOptions, getHomeDir } = await import("../src/delivery/http-options")

function makeApp() {
  const app = new Hono()
  registerHttpOptions(app)
  return app
}

describe("HTTP GET /api/options", () => {
  it("returns 200 + { homeDir } only", async () => {
    const app = makeApp()
    const res = await app.request("/api/options")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.homeDir).toBe("string")
    expect(body.homeDir.length).toBeGreaterThan(0)
    expect(body.models).toBeUndefined()
    expect(body.projects).toBeUndefined()
  })

  it("Slice 24: returns homeDir field (non-empty string, absolute path)", async () => {
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { homeDir: string }

    expect(typeof body.homeDir).toBe("string")
    expect(body.homeDir.length).toBeGreaterThan(0)
    const isAbsolute =
      body.homeDir.startsWith("/") ||
      /^[a-zA-Z]:[\\/]/.test(body.homeDir) ||
      body.homeDir.startsWith("\\\\")
    expect(isAbsolute).toBe(true)
  })

  it("Commit 2: homeDir is the actual os.homedir() value (cross-platform)", async () => {
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { homeDir: string }

    expect(body.homeDir).toBe(os.homedir())
  })
})

describe("getHomeDir", () => {
  it("returns os.homedir() (boot-layer C5 — no HOME/USERPROFILE env reads)", () => {
    expect(getHomeDir()).toBe(os.homedir())
  })
})

import * as os from "node:os"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { Hono } = await import("hono")
const { registerHttpOptions, getHomeDir } = await import("../src/delivery/http-options")

function makeApp() {
  const app = new Hono()
  registerHttpOptions(app)
  return app
}

describe("HTTP GET /api/options", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns 200 + { homeDir } only", async () => {
    const app = makeApp()
    const res = await app.request("/api/options")
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.homeDir).toBe("string")
    expect(body.homeDir.length).toBeGreaterThan(0)
    // regression-guard: העבודה היקרה נמחקה — אין יותר models/projects על ה-wire
    expect(body.models).toBeUndefined()
    expect(body.projects).toBeUndefined()
  })

  it("Slice 24: returns homeDir field (non-empty string, absolute path)", async () => {
    const app = makeApp()
    const res = await app.request("/api/options")
    const body = (await res.json()) as { homeDir: string }

    expect(typeof body.homeDir).toBe("string")
    expect(body.homeDir.length).toBeGreaterThan(0)
    // cross-platform: homeDir מנורמל מ-os.homedir() — absolute, אך לא בהכרח Unix "/"
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
  it("prefers HOME env", () => {
    vi.stubEnv("HOME", "/custom/home")
    expect(getHomeDir()).toBe("/custom/home")
    vi.unstubAllEnvs()
  })

  it("falls back to USERPROFILE when HOME is empty/unset", () => {
    vi.stubEnv("HOME", "")
    vi.stubEnv("USERPROFILE", "D:\\Users\\Bob")
    expect(getHomeDir()).toBe("D:\\Users\\Bob")
    vi.unstubAllEnvs()
  })

  // הערה: לא בודקים "both empty → os.homedir()" — על Windows os.homedir() עצמו
  // קורא USERPROFILE, אז stub שלו ל-"" משבש את ה-fallback. ה-`|| os.homedir()` טריוויאלי.
})

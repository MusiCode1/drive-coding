/**
 * http-cli-availability.test.ts — integration test for GET /api/cli-availability.
 *
 * Verifies the full gateway: BE endpoint → getCliSpec (provider/config, merges
 * CLI_SPECS + cli-specs.jsonc override) → detectAvailableClis (core, pure).
 *
 * Real fs is used deliberately (not mocked) — real temp dirs/files, same pattern as
 * cli-config.test.ts's override tests. Assertions are scoped to specific CLI_KINDS we
 * fully control (via a crafted override + a made-up unique binary name), so the test
 * stays deterministic regardless of which real CLIs happen to be installed on the box
 * running the suite. CLI_SPECS_FILE always points at a guaranteed-nonexistent path
 * unless the test is specifically exercising an override, so a real
 * ~/.config/drive-coding/cli-specs.jsonc on the host can't leak into results.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const NO_OVERRIDE_FILE = "/tmp/no-such-cli-specs-availability-test-99999.jsonc"

beforeEach(() => {
  vi.resetModules()
  delete process.env.CLI_SPECS_FILE
  delete process.env.OPENCODE_BIN
  process.env.CLI_SPECS_FILE = NO_OVERRIDE_FILE
})

afterEach(() => {
  vi.unstubAllEnvs()
  delete process.env.CLI_SPECS_FILE
  delete process.env.OPENCODE_BIN
})

async function makeApp() {
  const { Hono } = await import("hono")
  const { registerCliAvailabilityHttp } = await import("../src/delivery/http-cli-availability.js")
  const app = new Hono()
  registerCliAvailabilityHttp(app)
  return app
}

describe("GET /api/cli-availability — shape", () => {
  it("200 + { available: [], details: { ...CLI_KINDS } } with the right shape", async () => {
    vi.stubEnv("PATH", "/fake/empty/bin-availability-test")
    vi.stubEnv("PATHEXT", "")

    const app = await makeApp()
    const res = await app.request("/api/cli-availability")
    expect(res.status).toBe(200)

    const body = (await res.json()) as {
      available: string[]
      details: Record<string, { found: boolean; path?: string; source: string }>
    }

    expect(Array.isArray(body.available)).toBe(true)
    // §4: 7 CLI_KINDS today (opencode/claude/gemini/codex/qoder/cursor/grok)
    const kinds = Object.keys(body.details)
    expect(kinds).toContain("opencode")
    expect(kinds).toContain("claude")
    expect(kinds).toContain("cursor")
    for (const kind of kinds) {
      const detail = body.details[kind]
      expect(typeof detail?.found).toBe("boolean")
      expect(["path", "override", "not-found"]).toContain(detail?.source)
      // available[] and details[].found must agree
      expect(body.available.includes(kind)).toBe(detail?.found)
    }
  })
})

describe("GET /api/cli-availability — override gateway (bin: cli-specs.jsonc → getCliSpec → detectAvailableClis)", () => {
  let overrideFile: string
  let binDir: string

  beforeEach(() => {
    overrideFile = path.join(os.tmpdir(), `cli-availability-override-${Date.now()}.jsonc`)
    binDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-availability-bin-"))
  })

  afterEach(() => {
    if (fs.existsSync(overrideFile)) fs.unlinkSync(overrideFile)
    fs.rmSync(binDir, { recursive: true, force: true })
  })

  it("override.bin found → source 'override', ignores OPENCODE_BIN (envVar precedence per getCliCommand)", async () => {
    const uniqueBin = `custom-opencode-${Date.now()}`
    fs.writeFileSync(path.join(binDir, uniqueBin), "")
    fs.writeFileSync(overrideFile, JSON.stringify({ opencode: { bin: uniqueBin } }))
    process.env.CLI_SPECS_FILE = overrideFile
    vi.stubEnv("PATH", binDir)
    vi.stubEnv("PATHEXT", "")
    // envVar points elsewhere — must be ignored because override.bin wins (brief §4 explanation)
    vi.stubEnv("OPENCODE_BIN", "/should/not/be/used")

    const app = await makeApp()
    const res = await app.request("/api/cli-availability")
    const body = (await res.json()) as {
      available: string[]
      details: Record<string, { found: boolean; path?: string; source: string }>
    }

    expect(body.available).toContain("opencode")
    expect(body.details.opencode).toEqual({
      found: true,
      path: path.join(binDir, uniqueBin),
      source: "override",
    })
  })

  it("override.bin missing → source 'not-found', excluded from available", async () => {
    const uniqueBin = `nonexistent-cli-availability-${Date.now()}`
    fs.writeFileSync(overrideFile, JSON.stringify({ opencode: { bin: uniqueBin } }))
    process.env.CLI_SPECS_FILE = overrideFile
    vi.stubEnv("PATH", binDir) // empty dir — binary not present
    vi.stubEnv("PATHEXT", "")

    const app = await makeApp()
    const res = await app.request("/api/cli-availability")
    const body = (await res.json()) as {
      available: string[]
      details: Record<string, { found: boolean; path?: string; source: string }>
    }

    expect(body.available).not.toContain("opencode")
    expect(body.details.opencode).toEqual({ found: false, source: "not-found" })
  })
})

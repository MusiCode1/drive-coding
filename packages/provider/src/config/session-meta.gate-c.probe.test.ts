/**
 * Gate C probe — deep-merge + getCliSpec wiring (slice session-meta-config).
 * Run: bunx vitest run --root packages/provider src/config/session-meta.gate-c.probe.test.ts
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { CLI_SPECS } from "@drive-coding/core"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deepMergeSessionMeta } from "./session-meta-merge.js"

describe("Gate C — deepMergeSessionMeta", () => {
  it("adding a key preserves thinking and yields no conflicts", () => {
    const base = CLI_SPECS.claude.sessionMeta
    const { merged, conflicts } = deepMergeSessionMeta(base, { extraKey: true })
    const claudeCode = merged.claudeCode as
      | { options?: { thinking?: { display?: string } } }
      | undefined
    expect(claudeCode?.options?.thinking?.display).toBe("summarized")
    expect(conflicts).toEqual([])
  })

  it("changing display yields one conflict", () => {
    const base = CLI_SPECS.claude.sessionMeta
    const override = {
      claudeCode: { options: { thinking: { display: "omitted" } } },
    }
    const { conflicts } = deepMergeSessionMeta(base, override)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]?.path).toContain("display")
  })

  it("same value is silent", () => {
    const base = CLI_SPECS.claude.sessionMeta
    const { conflicts } = deepMergeSessionMeta(base, base)
    expect(conflicts).toEqual([])
  })

  it("arrays replace, not merge", () => {
    const base = { claudeCode: { emitRawSDKMessages: [{ type: "assistant" }] } }
    const override = { claudeCode: { emitRawSDKMessages: [{ type: "user" }] } }
    const { merged, conflicts } = deepMergeSessionMeta(base, override)
    expect(merged.claudeCode).toEqual({ emitRawSDKMessages: [{ type: "user" }] })
    expect(conflicts).toHaveLength(1)
  })
})

describe("Gate C — getCliSpec display default", () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
  })

  afterEach(() => {
    delete process.env.CLI_SPECS_FILE
    vi.restoreAllMocks()
  })

  it("getCliSpec(claude) without override keeps summarized thinking", async () => {
    const { getCliSpec } = await import("./cli-config.js")
    const meta = getCliSpec("claude")?.sessionMeta
    const claudeCode = meta?.claudeCode as
      | { options?: { thinking?: { display?: string } } }
      | undefined
    expect(claudeCode?.options?.thinking?.display).toBe("summarized")
  })
})

describe("Gate C — loadCliSpecsOverride conflict warning", () => {
  const tmpFiles: string[] = []

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    for (const f of tmpFiles) {
      try {
        fs.unlinkSync(f)
      } catch {
        // ignore
      }
    }
    tmpFiles.length = 0
    delete process.env.CLI_SPECS_FILE
    vi.restoreAllMocks()
  })

  it("warns once on display override without sessionMetaAllowDefaultOverride", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const filePath = path.join(os.tmpdir(), `gate-c-${Date.now()}.jsonc`)
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        claude: {
          sessionMeta: {
            claudeCode: { options: { thinking: { display: "omitted" } } },
          },
        },
      }),
    )
    tmpFiles.push(filePath)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./cli-config-file.js")
    loadCliSpecsOverride()

    const conflictWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[cli-config-file] sessionMeta conflict"),
    )
    expect(conflictWarns.length).toBeGreaterThanOrEqual(1)
    warnSpy.mockRestore()
  })

  it("sessionMetaAllowDefaultOverride:true suppresses conflict warnings", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const filePath = path.join(os.tmpdir(), `gate-c-silent-${Date.now()}.jsonc`)
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        claude: {
          sessionMetaAllowDefaultOverride: true,
          sessionMeta: {
            claudeCode: { options: { thinking: { display: "omitted" } } },
          },
        },
      }),
    )
    tmpFiles.push(filePath)
    process.env.CLI_SPECS_FILE = filePath

    const { loadCliSpecsOverride } = await import("./cli-config-file.js")
    loadCliSpecsOverride()

    const conflictWarns = warnSpy.mock.calls.filter((c) =>
      String(c[0]).includes("[cli-config-file] sessionMeta conflict"),
    )
    expect(conflictWarns).toHaveLength(0)
    warnSpy.mockRestore()
  })
})

/**
 * sidecar-routing.test.ts — isSidecarCliKind: the per-CLI routing gate
 * (slice cli-transport).
 *
 * A declared CliSpec.transport decides per-CLI (unix → sidecar, stdio → not,
 * http → not restorable). With no declared transport the legacy AGENT_SIDECAR
 * env decides. Config is memoized per module, so each test re-imports after
 * resetModules and points CLI_SPECS_FILE at a throwaway file.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const tmpFiles: string[] = []
const originalEnv = { ...process.env }

function writeSpecs(obj: unknown): string {
  const p = path.join(
    os.tmpdir(),
    `routing-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonc`,
  )
  fs.writeFileSync(p, JSON.stringify(obj), "utf8")
  tmpFiles.push(p)
  return p
}

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
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
})

describe("isSidecarCliKind", () => {
  it("declared unix transport → sidecar", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({
      "cursor-remote": { transport: { mode: "unix", socketDir: "/d" } },
    })
    delete process.env.AGENT_SIDECAR
    const { isSidecarCliKind } = await import("../src/acp/connect-via-sidecar.js")
    expect(isSidecarCliKind("cursor-remote")).toBe(true)
  })

  it("declared stdio transport → not a sidecar (even if AGENT_SIDECAR lists it)", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ claude: { transport: { mode: "stdio" } } })
    process.env.AGENT_SIDECAR = "claude"
    const { isSidecarCliKind } = await import("../src/acp/connect-via-sidecar.js")
    expect(isSidecarCliKind("claude")).toBe(false)
  })

  it("declared http transport → not restorable (false)", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({
      "x-remote": { transport: { mode: "http", httpUrl: "http://h" } },
    })
    const { isSidecarCliKind } = await import("../src/acp/connect-via-sidecar.js")
    expect(isSidecarCliKind("x-remote")).toBe(false)
  })

  it("no declared transport → legacy AGENT_SIDECAR decides", async () => {
    process.env.CLI_SPECS_FILE = "/tmp/does-not-exist-routing-1.jsonc"
    process.env.AGENT_SIDECAR = "cursor"
    const { isSidecarCliKind } = await import("../src/acp/connect-via-sidecar.js")
    expect(isSidecarCliKind("cursor")).toBe(true)
    expect(isSidecarCliKind("claude")).toBe(false)
  })
})

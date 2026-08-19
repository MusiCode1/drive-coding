/**
 * connection-registry.env-warning.test.ts — tests for the exported override predicates.
 *
 * The in-process warning in connect() warns when a cli-specs override sets bin/args or
 * env fields for an in-process CLI (claude/codex). These tests exercise the exported
 * predicates directly — NOT via connect(), which would spawn a real agent.
 *
 * The predicates read a module-memoized override (loadCliSpecsOverride in cli-config-file.ts),
 * so each test injects its config through CLI_SPECS_FILE + vi.resetModules() and re-imports
 * the module inside the test. A static import at the top would hold the memoized cache and
 * the second test would fail.
 */

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// In-process connectors are claude and codex (IN_PROCESS_CONNECTORS in connection-registry.ts).
// Only these kinds are checked by the combined warning condition. This set is duplicated here
// because IN_PROCESS_CONNECTORS is deliberately not exported (the brief's chosen seam).
const IN_PROCESS_KINDS = new Set(["claude", "codex"])

let tmpFile: string | null = null

function writeSpecs(specs: unknown): string {
  const filePath = path.join(
    os.tmpdir(),
    `cli-spec-env-warning-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonc`,
  )
  fs.writeFileSync(filePath, JSON.stringify(specs), "utf8")
  tmpFile = filePath
  return filePath
}

describe("overrideHasEnv / overrideHasBinOrArgs", () => {
  const origCliSpecsFile = process.env.CLI_SPECS_FILE

  beforeEach(() => {
    vi.resetModules()
    // Isolate from the user's real ~/.config/drive-coding/cli-specs.jsonc by pointing at a
    // non-existent path (delete would fall back to homedir(), the opposite of isolation).
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE"
  })

  afterEach(() => {
    vi.resetModules()
    if (origCliSpecsFile === undefined) delete process.env.CLI_SPECS_FILE
    else process.env.CLI_SPECS_FILE = origCliSpecsFile
    if (tmpFile) {
      try {
        fs.unlinkSync(tmpFile)
      } catch {
        /* ignore */
      }
      tmpFile = null
    }
  })

  it("in-process claude with setEnv → overrideHasEnv true", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ claude: { setEnv: { FOO: "bar" } } })
    const { overrideHasEnv } = await import("./connection-registry.js")
    expect(overrideHasEnv("claude")).toBe(true)
  })

  it("in-process claude with only unsetEnv → overrideHasEnv true", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ claude: { unsetEnv: ["HTTP_PROXY"] } })
    const { overrideHasEnv } = await import("./connection-registry.js")
    expect(overrideHasEnv("claude")).toBe(true)
  })

  it("in-process claude with no env fields → overrideHasEnv false (not noisy on every connect)", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ claude: { bin: "/custom/claude" } })
    const { overrideHasEnv } = await import("./connection-registry.js")
    expect(overrideHasEnv("claude")).toBe(false)
  })

  it("spawned opencode with setEnv → predicate true but combined in-process condition false", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ opencode: { setEnv: { FOO: "bar" } } })
    const { overrideHasEnv } = await import("./connection-registry.js")
    expect(overrideHasEnv("opencode")).toBe(true)
    // The warning fires only when `cliKind in IN_PROCESS_CONNECTORS && overrideHasEnv(cliKind)`.
    // opencode is spawned, so the combined condition is false even though the predicate is true.
    expect(IN_PROCESS_KINDS.has("opencode") && overrideHasEnv("opencode")).toBe(false)
  })

  it("regression: overrideHasBinOrArgs behaves as before", async () => {
    process.env.CLI_SPECS_FILE = writeSpecs({ claude: { bin: "/custom/claude", args: ["--foo"] } })
    const { overrideHasBinOrArgs } = await import("./connection-registry.js")
    expect(overrideHasBinOrArgs("claude")).toBe(true)
    expect(overrideHasBinOrArgs("opencode")).toBe(false)
  })
})

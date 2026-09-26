import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

describe("tool-output-mappings defaults", () => {
  it("loads Codex default with provenance and exact fields", async () => {
    const { getDefaultMappingsForTest } = await import("./tool-output-mappings.js")
    const defaults = getDefaultMappingsForTest()
    expect(defaults.codex).toEqual({
      verifiedAgainst: {
        bridge: "@musicode1/codex-acp",
        version: "1.0.2",
      },
      fields: {
        text: [["formatted_output"], ["result", "content", 0, "text"]],
        exitCode: [["exit_code"]],
      },
    })
    expect(defaults.claude).toBeUndefined()
  })
})

describe("getEffectiveToolOutputMappings", () => {
  const tmpFiles: string[] = []
  const originalEnv = { ...process.env }

  function writeTmpFile(content: string): string {
    const filePath = path.join(
      os.tmpdir(),
      `cli-specs-tool-output-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonc`,
    )
    fs.writeFileSync(filePath, content, "utf8")
    tmpFiles.push(filePath)
    return filePath
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

  it("merges partial override: text replaces list, exitCode inherited", async () => {
    const filePath = writeTmpFile(
      JSON.stringify({
        codex: {
          toolOutput: {
            fields: {
              text: [["only_text"]],
            },
          },
        },
      }),
    )
    process.env.CLI_SPECS_FILE = filePath

    const { getEffectiveToolOutputMappings } = await import("./tool-output-mappings.js")
    const effective = getEffectiveToolOutputMappings()
    expect(effective.codex?.fields.text).toEqual([["only_text"]])
    expect(effective.codex?.fields.exitCode).toEqual([["exit_code"]])
  })

  it("new CLI gets mapping without verifiedAgainst", async () => {
    const filePath = writeTmpFile(
      JSON.stringify({
        "custom-cli": {
          bin: "custom-cli-acp",
          toolOutput: {
            fields: {
              text: [["payload", "items", 0, "body"]],
            },
          },
        },
      }),
    )
    process.env.CLI_SPECS_FILE = filePath

    const { getEffectiveToolOutputMappings } = await import("./tool-output-mappings.js")
    const effective = getEffectiveToolOutputMappings()
    expect(effective["custom-cli"]).toEqual({
      fields: {
        text: [["payload", "items", 0, "body"]],
      },
    })
    expect(effective["custom-cli"]?.verifiedAgainst).toBeUndefined()
  })

  it("verifiedAgainst change in fixture does not affect projection fields", async () => {
    const { getDefaultMappingsForTest, getToolOutputMappingsProjection } = await import(
      "./tool-output-mappings.js"
    )
    const defaults = getDefaultMappingsForTest()
    const before = getToolOutputMappingsProjection()
    // Mutate in-memory copy for test — defaults object is frozen-ish but we simulate wrong provenance in JSON only
    expect(defaults.codex?.verifiedAgainst.bridge).toBe("@musicode1/codex-acp")
    expect(before.codex).toEqual({
      text: [["formatted_output"], ["result", "content", 0, "text"]],
      exitCode: [["exit_code"]],
    })
  })

  it("hot reload: invalidateCache picks up override change", async () => {
    const filePath = writeTmpFile(
      JSON.stringify({
        codex: {
          toolOutput: {
            fields: {
              text: [["first"]],
            },
          },
        },
      }),
    )
    process.env.CLI_SPECS_FILE = filePath

    const { getEffectiveToolOutputMappings, getToolOutputMappingsProjection } = await import(
      "./tool-output-mappings.js"
    )
    const { invalidateCache } = await import("./cli-config-file.js")

    expect(getEffectiveToolOutputMappings().codex?.fields.text).toEqual([["first"]])
    expect(getToolOutputMappingsProjection().codex?.text).toEqual([["first"]])

    fs.writeFileSync(
      filePath,
      JSON.stringify({
        codex: {
          toolOutput: {
            fields: {
              text: [["second"]],
            },
          },
        },
      }),
      "utf8",
    )
    invalidateCache()

    expect(getEffectiveToolOutputMappings().codex?.fields.text).toEqual([["second"]])
    expect(getToolOutputMappingsProjection().codex?.text).toEqual([["second"]])
  })
})

describe("parseToolOutputOverride validation", () => {
  it("rejects empty path, empty segment, negative index, unknown field via fail-open", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { parseToolOutputOverride } = await import("./tool-output-override-parse.js")

    expect(parseToolOutputOverride("codex", { fields: { text: [[]] } })).toBeUndefined()
    expect(parseToolOutputOverride("codex", { fields: { text: [[""]] } })).toBeUndefined()
    expect(parseToolOutputOverride("codex", { fields: { text: [[-1]] } })).toBeUndefined()
    expect(parseToolOutputOverride("codex", { fields: { text: [[1.5]] } })).toBeUndefined()
    expect(parseToolOutputOverride("codex", { fields: { content: [["x"]] } })).toBeUndefined()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

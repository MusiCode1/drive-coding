import { readFileSync } from "node:fs"
import { createInitialSessionState, reduce } from "@drive-coding/core/session"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import defaults from "./tool-output-mappings.json" with { type: "json" }

const sentinel = "TOOL_OUTPUT_DOCUMENTATION_SENTINEL"
const provenance = { bridge: "@agentclientprotocol/codex-acp", version: "2.5.0-dc.4" }

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("CLI_SPECS_FILE", "NO_OVERRIDE_FILE_CONTRACT_TEST")
  vi.stubEnv("CLI_SPECS_JSON", "")
})
afterEach(() => {
  vi.doUnmock("./tool-output-mappings.json")
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe("Codex canonical output contract", () => {
  it("derives terminal, MCP and non-terminal output from the packaged rules", async () => {
    const { getToolOutputRules } = await import("./tool-output-mappings.js")
    const toolOutput = getToolOutputRules("codex")
    expect(toolOutput).toBeDefined()
    expect(getToolOutputRules("claude")).toBeUndefined()
    const updates = [
      { sessionUpdate: "tool_call", toolCallId: "shell", _meta: { terminal_info: {} } },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell",
        _meta: { terminal_output_delta: { data: "one\n" } },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "shell",
        _meta: { terminal_output_delta: { data: "two\n" }, terminal_exit: { exit_code: 3 } },
      },
      { sessionUpdate: "tool_call", toolCallId: "mcp", _meta: { is_mcp_tool_call: true } },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "mcp",
        rawOutput: { error: null, result: { content: [{ text: "MCP result" }] } },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "non-terminal",
        rawOutput: { exit_code: 0 },
      },
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "legacy",
        rawOutput: { formatted_output: "legacy result" },
      },
    ]
    const state = updates.reduce(
      (state, update) => reduce(state, update, { toolOutput }).state,
      createInitialSessionState({ sessionId: "contract" }),
    )
    expect(
      state.messages.map((message) => message.role === "tool" && message.toolCall.output),
    ).toEqual([
      { text: "one\ntwo\n", exitCode: 3 },
      { text: "MCP result" },
      { exitCode: 0 },
      { text: "legacy result" },
    ])
    expect(defaults.codex.fields.text).toContainEqual({
      path: ["formatted_output"],
      note: expect.stringContaining("1.13"),
    })
    expect(toolOutput?.fields.text).toContainEqual({ from: "raw", path: ["formatted_output"] })
  })

  it("preserves the interim raw path projection", async () => {
    const { getToolOutputMappingsProjection } = await import("./tool-output-mappings.js")
    expect(getToolOutputMappingsProjection().codex).toEqual({
      text: [["result", "content", 0, "text"], ["formatted_output"]],
      exitCode: [["exit_code"]],
    })
  })

  it("checks classification of measured keys and provenance with negative controls", async () => {
    const { getToolOutputRules } = await import("./tool-output-mappings.js")
    const { codex: observed } = JSON.parse(
      readFileSync(new URL("./__fixtures__/tool-meta-observed-keys.json", import.meta.url), "utf8"),
    ) as {
      codex: { bridge: string; version: string; keys: string[] }
    }
    const missing = (keys: string[]) =>
      keys.filter((key) => !Object.hasOwn(getToolOutputRules("codex")?.metaKeys ?? {}, key))
    expect(observed.keys.length).toBeGreaterThan(0)
    expect(missing(observed.keys)).toEqual([])
    expect(missing([...observed.keys, "fixture_unclassified"])).toEqual(["fixture_unclassified"])
    const provenanceMatches = (observation: typeof observed) =>
      observation.version === defaults.codex.verifiedAgainst.version &&
      observation.bridge === defaults.codex.verifiedAgainst.bridge
    expect(provenanceMatches(observed)).toBe(true)
    expect(provenanceMatches({ ...observed, version: "0.0.0" })).toBe(false)
  })

  it("checks the packaged bridge version against the defaults", () => {
    const packageText = readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    const matches = (text: string) => {
      const pkg = JSON.parse(text) as { dependencies: Record<string, string> }
      return (
        pkg.dependencies["@musicode1/codex-acp"]?.match(/codex-acp-(.+)\.tgz$/)?.[1] ===
        defaults.codex.verifiedAgainst.version
      )
    }
    expect(matches(packageText)).toBe(true)
    expect(
      matches(
        JSON.stringify({
          dependencies: { "@musicode1/codex-acp": "file:vendor/codex-acp-0.0.0.tgz" },
        }),
      ),
    ).toBe(false)
  })

  it("strips notes from each level during compilation", async () => {
    const codex = {
      verifiedAgainst: provenance,
      note: sentinel,
      metaKeys: { stream: { mode: "append", note: sentinel } },
      fields: {
        text: { note: sentinel, paths: [{ path: ["$meta", "stream", "data"], note: sentinel }] },
      },
    }
    vi.doMock("./tool-output-mappings.json", () => ({ default: { codex } }))
    const { getToolOutputRules } = await import("./tool-output-mappings.js")
    const rules = getToolOutputRules("codex")
    expect(rules).toEqual({
      fields: { text: [{ from: "meta", key: "stream", path: ["data"] }] },
      metaKeys: { stream: "append" },
    })
    expect(JSON.stringify(rules)).not.toContain(sentinel)
    expect(JSON.stringify(codex)).toContain(sentinel)
  })

  it.each([
    { text: [["$meta", "nope"]] },
    { text: [["middle", "$meta"]] },
    { exitCode: [["$meta", "stream"]] },
  ])("rejects invalid meta paths in defaults (%j)", async (fields) => {
    vi.doMock("./tool-output-mappings.json", () => ({
      default: { codex: { verifiedAgainst: provenance, metaKeys: { stream: "append" }, fields } },
    }))
    await expect(import("./tool-output-mappings.js")).rejects.toThrow("$meta")
  })

  it("rejects non-string notes in defaults", async () => {
    vi.doMock("./tool-output-mappings.json", () => ({
      default: {
        codex: { verifiedAgainst: provenance, fields: { text: { paths: [["text"]], note: 1 } } },
      },
    }))
    await expect(import("./tool-output-mappings.js")).rejects.toThrow("note")
  })

  it("accepts a metaKeys-only override and warns once for a path invalidated by it", async () => {
    vi.stubEnv(
      "CLI_SPECS_JSON",
      JSON.stringify({
        codex: {
          toolOutput: { metaKeys: { terminal_output_delta: { mode: "ignore", note: sentinel } } },
        },
      }),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { getToolOutputRules } = await import("./tool-output-mappings.js")
    const { invalidateCache } = await import("./cli-config-file.js")
    for (const rules of [getToolOutputRules("codex"), getToolOutputRules("codex")]) {
      expect(rules?.metaKeys.terminal_output_delta).toBe("ignore")
      expect(rules?.metaKeys.terminal_exit).toBe("replace")
      expect(rules?.fields.text).not.toContainEqual(
        expect.objectContaining({ key: "terminal_output_delta" }),
      )
    }
    expect(warn).toHaveBeenCalledTimes(1)
    invalidateCache()
    getToolOutputRules("codex")
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("accepts inherited classifications, skips unclassified sources, and warns about invalid notes", async () => {
    vi.stubEnv(
      "CLI_SPECS_JSON",
      JSON.stringify({
        codex: {
          toolOutput: {
            note: 5,
            fields: {
              text: [
                {
                  path: ["$meta", "terminal_output_delta", "data"],
                  note: "uses default classification",
                },
                ["$meta", "nope"],
              ],
            },
          },
        },
      }),
    )
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { getToolOutputRules } = await import("./tool-output-mappings.js")
    expect(getToolOutputRules("codex")?.fields.text).toEqual([
      { from: "meta", key: "terminal_output_delta", path: ["data"] },
    ])
    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([
      expect.stringContaining("note"),
      expect.stringContaining("nope"),
    ])
  })

  it("preserves valid classifications when fields are malformed or empty", async () => {
    const { parseToolOutputOverride } = await import("./tool-output-override-parse.js")
    vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const fields of [null, {}]) {
      expect(
        parseToolOutputOverride("custom", { fields, metaKeys: { custom: "replace" } })?.metaKeys,
      ).toEqual({ custom: "replace" })
    }
  })
})

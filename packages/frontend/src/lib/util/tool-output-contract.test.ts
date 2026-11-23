/**
 * Provider projection → FE normalization contract (tool-output-field-mappings).
 * Codex 2.5.0-dc.4 rawOutput paths for the standard ACP client.
 * Shell text arrives separately in _meta.terminal_output_delta.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getToolOutputMappingsProjection } from "@drive-coding/provider/config"
import { afterEach, describe, expect, it, vi } from "vitest"
import { normalizeToolOutput } from "./tool-format"

describe("tool output field mappings end-to-end contract", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("codex projection reads MCP text and handles shell exit metadata without text", () => {
    vi.stubEnv("CLI_SPECS_FILE", "NO_OVERRIDE_FILE_CONTRACT_TEST")
    const mapping = getToolOutputMappingsProjection(process.env).codex
    expect(mapping).toEqual({
      text: [["result", "content", 0, "text"]],
      exitCode: [["exit_code"]],
    })
    expect(
      normalizeToolOutput(
        { error: null, result: { content: [{ type: "text", text: "mcp ok" }] } },
        mapping,
      ),
    ).toEqual({ kind: "text", text: "mcp ok" })
    expect(normalizeToolOutput({ exit_code: 0 }, mapping)).toEqual({
      kind: "stat",
      stats: [{ key: "exit_code", value: "0" }],
    })
    expect(normalizeToolOutput(undefined, mapping)).toEqual({ kind: "empty" })
  })

  it("static defaults identify the packaged Codex bridge", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..")
    const jsonPath = join(repoRoot, "packages/provider/src/config/tool-output-mappings.json")
    const json = readFileSync(jsonPath, "utf8")
    expect(json).toContain("@agentclientprotocol/codex-acp")
    expect(json).toContain('"2.5.0-dc.4"')
    expect(json).not.toContain("formatted_output")
  })
})

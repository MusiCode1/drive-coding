/**
 * Provider projection → FE normalization contract (tool-output-field-mappings).
 * Codex 2.5.0 rawOutput paths only. Command text lives in terminal_output_delta,
 * which this mapping does not reach.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getToolOutputMappingsProjection } from "@drive-coding/provider/config"
import { describe, expect, it } from "vitest"
import { normalizeToolOutput } from "./tool-format"

describe("tool output field mappings end-to-end contract", () => {
  it("codex projection reads the 2.5.0 rawOutput shapes", () => {
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE_CONTRACT_TEST"
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
  })

  it("static defaults record the 2.5.0 bridge and drop formatted_output", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..")
    const jsonPath = join(repoRoot, "packages/provider/src/config/tool-output-mappings.json")
    const json = readFileSync(jsonPath, "utf8")
    expect(json).toContain("@agentclientprotocol/codex-acp")
    expect(json).toContain("2.5.0")
    expect(json).not.toContain("formatted_output")
  })
})

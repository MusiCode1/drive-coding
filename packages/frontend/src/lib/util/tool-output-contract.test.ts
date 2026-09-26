/**
 * Provider projection → FE normalization contract (tool-output-field-mappings, Commit 5).
 * Release artifact smoke (formatted_output in bundle) is verified via build gates in CI/manual.
 */

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getToolOutputMappingsProjection } from "@drive-coding/provider/config"
import { describe, expect, it } from "vitest"
import { normalizeToolOutput } from "./tool-format"

describe("tool output field mappings end-to-end contract", () => {
  it("codex projection normalizes verified wire shape", () => {
    process.env.CLI_SPECS_FILE = "NO_OVERRIDE_FILE_CONTRACT_TEST"
    const mapping = getToolOutputMappingsProjection(process.env).codex
    expect(mapping).toBeDefined()
    expect(normalizeToolOutput({ formatted_output: "contract ok", exit_code: 0 }, mapping)).toEqual(
      { kind: "text", text: "contract ok", exitCode: 0 },
    )
  })

  it("static defaults JSON retains formatted_output path", () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../..")
    const jsonPath = join(repoRoot, "packages/provider/src/config/tool-output-mappings.json")
    expect(readFileSync(jsonPath, "utf8")).toContain("formatted_output")
  })
})

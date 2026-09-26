import { describe, expect, it } from "vitest"
import { TOOL_OUTPUT_FIELDS } from "./tool-output.js"

/** Must match packages/provider/src/config/tool-output-field-types.ts `TOOL_OUTPUT_FIELDS`. */
const PROVIDER_CANONICAL_FIELDS = [
  "text",
  "exitCode",
  "stdout",
  "stderr",
  "error",
  "isError",
] as const

describe("tool output canonical fields sync gate", () => {
  it("FE TOOL_OUTPUT_FIELDS matches provider list", () => {
    expect([...TOOL_OUTPUT_FIELDS]).toEqual([...PROVIDER_CANONICAL_FIELDS])
  })
})

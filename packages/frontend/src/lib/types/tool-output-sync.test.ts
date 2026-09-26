import { TOOL_OUTPUT_FIELDS as PROVIDER_FIELDS } from "@drive-coding/provider/config"
import { describe, expect, it } from "vitest"
import { TOOL_OUTPUT_FIELDS } from "./tool-output.js"

describe("tool output canonical fields sync gate", () => {
  it("FE TOOL_OUTPUT_FIELDS matches provider list", () => {
    expect([...TOOL_OUTPUT_FIELDS]).toEqual([...PROVIDER_FIELDS])
  })
})

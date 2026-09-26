import { describe, expect, it } from "vitest"
import { TOOL_OUTPUT_SHAPES } from "./__fixtures__/tool-output-shapes"
import { normalizeToolOutput } from "./tool-format"

describe("tool-output-shapes regression gate", () => {
  it.each(
    TOOL_OUTPUT_SHAPES.map((s) => [s.name, s.raw, s.expected] as const),
  )("%s → %s", (_name, raw, expected) => {
    expect(normalizeToolOutput(raw).kind).toBe(expected)
  })

  it("covers all 15 shapes", () => {
    expect(TOOL_OUTPUT_SHAPES).toHaveLength(15)
  })
})

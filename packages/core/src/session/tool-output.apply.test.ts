import { describe, expect, it } from "vitest"
import { applyToolOutputDelta, parseToolOutputDelta, TOOL_OUTPUT_TEXT_CAP } from "./tool-output"

describe("canonical tool output delta", () => {
  it("sets before appending, starts missing text fields empty, and keeps the tail", () => {
    expect(
      applyToolOutputDelta(
        { text: "previous" },
        {
          set: { text: "x".repeat(TOOL_OUTPUT_TEXT_CAP), exitCode: 0, isError: false },
          append: { text: "tail", stdout: "new" },
        },
      ),
    ).toEqual({
      text: `${"x".repeat(TOOL_OUTPUT_TEXT_CAP - 4)}tail`,
      stdout: "new",
      exitCode: 0,
      isError: false,
      truncated: true,
    })
  })

  it("caps all four text fields independently and keeps truncation sticky", () => {
    const text = `x${"y".repeat(TOOL_OUTPUT_TEXT_CAP)}`
    const output = applyToolOutputDelta(undefined, {
      set: { text, stdout: text, stderr: text, error: text },
    })
    const tail = "y".repeat(TOOL_OUTPUT_TEXT_CAP)
    expect(output).toEqual({ text: tail, stdout: tail, stderr: tail, error: tail, truncated: true })
    expect(applyToolOutputDelta(output, { set: { stdout: "" } }).truncated).toBe(true)
    expect(applyToolOutputDelta(undefined, { truncated: true })).toEqual({ truncated: true })
  })

  it("skips invalid fields independently", () => {
    expect(
      parseToolOutputDelta({
        set: { text: "start", error: null, exitCode: Infinity, isError: false, unknown: "x" },
        append: { text: "end", stdout: 1, exitCode: "3", stderr: "" },
        truncated: true,
      }),
    ).toEqual({
      set: { text: "start", isError: false },
      append: { text: "end", stderr: "" },
      truncated: true,
    })
  })

  it.each([null, [], 42, {}, { set: [], append: null, truncated: false }, { set: { bogus: "x" } }])(
    "ignores an invalid or empty delta (%j)",
    (value) => {
      expect(parseToolOutputDelta(value)).toBeUndefined()
    },
  )
})

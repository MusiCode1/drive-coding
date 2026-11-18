/**
 * last-assistant-text.test.ts — extractLastAssistantText unit tests.
 */

import { describe, expect, it } from "vitest"
import {
  extractLastAssistantQuote,
  extractLastAssistantText,
  LAST_ASSISTANT_TEXT_MAX_CHARS,
} from "./last-assistant-text.js"

describe("extractLastAssistantText", () => {
  it("returns text from the last assistant message", () => {
    const text = extractLastAssistantText([
      { role: "user", segments: [{ text: "hi" }] },
      { role: "assistant", segments: [{ text: "hello" }, { text: " world" }] },
    ])
    expect(text).toBe("hello world")
  })

  it("skips thought and tool roles", () => {
    const text = extractLastAssistantText([
      { role: "assistant", segments: [{ text: "first" }] },
      { role: "thought", segments: [{ text: "thinking" }] },
      { role: "tool", segments: [{ text: "tool output" }] },
    ])
    expect(text).toBe("first")
  })

  it("returns undefined when no assistant message or empty segments", () => {
    expect(extractLastAssistantText([])).toBeUndefined()
    expect(extractLastAssistantText([{ role: "user", segments: [{ text: "hi" }] }])).toBeUndefined()
    expect(extractLastAssistantText([{ role: "assistant", segments: [] }])).toBeUndefined()
    expect(
      extractLastAssistantText([{ role: "assistant", segments: [{ text: "" }] }]),
    ).toBeUndefined()
  })

  it("truncates with ellipsis when over max chars", () => {
    const long = "x".repeat(LAST_ASSISTANT_TEXT_MAX_CHARS + 10)
    const text = extractLastAssistantText([{ role: "assistant", segments: [{ text: long }] }])
    expect(text).toHaveLength(LAST_ASSISTANT_TEXT_MAX_CHARS + 1)
    expect(text?.endsWith("…")).toBe(true)
    expect(text?.slice(0, LAST_ASSISTANT_TEXT_MAX_CHARS)).toBe("x".repeat(LAST_ASSISTANT_TEXT_MAX_CHARS))
  })
})

describe("extractLastAssistantQuote", () => {
  it("sets truncated from threshold not trailing ellipsis in source", () => {
    const endsWithEllipsis = `${"y".repeat(LAST_ASSISTANT_TEXT_MAX_CHARS - 1)}…`
    const quote = extractLastAssistantQuote([
      { role: "assistant", segments: [{ text: endsWithEllipsis }] },
    ])
    expect(quote).toEqual({ text: endsWithEllipsis, truncated: false })
  })

  it("returns prior assistant when latest assistant message is empty", () => {
    const quote = extractLastAssistantQuote([
      { role: "assistant", segments: [{ text: "prior-turn" }] },
      { role: "user", segments: [{ text: "next" }] },
      { role: "assistant", segments: [{ text: "" }] },
    ])
    expect(quote).toEqual({ text: "prior-turn", truncated: false })
  })

  it("uses last non-empty assistant in session", () => {
    const quote = extractLastAssistantQuote([
      { role: "assistant", segments: [{ text: "first" }] },
      { role: "assistant", segments: [{ text: "second" }] },
    ])
    expect(quote).toEqual({ text: "second", truncated: false })
  })

  it("marks truncated true when over max", () => {
    const long = "z".repeat(LAST_ASSISTANT_TEXT_MAX_CHARS + 1)
    const quote = extractLastAssistantQuote([{ role: "assistant", segments: [{ text: long }] }])
    expect(quote?.truncated).toBe(true)
    expect(quote?.text.endsWith("…")).toBe(true)
  })
})


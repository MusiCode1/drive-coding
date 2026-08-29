/**
 * live-read-recent.test.ts — last-N bubbles without a search query.
 */

import { describe, expect, it } from "vitest"
import {
  clampRecentCount,
  parseRecentBool,
  parseRecentCount,
  READ_RECENT_DEFAULT_COUNT,
  READ_RECENT_MAX_CHARS,
  READ_RECENT_MAX_COUNT,
  readRecentBubbles,
  type RecentItem,
} from "./live-read-recent"

function item(
  role: RecentItem["role"],
  text: string,
  turnIndex: number,
  tool?: RecentItem["tool"],
): RecentItem {
  return tool ? { role, text, turnIndex, tool } : { role, text, turnIndex }
}

describe("readRecentBubbles()", () => {
  const fixtures: readonly RecentItem[] = [
    item("user", "first", 0),
    item("assistant", "second", 1),
    item("thought", "ponder", 2),
    item("tool", "run_tests", 3, {
      name: "run_tests",
      status: "completed",
      args: '{"cmd":"vitest"}',
      output: "ok",
    }),
    item("user", "latest", 4),
  ]

  it("returns an empty list when there are no message bubbles", () => {
    expect(readRecentBubbles([])).toEqual({ messages: [], total: 0, returned: 0 })
  })

  it("default skips thoughts and strips tool payloads", () => {
    const { messages, total, returned } = readRecentBubbles(fixtures, { count: 10 })
    expect(total).toBe(4)
    expect(returned).toBe(4)
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "user"])
    expect(messages.map((m) => m.text)).toEqual(["first", "second", "run_tests", "latest"])
    expect(messages[2]?.tool).toBeUndefined()
  })

  it("returns only the last N eligible bubbles", () => {
    const { messages, total, returned } = readRecentBubbles(fixtures, { count: 2 })
    expect(total).toBe(4)
    expect(returned).toBe(2)
    expect(messages.map((m) => m.text)).toEqual(["run_tests", "latest"])
  })

  it("defaults to READ_RECENT_DEFAULT_COUNT", () => {
    const many = Array.from({ length: 30 }, (_, i) => item("user", `m${i}`, i))
    const { messages, total, returned } = readRecentBubbles(many)
    expect(total).toBe(30)
    expect(returned).toBe(READ_RECENT_DEFAULT_COUNT)
    expect(messages[0]?.text).toBe("m22")
    expect(messages.at(-1)?.text).toBe("m29")
  })

  it("clips long text without splitting Hebrew letters", () => {
    const long = "שלום ".repeat(200)
    const { messages } = readRecentBubbles([item("user", long, 0)], { maxChars: 12 })
    expect([...messages[0]?.text ?? ""].length).toBeLessThanOrEqual(12)
    expect(messages[0]?.text.endsWith("\u2026")).toBe(true)
  })

  it("uses default maxChars cap", () => {
    const long = "a".repeat(READ_RECENT_MAX_CHARS + 50)
    const { messages } = readRecentBubbles([item("assistant", long, 0)])
    expect(messages[0]?.text.length).toBeLessThanOrEqual(READ_RECENT_MAX_CHARS)
  })

  it("thoughts=true includes thought traces", () => {
    const { messages } = readRecentBubbles(fixtures, { count: 10, thoughts: true })
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "thought", "tool", "user"])
    expect(messages[2]?.text).toBe("ponder")
  })

  it("toolCalls=true keeps args and output", () => {
    const { messages } = readRecentBubbles(fixtures, { count: 10, toolCalls: true })
    const tool = messages.find((m) => m.role === "tool")
    expect(tool?.tool).toEqual({
      name: "run_tests",
      status: "completed",
      args: '{"cmd":"vitest"}',
      output: "ok",
    })
  })

  it("messages=false and thoughts=true returns only thoughts", () => {
    const { messages, total } = readRecentBubbles(fixtures, {
      messages: false,
      thoughts: true,
    })
    expect(total).toBe(1)
    expect(messages).toEqual([{ role: "thought", turnIndex: 2, text: "ponder" }])
  })

  it("messages=false and toolCalls=true returns only full tool calls", () => {
    const { messages } = readRecentBubbles(fixtures, { messages: false, toolCalls: true })
    expect(messages).toHaveLength(1)
    expect(messages[0]?.role).toBe("tool")
    expect(messages[0]?.tool?.args).toBe('{"cmd":"vitest"}')
  })

  it("messages=false thoughts and toolCalls returns both extras", () => {
    const { messages } = readRecentBubbles(fixtures, {
      messages: false,
      thoughts: true,
      toolCalls: true,
    })
    expect(messages.map((m) => m.role)).toEqual(["thought", "tool"])
  })
})

describe("clampRecentCount / parseRecentCount / parseRecentBool", () => {
  it("clamps to 1..MAX", () => {
    expect(clampRecentCount(0)).toBe(1)
    expect(clampRecentCount(-3)).toBe(1)
    expect(clampRecentCount(READ_RECENT_MAX_COUNT + 5)).toBe(READ_RECENT_MAX_COUNT)
    expect(clampRecentCount(3.9)).toBe(3)
  })

  it("parses number or numeric string from Live args", () => {
    expect(parseRecentCount(undefined)).toBe(READ_RECENT_DEFAULT_COUNT)
    expect(parseRecentCount("5")).toBe(5)
    expect(parseRecentCount(12)).toBe(12)
    expect(parseRecentCount("nope")).toBe(READ_RECENT_DEFAULT_COUNT)
  })

  it("parses boolean or string flags from Live args", () => {
    expect(parseRecentBool(undefined)).toBeUndefined()
    expect(parseRecentBool(true)).toBe(true)
    expect(parseRecentBool(false)).toBe(false)
    expect(parseRecentBool("true")).toBe(true)
    expect(parseRecentBool("FALSE")).toBe(false)
    expect(parseRecentBool("1")).toBe(true)
    expect(parseRecentBool("nope")).toBeUndefined()
  })
})

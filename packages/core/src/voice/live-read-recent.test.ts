/**
 * live-read-recent.test.ts — last-N bubbles without a search query.
 */

import { describe, expect, it } from "vitest"
import {
  clampRecentCount,
  parseRecentCount,
  READ_RECENT_DEFAULT_COUNT,
  READ_RECENT_MAX_CHARS,
  READ_RECENT_MAX_COUNT,
  readRecentBubbles,
} from "./live-read-recent"
import type { LiveSeedBubble } from "./live-seed"

function bubble(kind: LiveSeedBubble["kind"], text: string, turnIndex: number): LiveSeedBubble {
  return { kind, text, turnIndex }
}

describe("readRecentBubbles()", () => {
  const fixtures: readonly LiveSeedBubble[] = [
    bubble("user", "first", 0),
    bubble("assistant", "second", 1),
    bubble("status", "agent running", 2),
    bubble("tool", "run_tests", 3),
    bubble("user", "latest", 4),
  ]

  it("returns an empty list when there are no message bubbles", () => {
    expect(readRecentBubbles([])).toEqual({ messages: [], total: 0, returned: 0 })
  })

  it("skips status bubbles and keeps chronological order", () => {
    const { messages, total, returned } = readRecentBubbles(fixtures, { count: 10 })
    expect(total).toBe(4)
    expect(returned).toBe(4)
    expect(messages.map((m) => m.text)).toEqual(["first", "second", "run_tests", "latest"])
    expect(messages[0]?.role).toBe("user")
    expect(messages[2]?.role).toBe("tool")
  })

  it("returns only the last N eligible bubbles", () => {
    const { messages, total, returned } = readRecentBubbles(fixtures, { count: 2 })
    expect(total).toBe(4)
    expect(returned).toBe(2)
    expect(messages.map((m) => m.text)).toEqual(["run_tests", "latest"])
  })

  it("defaults to READ_RECENT_DEFAULT_COUNT", () => {
    const many = Array.from({ length: 30 }, (_, i) => bubble("user", `m${i}`, i))
    const { messages, total, returned } = readRecentBubbles(many)
    expect(total).toBe(30)
    expect(returned).toBe(READ_RECENT_DEFAULT_COUNT)
    expect(messages[0]?.text).toBe("m22")
    expect(messages.at(-1)?.text).toBe("m29")
  })

  it("clips long text without splitting Hebrew letters", () => {
    const long = "שלום ".repeat(200)
    const { messages } = readRecentBubbles([bubble("user", long, 0)], { maxChars: 12 })
    expect([...messages[0]?.text ?? ""].length).toBeLessThanOrEqual(12)
    expect(messages[0]?.text.endsWith("\u2026")).toBe(true)
  })

  it("uses default maxChars cap", () => {
    const long = "a".repeat(READ_RECENT_MAX_CHARS + 50)
    const { messages } = readRecentBubbles([bubble("assistant", long, 0)])
    expect(messages[0]?.text.length).toBeLessThanOrEqual(READ_RECENT_MAX_CHARS)
  })
})

describe("clampRecentCount / parseRecentCount", () => {
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
})

/**
 * live-search.test.ts — TDD for slice live-context, Commit 1.
 */

import { describe, expect, it } from "vitest"
import { searchSessionBubbles } from "./live-search"
import type { LiveSeedBubble } from "./live-seed"

function bubble(kind: LiveSeedBubble["kind"], text: string, turnIndex: number): LiveSeedBubble {
  return { kind, text, turnIndex }
}

describe("searchSessionBubbles()", () => {
  const fixtures: readonly LiveSeedBubble[] = [
    bubble("user", "Let's test the auth module", 0),
    bubble("assistant", "Running tests on auth.test.ts", 1),
    bubble("tool", "run_tests", 2),
    bubble("status", "agent running tests on auth", 3),
  ]

  it("returns empty result for empty query", () => {
    expect(searchSessionBubbles(fixtures, "")).toEqual({ hits: [], totalMatches: 0 })
    expect(searchSessionBubbles(fixtures, "   ")).toEqual({ hits: [], totalMatches: 0 })
  })

  it("returns empty result when nothing matches", () => {
    expect(searchSessionBubbles(fixtures, "zzznomatch")).toEqual({ hits: [], totalMatches: 0 })
  })

  it("finds user and assistant text case-insensitively", () => {
    const { hits, totalMatches } = searchSessionBubbles(fixtures, "AUTH")
    expect(totalMatches).toBeGreaterThanOrEqual(2)
    expect(hits.some((h) => h.role === "user")).toBe(true)
    expect(hits.some((h) => h.role === "assistant")).toBe(true)
  })

  it("finds tool bubbles by tool name", () => {
    const { hits } = searchSessionBubbles(fixtures, "run_tests")
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ role: "tool", turnIndex: 2 })
  })

  it("does not return status bubbles even when text matches", () => {
    const { hits, totalMatches } = searchSessionBubbles(fixtures, "agent running")
    expect(hits).toEqual([])
    expect(totalMatches).toBe(0)
  })

  it("reports totalMatches above hits.length when limited", () => {
    const many = [
      bubble("user", "auth one", 0),
      bubble("user", "auth two", 1),
      bubble("user", "auth three", 2),
      bubble("user", "auth four", 3),
    ]
    const { hits, totalMatches } = searchSessionBubbles(many, "auth", { limit: 2 })
    expect(totalMatches).toBe(4)
    expect(hits).toHaveLength(2)
  })

  it("truncates snippets to snippetChars without splitting Hebrew letters", () => {
    const hebrew = bubble("user", "הסוכן מריץ טסטים על מודול auth בתוך הפרויקט", 0)
    const { hits } = searchSessionBubbles([hebrew], "auth", { snippetChars: 12 })
    expect(hits).toHaveLength(1)
    const snippet = hits[0]?.snippet ?? ""
    expect([...snippet].length).toBeLessThanOrEqual(12)
    expect(snippet).toContain("auth")
  })

  it("tokenizes Hebrew and English query parts", () => {
    const bubbles = [bubble("assistant", "module auth tests pass", 0)]
    const { hits } = searchSessionBubbles(bubbles, "auth \u05de\u05d5\u05d3\u05d5\u05dc")
    expect(hits).toHaveLength(0)

    const withHebrew = [bubble("user", "working on auth module", 0)]
    const hit = searchSessionBubbles(withHebrew, "auth module")
    expect(hit.totalMatches).toBe(1)
  })

  it("uses default limit 5 and snippetChars 200", () => {
    const bubbles = Array.from({ length: 8 }, (_, i) => bubble("user", `match number ${i}`, i))
    const { hits } = searchSessionBubbles(bubbles, "match")
    expect(hits).toHaveLength(5)
    for (const h of hits) {
      expect(h.snippet.length).toBeLessThanOrEqual(200)
    }
  })
})

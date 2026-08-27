/**
 * live-memory.test.ts — TDD for slice live-context, Commit 2.
 */

import { describe, expect, it } from "vitest"
import { formatMemoryForPrompt, type MemoryItem, upsertMemory } from "./live-memory"

const quotas = {
  maxItems: 3,
  maxItemChars: 20,
  maxTotalChars: 40,
}

describe("upsertMemory()", () => {
  it("adds a new item with generated id when id omitted", () => {
    const result = upsertMemory([], { text: "prefer tabs" }, "session", quotas)
    expect(result.ok).toBe(true)
    expect(result.full).toBe(false)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.text).toBe("prefer tabs")
    expect(result.items[0]?.id.length).toBeGreaterThan(0)
  })

  it("overwrites existing id", () => {
    const existing: MemoryItem[] = [{ id: "a", text: "old" }]
    const result = upsertMemory(existing, { id: "a", text: "new" }, "session", quotas)
    expect(result.items).toEqual([{ id: "a", text: "new" }])
    expect(result.ok).toBe(true)
  })

  it("truncates item text exceeding maxItemChars instead of refusing", () => {
    const long = "this is a very long memory entry text"
    const result = upsertMemory([], { text: long }, "session", {
      ...quotas,
      maxItemChars: 10,
      maxTotalChars: 100,
    })
    expect(result.ok).toBe(true)
    expect(result.items[0]?.text).toBe(long.slice(0, 10))
  })

  it("session layer evicts oldest on overflow (circular)", () => {
    const items: MemoryItem[] = [
      { id: "1", text: "first" },
      { id: "2", text: "second" },
      { id: "3", text: "third" },
    ]
    const result = upsertMemory(items, { id: "4", text: "fourth" }, "session", quotas)
    expect(result.ok).toBe(true)
    expect(result.full).toBe(false)
    expect(result.items.map((i) => i.id)).toEqual(["2", "3", "4"])
  })

  it("always layer refuses when full and returns current items", () => {
    const items: MemoryItem[] = [
      { id: "1", text: "a" },
      { id: "2", text: "b" },
      { id: "3", text: "c" },
    ]
    const result = upsertMemory(items, { id: "4", text: "d" }, "always", quotas)
    expect(result.ok).toBe(false)
    expect(result.full).toBe(true)
    expect(result.items).toEqual(items)
  })

  it("always layer allows update of existing id even when at capacity", () => {
    const items: MemoryItem[] = [
      { id: "1", text: "a" },
      { id: "2", text: "b" },
      { id: "3", text: "c" },
    ]
    const result = upsertMemory(items, { id: "2", text: "updated" }, "always", quotas)
    expect(result.ok).toBe(true)
    expect(result.items).toEqual([
      { id: "1", text: "a" },
      { id: "2", text: "updated" },
      { id: "3", text: "c" },
    ])
  })

  it("does not throw when always layer is full", () => {
    const items: MemoryItem[] = [
      { id: "1", text: "x" },
      { id: "2", text: "y" },
      { id: "3", text: "z" },
    ]
    expect(() => upsertMemory(items, { text: "new" }, "always", quotas)).not.toThrow()
  })

  it("deduplicates identical text on new insert (idempotency)", () => {
    const items: MemoryItem[] = [{ id: "1", text: "same fact" }]
    const result = upsertMemory(items, { text: "same fact" }, "session", quotas)
    expect(result.ok).toBe(true)
    expect(result.items).toHaveLength(1)
    expect(result.items[0]?.id).toBe("1")
  })

  it("evicts by maxTotalChars on session layer", () => {
    const items: MemoryItem[] = [
      { id: "1", text: "1234567890" },
      { id: "2", text: "1234567890" },
    ]
    const result = upsertMemory(items, { id: "3", text: "1234567890" }, "session", {
      maxItems: 10,
      maxItemChars: 20,
      maxTotalChars: 25,
    })
    expect(result.ok).toBe(true)
    expect(result.items.reduce((s, i) => s + i.text.length, 0)).toBeLessThanOrEqual(25)
    expect(result.items[result.items.length - 1]?.id).toBe("3")
  })
})

describe("formatMemoryForPrompt()", () => {
  it("formats items as numbered lines with ids", () => {
    const items: MemoryItem[] = [
      { id: "a", text: "Use Hebrew" },
      { id: "b", text: "No emojis" },
    ]
    const formatted = formatMemoryForPrompt(items)
    expect(formatted).toContain("[a]")
    expect(formatted).toContain("Use Hebrew")
    expect(formatted).toContain("[b]")
    expect(formatted).toContain("No emojis")
  })

  it("returns empty string for empty list", () => {
    expect(formatMemoryForPrompt([])).toBe("")
  })
})

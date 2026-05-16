/**
 * Phase 2 — narration.ts tests.
 *
 * Covers: buildNarratePrompt (pure, 6 tests) and
 * narrateToolCall (async, cache hit/miss/timeout/error, 8 tests).
 */

import type { Cache } from "@drive-coding/core/cache/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { NarrationValue } from "../src/voice/narration.js"
import { buildNarratePrompt, narrateToolCall } from "../src/voice/narration.js"

// ─── helpers ─────────────────────────────────────────────────

function makeNullCache(): Cache<NarrationValue> {
  return {
    get: async () => null,
    set: async () => {},
    has: async () => false,
  }
}

function makeHitCache(value: NarrationValue): Cache<NarrationValue> {
  return {
    get: async () => value,
    set: async () => {},
    has: async () => true,
  }
}

const baseCtx = {
  userMessage: "תוכל לקרוא את הפרויקט?",
  recentMessages: ["נתחיל עם ה-README"],
}

const baseTool = {
  toolCallId: "tc-001",
  kind: "read" as const,
  title: "README.md",
}

// ─── buildNarratePrompt — pure function ──────────────────────

describe("buildNarratePrompt — pure", () => {
  it("NARR-1: contains user message in prompt", () => {
    const prompt = buildNarratePrompt(baseCtx, baseTool)
    expect(prompt).toContain(baseCtx.userMessage)
  })

  it("NARR-2: contains tool title in prompt", () => {
    const prompt = buildNarratePrompt(baseCtx, baseTool)
    expect(prompt).toContain(baseTool.title)
  })

  it("NARR-3: contains tool kind in prompt", () => {
    const prompt = buildNarratePrompt(baseCtx, baseTool)
    expect(prompt).toContain("read")
  })

  it("NARR-4: recent messages joined into prompt", () => {
    const ctx = { userMessage: "שאלה", recentMessages: ["הודעה 1", "הודעה 2"] }
    const prompt = buildNarratePrompt(ctx, baseTool)
    expect(prompt).toContain("הודעה 1")
    expect(prompt).toContain("הודעה 2")
  })

  it("NARR-5: empty recentMessages uses fallback dash", () => {
    const ctx = { ...baseCtx, recentMessages: [] }
    const prompt = buildNarratePrompt(ctx, baseTool)
    expect(prompt.length).toBeGreaterThan(0)
    expect(prompt).toContain("—")
  })

  it("NARR-6: missing kind shows fallback marker", () => {
    const tool = { toolCallId: "tc-002", title: "some-script.sh" }
    const prompt = buildNarratePrompt(baseCtx, tool)
    expect(prompt).toContain("?")
  })
})

// ─── narrateToolCall — async with cache ──────────────────────

describe("narrateToolCall — cache miss → calls translator", () => {
  const mockTranslator = { generateContent: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("NARR-7: cache miss → calls LLM and returns Hebrew text", async () => {
    mockTranslator.generateContent.mockResolvedValue("אני בודק את ה-README")
    const cache = makeNullCache()
    const setSpy = vi.spyOn(cache, "set")

    const result = await narrateToolCall(baseCtx, baseTool, mockTranslator, cache)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("אני בודק את ה-README")
    expect(setSpy).toHaveBeenCalledOnce()
  })

  it("NARR-8: cache hit → returns cached value without calling LLM", async () => {
    const cached: NarrationValue = {
      text: "ערך מהקאש",
      toolTitle: "README.md",
      createdAt: new Date().toISOString(),
    }
    const cache = makeHitCache(cached)

    const result = await narrateToolCall(baseCtx, baseTool, mockTranslator, cache)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("ערך מהקאש")
    expect(mockTranslator.generateContent).not.toHaveBeenCalled()
  })

  it("NARR-9: LLM returns empty string → falls back to tool title", async () => {
    mockTranslator.generateContent.mockResolvedValue("")
    const result = await narrateToolCall(baseCtx, baseTool, mockTranslator, makeNullCache())
    expect(result.isOk()).toBe(true)
    const text = result._unsafeUnwrap()
    expect(text.length).toBeGreaterThan(0)
  })

  it("NARR-10: LLM throws → returns Err with error message", async () => {
    mockTranslator.generateContent.mockRejectedValue(new Error("LLM unavailable"))
    const result = await narrateToolCall(baseCtx, baseTool, mockTranslator, makeNullCache())
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toContain("LLM unavailable")
  })

  it("NARR-11: timeout (1500ms) → returns Err", async () => {
    mockTranslator.generateContent.mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 10_000)),
    )
    const start = Date.now()
    const result = await narrateToolCall(baseCtx, baseTool, mockTranslator, makeNullCache(), {
      timeoutMs: 100,
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2_000)
    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toContain("timeout")
  })

  it("NARR-12: on success, cache.set called with NarrationValue shape", async () => {
    mockTranslator.generateContent.mockResolvedValue("פלט מהמודל")
    const cache = makeNullCache()
    const setSpy = vi.spyOn(cache, "set")

    await narrateToolCall(baseCtx, baseTool, mockTranslator, cache)
    expect(setSpy).toHaveBeenCalledOnce()
    const [key, value] = setSpy.mock.calls[0] as [string, NarrationValue]
    expect(key).toBe(baseTool.toolCallId)
    expect(value.text).toBe("פלט מהמודל")
    expect(value.toolTitle).toBe(baseTool.title)
    expect(value.createdAt).toBeTruthy()
  })

  it("NARR-13: empty result AND empty title → returns non-empty fallback", async () => {
    mockTranslator.generateContent.mockResolvedValue("")
    const tool = { toolCallId: "tc-999", title: "", kind: "other" as const }
    const result = await narrateToolCall(baseCtx, tool, mockTranslator, makeNullCache())
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().length).toBeGreaterThan(0)
  })

  it("NARR-14: different toolCallIds produce independent cache entries", async () => {
    mockTranslator.generateContent
      .mockResolvedValueOnce("ניסוח ראשון")
      .mockResolvedValueOnce("ניסוח שני")

    const entries = new Map<string, NarrationValue>()
    const cache: Cache<NarrationValue> = {
      get: async (k) => entries.get(k) ?? null,
      set: async (k, v) => {
        entries.set(k, v)
      },
      has: async (k) => entries.has(k),
    }

    const tool1 = { ...baseTool, toolCallId: "tc-aaa" }
    const tool2 = { ...baseTool, toolCallId: "tc-bbb" }

    await narrateToolCall(baseCtx, tool1, mockTranslator, cache)
    await narrateToolCall(baseCtx, tool2, mockTranslator, cache)

    expect(entries.get("tc-aaa")?.text).toBe("ניסוח ראשון")
    expect(entries.get("tc-bbb")?.text).toBe("ניסוח שני")
  })
})

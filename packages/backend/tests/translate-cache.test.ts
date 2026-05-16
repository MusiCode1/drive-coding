/**
 * Phase 3 — translateText cache integration tests.
 *
 * Covers: cache hit skips LLM, cache miss calls LLM and stores result,
 * null cache still works, same text produces same cache key.
 */

import type { Cache } from "@drive-coding/core/cache/types"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { translateText, type VoiceConfig } from "../src/voice/pipeline.js"

vi.mock("ai", () => ({
  experimental_transcribe: vi.fn(),
  experimental_generateSpeech: vi.fn(),
  generateText: vi.fn(),
}))

import * as ai from "ai"

const baseConfig: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  ttsVoiceId: "Rachel",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}

const mockModel = {} as never
const mockRegistries = { translator: { "gemini/flash-lite": mockModel } } as Parameters<
  typeof translateText
>[2]

// ─── Phase 3 cache tests ──────────────────────────────────────

describe("translateText — Phase 3: cache integration", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("TRANS-CACHE-1: cache hit → returns cached value, does NOT call LLM", async () => {
    const cache: Cache<string> = {
      get: vi.fn().mockResolvedValue("מחרוזת מהקאש"),
      set: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(true),
    }

    const result = await translateText("Hello world", baseConfig, mockRegistries, cache)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("מחרוזת מהקאש")
    expect(ai.generateText).not.toHaveBeenCalled()
    expect(cache.set).not.toHaveBeenCalled()
  })

  it("TRANS-CACHE-2: cache miss → calls LLM, stores result, returns it", async () => {
    vi.mocked(ai.generateText).mockResolvedValue({ text: "שלום עולם" } as never)

    const stored = new Map<string, string>()
    const cache: Cache<string> = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockImplementation(async (k: string, v: string) => {
        stored.set(k, v)
      }),
      has: vi.fn().mockResolvedValue(false),
    }

    const result = await translateText("Hello world", baseConfig, mockRegistries, cache)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("שלום עולם")
    expect(ai.generateText).toHaveBeenCalledOnce()
    expect(cache.set).toHaveBeenCalledOnce()
    // The stored value should be the translated text
    const storedValue = [...stored.values()][0]
    expect(storedValue).toBe("שלום עולם")
  })

  it("TRANS-CACHE-3: null cache → skips cache logic, calls LLM normally", async () => {
    vi.mocked(ai.generateText).mockResolvedValue({ text: "עברית" } as never)

    const result = await translateText("English", baseConfig, mockRegistries, null)

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toBe("עברית")
    expect(ai.generateText).toHaveBeenCalledOnce()
  })

  it("TRANS-CACHE-4: same text → same cache key on consecutive calls", async () => {
    vi.mocked(ai.generateText).mockResolvedValue({ text: "תוצאה" } as never)

    const keys: string[] = []
    const cache: Cache<string> = {
      get: vi.fn().mockImplementation(async (k: string) => {
        keys.push(k)
        return null
      }),
      set: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(false),
    }

    await translateText("repeated text", baseConfig, mockRegistries, cache)
    await translateText("repeated text", baseConfig, mockRegistries, cache)

    expect(keys).toHaveLength(2)
    expect(keys[0]).toBeTruthy()
    expect(keys[0]).toBe(keys[1])
  })
})

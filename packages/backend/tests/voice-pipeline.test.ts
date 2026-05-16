import type { CacheStore } from "@drive-coding/core"
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  speakSentence,
  transcribeUserAudio,
  translateText,
  type VoiceConfig,
} from "../src/voice/pipeline"

// ─── Mocks ───────────────────────────────────────────────────
vi.mock("ai", () => ({
  experimental_transcribe: vi.fn(),
  experimental_generateSpeech: vi.fn(),
  generateText: vi.fn(),
}))

// Re-import mocked ai module
import * as ai from "ai"

const baseConfig: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  ttsVoiceId: "Rachel",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}

// ─── Mock registries ─────────────────────────────────────────
const mockSttModel = { specificationVersion: "v3", provider: "mock", modelId: "mock" }
const mockTtsModel = { specificationVersion: "v1", provider: "mock", modelId: "mock" }
const mockTranslatorModel = { specificationVersion: "v1", provider: "mock", modelId: "mock" }

const mockRegistries = {
  stt: { "gemini/flash-context": mockSttModel as never },
  tts: { "elevenlabs/v3": mockTtsModel as never },
  translator: { "gemini/flash-lite": mockTranslatorModel as never },
}

// ─── Mock cache ───────────────────────────────────────────────
function makeCache(hit: Uint8Array | null = null): CacheStore {
  const store = new Map<string, Uint8Array>()
  if (hit) store.set("__hit__", hit)
  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: Uint8Array) => {
      store.set(key, value)
    }),
  }
}

// ─── transcribeUserAudio ─────────────────────────────────────
describe("transcribeUserAudio", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns ok with transcribed text on success", async () => {
    vi.mocked(ai.experimental_transcribe).mockResolvedValue({ text: "שלום עולם" } as never)

    const result = await transcribeUserAudio(
      { bytes: new Uint8Array([1, 2, 3]), mimeType: "audio/webm" },
      baseConfig,
      { stt: mockRegistries.stt },
    )

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe("שלום עולם")
  })

  it("returns err when STT model not found", async () => {
    const result = await transcribeUserAudio(
      { bytes: new Uint8Array(), mimeType: "audio/webm" },
      { ...baseConfig, sttModel: "unknown/model" },
      { stt: mockRegistries.stt },
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("Unknown STT model")
  })

  it("returns err when STT API throws", async () => {
    vi.mocked(ai.experimental_transcribe).mockRejectedValue(new Error("API down"))

    const result = await transcribeUserAudio(
      { bytes: new Uint8Array([1]), mimeType: "audio/webm" },
      baseConfig,
      { stt: mockRegistries.stt },
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("STT failed")
  })

  it("passes previousAssistantText as providerOptions", async () => {
    vi.mocked(ai.experimental_transcribe).mockResolvedValue({ text: "context answer" } as never)

    await transcribeUserAudio(
      { bytes: new Uint8Array([1]), mimeType: "audio/webm" },
      { ...baseConfig, previousAssistantText: "previous response" },
      { stt: mockRegistries.stt },
    )

    const call = vi.mocked(ai.experimental_transcribe).mock.calls[0]?.[0]
    const geminiOpts = call?.providerOptions?.gemini as Record<string, unknown> | undefined
    expect(geminiOpts?.previousAssistantText).toBe("previous response")
  })

  it("passes no providerOptions when previousAssistantText is absent", async () => {
    vi.mocked(ai.experimental_transcribe).mockResolvedValue({ text: "answer" } as never)

    await transcribeUserAudio({ bytes: new Uint8Array([1]), mimeType: "audio/webm" }, baseConfig, {
      stt: mockRegistries.stt,
    })

    const call = vi.mocked(ai.experimental_transcribe).mock.calls[0]?.[0]
    expect(call?.providerOptions).toBeUndefined()
  })
})

// ─── speakSentence ───────────────────────────────────────────
describe("speakSentence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("calls TTS and returns audio via onChunk on cache miss", async () => {
    const mp3Bytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00])
    vi.mocked(ai.experimental_generateSpeech).mockResolvedValue({
      audio: { uint8Array: mp3Bytes },
    } as never)

    const cache = makeCache()
    const chunks: string[] = []

    const result = await speakSentence(
      "שלום עולם",
      baseConfig,
      { tts: mockRegistries.tts },
      cache,
      (chunk) => chunks.push(chunk),
    )

    expect(result.isOk()).toBe(true)
    expect(chunks).toHaveLength(1)
    expect(cache.set).toHaveBeenCalled()
  })

  it("returns cached mp3 without calling TTS API", async () => {
    const cachedBytes = new Uint8Array([0xaa, 0xbb])
    const cache: CacheStore = {
      get: vi.fn(async () => cachedBytes),
      set: vi.fn(),
    }
    const chunks: string[] = []

    const result = await speakSentence(
      "test",
      baseConfig,
      { tts: mockRegistries.tts },
      cache,
      (chunk) => chunks.push(chunk),
    )

    expect(result.isOk()).toBe(true)
    expect(ai.experimental_generateSpeech).not.toHaveBeenCalled()
    expect(chunks).toHaveLength(1)
  })

  it("returns err when TTS model not found", async () => {
    const result = await speakSentence(
      "test",
      { ...baseConfig, ttsModel: "unknown/tts" },
      { tts: mockRegistries.tts },
      makeCache(),
      () => {},
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("Unknown TTS model")
  })

  it("returns err when TTS API throws", async () => {
    vi.mocked(ai.experimental_generateSpeech).mockRejectedValue(new Error("TTS error"))
    const cache: CacheStore = {
      get: vi.fn(async () => null),
      set: vi.fn(),
    }

    const result = await speakSentence(
      "test",
      baseConfig,
      { tts: mockRegistries.tts },
      cache,
      () => {},
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("TTS failed")
  })
})

// ─── translateText ───────────────────────────────────────────
describe("translateText", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns translated text on success", async () => {
    vi.mocked(ai.generateText).mockResolvedValue({ text: "שלום עולם" } as never)

    const result = await translateText("Hello world", baseConfig, {
      translator: mockRegistries.translator,
    })

    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe("שלום עולם")
  })

  it("returns err when translator model not found", async () => {
    const result = await translateText(
      "test",
      { ...baseConfig, translatorModel: "unknown/model" },
      { translator: mockRegistries.translator },
    )
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("Unknown translator model")
  })

  it("returns err when translation API throws", async () => {
    vi.mocked(ai.generateText).mockRejectedValue(new Error("network error"))

    const result = await translateText("test", baseConfig, {
      translator: mockRegistries.translator,
    })
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error).toContain("Translation failed")
  })

  it("trims whitespace from translated result", async () => {
    vi.mocked(ai.generateText).mockResolvedValue({ text: "  שלום  \n" } as never)

    const result = await translateText("hello", baseConfig, {
      translator: mockRegistries.translator,
    })
    expect(result.isOk()).toBe(true)
    if (result.isOk()) expect(result.value).toBe("שלום")
  })
})

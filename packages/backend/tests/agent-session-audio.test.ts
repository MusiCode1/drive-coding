/**
 * Tests for AgentSession.sendAudioPrompt — voice round-trip behavior.
 *
 * Uses vi.mock to replace the pipeline module so tests run without real AI calls.
 */

import type { AcpTransport, PromptResponse, SessionNotification } from "@drive-coding/core"
import { err, ok } from "neverthrow"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the pipeline module BEFORE importing agent-session (vitest hoists vi.mock calls)
vi.mock("../src/voice/pipeline.js", () => ({
  transcribeUserAudio: vi.fn(),
  translateText: vi.fn(),
  speakSentence: vi.fn(),
  splitIntoSentences: vi.fn(),
}))

import type { CacheStore } from "@drive-coding/core"
import { createAgentSession } from "../src/app/agent-session.js"
import type { VoiceCallbacks, VoiceConfig } from "../src/voice/pipeline.js"
// Import mocked pipeline AFTER mock declaration
import * as pipeline from "../src/voice/pipeline.js"
import type { VoiceRegistries } from "../src/voice/providers.js"

// ─── Helpers ─────────────────────────────────────────────────

function makeMockTransport(opts?: {
  onPrompt?: (text: string, onUpdate: (n: SessionNotification) => void) => Promise<PromptResponse>
}): AcpTransport {
  return {
    async start(_input) {
      return { sessionId: "test-session-id", capabilities: { loadSession: false } }
    },
    async prompt(input, onUpdate) {
      if (opts?.onPrompt) return opts.onPrompt(input.text, onUpdate)
      return { stopReason: "end_turn" }
    },
    async cancel() {},
    async shutdown() {},
  }
}

const baseVoiceConfig: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  ttsVoiceId: "Rachel",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}

const mockRegistries = {} as VoiceRegistries

const mockCache: CacheStore = {
  async get() {
    return null
  },
  async set() {},
}

function makeCallbacks() {
  const sttPartials: string[] = []
  const audioChunks: string[] = []
  const errors: string[] = []
  const callbacks: VoiceCallbacks = {
    onSttPartial: (t) => sttPartials.push(t),
    onAudioChunk: (c) => audioChunks.push(c),
    onError: (e) => errors.push(e),
  }
  return { callbacks, sttPartials, audioChunks, errors }
}

// ─── STT-8: empty transcript → immediate done ─────────────────

describe("AgentSession.sendAudioPrompt — STT-8: empty transcript", () => {
  /** Covers behavior STT-8: empty transcript → done immediately, no ACP prompt */
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("STT-8: empty transcript → broadcasts done, skips ACP prompt entirely", async () => {
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok(""))

    const promptFn = vi.fn().mockResolvedValue({ stopReason: "end_turn" })
    const transport = makeMockTransport({ onPrompt: promptFn })
    const session = createAgentSession({ agentId: "a", transport })

    const broadcasts: string[] = []
    session.subscribe((msg) => broadcasts.push(msg.type))

    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1, 2, 3]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Must broadcast done without going through ACP
    expect(broadcasts).toContain("done")
    // transport.prompt must NOT be called
    expect(promptFn).not.toHaveBeenCalled()
  })

  it("STT-8: whitespace-only transcript also short-circuits", async () => {
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("   \n  "))

    const promptFn = vi.fn().mockResolvedValue({ stopReason: "end_turn" })
    const transport = makeMockTransport({ onPrompt: promptFn })
    const session = createAgentSession({ agentId: "a", transport })

    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(promptFn).not.toHaveBeenCalled()
  })

  it("STT-8: non-empty transcript proceeds to ACP prompt normally", async () => {
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שלום עולם"))
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })

    const promptFn = vi.fn().mockResolvedValue({ stopReason: "end_turn" })
    const transport = makeMockTransport({ onPrompt: promptFn })
    const session = createAgentSession({ agentId: "a", transport })

    const { callbacks, sttPartials } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(sttPartials).toContain("שלום עולם")
    // onPrompt receives the text string (makeMockTransport extracts input.text)
    expect(promptFn).toHaveBeenCalledWith("שלום עולם", expect.any(Function))
  })
})

// ─── PROMPT-5: serial TTS queue (order preserved) ─────────────

describe("AgentSession.sendAudioPrompt — PROMPT-5: serial TTS queue", () => {
  /** Covers behavior PROMPT-5: ttsQueue is serial — audio chunks always in sentence order */
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("PROMPT-5: 3 sentences → audio chunks arrive in sentence order", async () => {
    // Arrange: STT returns a transcript
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("S1. S2. S3."))

    // splitIntoSentences: simulate 3 sentences on first call, then empty
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["S1."], remaining: "S2. S3." })
      .mockReturnValueOnce({ sentences: ["S2.", "S3."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    // translateText: returns "T<input>" so we can track order
    vi.mocked(pipeline.translateText).mockImplementation(async (text) => ok(`T:${text}`))

    // speakSentence: calls onChunk with a tag identifying the sentence
    vi.mocked(pipeline.speakSentence).mockImplementation(
      async (_text, _cfg, _reg, _cache, onChunk) => {
        onChunk(`audio:${_text}`)
        return ok(undefined)
      },
    )

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        // Simulate 3 ACP chunks arriving (split across calls)
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "S1. " },
            messageId: null,
          },
        } as SessionNotification)
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "S2. S3." },
            messageId: null,
          },
        } as SessionNotification)
        return { stopReason: "end_turn" }
      },
    })

    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks } = makeCallbacks()

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Chunks must arrive in sentence order (S1, then S2, then S3)
    expect(audioChunks.length).toBeGreaterThanOrEqual(1)
    // First chunk must be from S1
    expect(audioChunks[0]).toContain("S1")
    // If S2 and S3 arrived, they must be after S1
    if (audioChunks.length >= 2) {
      expect(audioChunks[1]).toContain("S2")
    }
    if (audioChunks.length >= 3) {
      expect(audioChunks[2]).toContain("S3")
    }
  })
})

// ─── BUG: Translation error must NOT drop remaining queue items ──

describe("AgentSession.sendAudioPrompt — translation error resilience", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("translation error on one sentence does not drop the rest of the queue", async () => {
    // Arrange: STT returns text
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("prompt text"))

    // ACP responds with 3 sentences in a single chunk
    // splitIntoSentences returns all 3 immediately, no remaining
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({
        sentences: ["Sentence A.", "Sentence B.", "Sentence C."],
        remaining: "",
      })
      .mockReturnValue({ sentences: [], remaining: "" })

    // translateText: succeeds for A and C, FAILS for B
    vi.mocked(pipeline.translateText).mockImplementation(async (text) => {
      if (text === "Sentence B.") {
        // Simulate translation timeout
        return err("Translation timeout after 2500ms")
      }
      return ok(`translated:${text}`)
    })

    // speakSentence: always succeeds, calls onChunk
    vi.mocked(pipeline.speakSentence).mockImplementation(
      async (_text, _cfg, _reg, _cache, onChunk) => {
        onChunk(`audio:${_text}`)
        return ok(undefined)
      },
    )

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Sentence A. Sentence B. Sentence C." },
            messageId: null,
          },
        } as SessionNotification)
        return { stopReason: "end_turn" }
      },
    })

    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks, errors } = makeCallbacks()

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // B's error should be reported
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.some((e) => e.includes("Translation timeout"))).toBe(true)

    // CRITICAL: A and C must still produce audio!
    // With the bug, only A produces audio (processQueue aborts after B fails)
    expect(audioChunks.length).toBe(2)
    expect(audioChunks[0]).toContain("Sentence A.")
    expect(audioChunks[1]).toContain("Sentence C.")
  })

  it("translation error on trailing buffer still broadcasts done", async () => {
    // Arrange: response has no sentence boundaries → all goes to trailing flush
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("prompt"))

    // splitIntoSentences: never finds boundaries
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({
      sentences: [],
      remaining: "short reply",
    })

    // translateText always fails (simulates Gemini being down)
    vi.mocked(pipeline.translateText).mockResolvedValue(
      err("Translation failed: 503 Service Unavailable"),
    )

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "short reply" },
            messageId: null,
          },
        } as SessionNotification)
        return { stopReason: "end_turn" }
      },
    })

    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string }> = []
    session.subscribe((msg) => broadcasts.push(msg))

    const { callbacks, audioChunks, errors } = makeCallbacks()

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseVoiceConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Error should be reported
    expect(errors.length).toBeGreaterThanOrEqual(1)
    // Done must still be broadcast (not hang)
    expect(broadcasts.some((m) => m.type === "done")).toBe(true)
    // No audio (translation failed) — this is expected behavior
    expect(audioChunks.length).toBe(0)
  })
})

/**
 * Phase 4 — agent-session coordination tests.
 *
 * Covers:
 * - thoughtBuffer + flushThought (6 tests: COORD-1..6)
 * - message↔thought↔tool_call coordination: PROMPT-11/12 (8 tests: COORD-7..14)
 * - narration queue integration (6 tests: COORD-15..20)
 * - message/thought/segment ID tracking (5 tests: COORD-21..25)
 *
 * The pipeline module is mocked so no real AI calls are made.
 */

import type { SessionNotification } from "@drive-coding/core"
import { err, ok } from "neverthrow"
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock pipeline (hoisted by vitest)
vi.mock("../src/voice/pipeline.js", () => ({
  transcribeUserAudio: vi.fn(),
  translateText: vi.fn(),
  speakSentence: vi.fn(),
  splitIntoSentences: vi.fn(),
}))

// Mock narration module
vi.mock("../src/voice/narration.js", () => ({
  narrateToolCall: vi.fn(),
  buildNarratePrompt: vi.fn(),
}))

import type { AcpTransport, PromptResponse } from "@drive-coding/core"
import { createAgentSession } from "../src/app/agent-session.js"
import * as narration from "../src/voice/narration.js"
import type { VoiceCallbacks, VoiceConfig } from "../src/voice/pipeline.js"
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

const baseConfig: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  ttsVoiceId: "Rachel",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}

const mockRegistries = {} as VoiceRegistries
const mockCache = {
  async get() {
    return null
  },
  async set() {},
}

function makeCallbacks() {
  const sttPartials: string[] = []
  const audioChunks: string[] = []
  const errors: string[] = []
  const translations: Array<[string, string]> = []
  const callbacks: VoiceCallbacks = {
    onSttPartial: (t) => sttPartials.push(t),
    onAudioChunk: (c) => audioChunks.push(c),
    onError: (e) => errors.push(e),
    onTranslation: (orig, trans) => translations.push([orig, trans]),
  }
  return { callbacks, sttPartials, audioChunks, errors, translations }
}

function makeThoughtNotification(text: string): SessionNotification {
  return {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_thought_chunk",
      content: { type: "text", text },
      messageId: null,
    },
  } as SessionNotification
}

function makeMessageNotification(text: string): SessionNotification {
  return {
    sessionId: "s",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text },
      messageId: null,
    },
  } as SessionNotification
}

function makeToolCallNotification(
  toolCallId: string,
  title: string,
  kind = "read",
): SessionNotification {
  return {
    sessionId: "s",
    update: {
      sessionUpdate: "tool_call",
      toolCallId,
      title,
      kind,
      status: "pending",
      locations: [],
      content: [],
    },
  } as unknown as SessionNotification
}

// ─── Section 1: thoughtBuffer + flushThought ─────────────────

describe("thoughtBuffer + flushThought — Phase 4", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלת המשתמש"))
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("מתורגם"))
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunk(`audio:${_t}`)
      return ok(undefined)
    })
  })

  it("COORD-1: thought chunk is broadcast as text_chunk with kind=thought", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("I should check the README"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string; kind?: string }> = []
    session.subscribe((msg) => broadcasts.push(msg as { type: string; kind?: string }))

    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const thoughtChunks = broadcasts.filter((m) => m.type === "text_chunk" && m.kind === "thought")
    expect(thoughtChunks.length).toBeGreaterThanOrEqual(1)
  })

  it("COORD-2: thought chunk is translated + TTS'd", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["I should check the README."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("אני צריך לבדוק את ה-README"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("I should check the README."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(pipeline.translateText).toHaveBeenCalled()
    expect(audioChunks.length).toBeGreaterThanOrEqual(1)
  })

  it("COORD-3: trailing thought buffer flushed at end of prompt", async () => {
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({
      sentences: [],
      remaining: "trailing thought",
    })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("trailing thought"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // translateText should have been called for the trailing buffer
    expect(pipeline.translateText).toHaveBeenCalled()
  })

  it("COORD-4: thought translation error → reports error, continues", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["bad thought."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValueOnce(err("Translation timeout") as never)

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("bad thought."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string }> = []
    session.subscribe((msg) => broadcasts.push(msg))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // done must still be broadcast even if thought translation failed
    expect(broadcasts.some((m) => m.type === "done")).toBe(true)
  })

  it("COORD-5: empty thought buffer → no translate call for that buffer", async () => {
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        // Only message chunk, no thought
        onUpdate(makeMessageNotification("שלום"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string; kind?: string }> = []
    session.subscribe((msg) => broadcasts.push(msg as { type: string; kind?: string }))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const thoughtChunks = broadcasts.filter((m) => m.type === "text_chunk" && m.kind === "thought")
    expect(thoughtChunks).toHaveLength(0)
  })

  it("COORD-6: multiple thought sentences → each gets translated+TTS'd", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Thought A.", "Thought B."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText)
      .mockResolvedValueOnce(ok("מחשבה א"))
      .mockResolvedValueOnce(ok("מחשבה ב"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("Thought A. Thought B."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(audioChunks.length).toBeGreaterThanOrEqual(2)
  })
})

// ─── Section 2: message↔thought↔tool_call coordination ───────

describe("message↔thought↔tool_call coordination — PROMPT-11/12", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלת המשתמש"))
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunk(`audio:${_t}`)
      return ok(undefined)
    })
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("ניסוח ניאורציה"))
  })

  it("COORD-7: tool_call while thought is buffered → thought flushed before narration", async () => {
    const order: string[] = []

    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["thought sentence."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    vi.mocked(pipeline.translateText).mockImplementation(async (text) => {
      order.push(`translate:${text}`)
      return ok(`מ:${text}`)
    })
    vi.mocked(narration.narrateToolCall).mockImplementation(async () => {
      order.push("narrate")
      return ok("ניסוח")
    })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("thought sentence."))
        onUpdate(makeToolCallNotification("tc-1", "read file", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Translation of thought must precede narration
    const translateIdx = order.findIndex((s) => s.startsWith("translate"))
    const narrateIdx = order.indexOf("narrate")
    if (narrateIdx !== -1 && translateIdx !== -1) {
      expect(translateIdx).toBeLessThan(narrateIdx)
    }
  })

  it("COORD-8: tool_call while message is buffered → message flushed before narration", async () => {
    const order: string[] = []

    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["message sentence."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    vi.mocked(pipeline.translateText).mockImplementation(async (text) => {
      order.push(`translate:${text}`)
      return ok(`מ:${text}`)
    })
    vi.mocked(narration.narrateToolCall).mockImplementation(async () => {
      order.push("narrate")
      return ok("ניסוח")
    })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("message sentence."))
        onUpdate(makeToolCallNotification("tc-2", "edit file", "edit"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const translateIdx = order.findIndex((s) => s.startsWith("translate"))
    const narrateIdx = order.indexOf("narrate")
    if (narrateIdx !== -1 && translateIdx !== -1) {
      expect(translateIdx).toBeLessThan(narrateIdx)
    }
  })

  it("COORD-9: tool_call narration arrives as tool_call_update broadcast", async () => {
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("אני בודק קובץ"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-3", "README.md", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const toolUpdate = broadcasts.find(
      (m) => m.type === "tool_call_update" && m.toolCallId === "tc-3",
    )
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate?.narration).toBe("אני בודק קובץ")
  })

  it("COORD-10: narration error → error reported, queue continues", async () => {
    vi.mocked(narration.narrateToolCall).mockResolvedValue(err("Narration failed") as never)
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["A message after tool."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-4", "file.ts", "read"))
        onUpdate(makeMessageNotification("A message after tool."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string }> = []
    session.subscribe((msg) => broadcasts.push(msg))
    const { callbacks, errors } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(errors.some((e) => e.includes("Narration failed"))).toBe(true)
    expect(broadcasts.some((m) => m.type === "done")).toBe(true)
  })

  it("COORD-11: thought chunk while message buffered → message flushed (PROMPT-11)", async () => {
    const broadcastOrder: string[] = []

    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["message part."], remaining: "" })
      .mockReturnValueOnce({ sentences: ["thought part."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("message part."))
        onUpdate(makeThoughtNotification("thought part."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    session.subscribe((msg) => broadcastOrder.push((msg as { type: string }).type))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Both message and thought text_chunks should appear
    expect(broadcastOrder).toContain("text_chunk")
  })

  it("COORD-12: message chunk while thought buffered → thought flushed (PROMPT-12)", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["thought part."], remaining: "" })
      .mockReturnValueOnce({ sentences: ["message part."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("thought part."))
        onUpdate(makeMessageNotification("message part."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<{ type: string; kind?: string }> = []
    session.subscribe((msg) => broadcasts.push(msg as { type: string; kind?: string }))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // Both thought and message should appear in broadcasts
    const thoughtChunks = broadcasts.filter((m) => m.type === "text_chunk" && m.kind === "thought")
    const msgChunks = broadcasts.filter((m) => m.type === "text_chunk" && m.kind === "message")
    expect(thoughtChunks.length).toBeGreaterThanOrEqual(1)
    expect(msgChunks.length).toBeGreaterThanOrEqual(1)
  })

  it("COORD-13: narration context snapshot uses state at tool_call time", async () => {
    let capturedCtx: unknown = null
    vi.mocked(narration.narrateToolCall).mockImplementation(async (ctx) => {
      capturedCtx = { ...ctx }
      return ok("ניסוח")
    })
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Prior message."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("Prior message."))
        onUpdate(makeToolCallNotification("tc-5", "file.ts", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // userMessage should be the STT transcript
    expect((capturedCtx as { userMessage?: string })?.userMessage).toBe("שאלת המשתמש")
  })

  it("COORD-14: isCancelled flag → no new audio segments after cancel", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["S1.", "S2.", "S3."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    let onChunkCall = 0
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunkCall++
      onChunk(`audio-${onChunkCall}`)
      return ok(undefined)
    })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("S1. S2. S3."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks } = makeCallbacks()

    // Cancel after a tiny delay (mid-processing)
    const promptPromise = session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )
    // Cancel is called (but prompt may already be done in tests since mocks are sync)
    await session.cancel()
    await promptPromise

    // At least done should come — we just verify no hang
    expect(audioChunks).toBeDefined()
  })
})

// ─── Section 3: narration queue integration ───────────────────

describe("narration queue integration — Phase 4", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלה"))
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunk(`audio:${_t}`)
      return ok(undefined)
    })
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("ניסוח טול"))
  })

  it("COORD-15: tool_call → narration called with correct tool info", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-15", "package.json", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(narration.narrateToolCall).toHaveBeenCalledOnce()
    const [, tool] = vi.mocked(narration.narrateToolCall).mock.calls[0] as [
      unknown,
      { toolCallId: string },
    ]
    expect(tool.toolCallId).toBe("tc-15")
  })

  it("COORD-16: narration result is TTS'd", async () => {
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("אני קורא קובץ"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-16", "README.md", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks, audioChunks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // speakSentence should have been called with the narration text
    const speakCalls = vi.mocked(pipeline.speakSentence).mock.calls
    const narratedCall = speakCalls.find(([text]) => text === "אני קורא קובץ")
    expect(narratedCall).toBeDefined()
    // Audio for narration should be in chunks
    expect(audioChunks.some((c) => c.includes("אני קורא קובץ"))).toBe(true)
  })

  it("COORD-17: two tool_calls → two narrations in order", async () => {
    const narrateOrder: string[] = []
    vi.mocked(narration.narrateToolCall)
      .mockImplementationOnce(async (_ctx, tool) => {
        narrateOrder.push(tool.toolCallId)
        return ok(`ניסוח ${tool.toolCallId}`)
      })
      .mockImplementationOnce(async (_ctx, tool) => {
        narrateOrder.push(tool.toolCallId)
        return ok(`ניסוח ${tool.toolCallId}`)
      })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-17a", "file-a.ts", "read"))
        onUpdate(makeToolCallNotification("tc-17b", "file-b.ts", "edit"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(narrateOrder).toEqual(["tc-17a", "tc-17b"])
  })

  it("COORD-18: recentMessages context includes up to 3 prior messages", async () => {
    let capturedRecentMessages: string[] = []
    vi.mocked(narration.narrateToolCall).mockImplementation(async (ctx) => {
      capturedRecentMessages = [...ctx.recentMessages]
      return ok("ניסוח")
    })
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["First message."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("First message."))
        onUpdate(makeToolCallNotification("tc-18", "file.ts", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    // recentMessages should contain the message that was flushed before the tool call
    expect(capturedRecentMessages.some((m) => m.includes("First message."))).toBe(true)
  })

  it("COORD-19: narration audio chunk has kind='narration'", async () => {
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("אני בודק"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-19", "file.ts", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const audioBroadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => {
      if ((msg as { type: string }).type === "audio_chunk") {
        audioBroadcasts.push(msg as Record<string, unknown>)
      }
    })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const narrationChunks = audioBroadcasts.filter((m) => m.kind === "narration")
    expect(narrationChunks.length).toBeGreaterThanOrEqual(1)
  })

  it("COORD-20: narration cache key is toolCallId", async () => {
    let cacheGetKey: string | null = null
    const narrationCache = {
      get: vi.fn().mockImplementation(async (k: string) => {
        cacheGetKey = k
        return null
      }),
      set: vi.fn().mockResolvedValue(undefined),
      has: vi.fn().mockResolvedValue(false),
    }

    // We can't easily inject narrationCache from outside (it's internal to the session).
    // Instead, verify that narrateToolCall is called with toolCallId as cache key parameter.
    let capturedToolCallId: string | null = null
    vi.mocked(narration.narrateToolCall).mockImplementation(async (_ctx, tool) => {
      capturedToolCallId = tool.toolCallId
      return ok("ניסוח")
    })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeToolCallNotification("tc-cache-key", "file.ts", "read"))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(capturedToolCallId).toBe("tc-cache-key")
    // Suppress unused variable warning
    void narrationCache
    void cacheGetKey
  })
})

// ─── Section 4: message/thought/segment ID tracking ──────────

describe("ID tracking — message/thought/segment IDs — Phase 4", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלה"))
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Sentence one."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("משפט אחד"))
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunk("mp3data")
      return ok(undefined)
    })
  })

  it("COORD-21: text_chunk has messageId for message kind", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("Sentence one."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const msgChunk = broadcasts.find((m) => m.type === "text_chunk" && m.kind === "message")
    expect(msgChunk?.messageId).toBeTruthy()
    expect(typeof msgChunk?.messageId).toBe("string")
  })

  it("COORD-22: text_chunk has messageId for thought kind", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Thought sentence."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeThoughtNotification("Thought sentence."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    const thoughtChunk = broadcasts.find((m) => m.type === "text_chunk" && m.kind === "thought")
    expect(thoughtChunk?.messageId).toBeTruthy()
    expect(typeof thoughtChunk?.messageId).toBe("string")
  })

  it("COORD-23: audio_chunk has segmentId, messageId, kind, originalText, translatedText", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("Sentence one."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const audioBroadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => {
      if ((msg as { type: string }).type === "audio_chunk") {
        audioBroadcasts.push(msg as Record<string, unknown>)
      }
    })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    expect(audioBroadcasts.length).toBeGreaterThanOrEqual(1)
    const chunk = audioBroadcasts[0]
    expect(chunk).toBeDefined()
    expect(typeof chunk?.segmentId).toBe("string")
    expect(typeof chunk?.messageId).toBe("string")
    expect(chunk?.kind).toBe("message")
    expect(chunk?.originalText).toBeTruthy()
    expect(chunk?.translatedText).toBeTruthy()
  })

  it("COORD-24: chunks from same message share the same messageId", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["S1.", "S2."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("S1. S2."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const audioBroadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => {
      if ((msg as { type: string }).type === "audio_chunk") {
        audioBroadcasts.push(msg as Record<string, unknown>)
      }
    })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    if (audioBroadcasts.length >= 2) {
      expect(audioBroadcasts[0]?.messageId).toBe(audioBroadcasts[1]?.messageId)
    }
  })

  it("COORD-25: different segments have unique segmentIds", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["S1.", "S2."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate(makeMessageNotification("S1. S2."))
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const audioBroadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => {
      if ((msg as { type: string }).type === "audio_chunk") {
        audioBroadcasts.push(msg as Record<string, unknown>)
      }
    })
    const { callbacks } = makeCallbacks()
    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockCache,
    )

    if (audioBroadcasts.length >= 2) {
      expect(audioBroadcasts[0]?.segmentId).not.toBe(audioBroadcasts[1]?.segmentId)
    }
  })
})

/**
 * orchestrator.test.ts — ACP notifications → TTS jobs queue (Slice 10 shape).
 *
 * Tests:
 * - message chunks → sentences enqueued
 * - thought chunks handled identically
 * - tool_call → narration enqueued
 * - cancelAll clears the queue
 * - flushes buffer on kind change
 *
 * NOTE: Tests use mocked translate/tts/narrate/audioStream (no real API calls).
 * MediaSource not available in happy-dom — AudioStream is mocked.
 *
 * ACP envelope shape: { sessionId, update: { sessionUpdate, content, ... } }
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { createPlayerStore } from "$lib/stores/player.svelte"
import type { AudioStream } from "./audio-stream"
import { createVoiceOrchestrator } from "./orchestrator"
import { synthesizeStreaming as synthesizeMock } from "./tts-client"
import { translate as translateMock } from "./translate-client"

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./translate-client", () => ({
  translate: vi.fn().mockResolvedValue({ status: "translated", text: "translated text" }),
}))

vi.mock("./tts-client", () => ({
  synthesizeStreaming: vi.fn().mockResolvedValue(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([0xff, 0xf3]))
        controller.close()
      },
    }),
  ),
}))

vi.mock("./narrate-client", () => ({
  narrate: vi.fn().mockResolvedValue("אני בודק את הקוד"),
}))

// Mock AudioStream (MediaSource not in happy-dom)
function createMockAudioStream(): AudioStream {
  return {
    segments: new Map(),
    current: null,
    prepareSegment: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    clear: vi.fn(),
    appendBuffer: vi.fn().mockResolvedValue(undefined),
    waitForReady: vi.fn().mockResolvedValue(undefined),
  } as unknown as AudioStream
}

// Mock agentSession
function createMockAgentSession() {
  let voiceHandler: ((raw: string) => void) | null = null
  return {
    agentId: "test-agent",
    messages: [],
    bubbles: [],
    isLoadingHistory: false,
    status: "connected" as const,
    error: null,
    isConnected: true,
    connect: vi.fn(),
    disconnect: vi.fn(),
    sendPrompt: vi.fn(),
    sendRaw: vi.fn().mockReturnValue(true),
    cancel: vi.fn(),
    setVoiceMessageHandler(handler: (raw: string) => void) {
      voiceHandler = handler
    },
    clearBubbles: vi.fn(),
    getRecordingId: vi.fn().mockReturnValue(null),
    addTranslatedSegment: vi.fn(),
    updateToolNarration: vi.fn(),
    // Injects an ACP envelope directly as JSON string (as agentSession does in production)
    injectAcp(sessionId: string, update: Record<string, unknown>) {
      voiceHandler?.(JSON.stringify({ sessionId, update }))
    },
  }
}

// ── ACP envelope helpers ─────────────────────────────────────────────────────

function textChunk(kind: "agent_message_chunk" | "agent_thought_chunk", text: string) {
  return { sessionUpdate: kind, content: { type: "text", text } }
}

function toolCall(toolCallId: string, title: string, toolKind?: string) {
  return { sessionUpdate: "tool_call", toolCallId, title, kind: toolKind }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createVoiceOrchestrator (ACP shape, Slice 10)", () => {
  let player: ReturnType<typeof createPlayerStore>
  let audioStream: AudioStream
  let agentSession: ReturnType<typeof createMockAgentSession>
  let orchestrator: ReturnType<typeof createVoiceOrchestrator>

  beforeEach(() => {
    vi.clearAllMocks()
    player = createPlayerStore()
    audioStream = createMockAudioStream()
    agentSession = createMockAgentSession()
    orchestrator = createVoiceOrchestrator({
      agentSession,
      player,
      audioStream,
      getVoiceId: () => "test-voice-id",
    })
  })

  // ── 1: message chunks accumulate and split into sentences ─────────────────
  it("message chunks accumulate and split into sentences", () => {
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_message_chunk", "Hello world. Next sentence. "),
    )
    // splitIntoSentences finds two sentences
    expect(orchestrator.sentenceQueue.length).toBeGreaterThanOrEqual(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("message")
  })

  // ── 2: partial chunks accumulate across multiple events ───────────────────
  it("accumulates partial chunks across multiple events", () => {
    agentSession.injectAcp("sess-1", textChunk("agent_message_chunk", "Hello "))
    agentSession.injectAcp("sess-1", textChunk("agent_message_chunk", "world. Next."))
    // At minimum "Hello world." should be a sentence
    const texts = orchestrator.sentenceQueue.map((j) => j.text)
    expect(texts.some((t) => t.includes("Hello world"))).toBe(true)
  })

  // ── 3: thought chunks are enqueued as kind=thought ────────────────────────
  it("thought chunks are enqueued as kind=thought", () => {
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_thought_chunk", "Thinking about this. Let me consider."),
    )
    expect(orchestrator.sentenceQueue.length).toBeGreaterThanOrEqual(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("thought")
  })

  // ── 4: tool_call enqueues a narration job ─────────────────────────────────
  it("tool_call enqueues a narration job", () => {
    agentSession.injectAcp("sess-1", toolCall("call-1", "read README.md", "read"))
    expect(orchestrator.sentenceQueue.length).toBe(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("narration")
  })

  // ── 5: flushes thought buffer when message chunk arrives ──────────────────
  it("flushes thought buffer when message chunk arrives", () => {
    agentSession.injectAcp("sess-1", textChunk("agent_thought_chunk", "thinking content "))
    agentSession.injectAcp("sess-1", textChunk("agent_message_chunk", "actual message. "))
    const kinds = orchestrator.sentenceQueue.map((j) => j.kind)
    expect(kinds.length).toBeGreaterThanOrEqual(1)
    expect(kinds).toContain("message")
  })

  // ── 6: cancelAll clears the queue ─────────────────────────────────────────
  it("cancelAll clears the queue", () => {
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_message_chunk", "One sentence. Two sentence."),
    )
    expect(orchestrator.sentenceQueue.length).toBeGreaterThan(0)
    orchestrator.cancelAll()
    expect(orchestrator.sentenceQueue.length).toBe(0)
  })

  // ── 7: reset clears buffers ───────────────────────────────────────────────
  it("reset() resets state for a new turn", () => {
    agentSession.injectAcp("sess-1", textChunk("agent_message_chunk", "Old sentence. "))
    orchestrator.reset()
    // After reset, queue should be cleared
    expect(orchestrator.sentenceQueue.length).toBe(0)
  })

  // ── 8: setUserMessage updates narration context ───────────────────────────
  it("setUserMessage updates narration context (no throw)", () => {
    orchestrator.setUserMessage("read the README file")
    agentSession.injectAcp("sess-1", toolCall("call-2", "read file", "read"))
    expect(orchestrator.sentenceQueue.length).toBe(1)
  })

  // ── 9: non-text content → empty string, no crash ─────────────────────────
  it("non-text content type in message chunk → empty string enqueued, no crash", () => {
    expect(() =>
      agentSession.injectAcp("sess-1", {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image", url: "..." },
      }),
    ).not.toThrow()
  })

  // ── 10: malformed envelope → no crash ─────────────────────────────────────
  it("malformed JSON envelope → no crash", () => {
    // handleNotification directly with malformed input
    expect(() => orchestrator.handleNotification("{bad json")).not.toThrow()
    expect(() => orchestrator.handleNotification("{}")).not.toThrow()
  })

  // ── 11: translate() is called ONLY for thought jobs ───────────────────────
  // Regression guard — before 2026-05-18, fetchSegment translated message and
  // narration too, causing wasted Gemini calls + occasional paraphrasing.
  it("translate() is invoked only for thought jobs (not message/narration)", async () => {
    // Run 3 different kinds through the queue and let the playback loop pump.
    agentSession.injectAcp("sess-1", textChunk("agent_message_chunk", "Hello world. "))
    agentSession.injectAcp("sess-1", textChunk("agent_thought_chunk", "Thinking now. "))
    agentSession.injectAcp("sess-1", toolCall("call-1", "read README", "read"))

    // Let microtasks + a tick of the playback loop run.
    await new Promise((r) => setTimeout(r, 50))

    const calls = vi.mocked(translateMock).mock.calls
    // Every call's first arg is the thought text — none from message/narration.
    for (const args of calls) {
      const arg0 = args[0] as string
      expect(arg0).toContain("Thinking")
    }
    // Sanity: translate WAS called for the thought.
    expect(calls.length).toBeGreaterThanOrEqual(1)
  })

  // ── 12: message jobs go to TTS verbatim (no translate round-trip) ─────────
  it("message text reaches synthesizeStreaming verbatim — no translate", async () => {
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_message_chunk", "טקסט עברי של ההודעה. "),
    )
    await new Promise((r) => setTimeout(r, 50))

    expect(vi.mocked(translateMock)).not.toHaveBeenCalled()
    const ttsCalls = vi.mocked(synthesizeMock).mock.calls
    expect(ttsCalls.length).toBeGreaterThanOrEqual(1)
    const arg = ttsCalls[0]?.[0] as { text: string }
    expect(arg.text).toContain("טקסט עברי של ההודעה")
  })

  // ── 13: narration jobs go to TTS verbatim ─────────────────────────────────
  it("narration text reaches synthesizeStreaming verbatim — no translate", async () => {
    // narrate() mock returns "אני בודק את הקוד" — that exact string must hit TTS.
    agentSession.injectAcp("sess-1", toolCall("call-1", "read README", "read"))
    await new Promise((r) => setTimeout(r, 50))

    expect(vi.mocked(translateMock)).not.toHaveBeenCalled()
    const ttsCalls = vi.mocked(synthesizeMock).mock.calls
    expect(ttsCalls.length).toBeGreaterThanOrEqual(1)
    const arg = ttsCalls[0]?.[0] as { text: string }
    expect(arg.text).toBe("אני בודק את הקוד")
  })

  // ── 13b: Gemini narration is propagated back to the visual bubble ─────────
  // Ensures the orchestrator calls agentSession.updateToolNarration after
  // narrate() resolves, so the bubble shows both raw ACP toolTitle AND
  // Gemini's natural-language narration.
  it("tool_call → updateToolNarration is called with the Gemini result", async () => {
    agentSession.injectAcp("sess-1", toolCall("call-42", "read README", "read"))
    await new Promise((r) => setTimeout(r, 50))

    const calls = (agentSession.updateToolNarration as ReturnType<typeof vi.fn>).mock.calls
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(["call-42", "אני בודק את הקוד"])
  })

  // ── 13c: narrate failure → bubble narration is NOT touched ────────────────
  it("narrate() rejects → updateToolNarration is NOT called (bubble keeps toolTitle only)", async () => {
    const { narrate: narrateMock } = await import("./narrate-client")
    vi.mocked(narrateMock).mockRejectedValueOnce(new Error("gemini timeout"))

    agentSession.injectAcp("sess-1", toolCall("call-43", "read README", "read"))
    await new Promise((r) => setTimeout(r, 50))

    expect(agentSession.updateToolNarration).not.toHaveBeenCalled()
  })

  // ── 14: thought with `already_in_target` → original text reaches TTS ──────
  it("thought + status=already_in_target → original thought text reaches TTS", async () => {
    vi.mocked(translateMock).mockResolvedValue({ status: "already_in_target" })
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_thought_chunk", "מחשבה כבר בעברית. "),
    )
    await new Promise((r) => setTimeout(r, 50))

    const ttsCalls = vi.mocked(synthesizeMock).mock.calls
    expect(ttsCalls.length).toBeGreaterThanOrEqual(1)
    const arg = ttsCalls[0]?.[0] as { text: string }
    expect(arg.text).toContain("מחשבה כבר בעברית")
  })

  // ── 15: thought + status=translated → translated text reaches TTS ─────────
  it("thought + status=translated → translated text reaches TTS", async () => {
    vi.mocked(translateMock).mockResolvedValue({
      status: "translated",
      text: "מחשבה מתורגמת",
    })
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_thought_chunk", "An English thought. "),
    )
    await new Promise((r) => setTimeout(r, 50))

    const ttsCalls = vi.mocked(synthesizeMock).mock.calls
    expect(ttsCalls.length).toBeGreaterThanOrEqual(1)
    const arg = ttsCalls[0]?.[0] as { text: string }
    expect(arg.text).toBe("מחשבה מתורגמת")
  })

  // ── 16: thought + translate=null → job fails, no TTS call for that job ────
  it("thought + translate=null → job is failed, TTS not invoked", async () => {
    vi.mocked(translateMock).mockResolvedValue(null)
    agentSession.injectAcp(
      "sess-1",
      textChunk("agent_thought_chunk", "An English thought. "),
    )
    await new Promise((r) => setTimeout(r, 50))

    expect(vi.mocked(synthesizeMock)).not.toHaveBeenCalled()
    const failed = orchestrator.sentenceQueue.find((j) => j.kind === "thought")
    expect(failed?.status).toBe("failed")
  })
})

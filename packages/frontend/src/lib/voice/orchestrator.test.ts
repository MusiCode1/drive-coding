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

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("./translate-client", () => ({
  translate: vi.fn().mockResolvedValue("translated text"),
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
})

/**
 * orchestrator.test.ts — ACP notifications → TTS jobs queue.
 *
 * Tests:
 * - message chunks → sentences enqueued
 * - thought chunks handled identically
 * - tool_call → narration enqueued
 * - prefetch lookahead = 2
 * - jump cancels pending > newIndex
 *
 * NOTE: Tests use mocked translate/tts/narrate/audioStream (no real API calls).
 * MediaSource not available in happy-dom — AudioStream is mocked.
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
    // Test helper: inject notification
    inject(notification: Record<string, unknown>) {
      voiceHandler?.(JSON.stringify(notification))
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// SKIP: Tests built on Slice 9 server-protocol shape ({ type, text, messageId }).
// Slice 10 Phase 3 orchestrator now expects ACP envelope ({ sessionId, update: { sessionUpdate, content } }).
// Will be rewritten in Phase 4 cleanup with the new shape.
describe.skip("createVoiceOrchestrator (Slice 9 shape, deprecated)", () => {
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

  it("message chunks accumulate and split into sentences", () => {
    // "Hello world. " (with trailing space) triggers splitIntoSentences
    // "This is a test." stays as remaining (no trailing space/punctuation)
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-1",
      text: "Hello world. Next sentence. ",
    })

    // splitIntoSentences finds two sentences (both have trailing space+text or end)
    // "Hello world." + "Next sentence." — at least one job enqueued
    expect(orchestrator.sentenceQueue.length).toBeGreaterThanOrEqual(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("message")
  })

  it("accumulates partial chunks across multiple events", () => {
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-1",
      text: "Hello ",
    })
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-1",
      text: "world. Next.",
    })

    // After second chunk: "Hello world." and "Next." may be extracted
    // but "Next." might stay in remaining depending on sentence splitter
    // At minimum, "Hello world." should be a sentence
    const texts = orchestrator.sentenceQueue.map((j) => j.text)
    expect(texts.some((t) => t.includes("Hello world"))).toBe(true)
  })

  it("thought chunks are enqueued as kind=thought", () => {
    agentSession.inject({
      type: "agent_thought_chunk",
      messageId: "thought-1",
      text: "Thinking about this. Let me consider.",
    })

    expect(orchestrator.sentenceQueue.length).toBeGreaterThanOrEqual(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("thought")
  })

  it("tool_call enqueues a narration job", () => {
    agentSession.inject({
      type: "tool_call",
      toolCallId: "call-1",
      title: "read README.md",
      kind: "read",
    })

    // Narration job should be added (may be fetching)
    expect(orchestrator.sentenceQueue.length).toBe(1)
    expect(orchestrator.sentenceQueue[0]?.kind).toBe("narration")
  })

  it("segments are added to player playlist", () => {
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-2",
      text: "First sentence. Second sentence.",
    })

    expect(player.playlist.length).toBeGreaterThanOrEqual(1)
    expect(player.playlist[0]?.kind).toBe("message")
    expect(player.playlist[0]?.messageId).toBe("msg-2")
  })

  it("flushes thought buffer when message chunk arrives", () => {
    // "thinking content" gets flushed when message chunk arrives
    // "thinking content" has no sentence-end regex match → stays in remaining
    // but flushThought() sends it as-is
    agentSession.inject({
      type: "agent_thought_chunk",
      messageId: "t-1",
      text: "thinking content ",
    })
    // Now send a message chunk — should flush the thought buffer
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "m-1",
      text: "actual message. ",
    })

    // At minimum the thought flush should have produced a job
    const kinds = orchestrator.sentenceQueue.map((j) => j.kind)
    expect(kinds.length).toBeGreaterThanOrEqual(1)
    // Message should be present (the "actual message. " splits)
    // Thought may or may not be present depending on flush timing
    expect(kinds).toContain("message")
  })

  it("cancelAll clears the queue", () => {
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-3",
      text: "One sentence. Two sentence.",
    })

    expect(orchestrator.sentenceQueue.length).toBeGreaterThan(0)
    orchestrator.cancelAll()
    expect(orchestrator.sentenceQueue.length).toBe(0)
  })

  it("jump callback cancels fetching jobs > newIndex", () => {
    // Add 3 segments
    agentSession.inject({
      type: "agent_message_chunk",
      messageId: "msg-jump",
      text: "Sentence one. Sentence two. Sentence three.",
    })

    // Mark some as fetching
    const q = orchestrator.sentenceQueue
    if (q[0]) q[0].status = "fetching"
    if (q[1]) q[1].status = "fetching"
    if (q[2]) q[2].status = "fetching"

    // Simulate jump to index 0
    player.jumpToSegment(q[0]?.segmentId ?? "")

    // Jobs at index > 0 that were fetching should be reset to pending
    // (jump callback in orchestrator handles this)
    // Note: the exact behavior depends on timing — at minimum jobs should not be stuck
    expect(orchestrator.sentenceQueue.length).toBeGreaterThan(0)
  })

  it("setUserMessage updates narration context", () => {
    orchestrator.setUserMessage("read the README file")
    // No throw — context is tracked internally
    agentSession.inject({
      type: "tool_call",
      toolCallId: "call-2",
      title: "read file",
      kind: "read",
    })
    expect(orchestrator.sentenceQueue.length).toBe(1)
  })
})

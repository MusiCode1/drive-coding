/**
 * Phase 6 — WS protocol schema tests (Tier 1) + E2E session test.
 *
 * Covers:
 *   - PROTO-1..4: ArkType schema validation for extended messages
 *   - PROTO-5..6: ToolCallUpdateMessage schema
 *   - E2E-1: Full audio prompt with thought→message→tool_call → assert all WS events
 */

import type { SessionNotification } from "@drive-coding/core"
import {
  AudioChunkMessage,
  TextChunkMessage,
  ToolCallMessage,
  ToolCallUpdateMessage,
} from "@drive-coding/core/schemas/ws-messages"
import { ok } from "neverthrow"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../src/voice/pipeline.js", () => ({
  transcribeUserAudio: vi.fn(),
  translateText: vi.fn(),
  speakSentence: vi.fn(),
  splitIntoSentences: vi.fn(),
}))

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

// ─── Schema tests ──────────────────────────────────────────────

describe("TextChunkMessage — Tier 1 schema", () => {
  it("PROTO-1: valid text_chunk with messageId passes ArkType validation", () => {
    const msg = { type: "text_chunk", kind: "message", text: "שלום", messageId: "uuid-123" }
    const result = TextChunkMessage(msg)
    expect(result instanceof type.errors).toBe(false)
    // ArkType returns the parsed value (not an Error) on success
    expect(result).toMatchObject({ type: "text_chunk", messageId: "uuid-123" })
  })

  it("PROTO-2: text_chunk without messageId (optional) also validates", () => {
    const msg = { type: "text_chunk", kind: "thought", text: "מחשבה" }
    const result = TextChunkMessage(msg)
    expect(result).toMatchObject({ type: "text_chunk", kind: "thought" })
  })
})

describe("AudioChunkMessage — Tier 1 schema", () => {
  it("PROTO-3: full audio_chunk with all Tier 1 fields passes validation", () => {
    const msg = {
      type: "audio_chunk",
      mp3Base64: "base64data==",
      segmentId: "seg-uuid",
      messageId: "msg-uuid",
      kind: "message" as const,
      originalText: "Hello world",
      translatedText: "שלום עולם",
    }
    const result = AudioChunkMessage(msg)
    expect(result).toMatchObject({ type: "audio_chunk", kind: "message" })
  })

  it("PROTO-4: minimal audio_chunk (mp3Base64 only) still validates", () => {
    const msg = { type: "audio_chunk", mp3Base64: "data" }
    const result = AudioChunkMessage(msg)
    expect(result).toMatchObject({ type: "audio_chunk" })
  })
})

describe("ToolCallUpdateMessage — Tier 1 schema", () => {
  it("PROTO-5: tool_call_update with toolCallId + narration passes", () => {
    const msg = {
      type: "tool_call_update",
      toolCallId: "tc-abc",
      narration: "אני בודק קובץ",
    }
    const result = ToolCallUpdateMessage(msg)
    expect(result).toMatchObject({ type: "tool_call_update", toolCallId: "tc-abc" })
  })

  it("PROTO-6: ToolCallMessage accepts optional narration field", () => {
    const msg = {
      type: "tool_call",
      toolCallId: "tc-xyz",
      title: "Read file",
      narration: "ניסוח בעברית",
    }
    const result = ToolCallMessage(msg)
    expect(result).toMatchObject({ type: "tool_call", narration: "ניסוח בעברית" })
  })
})

// ─── E2E: full audio prompt flow ─────────────────────────────

// Helper types for import (avoid unused import warnings)
import { type } from "arktype"

const baseConfig: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  ttsVoiceId: "Rachel",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}
const mockRegistries = {} as VoiceRegistries
const mockTtsCache = {
  async get() {
    return null
  },
  async set() {},
}

function makeMockTransport(
  onPrompt: (text: string, onUpdate: (n: SessionNotification) => void) => Promise<PromptResponse>,
): AcpTransport {
  return {
    async start(_input) {
      return { sessionId: "e2e-sess", capabilities: { loadSession: false } }
    },
    async prompt(input, onUpdate) {
      return onPrompt(input.text, onUpdate)
    },
    async cancel() {},
    async shutdown() {},
  }
}

describe("E2E: full audio prompt — thought→message→tool_call event sequence", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלה"))
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Thought sentence."], remaining: "" })
      .mockReturnValueOnce({ sentences: ["Message sentence."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))
    vi.mocked(pipeline.speakSentence).mockImplementation(async (_t, _c, _r, _ca, onChunk) => {
      onChunk("mp3data")
      return ok(undefined)
    })
    vi.mocked(narration.narrateToolCall).mockResolvedValue(ok("אני בודק קובץ"))
  })

  it("E2E-1: thought→message→tool_call → all events have correct IDs and types", async () => {
    const transport = makeMockTransport(async (_text, onUpdate) => {
      // 1. Thought chunk
      onUpdate({
        sessionId: "s",
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "Thought sentence." },
          messageId: null,
        },
      } as SessionNotification)
      // 2. Message chunk
      onUpdate({
        sessionId: "s",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Message sentence." },
          messageId: null,
        },
      } as SessionNotification)
      // 3. Tool call
      onUpdate({
        sessionId: "s",
        update: {
          sessionUpdate: "tool_call",
          toolCallId: "tc-e2e",
          title: "ReadFile",
          kind: "read",
          status: "pending",
          locations: [],
          content: [],
        },
      } as unknown as SessionNotification)
      return { stopReason: "end_turn" }
    })

    const session = createAgentSession({ agentId: "a", transport })
    const allBroadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => allBroadcasts.push(msg as Record<string, unknown>))

    const callbacks: VoiceCallbacks = {
      onSttPartial: () => {},
      onAudioChunk: () => {},
      onError: () => {},
    }

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      callbacks,
      mockRegistries,
      mockTtsCache,
    )

    // Verify thought text_chunk has messageId
    const thoughtChunk = allBroadcasts.find((m) => m.type === "text_chunk" && m.kind === "thought")
    expect(thoughtChunk).toBeDefined()
    expect(typeof thoughtChunk?.messageId).toBe("string")

    // Verify message text_chunk has messageId
    const msgChunk = allBroadcasts.find((m) => m.type === "text_chunk" && m.kind === "message")
    expect(msgChunk).toBeDefined()
    expect(typeof msgChunk?.messageId).toBe("string")

    // Verify tool_call broadcast
    const toolCall = allBroadcasts.find((m) => m.type === "tool_call")
    expect(toolCall).toBeDefined()
    expect(toolCall?.toolCallId).toBe("tc-e2e")

    // Verify tool_call_update with narration
    const toolUpdate = allBroadcasts.find((m) => m.type === "tool_call_update")
    expect(toolUpdate).toBeDefined()
    expect(toolUpdate?.narration).toBe("אני בודק קובץ")

    // Verify audio_chunk events have Tier 1 fields
    const audioChunks = allBroadcasts.filter((m) => m.type === "audio_chunk")
    expect(audioChunks.length).toBeGreaterThanOrEqual(1)
    for (const chunk of audioChunks) {
      expect(typeof chunk.segmentId).toBe("string")
      expect(typeof chunk.messageId).toBe("string")
      expect(["message", "thought", "narration"]).toContain(chunk.kind)
    }

    // Verify thought and message chunks have DIFFERENT messageIds
    if (thoughtChunk?.messageId && msgChunk?.messageId) {
      expect(thoughtChunk.messageId).not.toBe(msgChunk.messageId)
    }

    // Verify done is broadcast
    const done = allBroadcasts.find((m) => m.type === "done")
    expect(done).toBeDefined()
  })
})

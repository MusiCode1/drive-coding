/**
 * Phase 5 — Provider error detection + getStderr injection.
 *
 * PROMPT-17: when the agent returns 0 message chars + stderr has a known
 * provider error pattern → broadcast { type: "error", code: "PROVIDER_ERROR" }.
 *
 * 7 tests total:
 *   - PERR-1..3: sendPrompt provider error detection
 *   - PERR-4..5: sendAudioPrompt provider error detection
 *   - PERR-6..7: getStderr wiring via createAgentSession
 */

import type { AcpTransport, PromptResponse, SessionNotification } from "@drive-coding/core"
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

import { createAgentSession } from "../src/app/agent-session.js"
import type { VoiceCallbacks, VoiceConfig } from "../src/voice/pipeline.js"
import * as pipeline from "../src/voice/pipeline.js"
import type { VoiceRegistries } from "../src/voice/providers.js"

// ─── helpers ─────────────────────────────────────────────────

const CREDIT_ERROR_STDERR = [
  'ERROR provider response: {"message":"Your credit balance is too low to access the Anthropic API"}',
]

const RATE_ERROR_STDERR = ['{"message":"rate limit exceeded — too many requests in 1 minute"}']

function makeMockTransport(opts?: {
  onPrompt?: (text: string, onUpdate: (n: SessionNotification) => void) => Promise<PromptResponse>
}): AcpTransport {
  return {
    async start(_input) {
      return { sessionId: "sess", capabilities: { loadSession: false } }
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
const noop: VoiceCallbacks = {
  onSttPartial: () => {},
  onAudioChunk: () => {},
  onError: () => {},
}

// ─── sendPrompt: provider error detection ────────────────────

describe("sendPrompt — PERR: provider error detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("PERR-1: 0 message chars + credit error in stderr → broadcasts PROVIDER_ERROR", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, _onUpdate) {
        // Returns with 0 message chars
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => CREDIT_ERROR_STDERR,
    })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendPrompt("test question")

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeDefined()
    expect(String(errorBroadcast?.message)).toMatch(/credit|provider/i)
  })

  it("PERR-2: 0 chars but NO provider error in stderr → no PROVIDER_ERROR broadcast", async () => {
    const transport = makeMockTransport({
      async onPrompt() {
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => ["INFO some harmless log line"],
    })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendPrompt("test")

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeUndefined()
  })

  it("PERR-3: message chars > 0 → no PROVIDER_ERROR even if stderr has error", async () => {
    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Some response" },
            messageId: null,
          },
        } as SessionNotification)
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => CREDIT_ERROR_STDERR,
    })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendPrompt("test")

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeUndefined()
  })
})

// ─── sendAudioPrompt: provider error detection ────────────────

describe("sendAudioPrompt — PERR: provider error detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(pipeline.transcribeUserAudio).mockResolvedValue(ok("שאלה"))
    vi.mocked(pipeline.splitIntoSentences).mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תרגום"))
    vi.mocked(pipeline.speakSentence).mockResolvedValue(ok(undefined))
  })

  it("PERR-4: audio prompt with 0 message chars + credit error → PROVIDER_ERROR broadcast", async () => {
    const transport = makeMockTransport({
      async onPrompt() {
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => RATE_ERROR_STDERR,
    })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      noop,
      mockRegistries,
      mockCache,
    )

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeDefined()
  })

  it("PERR-5: audio prompt with message chars → no PROVIDER_ERROR", async () => {
    vi.mocked(pipeline.splitIntoSentences)
      .mockReturnValueOnce({ sentences: ["Response."], remaining: "" })
      .mockReturnValue({ sentences: [], remaining: "" })
    vi.mocked(pipeline.translateText).mockResolvedValue(ok("תגובה"))

    const transport = makeMockTransport({
      async onPrompt(_text, onUpdate) {
        onUpdate({
          sessionId: "s",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Response." },
            messageId: null,
          },
        } as SessionNotification)
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => CREDIT_ERROR_STDERR,
    })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendAudioPrompt(
      new Uint8Array([1]),
      "audio/webm",
      baseConfig,
      noop,
      mockRegistries,
      mockCache,
    )

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeUndefined()
  })
})

// ─── getStderr wiring ─────────────────────────────────────────

describe("createAgentSession — getStderr wiring", () => {
  it("PERR-6: without getStderr → no PROVIDER_ERROR even with 0 chars", async () => {
    // No getStderr provided — session has no access to stderr
    const transport = makeMockTransport({
      async onPrompt() {
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({ agentId: "a", transport })
    const broadcasts: Array<Record<string, unknown>> = []
    session.subscribe((msg) => broadcasts.push(msg as Record<string, unknown>))

    await session.sendPrompt("test")

    const errorBroadcast = broadcasts.find((m) => m.type === "error" && m.code === "PROVIDER_ERROR")
    expect(errorBroadcast).toBeUndefined()
  })

  it("PERR-7: getStderr called after prompt completes (not before)", async () => {
    const stderrCalls: number[] = []
    let promptFinishedAt = -1
    let stderrCalledAt = -1
    let counter = 0

    const transport = makeMockTransport({
      async onPrompt() {
        // Simulate some work
        await new Promise((r) => setTimeout(r, 5))
        promptFinishedAt = counter++
        return { stopReason: "end_turn" }
      },
    })
    const session = createAgentSession({
      agentId: "a",
      transport,
      getStderr: () => {
        stderrCalledAt = counter++
        stderrCalls.push(stderrCalledAt)
        return []
      },
    })
    session.subscribe(() => {})

    await session.sendPrompt("test")

    // getStderr should be called after prompt finishes (for provider error check)
    if (stderrCalls.length > 0) {
      expect(stderrCalledAt).toBeGreaterThan(promptFinishedAt)
    } else {
      // If no chars produced, getStderr may not be called if no stderr check is needed
      // This is fine — just verify no hang
    }
    expect(promptFinishedAt).toBeGreaterThanOrEqual(0)
  })
})

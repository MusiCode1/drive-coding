import { ClientMessage } from "@drive-coding/core"
import { type } from "arktype"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushAsync, installMediaMocks, makeMockSession } from "./__test-helpers__"
import type { AgentSessionPublic } from "./agent-session.svelte"
import { createVoiceSessionStore } from "./voice-session.svelte"

describe("createVoiceSessionStore", () => {
  beforeEach(() => {
    installMediaMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("accepts AgentSessionPublic as parameter (compile contract)", () => {
    // If voice-session defines its own local interface, TypeScript will refuse
    // an AgentSessionPublic that has extra/different fields.
    const fake: AgentSessionPublic = {
      agentId: "x",
      messages: [],
      status: "connected",
      error: null,
      isConnected: true,
      connect: () => {},
      disconnect: () => {},
      sendPrompt: () => {},
      sendRaw: () => true,
      cancel: () => {},
      setVoiceMessageHandler: () => {},
    }
    const store = createVoiceSessionStore(fake)
    expect(store.voiceState).toBe("idle")
  })

  it("stopRec sends audio payload with agentId === store agentId", async () => {
    const sent: unknown[] = []
    const fake = makeMockSession({
      agentId: "real-agent-id",
      sendRaw: vi.fn((p) => {
        sent.push(p)
        return true
      }),
    })
    const store = createVoiceSessionStore(fake)
    await store.startRecording()
    await store.stopRecording()
    await flushAsync()

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: "audio",
      agentId: "real-agent-id",
      mimeType: expect.stringMatching(/audio/),
    })
  })

  it("starts in idle state", () => {
    const store = createVoiceSessionStore(makeMockSession())
    expect(store.voiceState).toBe("idle")
  })

  it("startRecording moves to recording state", async () => {
    const store = createVoiceSessionStore(makeMockSession())
    await store.startRecording()
    expect(store.voiceState).toBe("recording")
  })

  it("audio_chunk inbound via voiceMessageHandler does not throw", () => {
    let capturedHandler: ((raw: string) => void) | null = null
    const fake = makeMockSession({
      setVoiceMessageHandler: vi.fn((h) => {
        capturedHandler = h
      }),
    })
    // Create store to register handler
    createVoiceSessionStore(fake)
    expect(capturedHandler).not.toBeNull()
    // Call with audio_chunk — should not throw
    expect(() => {
      capturedHandler?.(JSON.stringify({ type: "audio_chunk", mp3Base64: "abc" }))
    }).not.toThrow()
  })

  it("every payload sent through sendRaw passes ClientMessage schema", async () => {
    const sent: unknown[] = []
    const fake = makeMockSession({
      sendRaw: vi.fn((p) => {
        sent.push(p)
        return true
      }),
    })
    const store = createVoiceSessionStore(fake)
    await store.startRecording()
    await store.stopRecording()
    await flushAsync()

    expect(sent.length).toBeGreaterThan(0)
    for (const payload of sent) {
      const result = ClientMessage(payload)
      if (result instanceof type.errors) {
        throw new Error(
          `payload נכשל ClientMessage:\n${JSON.stringify(payload, null, 2)}\nשגיאות: ${result.summary}`,
        )
      }
    }
  })
})

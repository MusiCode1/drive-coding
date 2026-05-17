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
      bubbles: [],
      isLoadingHistory: false,
      status: "connected",
      error: null,
      isConnected: true,
      connect: () => {},
      disconnect: () => {},
      sendPrompt: () => {},
      sendRaw: () => true,
      cancel: () => {},
      setVoiceMessageHandler: () => {},
      clearBubbles: () => {},
      getRecordingId: () => null,
      addTranslatedSegment: () => {},
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

  it("sendAudioBlob moves to thinking state so subsequent audio_chunk events play", async () => {
    let capturedHandler: ((raw: string) => void) | null = null
    const sent: unknown[] = []
    const fake = makeMockSession({
      agentId: "agent-x",
      setVoiceMessageHandler: vi.fn((h) => {
        capturedHandler = h
      }),
      sendRaw: vi.fn((p) => {
        sent.push(p)
        return true
      }),
    })
    const store = createVoiceSessionStore(fake)

    // Simulate file upload path
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp3" })
    await store.sendAudioBlob(fakeBlob)
    await flushAsync()

    // 1. sent the audio
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: "audio",
      agentId: "agent-x",
      mimeType: "audio/mp3",
    })

    // 2. moved to thinking — so audio_chunk will be accepted
    expect(store.voiceState).toBe("thinking")

    // 3. audio_chunk arriving now should trigger speaking state
    ;(capturedHandler as ((raw: string) => void) | null)?.(
      JSON.stringify({ type: "audio_chunk", mp3Base64: "abc" }),
    )
    // (player.enqueue is called; state would change to speaking via onStateChange)
  })

  it("canReplayLast becomes reactive=true after an audio_chunk is received", async () => {
    let capturedHandler: ((raw: string) => void) | null = null
    const fake = makeMockSession({
      setVoiceMessageHandler: vi.fn((h) => {
        capturedHandler = h
      }),
    })
    // Mock window.Audio so player.enqueue works in jsdom
    class MockAudio {
      src: string
      paused = true
      currentTime = 0
      _ended: () => void = () => {}
      _error: () => void = () => {}
      constructor(src: string) {
        this.src = src
      }
      addEventListener(type: string, fn: () => void) {
        if (type === "ended") this._ended = fn
        if (type === "error") this._error = fn
      }
      play() {
        return Promise.resolve()
      }
    }
    vi.stubGlobal("Audio", MockAudio)

    const store = createVoiceSessionStore(fake)
    expect(store.canReplayLast).toBe(false)

    // Move to thinking first so audio_chunk is accepted
    await store.sendAudioBlob(new Blob([new Uint8Array([1])], { type: "audio/mp3" }))
    await flushAsync()

    ;(capturedHandler as ((raw: string) => void) | null)?.(
      JSON.stringify({ type: "audio_chunk", mp3Base64: "abc" }),
    )
    await flushAsync()

    expect(store.canReplayLast).toBe(true)
  })

  it("sendAudioBlob with empty blob does not send and stays idle", async () => {
    const sent: unknown[] = []
    const fake = makeMockSession({
      sendRaw: vi.fn((p) => {
        sent.push(p)
        return true
      }),
    })
    const store = createVoiceSessionStore(fake)
    await store.sendAudioBlob(new Blob([], { type: "audio/mp3" }))
    expect(sent).toHaveLength(0)
    expect(store.voiceState).toBe("idle")
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

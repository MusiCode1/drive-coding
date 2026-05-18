/**
 * voice-session.test.ts — Phase 3 refactor.
 *
 * Voice session now delegates to orchestrator (FE-side STT + ACP).
 * Tests cover the state machine and public API contract.
 *
 * NOTE: STT (transcribe) and orchestrator are mocked — no real API calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushAsync, installMediaMocks, makeMockSession } from "./__test-helpers__"
import { createPlayerStore } from "./player.svelte"
import { createVoiceSessionStore } from "./voice-session.svelte"

// Mock STT client — returns a short transcription
vi.mock("$lib/voice/stt-client", () => ({
  transcribe: vi.fn().mockResolvedValue({ text: "שלום עולם", recordingId: "rec-1" }),
}))

// Mock AudioStream (MediaSource not in happy-dom)
vi.mock("$lib/voice/audio-stream", () => ({
  AudioStream: class {
    prepareSegment = vi.fn().mockResolvedValue(undefined)
    play = vi.fn().mockResolvedValue(undefined)
    cancel = vi.fn()
    clear = vi.fn()
  },
}))

// Mock orchestrator — just register the handler, don't actually do TTS
vi.mock("$lib/voice/orchestrator", () => ({
  createVoiceOrchestrator: vi.fn().mockImplementation(({ agentSession }) => {
    agentSession.setVoiceMessageHandler(() => {})
    return {
      handleNotification: vi.fn(),
      cancelAll: vi.fn(),
      reset: vi.fn(),
      setUserMessage: vi.fn(),
      get sentenceQueue() {
        return []
      },
    }
  }),
}))

function makeStore(overrides: Parameters<typeof makeMockSession>[0] = {}) {
  const session = makeMockSession(overrides)
  const player = createPlayerStore()
  return {
    store: createVoiceSessionStore({
      agentSession: session,
      player,
      getVoiceId: () => "test-voice-id",
    }),
    session,
    player,
  }
}

describe("createVoiceSessionStore (Phase 3)", () => {
  beforeEach(() => {
    installMediaMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("starts in idle state", () => {
    const { store } = makeStore()
    expect(store.voiceState).toBe("idle")
  })

  it("startRecording moves to recording state", async () => {
    const { store } = makeStore()
    await store.startRecording()
    expect(store.voiceState).toBe("recording")
  })

  it("isRecording reflects recording state", async () => {
    const { store } = makeStore()
    expect(store.isRecording).toBe(false)
    await store.startRecording()
    expect(store.isRecording).toBe(true)
  })

  it("sendAudioBlob with empty blob stays idle", async () => {
    const { store } = makeStore()
    await store.sendAudioBlob(new Blob([], { type: "audio/mp3" }))
    expect(store.voiceState).toBe("idle")
  })

  it("sendAudioBlob non-empty: transcribes then sends prompt", async () => {
    const { store, session } = makeStore()
    const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/mp3" })
    await store.sendAudioBlob(fakeBlob)
    await flushAsync()

    // sendPrompt should be called with the transcribed text
    expect(session.sendPrompt).toHaveBeenCalledWith("שלום עולם")
  })

  it("cancel moves to idle", async () => {
    const { store } = makeStore()
    await store.startRecording()
    store.cancel()
    expect(store.voiceState).toBe("idle")
  })

  it("currentlyPlayingSegmentId starts null", () => {
    const { store } = makeStore()
    expect(store.currentlyPlayingSegmentId).toBeNull()
  })

  it("canReplayLast starts false", () => {
    const { store } = makeStore()
    expect(store.canReplayLast).toBe(false)
  })

  it("getSegment returns undefined for unknown id", () => {
    const { store } = makeStore()
    expect(store.getSegment("unknown-id")).toBeUndefined()
  })

  it("accepts new deps interface (compile contract)", () => {
    const session = makeMockSession()
    const player = createPlayerStore()
    // Should not throw when constructed with deps object
    expect(() => {
      createVoiceSessionStore({ agentSession: session, player, getVoiceId: () => "v-id" })
    }).not.toThrow()
  })
})

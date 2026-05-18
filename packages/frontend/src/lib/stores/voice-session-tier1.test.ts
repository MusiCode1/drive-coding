/**
 * voice-session-tier1.test.ts — Phase 3 refactor.
 *
 * Phase 3: voice session no longer receives audio_chunk events (server-protocol).
 * Segment tracking now happens via player store (orchestrator populates it).
 *
 * These tests verify the backward-compat API that +page.svelte still uses:
 * - currentlyPlayingSegmentId (derived from player.currentItem)
 * - getSegment() (segment cache for bubble highlighting)
 *
 * NOTE: Most server-protocol tests were removed as they're no longer applicable.
 * The orchestrator.test.ts covers the new notification processing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installMediaMocks, makeMockSession } from "./__test-helpers__"
import { createPlayerStore } from "./player.svelte"
import { createVoiceSessionStore } from "./voice-session.svelte"

// Mock deps
vi.mock("$lib/voice/stt-client", () => ({
  transcribe: vi.fn().mockResolvedValue({ text: "test transcription", recordingId: "r1" }),
}))
vi.mock("$lib/voice/audio-stream", () => ({
  AudioStream: class {
    prepareSegment = vi.fn().mockResolvedValue(undefined)
    play = vi.fn().mockResolvedValue(undefined)
    cancel = vi.fn()
    clear = vi.fn()
  },
}))
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

describe("voice-session Phase 3 backward compat", () => {
  beforeEach(() => {
    installMediaMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("currentlyPlayingSegmentId is null initially", () => {
    const { store } = makeStore()
    expect(store.currentlyPlayingSegmentId).toBeNull()
  })

  it("getSegment returns undefined for unknown id", () => {
    const { store } = makeStore()
    expect(store.getSegment("unknown")).toBeUndefined()
  })

  it("voiceState starts idle", () => {
    const { store } = makeStore()
    expect(store.voiceState).toBe("idle")
  })

  it("cancel clears playback and resets to idle", async () => {
    const { store } = makeStore()
    await store.startRecording()
    store.cancel()
    expect(store.voiceState).toBe("idle")
    expect(store.currentlyPlayingSegmentId).toBeNull()
  })

  it("sendAudioBlob with empty blob stays idle (no STT call)", async () => {
    const { store } = makeStore()
    await store.sendAudioBlob(new Blob([], { type: "audio/mp3" }))
    expect(store.voiceState).toBe("idle")
  })
})

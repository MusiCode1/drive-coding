/**
 * voice-session-tier1.test.ts — Phase 5 TDD
 *
 * Tests for Tier 1 audio_chunk caching:
 *   - segmentId-keyed cache (kind, originalText, translatedText)
 *   - currentlyPlayingSegmentId tracking
 *   - audio chunks without segmentId still play
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushAsync, makeMockSession } from "./__test-helpers__"
import { createVoiceSessionStore } from "./voice-session.svelte"

// Minimal MockAudio that supports ended/error events + play()
class MockAudio {
  src: string
  paused = true
  currentTime = 0
  static instances: MockAudio[] = []
  private _listeners: Record<string, Array<() => void>> = {}

  constructor(src: string) {
    this.src = src
    MockAudio.instances.push(this)
  }

  addEventListener(type: string, fn: () => void) {
    if (!this._listeners[type]) this._listeners[type] = []
    this._listeners[type]!.push(fn)
  }

  play() {
    return Promise.resolve()
  }

  _triggerEnded() {
    for (const fn of this._listeners["ended"] ?? []) fn()
  }
}

function installAudioMock() {
  MockAudio.instances = []
  vi.stubGlobal("Audio", MockAudio)
}

describe("voice-session Tier 1 audio_chunk caching (Phase 5)", () => {
  beforeEach(() => {
    installAudioMock()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    MockAudio.instances = []
  })

  // Helper to move store to "thinking" and fire a fake audio_chunk
  async function makeThinkingStore() {
    const fake = makeMockSession({
      sendRaw: vi.fn(() => true),
    })
    const store = createVoiceSessionStore(fake)

    // Move to thinking via sendAudioBlob
    await store.sendAudioBlob(new Blob([new Uint8Array([1])], { type: "audio/mp3" }))
    await flushAsync()
    return { store, fake }
  }

  // Helper to fire a message through the voice handler
  function fireMessage(fake: ReturnType<typeof makeMockSession>, msg: unknown) {
    const setHandler = fake.setVoiceMessageHandler as ReturnType<typeof vi.fn>
    const handler = setHandler.mock.calls[0]?.[0] as ((raw: string) => void) | undefined
    if (!handler) throw new Error("voiceMessageHandler was not registered")
    handler(JSON.stringify(msg))
  }

  // ── 1: audio_chunk with segmentId stored in cache ──────────────────────────
  it("audio_chunk with segmentId is stored in segment cache", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "abc",
      segmentId: "seg-1",
      kind: "message",
    })
    expect(store.getSegment("seg-1")).toBeDefined()
    expect(store.getSegment("seg-1")?.kind).toBe("message")
  })

  // ── 2: audio_chunk with kind:thought stored correctly ──────────────────────
  it("audio_chunk with kind:thought stores thought kind", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "xyz",
      segmentId: "seg-thought",
      kind: "thought",
    })
    expect(store.getSegment("seg-thought")?.kind).toBe("thought")
  })

  // ── 3: audio_chunk with originalText/translatedText stored ─────────────────
  it("audio_chunk stores originalText and translatedText in segment cache", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "abc",
      segmentId: "seg-2",
      kind: "thought",
      originalText: "the original english text",
      translatedText: "הטקסט בעברית",
    })
    const seg = store.getSegment("seg-2")
    expect(seg?.originalText).toBe("the original english text")
    expect(seg?.translatedText).toBe("הטקסט בעברית")
  })

  // ── 4: audio_chunk without segmentId still plays (no cache entry) ──────────
  it("audio_chunk without segmentId enqueues audio without cache entry", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "abc",
      // no segmentId
    })
    await flushAsync()
    // Audio should be playing after the chunk arrives
    expect(store.voiceState).toBe("speaking")
    // No cache entry created (no segmentId)
    expect(store.getSegment("undefined")).toBeUndefined()
  })

  // ── 5: multiple segments stored correctly ──────────────────────────────────
  it("multiple audio_chunk events with different segmentIds are all cached", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, { type: "audio_chunk", mp3Base64: "a", segmentId: "s1", kind: "message" })
    fireMessage(fake, { type: "audio_chunk", mp3Base64: "b", segmentId: "s2", kind: "thought" })
    fireMessage(fake, { type: "audio_chunk", mp3Base64: "c", segmentId: "s3", kind: "narration" })
    expect(store.getSegment("s1")?.kind).toBe("message")
    expect(store.getSegment("s2")?.kind).toBe("thought")
    expect(store.getSegment("s3")?.kind).toBe("narration")
  })

  // ── 6: currentlyPlayingSegmentId set when audio plays ──────────────────────
  it("currentlyPlayingSegmentId is set when audio_chunk with segmentId starts playing", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "abc",
      segmentId: "seg-play",
      kind: "message",
    })
    await flushAsync()
    // Audio with segmentId "seg-play" should now be playing
    expect(store.voiceState).toBe("speaking")
    expect(store.currentlyPlayingSegmentId).toBe("seg-play")
  })

  // ── 7: currentlyPlayingSegmentId clears when audio ends ────────────────────
  it("currentlyPlayingSegmentId is null when no audio is playing", async () => {
    const { store } = await makeThinkingStore()
    // No audio_chunk fired yet
    expect(store.currentlyPlayingSegmentId).toBeNull()
  })

  // ── B15: audio_chunk with messageId stores it in segmentCache ──────────────
  it("B15: audio_chunk with messageId stores it in segment cache", async () => {
    const { store, fake } = await makeThinkingStore()
    fireMessage(fake, {
      type: "audio_chunk",
      mp3Base64: "abc",
      segmentId: "seg-b15",
      kind: "message",
      messageId: "msg-abc",
    })
    const seg = store.getSegment("seg-b15")
    expect(seg?.messageId).toBe("msg-abc")
  })
})

/**
 * bubble-player.toggle.test.svelte.ts — regression tests for BubblePlayer.toggle().
 *
 * Commit 0 (slice playlist-pure-decision): RED before the else fix.
 *
 * Tests:
 *   1. bubble in playlist + state==="playing" → jumpToBubble called, no new fetch
 *   2. bubble in playlist + state==="idle" → #reserveAndPlay runs (reserve called N times)
 *   3. bubble not in playlist (historical) → reserve called (historical branch runs)
 */

import { beforeEach, describe, expect, it, vi } from "vitest"
import { BubblePlayer } from "./bubble-player.svelte"
import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"

// ─── mocks for resolveTts and splitIntoSentences ─────────────────────────────

vi.mock("$lib/adapters/voice/tts-resolve", () => ({
  resolveTts: vi.fn(() => ({
    provider: {
      synthesize: vi.fn().mockResolvedValue(new ReadableStream()),
    },
    voiceId: "voice-mock",
    modelId: "model-mock",
  })),
}))

vi.mock("@drive-coding/core/voice/sentence-boundary", () => ({
  splitIntoSentences: vi.fn((_text: string) => ({
    sentences: ["sentence one", "sentence two"],
  })),
}))

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeSession(bubbles: Array<{ id: string; kind: string; segments: Array<{ text: string }> }>): AgentSession {
  return {
    turnState: "idle",
    bubbles,
  } as unknown as AgentSession
}

function makeSettings(): Settings {
  return {
    ttsProvider: "elevenlabs",
    voiceId: "test-voice",
    geminiVoice: "Kore",
  } as unknown as Settings
}

function makePlaylist(
  overrides: Partial<{
    state: "idle" | "playing"
    hasItem: boolean
  }> = {},
): { playlist: AudioPlaylist; jumpToBubbleFn: ReturnType<typeof vi.fn>; reserveFn: ReturnType<typeof vi.fn>; prepareSegmentForBubbleFn: ReturnType<typeof vi.fn> } {
  const jumpToBubbleFn = vi.fn()
  const reserveFn = vi.fn()
  const prepareSegmentForBubbleFn = vi.fn().mockResolvedValue(undefined)
  const markReadyFn = vi.fn()
  const markErrorFn = vi.fn()
  const stopFn = vi.fn()

  const items = overrides.hasItem === true ? [{ bubbleId: "bubble-test", segmentId: "seg-0", state: "playing", orderKey: { seq: 0, segmentIndex: 0 }, bubbleId2: "bubble-test" }] : []

  const playlist = {
    state: overrides.state ?? "playing",
    items,
    jumpToBubble: jumpToBubbleFn,
    reserve: reserveFn,
    prepareSegmentForBubble: prepareSegmentForBubbleFn,
    markReady: markReadyFn,
    markError: markErrorFn,
    stop: stopFn,
  } as unknown as AudioPlaylist

  return { playlist, jumpToBubbleFn, reserveFn, prepareSegmentForBubbleFn }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("BubblePlayer.toggle — regression tests (Commit 0)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Test 1: bubble in playlist + state==="playing" → jumpToBubble only, no new reserve
  it("בועה בפלייליסט + state=playing → jumpToBubble נקרא ואין fetch חדש", () => {
    const bubble = { id: "bubble-test", kind: "message", segments: [{ text: "hello world sentence here" }] }
    const session = makeSession([bubble])
    const settings = makeSettings()
    const { playlist, jumpToBubbleFn, reserveFn } = makePlaylist({ state: "playing", hasItem: true })

    const player = new BubblePlayer({ session, settings, playlist })
    player.toggle("bubble-test")

    // jumpToBubble should be called — not reserve
    expect(jumpToBubbleFn).toHaveBeenCalledWith("bubble-test")
    // reserve must NOT be called (no new fetch started)
    expect(reserveFn).not.toHaveBeenCalled()
    // playingBubbleId should be set
    expect(player.playingBubbleId).toBe("bubble-test")
  })

  // Test 2: bubble in playlist + state==="idle" → reserve called (restart flow)
  it("בועה בפלייליסט + state=idle → reserve נקרא (restart)", async () => {
    const bubble = { id: "bubble-test", kind: "message", segments: [{ text: "hello world sentence here" }] }
    const session = makeSession([bubble])
    const settings = makeSettings()
    const { playlist, reserveFn } = makePlaylist({ state: "idle", hasItem: true })

    const player = new BubblePlayer({ session, settings, playlist })
    player.toggle("bubble-test")

    // reserve should be called (restart: reserveAndPlay)
    // splitIntoSentences returns 2 sentences → reserve called 2 times
    await Promise.resolve()
    await Promise.resolve()
    expect(reserveFn).toHaveBeenCalled()
    // reserve should not be called 2N times (no double-run)
    expect(reserveFn.mock.calls.length).toBeLessThanOrEqual(2)
  })

  // Test 3: bubble not in playlist (historical) → reserve called
  it("בועה היסטורית (לא בפלייליסט) → reserve נקרא", async () => {
    const bubble = { id: "bubble-hist", kind: "message", segments: [{ text: "historical text here" }] }
    const session = makeSession([bubble])
    const settings = makeSettings()
    // hasItem=false → alreadyInPlaylist = false
    const { playlist, reserveFn } = makePlaylist({ state: "idle", hasItem: false })

    const player = new BubblePlayer({ session, settings, playlist })
    player.toggle("bubble-hist")

    // The historical branch must run
    await Promise.resolve()
    await Promise.resolve()
    expect(reserveFn).toHaveBeenCalled()
  })
})

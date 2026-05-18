/**
 * playback-storage.test.ts — TTL, missing key, malformed JSON
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearPlaybackState,
  createPlaybackStorageSync,
  loadPlaybackState,
  type PlaybackState,
  savePlaybackState,
} from "./playback-storage"

const TTL_MS = 24 * 60 * 60 * 1000

describe("loadPlaybackState", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("returns null for missing key", () => {
    expect(loadPlaybackState("agent-x")).toBeNull()
  })

  it("returns stored state when fresh", () => {
    const state: PlaybackState = {
      agentId: "agent-1",
      sessionId: "sess-1",
      currentSegmentIndex: 3,
      playedSegmentIds: ["a", "b", "c"],
      updatedAt: Date.now(),
    }
    savePlaybackState(state)
    const loaded = loadPlaybackState("agent-1")
    expect(loaded).not.toBeNull()
    expect(loaded?.currentSegmentIndex).toBe(3)
    expect(loaded?.playedSegmentIds).toEqual(["a", "b", "c"])
    expect(loaded?.sessionId).toBe("sess-1")
  })

  it("returns null when TTL expired (>24h)", () => {
    const expired: PlaybackState = {
      agentId: "agent-2",
      sessionId: null,
      currentSegmentIndex: 5,
      playedSegmentIds: [],
      updatedAt: Date.now() - TTL_MS - 1000,
    }
    localStorage.setItem("voice-acp:playback:agent-2", JSON.stringify(expired))
    expect(loadPlaybackState("agent-2")).toBeNull()
    // Should also clean up the expired key
    expect(localStorage.getItem("voice-acp:playback:agent-2")).toBeNull()
  })

  it("returns state at exactly TTL boundary (still valid)", () => {
    const fresh: PlaybackState = {
      agentId: "agent-3",
      sessionId: null,
      currentSegmentIndex: 2,
      playedSegmentIds: [],
      updatedAt: Date.now() - TTL_MS + 5000, // 5s before expiry
    }
    localStorage.setItem("voice-acp:playback:agent-3", JSON.stringify(fresh))
    const loaded = loadPlaybackState("agent-3")
    expect(loaded?.currentSegmentIndex).toBe(2)
  })

  it("returns null for malformed JSON", () => {
    localStorage.setItem("voice-acp:playback:agent-bad", "{ not valid json }")
    expect(loadPlaybackState("agent-bad")).toBeNull()
  })
})

describe("savePlaybackState", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it("saves state with updatedAt set", () => {
    const before = Date.now()
    savePlaybackState({
      agentId: "agent-save",
      sessionId: null,
      currentSegmentIndex: 7,
      playedSegmentIds: ["x"],
      updatedAt: 0, // should be overwritten
    })
    const raw = localStorage.getItem("voice-acp:playback:agent-save")
    expect(raw).not.toBeNull()
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    const parsed = JSON.parse(raw!) as PlaybackState
    expect(parsed.updatedAt).toBeGreaterThanOrEqual(before)
    expect(parsed.currentSegmentIndex).toBe(7)
  })
})

describe("clearPlaybackState", () => {
  it("removes stored state", () => {
    savePlaybackState({
      agentId: "agent-clear",
      sessionId: null,
      currentSegmentIndex: 1,
      playedSegmentIds: [],
      updatedAt: Date.now(),
    })
    clearPlaybackState("agent-clear")
    expect(loadPlaybackState("agent-clear")).toBeNull()
  })
})

describe("createPlaybackStorageSync", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("debounces save by 1s", () => {
    const sync = createPlaybackStorageSync("agent-debounce", () => "sess-abc")

    sync.sync(1, ["seg-a"])
    sync.sync(2, ["seg-a", "seg-b"])
    sync.sync(3, ["seg-a", "seg-b", "seg-c"])

    // Nothing saved yet
    expect(loadPlaybackState("agent-debounce")).toBeNull()

    vi.advanceTimersByTime(1100)

    // Now saved with last value
    const saved = loadPlaybackState("agent-debounce")
    expect(saved?.currentSegmentIndex).toBe(3)
    expect(saved?.playedSegmentIds).toEqual(["seg-a", "seg-b", "seg-c"])
    expect(saved?.sessionId).toBe("sess-abc")

    sync.destroy()
  })

  it("destroy cancels pending save", () => {
    const sync = createPlaybackStorageSync("agent-destroy", () => null)
    sync.sync(5, [])
    sync.destroy()
    vi.advanceTimersByTime(2000)
    expect(loadPlaybackState("agent-destroy")).toBeNull()
  })
})

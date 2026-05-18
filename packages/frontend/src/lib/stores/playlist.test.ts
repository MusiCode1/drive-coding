/**
 * playlist.test.ts — tests for player.svelte.ts (playlist navigation + callbacks)
 * Phase 3 additions: onAdvance, onJump callbacks.
 */

import { describe, expect, it, vi } from "vitest"
import { createPlayerStore } from "./player.svelte"

describe("createPlayerStore", () => {
  it("starts empty", () => {
    const store = createPlayerStore()
    expect(store.playlist).toHaveLength(0)
    expect(store.currentIndex).toBe(-1)
    expect(store.hasNext).toBe(false)
    expect(store.hasPrev).toBe(false)
  })

  it("addSegment appends items", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "msg-1")
    store.addSegment("seg-2", "thought", "msg-2")
    expect(store.playlist).toHaveLength(2)
    expect(store.playlist[0]?.segmentId).toBe("seg-1")
    expect(store.playlist[1]?.kind).toBe("thought")
  })

  it("addSegment ignores duplicates", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "msg-1")
    store.addSegment("seg-1", "message", "msg-1")
    expect(store.playlist).toHaveLength(1)
  })

  it("jumpToSegment sets currentIndex and fires onJump", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "msg-1")
    store.addSegment("seg-2", "thought", "msg-2")

    const jumpCb = vi.fn()
    store.onJump(jumpCb)

    const idx = store.jumpToSegment("seg-2")
    expect(idx).toBe(1)
    expect(store.currentIndex).toBe(1)
    expect(jumpCb).toHaveBeenCalledWith(1)
  })

  it("jumpToSegment returns -1 for unknown segmentId", () => {
    const store = createPlayerStore()
    expect(store.jumpToSegment("unknown")).toBe(-1)
  })

  it("goNext advances and fires onAdvance", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.addSegment("seg-2", "message", null)
    store.jumpToSegment("seg-1")

    const advanceCb = vi.fn()
    store.onAdvance(advanceCb)

    const item = store.goNext()
    expect(item?.segmentId).toBe("seg-2")
    expect(store.currentIndex).toBe(1)
    expect(advanceCb).toHaveBeenCalledWith(1)
  })

  it("goNext returns null at end of playlist", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.jumpToSegment("seg-1")
    expect(store.goNext()).toBeNull()
  })

  it("goPrev navigates backward and fires onJump", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.addSegment("seg-2", "message", null)
    store.jumpToSegment("seg-2")

    const jumpCb = vi.fn()
    store.onJump(jumpCb)

    const item = store.goPrev()
    expect(item?.segmentId).toBe("seg-1")
    expect(jumpCb).toHaveBeenCalledWith(0)
  })

  it("goPrev returns null at start", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.jumpToSegment("seg-1")
    expect(store.goPrev()).toBeNull()
  })

  it("jumpToBubble finds first segment of a bubble", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "bubble-A")
    store.addSegment("seg-2", "message", "bubble-A")
    store.addSegment("seg-3", "thought", "bubble-B")

    const item = store.jumpToBubble("bubble-A")
    expect(item?.segmentId).toBe("seg-1")
    expect(store.currentIndex).toBe(0)
  })

  it("jumpToBubble returns null for unknown messageId", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "bubble-A")
    expect(store.jumpToBubble("unknown")).toBeNull()
  })

  it("isPlayingBubble matches current segment's bubble", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", "bubble-A")
    store.addSegment("seg-2", "message", "bubble-B")
    store.jumpToBubble("bubble-A")
    expect(store.isPlayingBubble("bubble-A")).toBe(true)
    expect(store.isPlayingBubble("bubble-B")).toBe(false)
  })

  it("replayLastResponse jumps to first message segment", () => {
    const store = createPlayerStore()
    store.addSegment("seg-thought", "thought", null)
    store.addSegment("seg-msg-1", "message", "bubble-A")
    store.addSegment("seg-msg-2", "message", "bubble-A")

    const item = store.replayLastResponse()
    expect(item?.segmentId).toBe("seg-msg-1")
  })

  it("replayLastResponse returns null when no message segments", () => {
    const store = createPlayerStore()
    store.addSegment("seg-thought", "thought", null)
    expect(store.replayLastResponse()).toBeNull()
  })

  it("advance moves forward and fires onAdvance", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.addSegment("seg-2", "message", null)
    store.jumpToSegment("seg-1")

    const advanceCb = vi.fn()
    store.onAdvance(advanceCb)

    const item = store.advance()
    expect(item?.segmentId).toBe("seg-2")
    expect(advanceCb).toHaveBeenCalledWith(1)
  })

  it("clear resets state", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.jumpToSegment("seg-1")
    store.clear()
    expect(store.playlist).toHaveLength(0)
    expect(store.currentIndex).toBe(-1)
  })

  it("hasNext and hasPrev reflect position", () => {
    const store = createPlayerStore()
    store.addSegment("seg-1", "message", null)
    store.addSegment("seg-2", "message", null)
    store.jumpToSegment("seg-1")
    expect(store.hasNext).toBe(true)
    expect(store.hasPrev).toBe(false)
    store.goNext()
    expect(store.hasNext).toBe(false)
    expect(store.hasPrev).toBe(true)
  })
})

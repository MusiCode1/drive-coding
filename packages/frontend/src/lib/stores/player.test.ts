/**
 * player.test.ts — Phase 7 TDD
 *
 * Tests for the playlist navigation store (createPlayerStore).
 */
import { describe, expect, it } from "vitest"
import { createPlayerStore } from "./player.svelte"

describe("createPlayerStore — playlist navigation (Phase 7)", () => {
  // ── 1: addSegment appends to playlist ─────────────────────────────────────
  it("addSegment appends segments in order", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s2", "thought")
    store.addSegment("s3", "message")
    expect(store.playlist).toHaveLength(3)
    expect(store.playlist[0]?.segmentId).toBe("s1")
    expect(store.playlist[2]?.segmentId).toBe("s3")
  })

  // ── 2: addSegment ignores duplicates ───────────────────────────────────────
  it("addSegment ignores duplicate segmentIds", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s1", "message") // duplicate
    expect(store.playlist).toHaveLength(1)
  })

  // ── 3: jumpToSegment sets currentIndex ────────────────────────────────────
  it("jumpToSegment sets currentIndex to the segment's position", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s2", "thought")
    store.addSegment("s3", "message")
    const idx = store.jumpToSegment("s2")
    expect(idx).toBe(1)
    expect(store.currentIndex).toBe(1)
    expect(store.currentItem?.segmentId).toBe("s2")
  })

  // ── 4: jumpToSegment returns -1 for unknown segment ───────────────────────
  it("jumpToSegment returns -1 for unknown segmentId", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    const result = store.jumpToSegment("unknown")
    expect(result).toBe(-1)
    expect(store.currentIndex).toBe(-1)
  })

  // ── 5: goNext advances through playlist ───────────────────────────────────
  it("goNext advances to next segment", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s2", "message")
    store.addSegment("s3", "message")
    store.jumpToSegment("s1")
    const next = store.goNext()
    expect(next?.segmentId).toBe("s2")
    expect(store.currentIndex).toBe(1)
  })

  // ── 6: goNext returns null at end of playlist ──────────────────────────────
  it("goNext returns null when at last segment", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.jumpToSegment("s1")
    const result = store.goNext()
    expect(result).toBeNull()
  })

  // ── 7: goPrev goes back ────────────────────────────────────────────────────
  it("goPrev goes to previous segment", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s2", "message")
    store.jumpToSegment("s2")
    const prev = store.goPrev()
    expect(prev?.segmentId).toBe("s1")
    expect(store.currentIndex).toBe(0)
  })

  // ── 8: goPrev returns null at beginning ───────────────────────────────────
  it("goPrev returns null when at first segment", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.jumpToSegment("s1")
    const result = store.goPrev()
    expect(result).toBeNull()
  })

  // ── 9: replayLastResponse finds first message segment ─────────────────────
  it("replayLastResponse returns first message-kind segment", () => {
    const store = createPlayerStore()
    store.addSegment("th1", "thought")
    store.addSegment("m1", "message")
    store.addSegment("m2", "message")
    const item = store.replayLastResponse()
    expect(item?.segmentId).toBe("m1")
    expect(store.currentIndex).toBe(1)
  })

  // ── 10: clear resets state ─────────────────────────────────────────────────
  it("clear resets playlist and currentIndex", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.jumpToSegment("s1")
    store.clear()
    expect(store.playlist).toHaveLength(0)
    expect(store.currentIndex).toBe(-1)
  })

  // ── 11: hasNext / hasPrev flags ───────────────────────────────────────────
  it("hasNext and hasPrev report correctly", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message")
    store.addSegment("s2", "message")
    store.addSegment("s3", "message")
    store.jumpToSegment("s2")
    expect(store.hasNext).toBe(true)
    expect(store.hasPrev).toBe(true)
    store.jumpToSegment("s1")
    expect(store.hasPrev).toBe(false)
    store.jumpToSegment("s3")
    expect(store.hasNext).toBe(false)
  })
})

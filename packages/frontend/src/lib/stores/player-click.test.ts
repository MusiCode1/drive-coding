/**
 * player-click.test.ts — Phase 8 TDD
 *
 * Tests for bubble click-to-play:
 *   - jumpToBubble(messageId): finds first segmentId of bubble, calls jumpToSegment
 *   - visual state derived: isPlayingBubble(messageId) = currentSegmentId belongs to bubble
 *   - switching bubbles stops current + starts new
 */
import { describe, expect, it } from "vitest"
import { createPlayerStore } from "./player.svelte"

describe("createPlayerStore — bubble click-to-play (Phase 8)", () => {
  // ── Helper: store with playlist built from "bubbles" ──────────────────────
  function makeStoreWithBubbles() {
    const store = createPlayerStore()
    // Simulate: bubble "msg-1" has segments s1, s2
    store.addSegment("s1", "message", "msg-1")
    store.addSegment("s2", "message", "msg-1")
    // Bubble "msg-2" has segments s3, s4
    store.addSegment("s3", "thought", "msg-2")
    store.addSegment("s4", "thought", "msg-2")
    // User bubble "user-1" has segment s5
    store.addSegment("s5", "message", "user-1")
    return store
  }

  // ── 1: jumpToBubble jumps to first segment of the bubble ──────────────────
  it("jumpToBubble jumps to the first segment of a given messageId", () => {
    const store = makeStoreWithBubbles()
    const result = store.jumpToBubble("msg-2")
    expect(result?.segmentId).toBe("s3")
    expect(store.currentIndex).toBe(2) // s3 is at index 2
  })

  // ── 2: jumpToBubble returns null for unknown messageId ────────────────────
  it("jumpToBubble returns null for unknown messageId", () => {
    const store = makeStoreWithBubbles()
    const result = store.jumpToBubble("not-a-bubble")
    expect(result).toBeNull()
  })

  // ── 3: isPlayingBubble returns true when current segment belongs to bubble ─
  it("isPlayingBubble returns true when currently playing a segment from that bubble", () => {
    const store = makeStoreWithBubbles()
    store.jumpToBubble("msg-1")
    expect(store.isPlayingBubble("msg-1")).toBe(true)
    expect(store.isPlayingBubble("msg-2")).toBe(false)
  })

  // ── 4: switching bubbles updates currentIndex ─────────────────────────────
  it("jumping to a different bubble updates currentIndex correctly", () => {
    const store = makeStoreWithBubbles()
    store.jumpToBubble("msg-1")
    expect(store.currentItem?.segmentId).toBe("s1")
    store.jumpToBubble("msg-2")
    expect(store.currentItem?.segmentId).toBe("s3")
  })

  // ── 5: addSegment with messageId stores correctly ─────────────────────────
  it("addSegment with messageId stores messageId on playlist item", () => {
    const store = createPlayerStore()
    store.addSegment("s1", "message", "bubble-1")
    expect(store.playlist[0]?.messageId).toBe("bubble-1")
  })
})

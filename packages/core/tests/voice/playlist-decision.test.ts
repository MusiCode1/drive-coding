/**
 * playlist-decision.test.ts — TDD tests for decidePlaylistAction + applyNavigation.
 *
 * Exhaustive coverage of all 9 decision rules and navigation edge cases.
 * No IO, no mocks, pure function tests.
 */

import { describe, expect, it } from "vitest"
import {
  decidePlaylistAction,
  applyNavigation,
  type PlaylistSnapshot,
  type SegmentFacts,
} from "../../src/voice/playlist-decision"

// ─── helpers ──────────────────────────────────────────────────────────────────

function seg(
  id: string,
  overrides: Partial<SegmentFacts> = {},
): SegmentFacts {
  return {
    segmentId: id,
    fetch: "idle",
    playable: false,
    buffered: false,
    playedToEnd: false,
    waitedTooLong: false,
    ...overrides,
  }
}

function snap(
  items: SegmentFacts[],
  cursor: number,
  overrides: Partial<Pick<PlaylistSnapshot, "transport" | "explicitVisit">> = {},
): PlaylistSnapshot {
  return {
    items,
    cursor,
    transport: "playing",
    explicitVisit: false,
    ...overrides,
  }
}

// ─── decidePlaylistAction — 9 rules ──────────────────────────────────────────

describe("decidePlaylistAction", () => {
  // Rule 1: transport=stopped → exit
  it("rule 1: transport=stopped → exit", () => {
    const s = snap([seg("a")], 0, { transport: "stopped" })
    expect(decidePlaylistAction(s)).toEqual({ kind: "exit" })
  })

  it("rule 1: stopped overrides paused", () => {
    const s = snap([seg("a")], 0, { transport: "stopped" })
    expect(decidePlaylistAction(s)).toEqual({ kind: "exit" })
  })

  // Rule 2: transport=paused → wait
  it("rule 2: transport=paused → wait", () => {
    const s = snap([seg("a")], 0, { transport: "paused" })
    expect(decidePlaylistAction(s)).toEqual({ kind: "wait" })
  })

  it("rule 2: paused even when playable", () => {
    const s = snap([seg("a", { playable: true })], 0, { transport: "paused" })
    expect(decidePlaylistAction(s)).toEqual({ kind: "wait" })
  })

  // Rule 3: cursor >= items.length → park
  it("rule 3: cursor === items.length → park", () => {
    const s = snap([seg("a")], 1)
    expect(decidePlaylistAction(s)).toEqual({ kind: "park" })
  })

  it("rule 3: cursor > items.length → park", () => {
    const s = snap([seg("a")], 5)
    expect(decidePlaylistAction(s)).toEqual({ kind: "park" })
  })

  it("rule 3: empty list cursor=0 → park", () => {
    const s = snap([], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "park" })
  })

  // Rule 4: item undefined → skip
  it("rule 4: item at cursor undefined (sparse) → skip", () => {
    // items.length > cursor but items[cursor] is undefined (shouldn't happen normally)
    // simulate via casting
    const items = [seg("a"), undefined as unknown as SegmentFacts, seg("c")]
    const s = snap(items, 1)
    expect(decidePlaylistAction(s)).toEqual({ kind: "skip", index: 1 })
  })

  // Rule 5: playable || buffered → play
  it("rule 5: playable=true → play", () => {
    const s = snap([seg("a", { playable: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  it("rule 5: buffered=true → play", () => {
    const s = snap([seg("a", { buffered: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  it("rule 5: buffered beats failed fetch (rule 5 before rule 7/8)", () => {
    const s = snap([seg("a", { buffered: true, fetch: "failed" })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  it("rule 5: playable beats waitedTooLong (rule 5 before rule 7)", () => {
    const s = snap([seg("a", { playable: true, waitedTooLong: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  it("rule 5: playable=true wins over playedToEnd=true (rule 5 before rule 6)", () => {
    const s = snap([seg("a", { playable: true, playedToEnd: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  it("rule 5: buffered=true + playedToEnd=true → play (replay)", () => {
    const s = snap([seg("a", { buffered: true, playedToEnd: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 0 })
  })

  // Rule 6: playedToEnd && !buffered → skip
  it("rule 6: playedToEnd=true, buffered=false → skip", () => {
    const s = snap([seg("a", { playedToEnd: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "skip", index: 0 })
  })

  it("rule 6: playedToEnd + explicitVisit still skip (navigation handles retry via resetToPending)", () => {
    const s = snap([seg("a", { playedToEnd: true })], 0, { explicitVisit: true })
    // decide still returns skip; applyNavigation.resetToPending handles the retry
    expect(decidePlaylistAction(s)).toEqual({ kind: "skip", index: 0 })
  })

  // Rule 7: fetch=in-flight → wait-fetch / skip-on-timeout
  it("rule 7: fetch=in-flight, waitedTooLong=false → wait-fetch", () => {
    const s = snap([seg("a", { fetch: "in-flight" })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "wait-fetch", index: 0 })
  })

  it("rule 7: fetch=in-flight, waitedTooLong=true → skip", () => {
    const s = snap([seg("a", { fetch: "in-flight", waitedTooLong: true })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "skip", index: 0 })
  })

  // Rule 8: fetch=failed → request-fetch if explicitVisit, else skip
  it("rule 8: fetch=failed, explicitVisit=false → skip", () => {
    const s = snap([seg("a", { fetch: "failed" })], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "skip", index: 0 })
  })

  it("rule 8: fetch=failed, explicitVisit=true → request-fetch", () => {
    const s = snap([seg("a", { fetch: "failed" })], 0, { explicitVisit: true })
    expect(decidePlaylistAction(s)).toEqual({ kind: "request-fetch", index: 0 })
  })

  // Rule 9: fetch=idle (not playable, not buffered, not playedToEnd) → request-fetch
  it("rule 9: fetch=idle, nothing else set → request-fetch", () => {
    const s = snap([seg("a")], 0)
    expect(decidePlaylistAction(s)).toEqual({ kind: "request-fetch", index: 0 })
  })

  it("rule 9: fetch=idle at index 2 → request-fetch index 2", () => {
    const s = snap([seg("a", { buffered: true }), seg("b", { buffered: true }), seg("c")], 2)
    expect(decidePlaylistAction(s)).toEqual({ kind: "request-fetch", index: 2 })
  })

  // Cursor targeting: play/request-fetch/skip return correct index
  it("action index matches cursor position", () => {
    const s = snap([seg("x"), seg("y"), seg("z", { playable: true })], 2)
    expect(decidePlaylistAction(s)).toEqual({ kind: "play", index: 2 })
  })
})

// ─── applyNavigation ──────────────────────────────────────────────────────────

describe("applyNavigation", () => {
  // Out of range → no-op
  it("target < 0 → no-op", () => {
    const s = snap([seg("a"), seg("b")], 0)
    const result = applyNavigation(s, -1, false)
    expect(result.cursor).toBe(0)
    expect(result.cancel).toEqual([])
    expect(result.resetToPending).toEqual([])
  })

  it("target >= items.length → no-op", () => {
    const s = snap([seg("a"), seg("b")], 0)
    const result = applyNavigation(s, 5, true)
    expect(result.cursor).toBe(0)
    expect(result.cancel).toEqual([])
    expect(result.resetToPending).toEqual([])
  })

  // current item: if !buffered → cancel + resetToPending
  it("current item not buffered → cancel + resetToPending", () => {
    const items = [seg("a", { buffered: false }), seg("b")]
    const s = snap(items, 0)
    const result = applyNavigation(s, 1, false)
    expect(result.cursor).toBe(1)
    expect(result.cancel).toContain("a")
    expect(result.resetToPending).toContain("a")
  })

  // current item: buffered → not cancelled, kept
  it("current item buffered → NOT cancelled", () => {
    const items = [seg("a", { buffered: true }), seg("b")]
    const s = snap(items, 0)
    const result = applyNavigation(s, 1, false)
    expect(result.cancel).not.toContain("a")
    expect(result.resetToPending).not.toContain("a")
  })

  // next (resetTarget=false): target not touched
  it("next (resetTarget=false): target in-fetch not cancelled", () => {
    const items = [seg("a"), seg("b", { fetch: "in-flight" })]
    const s = snap(items, 0)
    const result = applyNavigation(s, 1, false) // next
    expect(result.cancel).not.toContain("b")
    expect(result.resetToPending).not.toContain("b")
    expect(result.cursor).toBe(1)
  })

  // prev (resetTarget=true): target buffered → not cancelled (replay)
  it("prev (resetTarget=true): target buffered → NOT cancelled (retain-replay)", () => {
    const items = [seg("a", { buffered: true }), seg("b")]
    const s = snap(items, 1)
    const result = applyNavigation(s, 0, true) // prev
    expect(result.cancel).not.toContain("a")
    expect(result.resetToPending).not.toContain("a")
    expect(result.cursor).toBe(0)
  })

  // prev (resetTarget=true): target not buffered → cancel + resetToPending
  it("prev (resetTarget=true): target not buffered → cancel + resetToPending", () => {
    const items = [seg("a", { buffered: false }), seg("b")]
    const s = snap(items, 1)
    const result = applyNavigation(s, 0, true) // prev
    expect(result.cancel).toContain("a")
    expect(result.resetToPending).toContain("a")
  })

  // self-navigation: target === current
  it("target === current → no-op (cursor unchanged, nothing cancelled)", () => {
    const items = [seg("a"), seg("b")]
    const s = snap(items, 0)
    const result = applyNavigation(s, 0, true)
    expect(result.cursor).toBe(0)
    expect(result.cancel).toEqual([])
    expect(result.resetToPending).toEqual([])
  })

  // cursor is set to target
  it("cursor always set to valid target", () => {
    const items = [seg("a"), seg("b"), seg("c")]
    const s = snap(items, 0)
    const result = applyNavigation(s, 2, true)
    expect(result.cursor).toBe(2)
  })
})

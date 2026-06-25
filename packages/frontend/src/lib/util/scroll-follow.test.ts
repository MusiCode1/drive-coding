/**
 * scroll-follow.test.ts — TDD לפונקציות הטהורות של batched follow.
 *
 * Commit 0: RED phase — כל הטסטים נכתבים לפני הקוד.
 */
import { describe, it, expect } from "vitest"
import {
  computeScrollEdges,
  shouldFollowJump,
  FOLLOW_DISTANCE_LINES,
  FOLLOW_FLOOR_MS,
} from "./scroll-follow"

// ─── computeScrollEdges ───────────────────────────────────────────

describe("computeScrollEdges", () => {
  it("atBottom=true when distance from bottom <= margin", () => {
    const result = computeScrollEdges({
      scrollOffset: 900,
      scrollSize: 1000,
      viewportSize: 100,
      sentinelMargin: 48,
    })
    // distance = 1000 - (900 + 100) = 0 → atBottom
    expect(result.atBottom).toBe(true)
    expect(result.atTop).toBe(false)
  })

  it("atBottom=false when distance from bottom > margin", () => {
    const result = computeScrollEdges({
      scrollOffset: 100,
      scrollSize: 1000,
      viewportSize: 400,
      sentinelMargin: 48,
    })
    // distance = 1000 - (100 + 400) = 500 → not atBottom
    expect(result.atBottom).toBe(false)
  })

  it("atBottom=true when within margin of bottom", () => {
    const result = computeScrollEdges({
      scrollOffset: 900,
      scrollSize: 1000,
      viewportSize: 80,
      sentinelMargin: 48,
    })
    // distance = 1000 - (900 + 80) = 20 <= 48 → atBottom
    expect(result.atBottom).toBe(true)
  })

  it("atTop=true when scrollOffset <= margin", () => {
    const result = computeScrollEdges({
      scrollOffset: 10,
      scrollSize: 1000,
      viewportSize: 400,
      sentinelMargin: 48,
    })
    expect(result.atTop).toBe(true)
  })

  it("atTop=false when scrollOffset > margin", () => {
    const result = computeScrollEdges({
      scrollOffset: 100,
      scrollSize: 1000,
      viewportSize: 400,
      sentinelMargin: 48,
    })
    expect(result.atTop).toBe(false)
  })

  it("short content: both atTop and atBottom when content < viewport", () => {
    const result = computeScrollEdges({
      scrollOffset: 0,
      scrollSize: 200,
      viewportSize: 500,
      sentinelMargin: 48,
    })
    // distance = 200 - (0 + 500) = -300 → atBottom (negative = all content visible)
    expect(result.atTop).toBe(true)
    expect(result.atBottom).toBe(true)
  })

  it("uses default sentinelMargin=48 when not provided", () => {
    const result = computeScrollEdges({
      scrollOffset: 0,
      scrollSize: 100,
      viewportSize: 50,
    })
    // distance = 100 - (0 + 50) = 50 > 48 → not atBottom
    expect(result.atBottom).toBe(false)
  })

  it("custom sentinelMargin overrides default", () => {
    const result = computeScrollEdges({
      scrollOffset: 0,
      scrollSize: 100,
      viewportSize: 50,
      sentinelMargin: 60,
    })
    // distance = 50 <= 60 → atBottom
    expect(result.atBottom).toBe(true)
  })
})

// ─── shouldFollowJump ────────────────────────────────────────────

describe("shouldFollowJump", () => {
  const LINE_HEIGHT = 24
  const NOW = 10_000
  const LAST_JUMP_FAR_PAST = 0 // floor בהחלט עבר

  it("false when following=false (in hold)", () => {
    const result = shouldFollowJump({
      following: false,
      distanceBelow: LINE_HEIGHT * 5, // מרחק גדול
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: LAST_JUMP_FAR_PAST,
    })
    expect(result).toBe(false)
  })

  it("false when distance < 3 lines", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 2, // פחות מ-3 שורות
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: LAST_JUMP_FAR_PAST,
    })
    expect(result).toBe(false)
  })

  it("false when distance exactly at 3 lines but floor NOT passed", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 3, // בדיוק 3 שורות
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: NOW - 100, // רק 100ms עברו, פחות מ-300ms
    })
    expect(result).toBe(false)
  })

  it("false when floor not passed — even if distance is huge", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 100,
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: NOW - 200, // עדיין בתוך floor 300ms
    })
    expect(result).toBe(false)
  })

  it("true when all three conditions met: following + distance>=3 lines + floor passed", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 4,
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: LAST_JUMP_FAR_PAST,
    })
    expect(result).toBe(true)
  })

  it("true at exactly distance=3*lineHeight and floor passed", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * FOLLOW_DISTANCE_LINES, // exactly 3
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: NOW - FOLLOW_FLOOR_MS, // exactly 300ms
    })
    expect(result).toBe(true)
  })

  it("uses custom distanceLines override", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 2, // 2 שורות
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: LAST_JUMP_FAR_PAST,
      distanceLines: 2, // override ל-2 שורות
    })
    expect(result).toBe(true)
  })

  it("uses custom floorMs override", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 4,
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: NOW - 100, // רק 100ms עברו
      floorMs: 50, // floor קצר יותר
    })
    expect(result).toBe(true)
  })

  it("edge: huge block + floor passed → true (one jump, full bottom)", () => {
    const result = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * 500, // tool result ענק
      lineHeight: LINE_HEIGHT,
      now: NOW,
      lastJumpAt: LAST_JUMP_FAR_PAST,
    })
    expect(result).toBe(true)
  })

  it("constants: FOLLOW_DISTANCE_LINES=3 and FOLLOW_FLOOR_MS=300", () => {
    expect(FOLLOW_DISTANCE_LINES).toBe(3)
    expect(FOLLOW_FLOOR_MS).toBe(300)
  })
})

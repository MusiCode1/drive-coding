/**
 * live-transcript-scroll-config.test.ts — DoD 7+8 (slice live-transcript-box §6).
 */
import { describe, expect, it } from "vitest"
import {
  LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
  LIVE_TRANSCRIPT_SENTINEL_MARGIN,
} from "$lib/components/chat/live-transcript-scroll-config"
import { computeScrollEdges, shouldFollowJump } from "$lib/util/scroll-follow"

const LINE_HEIGHT = 20

describe("LiveTranscript scroll calibration — DoD 7", () => {
  it("atBottom within LIVE_TRANSCRIPT_SENTINEL_MARGIN", () => {
    const edges = computeScrollEdges({
      scrollOffset: 400,
      scrollSize: 500,
      viewportSize: 92,
      sentinelMargin: LIVE_TRANSCRIPT_SENTINEL_MARGIN,
    })
    // distance = 500 - (400 + 92) = 8 → at bottom
    expect(edges.atBottom).toBe(true)
  })

  it("shouldFollowJump true when lag >= one line and floor passed", () => {
    const ok = shouldFollowJump({
      following: true,
      distanceBelow: LINE_HEIGHT * LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
      lineHeight: LINE_HEIGHT,
      now: 10_000,
      lastJumpAt: 0,
      distanceLines: LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
    })
    expect(ok).toBe(true)
  })
})

describe("LiveTranscript scroll calibration — DoD 8 mutation gate", () => {
  it("shouldFollowJump false when following=false", () => {
    const ok = shouldFollowJump({
      following: false,
      distanceBelow: LINE_HEIGHT * 10,
      lineHeight: LINE_HEIGHT,
      now: 10_000,
      lastJumpAt: 0,
      distanceLines: LIVE_TRANSCRIPT_FOLLOW_DISTANCE_LINES,
    })
    expect(ok).toBe(false)
  })
})

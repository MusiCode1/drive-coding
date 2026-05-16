import { describe, expect, it } from "vitest"
import { deriveScrollState, type ScrollStateInput } from "./smart-scroll"

describe("deriveScrollState", () => {
  const base: ScrollStateInput = {
    scrollHeight: 1000,
    scrollTop: 900,
    clientHeight: 100,
    lastUserInteractionAt: 0,
    nowMs: 1000,
    autoScrollEnabled: true,
    showJumpDown: false,
  }

  it("at bottom (distance=0) → auto=true, jumpDown=false", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 900,
      scrollHeight: 1000,
      clientHeight: 100,
    })
    expect(result.autoScrollEnabled).toBe(true)
    expect(result.showJumpDown).toBe(false)
  })

  it("at bottom with distance=10 still counts as at-bottom", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 890,
      scrollHeight: 1000,
      clientHeight: 100,
    })
    // distance = 1000 - 890 - 100 = 10
    expect(result.autoScrollEnabled).toBe(true)
    expect(result.showJumpDown).toBe(false)
  })

  it("user scrolled up recently within 500ms → disable auto, show jump-down", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 400, // distance = 1000 - 400 - 100 = 500
      lastUserInteractionAt: 800, // 200ms ago
      nowMs: 1000,
      autoScrollEnabled: true,
      showJumpDown: false,
    })
    expect(result.autoScrollEnabled).toBe(false)
    expect(result.showJumpDown).toBe(true)
  })

  it("user scrolled up but interaction was >500ms ago → keep auto", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 400,
      lastUserInteractionAt: 400, // 600ms ago
      nowMs: 1000,
      autoScrollEnabled: true,
      showJumpDown: false,
    })
    expect(result.autoScrollEnabled).toBe(true)
    expect(result.showJumpDown).toBe(false)
  })

  it("auto already disabled + user at bottom → re-enable auto, hide jump-down", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 900,
      autoScrollEnabled: false,
      showJumpDown: true,
    })
    expect(result.autoScrollEnabled).toBe(true)
    expect(result.showJumpDown).toBe(false)
  })

  it("auto disabled + user far from bottom → stays disabled", () => {
    const result = deriveScrollState({
      ...base,
      scrollTop: 400,
      autoScrollEnabled: false,
      showJumpDown: true,
      lastUserInteractionAt: 400,
      nowMs: 1000,
    })
    expect(result.autoScrollEnabled).toBe(false)
    expect(result.showJumpDown).toBe(true)
  })

  it("programmatic content addition (no user interaction) does not disable auto-scroll", () => {
    // distance > 10 but no recent user interaction
    const result = deriveScrollState({
      ...base,
      scrollTop: 400,
      lastUserInteractionAt: 0, // never
      nowMs: 9999,
      autoScrollEnabled: true,
      showJumpDown: false,
    })
    // No user interaction within 500ms → auto stays on
    expect(result.autoScrollEnabled).toBe(true)
    expect(result.showJumpDown).toBe(false)
  })
})

/**
 * sidebar-width.test.ts — clamp + direction gates (slice sidebar-resize).
 */
import { describe, expect, it } from "vitest"
import {
  clampSidebarWidth,
  DEFAULT_SIDEBAR_WIDTH_REM,
  nextSidebarWidth,
} from "./sidebar-width"

describe("clampSidebarWidth", () => {
  it("clamps below MIN_REM", () => {
    expect(clampSidebarWidth(13)).toBe(14)
  })

  it("clamps above MAX_REM", () => {
    expect(clampSidebarWidth(40)).toBe(32)
  })

  it("passes through in-range values", () => {
    expect(clampSidebarWidth(20)).toBe(20)
  })

  it("returns default for NaN", () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH_REM)
  })
})

describe("nextSidebarWidth", () => {
  const rootPx = 16

  it("ltr: +deltaPx widens", () => {
    expect(nextSidebarWidth(20, 40, "ltr", rootPx)).toBeGreaterThan(20)
  })

  it("rtl: +deltaPx narrows", () => {
    expect(nextSidebarWidth(20, 40, "rtl", rootPx)).toBeLessThan(20)
  })

  it("clamps overflow from large delta", () => {
    expect(nextSidebarWidth(20, 10_000, "ltr", rootPx)).toBe(32)
    expect(nextSidebarWidth(20, -10_000, "rtl", rootPx)).toBe(32)
  })

  it("does not leak NaN from bad inputs", () => {
    expect(Number.isFinite(nextSidebarWidth(Number.NaN, 40, "ltr", rootPx))).toBe(true)
    expect(Number.isFinite(nextSidebarWidth(20, Number.NaN, "ltr", rootPx))).toBe(true)
  })
})

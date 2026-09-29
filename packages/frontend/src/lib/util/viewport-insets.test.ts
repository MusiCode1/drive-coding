/**
 * viewport-insets.test.ts - the two bits of arithmetic that keep the UI reachable on a phone.
 *
 * ─── slice mobile-parity ───
 */
import { describe, expect, it } from "vitest"
import { occludedPx, PEEK_BASE_PX, peekHeight } from "./viewport-insets"

// ─── peekHeight - the BottomSheet handle must clear the home indicator ─────────

describe("peekHeight", () => {
  it("is just the handle when there is no cutout (desktop, phones without one)", () => {
    expect(peekHeight(0)).toBe(PEEK_BASE_PX)
  })

  it("clears an iPhone-class home indicator", () => {
    const viewportH = 844
    const inset = 34
    const handleTop = viewportH - peekHeight(inset)
    const handleBottom = handleTop + 26 // py-2.5 (10+10) + the 6px bar
    expect(handleBottom).toBeLessThanOrEqual(viewportH - inset)
  })

  it("regression: a flat 28px put the whole handle inside the inset", () => {
    // This is the defect. Kept as a test so the constant cannot quietly go back.
    const viewportH = 844
    const safeEdge = viewportH - 34
    expect(viewportH - PEEK_BASE_PX).toBeGreaterThan(safeEdge) // was: in the gesture strip
    expect(viewportH - peekHeight(34)).toBeLessThan(safeEdge) // now: above it
  })

  it("ignores a negative inset rather than shrinking the handle", () => {
    expect(peekHeight(-20)).toBe(PEEK_BASE_PX)
  })

  it("grows monotonically with the inset", () => {
    expect(peekHeight(21)).toBeLessThan(peekHeight(34))
    expect(peekHeight(34)).toBeLessThan(peekHeight(48))
  })
})

// ─── occludedPx - how much the on-screen keyboard covers ──────────────────────

describe("occludedPx", () => {
  it("is 0 when nothing occludes the viewport", () => {
    expect(occludedPx(844, 844, 0)).toBe(0)
  })

  it("reports an open keyboard (Android: the visual viewport shrinks)", () => {
    expect(occludedPx(844, 508, 0)).toBe(336)
  })

  it("counts offsetTop - iOS shifts the viewport instead of shrinking it", () => {
    expect(occludedPx(844, 508, 40)).toBe(296)
    expect(occludedPx(844, 508, 40)).toBeLessThan(occludedPx(844, 508, 0))
  })

  it("ignores browser chrome collapsing - dvh already handles that", () => {
    expect(occludedPx(844, 784, 0)).toBe(0) // ~60px toolbar, below the noise floor
  })

  it("clamps over-scroll rubber-banding to 0", () => {
    expect(occludedPx(844, 900, 0)).toBe(0)
  })

  it("never returns a negative or non-finite inset", () => {
    expect(occludedPx(844, Number.NaN, 0)).toBe(0)
    expect(occludedPx(Number.NaN, 508, 0)).toBe(0)
    expect(occludedPx(844, Number.POSITIVE_INFINITY, 0)).toBe(0)
  })

  it("rounds to whole pixels - fractional viewports are common on Android", () => {
    expect(occludedPx(844, 507.6, 0)).toBe(336)
    expect(Number.isInteger(occludedPx(844, 507.6, 0))).toBe(true)
  })
})

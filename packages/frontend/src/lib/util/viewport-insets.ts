/**
 * viewport-insets - pure arithmetic + measurement for the two insets a phone imposes:
 * the display cutout (notch / home indicator) and the on-screen keyboard.
 *
 * Kept out of the view-model so the arithmetic is testable without a layout engine or a
 * real keyboard. ResponsiveVM owns the listeners; this file owns the maths.
 *
 * ─── slice mobile-parity ───
 */

/** Height of the BottomSheet grab handle - the `peek` detent before any inset. */
export const PEEK_BASE_PX = 28

/** Below this, a visual-viewport change is browser chrome or rubber-banding, not a keyboard. */
export const KB_NOISE_PX = 80

/**
 * Visible height of the BottomSheet's `peek` detent.
 *
 * The handle is the only way into SessionOptionsPanel on mobile (AppShell renders the
 * Sidebar for desktop and the BottomSheet for mobile), so it has to sit *above* the home
 * indicator rather than inside it - otherwise the OS gesture strip swallows the drag and
 * the panel is unreachable on a phone.
 */
export function peekHeight(safeBottomPx: number): number {
  return PEEK_BASE_PX + Math.max(0, safeBottomPx)
}

/** BottomSheet stop points, as visible height in px measured from the bottom edge. */
export type SheetDetentName = "peek" | "half" | "full"

/**
 * Visible height of one detent. Pure, so the snapping can be tested without a DOM.
 * `full` is the sheet's own height; `half` is 45vh capped by it; `peek` is the handle
 * plus the cutout inset.
 */
export function detentHeight(
  detent: SheetDetentName,
  winH: number,
  sheetPx: number,
  safeBottomPx: number,
): number {
  if (detent === "peek") return peekHeight(safeBottomPx)
  if (detent === "half") return Math.min(winH * 0.45, sheetPx)
  return sheetPx
}

/**
 * How much of the layout viewport the on-screen keyboard covers.
 *
 * `offsetTop` matters: iOS scrolls the layout viewport up behind the keyboard instead of
 * shrinking it, so `height` alone under-reports the occlusion.
 * Returns 0 for anything below the noise floor, for over-scroll (visual viewport taller
 * than layout), and for non-finite input.
 */
export function occludedPx(
  layoutHeight: number,
  visualHeight: number,
  visualOffsetTop: number,
): number {
  const raw = layoutHeight - (visualHeight + visualOffsetTop)
  if (!Number.isFinite(raw) || raw < KB_NOISE_PX) return 0
  return Math.round(raw)
}

/**
 * Measures `env(safe-area-inset-bottom)` in CSS pixels.
 *
 * `getComputedStyle(...).getPropertyValue("--safe-b")` does NOT work: a custom property's
 * computed value is the unresolved token (`env(safe-area-inset-bottom, 0px)`), not a
 * length. So spend the inset on a real property in a throwaway probe and measure that.
 * Returns 0 during SSR, on desktop, and on any browser without cutout insets.
 */
export function readSafeBottomPx(): number {
  if (typeof document === "undefined") return 0
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;inset-block-end:0;inline-size:0;block-size:env(safe-area-inset-bottom, 0px);visibility:hidden;pointer-events:none"
  document.body.appendChild(probe)
  const px = Number.parseFloat(getComputedStyle(probe).blockSize)
  probe.remove()
  return Number.isFinite(px) ? px : 0
}

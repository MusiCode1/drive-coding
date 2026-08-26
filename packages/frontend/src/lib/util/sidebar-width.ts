/**
 * sidebar-width.ts — clamp + direction-aware width math for the desktop sidebar.
 *
 * ─── slice sidebar-resize ───
 */

export const MIN_REM = 14
export const MAX_REM = 32
export const DEFAULT_SIDEBAR_WIDTH_REM = 18

/** Clamp sidebar width in rem; non-finite values fall back to default. */
export function clampSidebarWidth(rem: number): number {
  if (!Number.isFinite(rem)) return DEFAULT_SIDEBAR_WIDTH_REM
  return Math.max(MIN_REM, Math.min(MAX_REM, rem))
}

/** Resize sign: LTR expands on +deltaX, RTL expands on -deltaX. */
export function sidebarResizeSign(dir: "ltr" | "rtl"): number {
  return dir === "ltr" ? 1 : -1
}

/**
 * Next sidebar width (rem) after a horizontal pointer delta.
 * `deltaPx` is raw clientX movement (+ = moved right).
 */
export function nextSidebarWidth(
  startRem: number,
  deltaPx: number,
  dir: "ltr" | "rtl",
  rootFontSizePx: number,
): number {
  if (!Number.isFinite(startRem) || !Number.isFinite(deltaPx) || !Number.isFinite(rootFontSizePx)) {
    return clampSidebarWidth(startRem)
  }
  const fontPx = rootFontSizePx > 0 ? rootFontSizePx : 16
  const deltaRem = (deltaPx * sidebarResizeSign(dir)) / fontPx
  return clampSidebarWidth(startRem + deltaRem)
}

export function remToPx(rem: number, rootFontSizePx: number): number {
  const fontPx = rootFontSizePx > 0 ? rootFontSizePx : 16
  return rem * fontPx
}

export function pxToRem(px: number, rootFontSizePx: number): number {
  const fontPx = rootFontSizePx > 0 ? rootFontSizePx : 16
  return px / fontPx
}

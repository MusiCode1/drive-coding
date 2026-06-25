/**
 * scroll-follow.ts — פונקציות טהורות לבקרת batched follow.
 *
 * Commit 0 (TDD): פונקציות גאומטריה וקבלת-החלטה בלבד.
 * אין IO, אין DOM, אין Svelte — טהורות לחלוטין.
 *
 * ─── slice chat-virtualization ───
 */

/** תוצאת בדיקת קצוות scroll */
export type ScrollEdges = { atTop: boolean; atBottom: boolean }

/**
 * computeScrollEdges — טהורה: גאומטריה בלבד.
 * sentinelMargin px מהקצה = "בקצה".
 *
 * isAtBottom: scrollSize - (scrollOffset + viewportSize) <= margin
 * isAtTop:    scrollOffset <= margin
 */
export function computeScrollEdges(input: {
  scrollOffset: number   // handle.getScrollOffset()
  scrollSize: number     // handle.getScrollSize()
  viewportSize: number   // handle.getViewportSize()
  sentinelMargin?: number // default 48
}): ScrollEdges {
  const margin = input.sentinelMargin ?? 48
  const distanceBelow = input.scrollSize - (input.scrollOffset + input.viewportSize)
  return {
    atTop: input.scrollOffset <= margin,
    atBottom: distanceBelow <= margin,
  }
}

/** מינימום מרחק (ביחידות line-height) שמפעיל קפיצה */
export const FOLLOW_DISTANCE_LINES = 3

/** מינימום זמן (ms) בין קפיצות — מאחד פרצים מהירים לקפיצה אחת */
export const FOLLOW_FLOOR_MS = 300

/**
 * shouldFollowJump — טהורה: ההחלטה ה-batched.
 * "האם מותר לקפוץ לתחתית עכשיו?"
 *
 * = following && distanceBelow >= (distanceLines??3)*lineHeight && (now-lastJumpAt) >= (floorMs??300)
 */
export function shouldFollowJump(input: {
  following: boolean        // דגל follow פעיל (לא ב-hold)
  distanceBelow: number     // px: scrollSize - (scrollOffset + viewportSize)
  lineHeight: number        // px (computed line-height של אזור התוכן)
  now: number               // performance.now()/Date.now()
  lastJumpAt: number        // timestamp הקפיצה התוכניתית הקודמת
  distanceLines?: number    // default FOLLOW_DISTANCE_LINES (3)
  floorMs?: number          // default FOLLOW_FLOOR_MS (300)
}): boolean {
  if (!input.following) return false

  const threshold = (input.distanceLines ?? FOLLOW_DISTANCE_LINES) * input.lineHeight
  if (input.distanceBelow < threshold) return false

  const floor = input.floorMs ?? FOLLOW_FLOOR_MS
  if (input.now - input.lastJumpAt < floor) return false

  return true
}

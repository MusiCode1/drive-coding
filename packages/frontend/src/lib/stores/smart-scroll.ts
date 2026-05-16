/**
 * smart-scroll.ts — Slice 7 Drive-First UX
 *
 * deriveScrollState: pure function — given scroll position + interaction
 * timestamps, returns new autoScrollEnabled + showJumpDown state.
 *
 * Ported from v1 index.html:558-594, adapted as a testable pure function.
 */

export interface ScrollStateInput {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  lastUserInteractionAt: number // epoch ms (0 = never)
  nowMs: number
  autoScrollEnabled: boolean
  showJumpDown: boolean
}

export interface ScrollStateOutput {
  autoScrollEnabled: boolean
  showJumpDown: boolean
}

/**
 * Compute new scroll state given current scroll position and user interaction timing.
 *
 * Rules:
 * - distance ≤ 10px from bottom → always re-enable auto + hide jump-down
 * - distance > 10px AND recent user interaction (<500ms) AND auto was on → disable auto + show jump-down
 * - distance > 10px AND no recent user interaction → keep current state unchanged
 */
export function deriveScrollState(input: ScrollStateInput): ScrollStateOutput {
  const {
    scrollHeight,
    scrollTop,
    clientHeight,
    lastUserInteractionAt,
    nowMs,
    autoScrollEnabled,
    showJumpDown,
  } = input

  const distance = scrollHeight - scrollTop - clientHeight
  const isRecentUserScroll = nowMs - lastUserInteractionAt < 500

  if (distance <= 10) {
    // Reached bottom — always re-enable auto scroll
    return { autoScrollEnabled: true, showJumpDown: false }
  }

  if (isRecentUserScroll && autoScrollEnabled) {
    // User deliberately scrolled up while auto was on — disable auto
    return { autoScrollEnabled: false, showJumpDown: true }
  }

  // No change — content was added programmatically or auto already off
  return { autoScrollEnabled, showJumpDown }
}

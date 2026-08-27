/**
 * echo-gate.ts — pure echo gate for Live mic frame forwarding.
 *
 * Consumer: live-secretary (slice 4). Pure function — TDD here, wired there.
 *
 * Slice: live-ears, Commit 2.
 */

export const OUTPUT_ACTIVE_LEVEL = 0.015
export const MIN_BARGE_IN_LEVEL = 0.04
export const OUTPUT_ECHO_RATIO = 0.65

/** Whether a mic frame should be forwarded to the Live session. */
export function shouldForwardFrame(inputLevel: number, outputLevel: number): boolean {
  const outputActive = outputLevel > OUTPUT_ACTIVE_LEVEL
  const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, outputLevel * OUTPUT_ECHO_RATIO)
  if (outputActive && inputLevel < echoThreshold) return false
  return true
}

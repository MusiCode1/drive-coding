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
/**
 * ⚠️ NO CONSUMER, ON PURPOSE — measured 2026-08-27.
 *
 * These constants come from `omp`, which runs in a terminal with no WebRTC
 * stack and therefore had to gate echo by hand. In a browser, `getUserMedia`
 * enables `echoCancellation` by default, and a live preview on a real device
 * confirmed it: the secretary's own speech never came back as input transcript.
 *
 * Wiring this in would not merely be redundant — it would be HARMFUL. A gate
 * that drops microphone frames while output is active suppresses exactly the
 * legitimate barge-in it exists to permit, paying in functionality to attenuate
 * a signal the platform already attenuated.
 *
 * Kept because the evidence is negative ("I did not see it") rather than
 * positive, and because the deployment target is a phone speaker in a car —
 * loud, reverberant, microphone close to the speaker. If echo shows up there,
 * this is ready. A native build without a WebRTC stack would need it too.
 */
export function shouldForwardFrame(inputLevel: number, outputLevel: number): boolean {
  const outputActive = outputLevel > OUTPUT_ACTIVE_LEVEL
  const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, outputLevel * OUTPUT_ECHO_RATIO)
  if (outputActive && inputLevel < echoThreshold) return false
  return true
}

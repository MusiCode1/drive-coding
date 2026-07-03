/**
 * probe-status.ts — pure logic for interpreting TTS provider probe HTTP status.
 *
 * Slice: tts-provider-availability, Commit 0.
 *
 * Maps an upstream HTTP status (or null on network/timeout error) to availability.
 * Pure function — no IO, no side effects. TDD.
 */

export type ProbeReason = "ok" | "no-key" | "forbidden" | "quota" | "error"
export type ProbeResult = { available: boolean; reason: ProbeReason }

/**
 * Maps an upstream HTTP status (or null on network/timeout error) to availability.
 *
 * 200-299 → {true,  "ok"}
 * 401     → {false, "no-key"}
 * 403     → {false, "forbidden"}
 * 429     → {false, "quota"}
 * null    → {false, "error"}  (network error / timeout)
 * other   → {false, "error"}  (any other 4xx/5xx)
 */
export function interpretProbeStatus(status: number | null): ProbeResult {
  if (status === null) {
    return { available: false, reason: "error" }
  }
  if (status >= 200 && status <= 299) {
    return { available: true, reason: "ok" }
  }
  if (status === 401) {
    return { available: false, reason: "no-key" }
  }
  if (status === 403) {
    return { available: false, reason: "forbidden" }
  }
  if (status === 429) {
    return { available: false, reason: "quota" }
  }
  return { available: false, reason: "error" }
}

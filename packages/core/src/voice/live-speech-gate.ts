/**
 * live-speech-gate.ts — pure speech gate with hangover and prefix-flush signal.
 *
 * Slice: live-silence-cost, Commit 0.
 * Prefix ring buffer lives in the FE; this module only decides send/flush per frame.
 */

export const LIVE_SPEECH_HANGOVER_FRAMES = 8 // ~640ms @ 80ms

export type SpeechGateDecision = { sendCurrent: boolean; flushPrefix: boolean }

type GateState = "idle" | "sending" | "hangover"

export function createSpeechGate(opts?: { hangoverFrames?: number }): {
  step(speaking: boolean): SpeechGateDecision
  reset(): void
} {
  const hangoverFrames = opts?.hangoverFrames ?? LIVE_SPEECH_HANGOVER_FRAMES
  let state: GateState = "idle"
  let hangoverRemaining = 0

  return {
    step(speaking: boolean): SpeechGateDecision {
      if (speaking) {
        const wasIdle = state === "idle"
        state = "sending"
        hangoverRemaining = 0
        return { sendCurrent: true, flushPrefix: wasIdle }
      }

      if (state === "sending") {
        hangoverRemaining = hangoverFrames - 1
        state = hangoverRemaining > 0 ? "hangover" : "idle"
        return { sendCurrent: true, flushPrefix: false }
      }

      if (state === "hangover" && hangoverRemaining > 0) {
        hangoverRemaining--
        if (hangoverRemaining === 0) state = "idle"
        return { sendCurrent: true, flushPrefix: false }
      }

      state = "idle"
      return { sendCurrent: false, flushPrefix: false }
    },

    reset(): void {
      state = "idle"
      hangoverRemaining = 0
    },
  }
}

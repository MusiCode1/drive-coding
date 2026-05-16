/**
 * cues.ts — Slice 7 Drive-First UX
 *
 * 5 Web Audio API synthesized event cues (D42).
 * No mp3 files needed — tones are generated programmatically.
 *
 * Reference: v1 index.html:1883-1898 (startup chime)
 * Spec: §9.6 "TTS-first feedback — כל מצב חשוב גם נשמע"
 *
 * AudioContext requires a user gesture to start. The context is created
 * lazily on first call — guaranteed to be within a click handler chain.
 */

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  // SSR / no browser support guard
  if (typeof window === "undefined") return null
  if (
    typeof AudioContext === "undefined" &&
    typeof (window as { webkitAudioContext?: unknown }).webkitAudioContext === "undefined"
  ) {
    return null
  }

  if (!audioCtx) {
    const Ctor =
      (
        window as unknown as {
          AudioContext?: typeof AudioContext
          webkitAudioContext?: typeof AudioContext
        }
      ).AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    audioCtx = new Ctor()
  }

  if (audioCtx.state === "suspended") {
    // Best-effort resume — may fail if called outside user gesture
    audioCtx.resume().catch(() => {})
  }

  return audioCtx
}

/**
 * Play a sequence of tones.
 * @param freqs     - Array of frequencies (Hz). Each plays for duration/freqs.length seconds.
 * @param duration  - Total duration in seconds.
 * @param gain      - Peak gain (0–1). Default 0.18.
 */
function tone(freqs: number[], duration: number, gain: number = 0.18): void {
  const ctx = getCtx()
  if (!ctx) return

  try {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = "sine"

    const t = ctx.currentTime
    const segLen = duration / freqs.length

    for (let i = 0; i < freqs.length; i++) {
      const f = freqs[i]
      if (f !== undefined) osc.frequency.setValueAtTime(f, t + segLen * i)
    }

    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + 0.02)
    g.gain.linearRampToValueAtTime(0, t + duration)

    osc.connect(g).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + duration + 0.05)
  } catch {
    // Swallow — audio is non-critical
  }
}

/**
 * The 5 D42 audio cues, mapped to voice pipeline events.
 *
 * | Event           | Freq(s)    | Duration | Notes            |
 * |-----------------|------------|----------|------------------|
 * | recordingStart  | 880 Hz     | 0.12s    | single A5 short  |
 * | recordingStop   | 660 Hz     | 0.12s    | single E5 short  |
 * | thinking        | 523→659 Hz | 0.30s    | C5→E5 rising     |
 * | speaking        | 659→523 Hz | 0.30s    | E5→C5 falling    |
 * | error           | 330→220 Hz | 0.40s    | E4→A3 low warn   |
 */
export const cues = {
  recordingStart: (): void => tone([880], 0.12, 0.2),
  recordingStop: (): void => tone([660], 0.12, 0.2),
  thinking: (): void => tone([523, 659], 0.3, 0.15),
  speaking: (): void => tone([659, 523], 0.3, 0.15),
  error: (): void => tone([330, 220], 0.4, 0.25),
}

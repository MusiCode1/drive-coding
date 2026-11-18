/**
 * CuesEngine — synthesises short audio cues via Web Audio API.
 *
 * 5 cue types per frontend-spec §10. AudioContext is created lazily on
 * the first play() call (browsers require user gesture before creation).
 * Once created, the context stays alive — subsequent plays reuse it.
 *
 * זה engine (engines/), לא VM: owner של AudioContext, ללא $state.
 * זרימת import חוקית: VM → engine.
 *
 * slice 6: owner-driven audio cues.
 * slice nicer-submit-cue: "thinking" is the sound of submitting a prompt, so
 * it is a plucked two-note figure rather than a sine glide.
 */

export type CueId =
  | "recordingStart"
  | "recordingStop"
  | "thinking"
  | "speaking"
  | "error"

export class CuesEngine {
  /** Toggle all cues. slice 9 will bind this to Settings. */
  enabled: boolean = true

  #ctx: AudioContext | null = null

  /**
   * Play a cue. No-op if enabled=false or if AudioContext cannot be created
   * (SSR / browser blocked). Never throws.
   */
  play(cue: CueId): void {
    if (!this.enabled) return
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (typeof globalThis.AudioContext === "undefined") return // SSR / no Web Audio
    if (this.#ctx === null) {
      try {
        this.#ctx = new AudioContext()
      } catch {
        return // browser blocked creation
      }
    }
    if (this.#ctx.state === "suspended") void this.#ctx.resume()

    switch (cue) {
      case "recordingStart":
        this.#playGlide(880, 880, 120) // A5
        break
      case "recordingStop":
        this.#playGlide(660, 660, 120) // E5
        break
      case "thinking":
        this.#playPluck(523.25, 0) // C5 then G5: a rising fifth, ~290ms total
        this.#playPluck(783.99, 0.07)
        break
      case "speaking":
        this.#playGlide(659, 523, 300) // E5 → C5 (falling)
        break
      case "error":
        this.#playGlide(329, 220, 400) // E4 → A3 (alarming drop)
        break
    }
  }

  /** Cleanup. Called in layout's destroy (optional). */
  async close(): Promise<void> {
    if (this.#ctx !== null) {
      await this.#ctx.close()
      this.#ctx = null
    }
  }

  // ─── private helpers ─────────────────────────────────────────────────────

  /**
   * One plucked note. The decay is exponential because that is what a struck
   * thing does; the linear ramp below is exactly what makes a cue sound
   * synthetic. Never ramps to 0, which exponentialRampToValueAtTime rejects.
   */
  #playPluck(freq: number, delay: number): void {
    const ctx = this.#ctx
    if (ctx === null) return
    const t = ctx.currentTime + delay
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = freq
    osc.type = "sine"
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.18, t + 0.006) // fast attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22) // natural tail
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.25)
  }

  /** Sustained tone, optionally sliding. fromFreq === toFreq is a flat tone. */
  #playGlide(fromFreq: number, toFreq: number, ms: number): void {
    const ctx = this.#ctx
    if (ctx === null) return
    const t = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.setValueAtTime(fromFreq, t)
    osc.frequency.linearRampToValueAtTime(toFreq, t + ms / 1000)
    osc.type = "sine"
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.2, t + 0.005)
    gain.gain.linearRampToValueAtTime(0, t + ms / 1000)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + ms / 1000 + 0.05)
  }
}

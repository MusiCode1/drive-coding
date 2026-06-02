/**
 * WakeWordVM — view-model לתשתית wake-word.
 *
 * מחזיק WakeWordEngine + WakeWordCapture.
 * מגשר בין events של ה-engine ל-$state reactive.
 *
 * הערה: VM זה נוצר ב-route הבדיקה /wake-word-test ישירות (לא דרך +layout.svelte),
 * כי הוא route standalone שאינו חלק מה-app shell. חריג מכוון מחוק זהב #1.
 */

import { WakeWordEngine } from "../engines/wake-word/wake-word-engine.js"
import { WakeWordCapture } from "../engines/wake-word/capture.js"
import type { WakeWordConfig } from "../engines/wake-word/types.js"

export type WakeWordMode = "off" | "listening" | "recording"

export class WakeWordVM {
  mode: WakeWordMode = $state("off")
  level = $state(0)       // RMS גולמי (החלקה ב-VoiceOrb component)
  flashCount = $state(0)  // מוגדל בכל detect → component מפעיל אנימציה
  lastError: string | null = $state(null)

  readonly #engine: WakeWordEngine
  readonly #capture: WakeWordCapture
  #cueCtx: AudioContext | null = null

  constructor(config: WakeWordConfig) {
    this.#engine = new WakeWordEngine(config)
    this.#capture = new WakeWordCapture()
    this.#setupListeners()

    // $effect: mode → engine.start/stop (חוק זהב #4)
    $effect(() => {
      const mode = this.mode
      if (mode === "listening" || mode === "recording") {
        this.#engine.start().catch((err: unknown) => {
          this.lastError =
            err instanceof Error ? err.message : String(err)
          this.mode = "off"
        })
      } else {
        this.#engine.stop().catch(() => {})
      }
    })
  }

  /** טוען מודלים. לקרוא פעם אחת לפני toggle(). */
  async load(): Promise<void> {
    try {
      await this.#engine.load()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      throw err
    }
  }

  /** toggle: off↔listening. */
  toggle(): void {
    if (this.mode === "off") {
      this.lastError = null
      this.mode = "listening"
    } else {
      // עצירה מכל מצב — כולל recording (abort)
      this.#capture.abort()
      this.mode = "off"
    }
  }

  // ─── Cue tones ──────────────────────────────────────────────────────────────

  #getCueCtx(): AudioContext {
    if (!this.#cueCtx) {
      this.#cueCtx = new AudioContext()
    }
    return this.#cueCtx
  }

  #tone(freq: number, durMs: number): void {
    try {
      const ctx = this.#getCueCtx()
      if (ctx.state === "suspended") ctx.resume()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + durMs / 1000,
      )
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + durMs / 1000 + 0.02)
    } catch {
      // cue אופציונלי — לא נגמרים בשגיאה אם AudioContext לא זמין
    }
  }

  // ─── Event listeners ─────────────────────────────────────────────────────────

  #setupListeners(): void {
    this.#engine.on("level", (rms) => {
      this.level = rms
    })

    this.#engine.on("frame", (frame) => {
      this.#capture.pushFrame(frame)
    })

    this.#engine.on("detect", ({ keyword: _kw }) => {
      this.flashCount++

      if (!this.#capture.capturing) {
        // wake #1 → התחל הקלטה
        this.#capture.start()
        this.#tone(880, 160) // cue start (גבוה = "go")
        this.mode = "recording"
      } else {
        // wake #2 → עצור הקלטה
        const result = this.#capture.stop(16)
        this.#tone(440, 220) // cue end (נמוך = "done")
        this.mode = "listening"

        // השמעה אוטומטית ~1s אחרי ה-cue
        if (result?.wavBytes) {
          const blob = new Blob([result.wavBytes.buffer as ArrayBuffer], { type: "audio/wav" })
          const url = URL.createObjectURL(blob)
          setTimeout(() => {
            const audio = new Audio(url)
            audio.play().catch(() => {})
          }, 1000)
        }
      }
    })

    this.#engine.on("error", (err) => {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.mode = "off"
    })
  }
}

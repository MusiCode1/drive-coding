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

export type WakeWordLogEntry = { t: number; text: string; kind: "vad" | "detect" | "cap" }

export class WakeWordVM {
  mode: WakeWordMode = $state("off")
  level = $state(0)       // RMS גולמי (החלקה ב-VoiceOrb component)
  flashCount = $state(0)  // מוגדל בכל detect → component מפעיל אנימציה
  lastError: string | null = $state(null)

  // ─── קלט ──────────────────────────────────────────────────────────
  /** רשימת מכשירי קלט — ממולא על-ידי loadDevices() */
  devices: MediaDeviceInfo[] = $state([])
  /** device ID שנבחר; null = ברירת מחדל */
  selectedDeviceId: string | null = $state(null)
  /** גיין נוכחי (0–3). מוצג ב-UI כ-percentage. */
  gain = $state(1.0)

  // ─── הקלטה ────────────────────────────────────────────────────────
  // ההקלטה הנוכחית בלבד (לא שומרים היסטוריה). url ל-<audio> controls.
  currentClipUrl: string | null = $state(null)
  currentClipLabel = $state("")

  // לוג זרם-אירועים (חלון תצוגה ב-route הבדיקה).
  logs: WakeWordLogEntry[] = $state([])

  readonly #engine: WakeWordEngine
  readonly #capture: WakeWordCapture
  #cueCtx: AudioContext | null = null
  #frameIndex = 0

  constructor(config: WakeWordConfig) {
    this.#engine = new WakeWordEngine(config)
    this.#capture = new WakeWordCapture()
    this.#setupListeners()

    // $effect: mode + selectedDeviceId → engine.start/stop (חוק זהב #4)
    $effect(() => {
      const mode = this.mode
      const deviceId = this.selectedDeviceId  // tracking dep — restart on device change
      if (mode === "listening" || mode === "recording") {
        this.#engine.start(deviceId).catch((err: unknown) => {
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

  /**
   * מאכלס את devices[] מ-enumerateDevices.
   * חובה לקרוא getUserMedia קודם כדי לקבל labels (דרישת דפדפן).
   */
  async loadDevices(): Promise<void> {
    try {
      // בקשת הרשאה קצרה כדי לאפשר labels בתוצאות enumerateDevices
      const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
      tmp.getTracks().forEach((t) => t.stop())
    } catch {
      // אם ה-getUserMedia נכשל — enumerateDevices עדיין יחזיר רשימה חלקית
    }
    const all = await navigator.mediaDevices.enumerateDevices()
    this.devices = all.filter((d) => d.kind === "audioinput")
  }

  /** מגדיר מכשיר קלט. אם רצים — מאפס ומפעיל מחדש. */
  setDevice(id: string | null): void {
    if (id === this.selectedDeviceId) return
    const wasActive = this.mode !== "off"
    if (wasActive) {
      this.#capture.abort()
      this.#engine.stop().catch(() => {})
      this.mode = "off"
    }
    this.selectedDeviceId = id
    if (wasActive) {
      // microtask — נותן ל-$effect להגיב ל-mode="off" לפני שמחזירים
      queueMicrotask(() => {
        this.lastError = null
        this.mode = "listening"
      })
    }
  }

  /** עדכון גיין (0–3). */
  setGain(v: number): void {
    this.gain = v
    this.#engine.setGain(v)
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

  /** מוסיף שורה ללוג (תצוגה ב-route). שומר חלון אחרון בלבד. */
  #log(text: string, kind: WakeWordLogEntry["kind"]): void {
    const secs = (this.#frameIndex * 1280) / 16000
    const next = [...this.logs, { t: secs, text, kind }]
    // שמור עד 200 שורות אחרונות
    this.logs = next.length > 200 ? next.slice(next.length - 200) : next
  }

  #setupListeners(): void {
    this.#engine.on("level", (rms) => {
      this.level = rms
    })

    this.#engine.on("frame", (frame) => {
      this.#frameIndex++
      this.#capture.pushFrame(frame)
    })

    this.#engine.on("vadStart", () => {
      this.#log("VAD ▶ speech start", "vad")
    })

    this.#engine.on("vadEnd", ({ frames }) => {
      const s = ((frames ?? 0) * 1280) / 16000
      this.#log(`VAD ■ speech end (${s.toFixed(2)}s)`, "vad")
    })

    this.#engine.on("detect", ({ keyword, score, sinceVadStart }) => {
      this.flashCount++
      const since =
        sinceVadStart != null
          ? ` (+${((sinceVadStart * 1280) / 16000).toFixed(2)}s after VAD)`
          : ""
      this.#log(`DETECT ★ "${keyword}" ${score.toFixed(2)}${since}`, "detect")

      if (!this.#capture.capturing) {
        // wake #1 → התחל הקלטה
        this.#capture.start()
        this.#tone(880, 160) // cue start (גבוה = "go")
        this.mode = "recording"
        this.#log("capture STARTED (wake #1)", "cap")
      } else {
        // wake #2 → עצור הקלטה
        const result = this.#capture.stop(16)
        this.#tone(440, 220) // cue end (נמוך = "done")
        this.mode = "listening"
        this.#log("capture STOPPED (wake #2)", "cap")

        // ההקלטה הנוכחית בלבד — שחרר את הקודמת, חשוף את החדשה ב-controls.
        if (result?.wavBytes) {
          if (this.currentClipUrl) URL.revokeObjectURL(this.currentClipUrl)
          const blob = new Blob([result.wavBytes.buffer as ArrayBuffer], {
            type: "audio/wav",
          })
          const url = URL.createObjectURL(blob)
          this.currentClipUrl = url
          const secs = (result.frames * 1280) / 16000
          this.currentClipLabel = `${secs.toFixed(1)}s @ ${new Date().toLocaleTimeString()}`
          // השמעה אוטומטית מופעלת מה-route דרך אלמנט ה-<audio> הגלוי (לא כאן)
        }
      }
    })

    this.#engine.on("error", (err) => {
      this.lastError = err instanceof Error ? err.message : String(err)
      this.mode = "off"
    })
  }
}

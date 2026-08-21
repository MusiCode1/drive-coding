/**
 * rec-probe.ts — ‏מכונת-המצבים של probe ההקלטה.
 *
 * ─── ‏הבאג שהמודול הזה סוגר ───
 * ‏בהרצה על חומרה אמיתית (`investigations/captures/2026-08-21-dpad-session-1.md`)
 * ‏היומן הראה **‏שלוש** ‏שורות `started` ‏רצופות בלי `stop` ‏ביניהן, ‏ואז **‏שמונה**
 * ‏`stopped` ‏על הקלטה אחת — ‏שבע מהן `bytes: 0`. ‏חשבון-הזמן חשף את השורש:
 * ‏כל ה-`ms` ‏נגזרו מ**‏אותה** ‏חותמת-התחלה, ‏ולכן גדלו מונוטונית (1156 → 43721).
 *
 * ‏השורש אושש בקוד, ‏לא בהשערה: ‏`Recorder.stop()` ‏על recorder מת (‏ענף
 * ‏`if (!this.mr)`) ‏מחזיר `{ blob: new Blob(), mimeType: "audio/webm" }` —
 * ‏**‏בדיוק** ‏החתימה שבלוג, ‏בעוד ההצלחה היחידה חזרה עם `audio/webm;codecs=opus`.
 *
 * ─── ‏למה מודול מוזרק-תלויות ───
 * ‏`MediaRecorder` ‏אינו קיים ב-vitest (`environment: "node"`). ‏בלי הזרקה,
 * ‏אין דרך לבדוק את השערים — ‏וזו בדיוק הסיבה שהבאג הגיע לחומרה.
 *
 * 🔴 ‏**‏שתי הדחיות נרשמות ביומן.** ‏יומן שבולע בשקט הוא מה שנכשל כאן:
 * ‏המשתמש ראה 8 ‏שורות `stopped` ‏ולא ידע שרק הראשונה אמיתית.
 */

import type { BtButton } from "./bt-remote.js"

/** ‏מינימום-המשטח מ-`Recorder` — ‏כדי שטסט יזריק כפול בלי MediaRecorder. */
export type RecorderLike = {
  start(): Promise<void>
  stop(): Promise<{ blob: { size: number }; mimeType: string }>
}

export type RecProbeRow = {
  kind: "rec" | "err"
  detail: string
  data?: Record<string, unknown>
}

export type RecProbeCue = "recordingStart" | "recordingStop"

export type RecProbeState = "idle" | "starting" | "recording" | "stopping"

export class RecProbe {
  #recorder: RecorderLike
  #now: () => number
  #onRow: (row: RecProbeRow) => void
  #onStartFailed: (() => void) | undefined
  #onCue: ((cue: RecProbeCue) => void) | undefined

  #state: RecProbeState = "idle"
  #startedAt = 0

  constructor(deps: {
    recorder: RecorderLike
    now: () => number
    onRow: (row: RecProbeRow) => void
    /** ‏נקרא כש-`start` ‏נכשל — ‏ה-route ‏מכבה את המתג. */
    onStartFailed?: () => void
    onCue?: (cue: RecProbeCue) => void
  }) {
    this.#recorder = deps.recorder
    this.#now = deps.now
    this.#onRow = deps.onRow
    this.#onStartFailed = deps.onStartFailed
    this.#onCue = deps.onCue
  }

  get state(): RecProbeState {
    return this.#state
  }

  /** ‏0 ‏כשאין הקלטה פעילה — ‏זה מה שהופך את איפוס-החותמת ל**‏נצפה**. */
  #elapsedMs(): number {
    return this.#startedAt === 0 ? 0 : this.#now() - this.#startedAt
  }

  /**
   * 🔴 ‏`center` ‏**‏לעולם** ‏אינו מפעיל הקלטה (‏אילוץ §3.2 ‏של פקודת-המשימה)
   * — ‏מחזיר בלי לרשום דבר.
   */
  async handle(button: BtButton): Promise<void> {
    if (button === "center") return
    if (button === "next") return this.#start()
    return this.#stop()
  }

  async #start(): Promise<void> {
    if (this.#state !== "idle") {
      this.#onRow({
        kind: "rec",
        detail: `start ignored — state=${this.#state}`,
        data: { state: this.#state, elapsedMs: this.#elapsedMs() },
      })
      return
    }
    // ⚠️ ‏שניהם **‏סינכרונית, ‏לפני ה-await** — ‏טאפים מגיעים במרווחי 3-12ms (‏נמדד),
    // ‏ושער שנבדק אחרי ה-await הוא מרוץ.
    this.#state = "starting"
    this.#startedAt = this.#now()
    try {
      await this.#recorder.start()
      this.#state = "recording"
      this.#onCue?.("recordingStart")
      this.#onRow({ kind: "rec", detail: "recording started" })
    } catch (e: unknown) {
      this.#state = "idle"
      this.#startedAt = 0
      this.#onRow({ kind: "err", detail: e instanceof Error ? e.message : String(e) })
      this.#onStartFailed?.()
    }
  }

  async #stop(): Promise<void> {
    if (this.#state !== "recording") {
      this.#onRow({
        kind: "rec",
        detail: `stop ignored — state=${this.#state}`,
        data: { state: this.#state, elapsedMs: this.#elapsedMs() },
      })
      return
    }
    this.#state = "stopping"
    const startedAt = this.#startedAt
    try {
      const { blob, mimeType } = await this.#recorder.stop()
      const ms = this.#now() - startedAt
      this.#onCue?.("recordingStop")
      this.#onRow({
        kind: "rec",
        detail: "recording stopped",
        data: {
          ms,
          bytes: blob.size,
          mimeType,
          // ‏`null` ‏מפורש = "‏לא ניתן לחישוב". ‏בלי ההגנה, ‏`Infinity` ‏היה נכתב
          // ‏כ-`null` ‏**‏בשקט** ‏ע"י JSON.stringify ‏בייצוא.
          bytesPerSec: ms > 0 ? Math.round(blob.size / (ms / 1000)) : null,
        },
      })
    } catch (e: unknown) {
      this.#onRow({ kind: "err", detail: e instanceof Error ? e.message : String(e) })
    } finally {
      this.#startedAt = 0
      this.#state = "idle"
    }
  }
}

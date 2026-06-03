/**
 * Mic — "האוזן" של המשתמש.
 *
 * נקודת כניסה (entry point) יחידה toggle() שמונעת על ידי רכיב ה-MicButton.
 * מכונת מצבים (State machine): idle → recording → transcribing → idle
 *
 * בתעתיק מוצלח, שולח את הטקסט אל AgentSession.sendPrompt().
 * ה-recordingId מועבר הלאה (slice 10 יחבר לזה את ה-endpoint האמיתי ב-BE;
 * כרגע הוא תמיד "").
 *
 * השדה error שומר MessageKey כדי שהקומפוננטה תוכל לתרגם אותו בעזרת t().
 *
 * ─── slice sessions-inline: blob שמירה + retryTranscribe + canRetry ───
 * #lastBlob — שומר את הבלוב של ההקלטה האחרונה כאשר תמלול נכשל.
 * retryTranscribe() — מנסה שוב לתמלל את ה-blob השמור (public).
 * canRetry — getter שמחזיר true אם יש blob שמור (לUI).
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { CuesEngine } from "../engines/cues"
import type { AgentSession } from "./agent-session.svelte"
import { Recorder } from "../engines/recorder"
import { transcribe } from "../adapters/voice/transcribe"

export type MicState = "idle" | "recording" | "transcribing"

export class Mic {
  state: MicState = $state("idle")
  error: MessageKey | null = $state(null)

  readonly #session: AgentSession
  readonly #recorder: Recorder
  readonly #cues?: CuesEngine
  // ─── slice sessions-inline: blob שמירה ───
  #lastBlob: Blob | null = null

  constructor(opts: { session: AgentSession; cues?: CuesEngine }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
    this.#cues = opts.cues
  }

  // ─── slice sessions-inline: getter ל-UI ───
  /** מחזיר true אם יש blob שמור מהקלטה שתמלולה נכשל — אפשרות לנסות שוב. */
  get canRetry(): boolean {
    return this.#lastBlob !== null
  }

  /**
   * נקודת כניסה יחידה — ה-MicButton קורא לזה. מתנהג בהתאם למצב (state):
   *   idle        → תחילת הקלטה
   *   recording   → עצירה, תעתיק (transcribe), ושליחת פרומפט
   *   transcribing → חוסר פעולה (no-op) (הכפתור מנוטרל)
   */
  toggle = async (): Promise<void> => {
    if (this.state === "idle") {
      this.state = "recording"
      this.error = null
      try {
        await this.#recorder.start()
      } catch (e: unknown) {
        this.state = "idle"
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          this.error = "mic.error.permission"
        } else if (e instanceof DOMException && e.name === "NotFoundError") {
          this.error = "mic.error.notFound"
        } else {
          this.error = "mic.error.generic"
        }
        return
      }
      // slice 6: cue אחרי הרשאה הוענקה + הקלטה התחילה בפועל
      this.#cues?.play("recordingStart")
      return
    }

    if (this.state === "recording") {
      this.state = "transcribing"
      // slice 6: cue מיד אחרי מעבר ל-transcribing (הקלטה הסתיימה)
      this.#cues?.play("recordingStop")
      let blob: Blob
      try {
        const result = await this.#recorder.stop()
        blob = result.blob
      } catch (e: unknown) {
        this.state = "idle"
        console.warn("[mic] recorder.stop() failed", e)
        this.error = "mic.error.generic"
        return
      }

      // ─── slice sessions-inline: שמור blob לפני תמלול ───
      this.#lastBlob = blob
      await this.#runTranscribe(blob)
      return
    }

    // transcribing → חוסר פעולה (no-op)
  }

  /**
   * מנסה שוב לתמלל את ההקלטה האחרונה ששמורה (אחרי כשל). no-op אם אין blob שמור.
   * ─── slice sessions-inline ───
   */
  retryTranscribe = async (): Promise<void> => {
    if (this.#lastBlob === null) return
    if (this.state !== "idle") return
    this.state = "transcribing"
    this.error = null
    await this.#runTranscribe(this.#lastBlob)
  }

  /**
   * ביטול באמצע הקלטה. נקרא על ידי VoiceMode.cancel() (slice 7 יוסיף גם
   * כפתור ביטול ייעודי). עוצר את המקליט (recorder) ללא שליחת פרומפט.
   */
  cancel(): void {
    if (this.state === "recording") {
      // עצור את המקליט מבלי לעבד את התוצאה
      void this.#recorder.stop().catch(() => {})
      this.state = "idle"
      this.error = null
    }
    // במצב transcribing: אי אפשר לבטל בקשת Gemini שיצאה לדרך ב-MVP הנוכחי.
    // המצב יחזור באופן טבעי ל-idle אחרי ש-transcribe() יסתיים (resolves/rejects).
  }

  // ─── פרטי: לוגיקת transcribe משותפת ל-toggle ו-retryTranscribe ───

  /**
   * מריץ תמלול על blob נתון. אחראי על עדכון state, error, ו-#lastBlob.
   * ב-catch: משאיר #lastBlob שמור (לא מאפס) כדי לאפשר retryTranscribe.
   * בהצלחה: מאפס #lastBlob (לא צריך יותר).
   */
  #runTranscribe = async (blob: Blob): Promise<void> => {
    let text: string
    let recordingId: string
    try {
      const result = await transcribe(blob)
      text = result.text
      recordingId = result.recordingId
    } catch (e: unknown) {
      this.state = "idle"
      console.warn("[mic] transcribe() failed", e)
      this.error = "mic.error.transcribe"
      // #lastBlob נשמר — המשתמש יכול לנסות שוב דרך retryTranscribe()
      return
    }

    // הצלחה: נקה blob (לא צריך יותר)
    this.#lastBlob = null
    if (text.trim().length > 0) {
      void this.#session.sendPrompt(text, { recordingId })
    }
    this.state = "idle"
  }
}

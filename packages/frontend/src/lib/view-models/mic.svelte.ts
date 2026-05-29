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
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "./agent-session.svelte"
import { Recorder } from "../engines/recorder"
import { transcribe } from "../adapters/voice/transcribe"

export type MicState = "idle" | "recording" | "transcribing"

export class Mic {
  state: MicState = $state("idle")
  error: MessageKey | null = $state(null)

  readonly #session: AgentSession
  readonly #recorder: Recorder

  constructor(opts: { session: AgentSession }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
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
      return
    }

    if (this.state === "recording") {
      this.state = "transcribing"
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
        return
      }

      if (text.trim().length > 0) {
        void this.#session.sendPrompt(text, { recordingId })
      }
      this.state = "idle"
      return
    }

    // transcribing → חוסר פעולה (no-op)
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
}

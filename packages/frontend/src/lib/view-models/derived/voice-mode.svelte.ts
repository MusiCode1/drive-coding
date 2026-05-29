/**
 * VoiceMode — FSM (מכונת מצבים) נגזרת שמסכמת את ה-mic + session + speaker לכדי
 * מצב תצוגה יחיד עבור רכיב ה-MicButton.
 *
 * אינו מחזיק מצב ראשי (primary state) — הוא נגזר משלושה מקורות:
 *   - Mic.state         (הקלטה / תמלול)
 *   - AgentSession.status (חושב)
 *   - Speaker.state     (מדבר)
 *
 * isCancelling הוא השדה היחיד שניתן לשינוי: מוגדר על ידי cancel(), מאופס על ידי $effect
 * ברגע שכל המקורות נרגעים חזרה למצב המתנה (idle).
 *
 * בטיחות ריאקטיבית (learnings 2026-05-16):
 *   - $derived.by קורא משלושת המקורות באמצעות getters — אין כתיבות → בטוח.
 *   - ה-$effect ONLY כותב `isCancelling = false` ורק כאשר כל שלושת
 *     התנאים מתקיימים במקביל. ברגע ששקר, התנאי כבר אינו
 *     מתקיים → אין לולאה אינסופית (סיכון #9 במפרט).
 */

import type { Mic } from "../mic.svelte"
import type { AgentSession } from "../agent-session.svelte"
import type { Speaker } from "../speaker.svelte"

export type VoiceModeState =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "cancelling"

export class VoiceMode {
  readonly #mic: Mic
  readonly #session: AgentSession
  readonly #speaker: Speaker

  /** דגל פנימי — מוגדר על ידי cancel(), מתאפס כשה-FSM חוזר למצב idle */
  isCancelling: boolean = $state(false)

  state: VoiceModeState = $derived.by(() => {
    if (this.isCancelling) return "cancelling"
    if (this.#mic.state === "recording") return "recording"
    if (this.#mic.state === "transcribing") return "transcribing"
    if (this.#speaker.state === "speaking") return "speaking"
    if (this.#session.status === "thinking") return "thinking"
    return "idle"
  })

  constructor(opts: { mic: Mic; session: AgentSession; speaker: Speaker }) {
    this.#mic = opts.mic
    this.#session = opts.session
    this.#speaker = opts.speaker

    // אפס את isCancelling ברגע שכל המקורות חוזרים למצב idle
    $effect(() => {
      if (
        this.isCancelling &&
        this.#mic.state === "idle" &&
        this.#session.status !== "thinking" &&
        this.#speaker.state === "idle"
      ) {
        this.isCancelling = false
      }
    })
  }

  /**
   * ביטול פעולת הקלטה / TTS / בקשה שרצה כרגע.
   * נקרא על ידי ה-MicButton כשהמצב הוא "speaking" או "thinking",
   * וייקרא גם על ידי כפתור הביטול ב-slice 7.
   */
  cancel(): void {
    this.isCancelling = true
    this.#mic.cancel()
    // Speaker.stop() היא מתודה תוספתית (additive) שנוספה בקומִיט הזה — ראה speaker.svelte.ts
    this.#speaker.stop()
  }
}

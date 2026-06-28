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
    if (this.#session.turnState !== "idle") return "thinking"
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
        this.#session.turnState === "idle" &&
        this.#speaker.state === "idle"
      ) {
        this.isCancelling = false
      }
    })
  }

  /**
   * A3: עצירת השמעה בלבד — לא נוגע בריצת הסוכן ולא ב-mic.
   * B1 יחבר לכפתור stop השמעה.
   */
  stopPlayback(): void {
    this.#speaker.stop()
  }

  /**
   * A3: עצירת הסוכן + ההשמעה (החלטה #3 מ-brief).
   * מגדיר isCancelling=true → state="cancelling" → מאפס ב-$effect כש-idle.
   */
  cancelRun(): void {
    this.isCancelling = true
    this.#mic.cancel()
    this.#speaker.stop()
    void this.#session.cancelTurn()
  }

  /**
   * @deprecated — נשאר זמנית כ-alias ל-cancelRun עד B1 מחווט.
   * קוראים קיימים: MicLarge.svelte ×2 (שורות 45 ו-89).
   * B1 יחליף קריאות ל-cancelRun() / stopPlayback() לפי ההקשר.
   */
  cancel(): void {
    this.cancelRun()
  }
}

/**
 * ModelStatus — derived VM שמסכם את מצב המודל לכדי phase יחיד לתצוגה.
 *
 * קורא session.turnState + speaker.state + speaker.hasPendingNarration.
 * משמש את StatusBubble להצגת בועת-מצב transient.
 *
 * ─── msr-v2 ───
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import type { AgentSession } from "../agent-session.svelte"
import type { Speaker } from "../speaker.svelte"

export type ModelPhase =
  | "waiting"
  | "thinking"
  | "responding"
  | "calling-tool"
  | "pending-tts"
  | "speaking"
  | null

export class ModelStatus {
  readonly #session: AgentSession
  readonly #speaker: Speaker

  constructor(opts: { session: AgentSession; speaker: Speaker }) {
    this.#session = opts.session
    this.#speaker = opts.speaker
  }

  phase: ModelPhase = $derived.by(() => {
    if (this.#speaker.state === "speaking")                   return "speaking"
    if (this.#session.turnState === "calling-tool")           return "calling-tool"
    if (this.#session.turnState === "responding")             return "responding"
    if (this.#session.turnState === "thinking")               return "thinking"
    if (this.#session.turnState === "waiting")                return "waiting"
    if (this.#speaker.enabled && this.#speaker.hasPendingNarration) return "pending-tts"
    return null
  })

  /** האם יש ריצת-סוכן פעילה שאפשר לבטל. הגדרה אחת לכל צרכני "עצור ריצה". */
  isRunActive: boolean = $derived.by(() => this.#session.turnState !== "idle")

  /**
   * מפתח-התווית של כפתור "עצור ריצה" — מקור אחד לשני צרכניו (MicLarge, TypeArea).
   * לפי turnState ולא לפי phase: phase מחזיר "speaking" ראשון ולכן כמעט תמיד
   * היה נופל ל-fallback.
   */
  stopRunLabelKey: MessageKey = $derived.by(() => {
    const ts = this.#session.turnState
    if (ts === "thinking") return "playbackControls.stopRun.thinking"
    if (ts === "responding") return "playbackControls.stopRun.responding"
    if (ts === "calling-tool") return "playbackControls.stopRun.callingTool"
    return "playbackControls.stopRun" // waiting + idle + כל השאר
  })
}

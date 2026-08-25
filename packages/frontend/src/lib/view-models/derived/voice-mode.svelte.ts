/**
 * VoiceMode — derived VM for mic control, playback stop, and run cancellation.
 *
 * Role narrowed by slice control-roles: MicLarge reads mic.state directly for
 * display; this VM exposes startTalking (barge-in), cancelRun, stopPlayback,
 * and isCancelling for the dedicated stop-run button.
 *
 * isCancelling resets via $effect when canClearCancelling is true — turnState
 * and speaker idle only (mic is excluded after R1: cancelRun skips mic.cancel
 * while recording).
 *
 * Reactive safety (learnings 2026-05-16):
 *   - $derived.by reads mic/session/speaker via getters — no writes.
 *   - $effect ONLY clears isCancelling when canClearCancelling is true.
 */

import type { AudioPlaylist } from "$lib/engines/audio-playlist.svelte"
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
  readonly #playlist: AudioPlaylist

  /** דגל פנימי — מוגדר על ידי cancelRun(), מתאפס כש-canClearCancelling */
  isCancelling: boolean = $state(false)

  state: VoiceModeState = $derived.by(() => {
    if (this.isCancelling) return "cancelling"
    if (this.#mic.state === "recording") return "recording"
    if (this.#mic.state === "transcribing") return "transcribing"
    if (this.#speaker.state === "speaking") return "speaking"
    if (this.#session.turnState !== "idle") return "thinking"
    return "idle"
  })

  constructor(opts: { mic: Mic; session: AgentSession; speaker: Speaker; playlist: AudioPlaylist }) {
    this.#mic = opts.mic
    this.#session = opts.session
    this.#speaker = opts.speaker
    this.#playlist = opts.playlist

    $effect(() => {
      if (this.isCancelling && this.canClearCancelling) this.isCancelling = false
    })
  }

  /**
   * האם ה-cancel הושלם ⇒ מותר לאפס את isCancelling.
   * מופרד מה-$effect במכוון: ה-$effect אינו רץ תחת vitest (environment: node),
   * ולכן זהו המשטח היחיד שבו אפשר להוכיח את (ג) בטסט.
   * ⚠️ **אינו בודק את ה-mic** — אחרי R1, cancelRun אינו נוגע במיקרופון כשהוא
   * מקליט, ולכן ה-mic אינו חלק ממה שצריך "להירגע".
   */
  get canClearCancelling(): boolean {
    return this.#session.turnState === "idle" && this.#speaker.state === "idle"
  }

  /**
   * barge-in — המשתמש רוצה לדבר בזמן שהסוכן מדבר.
   * עוצר את ההשמעה הנוכחית ומתחיל להקליט.
   * ⚠️ אינו מבטל את ריצת הסוכן — זו כל הנקודה.
   * ⚠️ אינו משתיק סגמנטים *חדשים* של ריצה שממשיכה — ר' R6.
   * ⚠️ עוצר רק כשבאמת נשמע קול: ב-paused אין מה לעצור, ועצירה הייתה
   *    מוחקת את הפלייליסט המשומר — ר' R8.
   */
  async startTalking(): Promise<void> {
    const audible =
      this.#speaker.state === "speaking" && this.#playlist.transport === "playing"
    if (audible) this.#speaker.stop()
    await this.#mic.toggle()
  }

  /**
   * A3: עצירת השמעה בלבד — לא נוגע בריצת הסוכן ולא ב-mic.
   */
  stopPlayback(): void {
    this.#speaker.stop()
  }

  /**
   * A3: עצירת הסוכן + ההשמעה.
   * מגדיר isCancelling=true → מאפס ב-$effect כש-canClearCancelling.
   */
  cancelRun(): void {
    this.isCancelling = true
    // הקלטה פעילה היא כוונת-משתמש חיה ואינה חלק מהתור שמבוטל
    if (this.#mic.state !== "recording") this.#mic.cancel()
    this.#speaker.stop()
    void this.#session.cancelTurn()
  }
}

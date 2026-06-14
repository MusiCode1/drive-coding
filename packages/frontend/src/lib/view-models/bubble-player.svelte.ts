/**
 * BubblePlayer — VM (entity) להשמעת בועה בודדת.
 *
 * toggle(bubbleId) — לחיצה שנייה על אותה בועה עוצרת.
 * guard: no-op אם session.turnState !== "idle" (לא להשמיע בזמן שהסוכן עונה).
 * user bubble → playUserRecording. message/thought → playAgentText.
 * tool bubble → אין ▶.
 *
 * אין $effect — toggle הוא method ישיר (§8.10).
 *
 * ─── msr-v2 (Commit 5) ───
 */

import type { AgentSession } from "./agent-session.svelte"
import type { Settings } from "./settings.svelte"
import type { Bubble } from "$lib/types/bubble"
import { playUserRecording, playAgentText } from "$lib/adapters/voice/play-bubble"

export class BubblePlayer {
  playingBubbleId: string | null = $state(null)

  readonly #session: AgentSession
  readonly #settings: Settings
  #audioEl: HTMLAudioElement | null = null
  #abortCtrl: AbortController | null = null

  constructor(opts: { session: AgentSession; settings: Settings }) {
    this.#session = opts.session
    this.#settings = opts.settings
  }

  /**
   * לחיצה שנייה על אותה בועה → עוצר. אחרת מנגן.
   * no-op אם turnState !== "idle" או בועה מסוג tool.
   */
  toggle(bubbleId: string): void {
    // no-op אם הסוכן עדיין עונה
    if (this.#session.turnState !== "idle") return

    // לחיצה שנייה על אותה בועה → עצור
    if (this.playingBubbleId === bubbleId) {
      this.stop()
      return
    }

    // עצור ניגון קודם (אם יש)
    this.stop()

    // מצא את הבועה
    const bubble = this.#session.bubbles.find((b: Bubble) => b.id === bubbleId)
    if (!bubble) return

    // tool bubble — אין ▶
    if (bubble.kind === "tool") return

    this.playingBubbleId = bubbleId
    this.#abortCtrl = new AbortController()
    const abortCtrl = this.#abortCtrl

    // צור <audio> חד-פעמי
    const audioEl = new Audio()
    this.#audioEl = audioEl

    const cleanup = () => {
      this.playingBubbleId = null
      this.#audioEl = null
      this.#abortCtrl = null
    }

    if (bubble.kind === "user") {
      const recordingId = bubble.recordingId
      if (!recordingId) {
        cleanup()
        return
      }
      void playUserRecording(recordingId, audioEl).then(cleanup).catch(cleanup)
    } else {
      // message / thought — TTS
      const text = bubble.segments.map((s) => s.text).join("")
      if (!text.trim()) {
        cleanup()
        return
      }
      void playAgentText(text, this.#settings.voiceId, audioEl, { signal: abortCtrl.signal })
        .then(cleanup)
        .catch(cleanup)
    }
  }

  /** עוצר כל ניגון פעיל. */
  stop(): void {
    if (this.#abortCtrl) {
      this.#abortCtrl.abort()
      this.#abortCtrl = null
    }
    if (this.#audioEl) {
      try {
        this.#audioEl.pause()
      } catch {
        // כבר עצור
      }
      this.#audioEl = null
    }
    this.playingBubbleId = null
  }
}

/**
 * ModelStatus — VM נגזרת שמסכמת את מצב המודל + Speaker לכדי phase תצוגתי יחיד.
 *
 * קורא session.turnState + speaker.state/hasPendingNarration.
 * phase === null = אין פעילות (אל תרנדר StatusBubble).
 *
 * ─── slice model-status-control-replay ───
 */

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

  phase: ModelPhase = $derived.by(() => {
    if (this.#speaker.state === "speaking") return "speaking"
    if (this.#session.turnState === "calling-tool") return "calling-tool"
    if (this.#session.turnState === "responding") return "responding"
    if (this.#session.turnState === "thinking") return "thinking"
    if (this.#session.turnState === "waiting") return "waiting"
    if (this.#speaker.enabled && this.#speaker.hasPendingNarration) return "pending-tts"
    return null
  })

  constructor(opts: { session: AgentSession; speaker: Speaker }) {
    this.#session = opts.session
    this.#speaker = opts.speaker
  }
}

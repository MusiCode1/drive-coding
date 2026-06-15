/**
 * ModelStatus — derived VM שמסכם את מצב המודל לכדי phase יחיד לתצוגה.
 *
 * קורא session.turnState + speaker.state + speaker.hasPendingNarration.
 * משמש את StatusBubble להצגת בועת-מצב transient.
 *
 * ─── msr-v2 ───
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
}

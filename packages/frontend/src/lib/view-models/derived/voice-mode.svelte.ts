/**
 * VoiceMode — derived FSM that summarises mic + session + speaker into a
 * single display state for MicButton.
 *
 * Does NOT hold primary state — it derives from three sources:
 *   - Mic.state         (recording / transcribing)
 *   - AgentSession.status (thinking)
 *   - Speaker.state     (speaking)
 *
 * isCancelling is the only mutable field: set by cancel(), reset by $effect
 * once all sources settle to idle.
 *
 * Reactivity safety (learnings 2026-05-16):
 *   - $derived.by reads from three sources via getters — no writes → safe.
 *   - The $effect ONLY writes `isCancelling = false` and only when the three
 *     conditions are simultaneously true. Once false, the condition is no
 *     longer true → no infinite loop (risk #9 in brief).
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

  /** Internal flag — set by cancel(), reset when FSM returns to idle */
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

    // Reset isCancelling once all sources settle back to idle
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
   * Cancel ongoing recording / TTS / request.
   * Called by MicButton when state is "speaking" or "thinking",
   * and will be called by the cancel button in slice 7.
   */
  cancel(): void {
    this.isCancelling = true
    this.#mic.cancel()
    // Speaker.stop() is an additive method added in this commit — see speaker.svelte.ts
    this.#speaker.stop()
  }
}

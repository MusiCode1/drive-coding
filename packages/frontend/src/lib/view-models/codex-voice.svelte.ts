/**
 * codex-voice.svelte.ts — the voice conversation with a Codex session (view-models layer).
 *
 * Entity: one live voice call bound to one Codex session. The voice model (GPT-Live, via Codex's
 * app-server) hands work to Codex on the session's own thread; Codex's turns show up in the chat
 * through the normal session updates. This VM only owns the call, its status and captions.
 *
 * ⚠️ POC deviation: exported as a module-level instance instead of a context created in
 * `+layout.svelte` — the layout is over its size budget and the ratchet blocks growth there.
 *
 * Slice: codex-voice-poc.
 */

import {
  speakCodexVoice,
  startCodexVoice,
  stopCodexVoice,
} from "$lib/adapters/voice/codex-realtime.js"
import {
  type CodexVoiceCall,
  type CodexVoiceEvent,
  startCodexVoiceCall,
} from "$lib/engines/codex-voice-call.js"

export type CodexVoiceStatus = "idle" | "connecting" | "live" | "error"

export interface CodexVoiceTarget {
  agentId: string
  sessionId: string
  /** Instructions for the voice model, in the user's language. */
  prompt: string
  /** Read reactively while the call runs; the call ends if it changes. */
  currentSessionId: () => string | null
  /** Title of the pending permission request, or null. Read reactively while the call runs. */
  pendingPermission: () => string | null
  /** Spoken prefix for a pending permission request. */
  permissionSpeech: string
}

export class CodexVoice {
  status = $state<CodexVoiceStatus>("idle")
  error = $state<string | null>(null)
  lastUser = $state("")
  lastAssistant = $state("")
  lastDelegation = $state("")

  #call: CodexVoiceCall | null = null
  #target: CodexVoiceTarget | null = null
  #disposeWatch: (() => void) | null = null
  #announced: string | null = null

  get active(): boolean {
    return this.status === "connecting" || this.status === "live"
  }

  async start(target: CodexVoiceTarget): Promise<void> {
    if (this.active) return
    this.#target = target
    this.error = null
    this.lastUser = ""
    this.lastAssistant = ""
    this.lastDelegation = ""
    this.status = "connecting"
    try {
      this.#call = await startCodexVoiceCall({
        negotiate: (sdp) => startCodexVoice(target.agentId, target.sessionId, sdp, target.prompt),
        onEvent: (e) => this.#onEvent(e),
      })
      this.#watch(target)
    } catch (err) {
      this.#fail(err instanceof Error ? err.message : String(err))
    }
  }

  async stop(): Promise<void> {
    const target = this.#target
    this.#teardown()
    if (this.status !== "error") this.status = "idle"
    if (target) await stopCodexVoice(target.agentId, target.sessionId).catch(() => {})
  }

  #onEvent(e: CodexVoiceEvent): void {
    if (e.type === "state") {
      if (e.state === "live") this.status = "live"
      if (e.state === "closed" && this.active) this.status = "idle"
    } else if (e.type === "transcript") {
      if (e.role === "user") this.lastUser = e.text
      else this.lastAssistant = e.text
    } else if (e.type === "delegation") {
      this.lastDelegation = e.text
    } else {
      this.#fail(e.message)
    }
  }

  /** Ends the call when the user leaves the session; speaks pending permission requests. */
  #watch(target: CodexVoiceTarget): void {
    this.#disposeWatch = $effect.root(() => {
      $effect(() => {
        // Deferred: stop() disposes this effect root, which must not happen from inside it.
        if (target.currentSessionId() !== target.sessionId) queueMicrotask(() => void this.stop())
      })
      $effect(() => {
        const title = target.pendingPermission()
        if (title === null || title === this.#announced || this.status !== "live") return
        this.#announced = title
        void speakCodexVoice(
          target.agentId,
          target.sessionId,
          `${target.permissionSpeech} ${title}`,
        ).catch(() => {})
      })
    })
  }

  #fail(message: string): void {
    this.error = message
    this.status = "error"
    this.#teardown()
  }

  #teardown(): void {
    this.#disposeWatch?.()
    this.#disposeWatch = null
    this.#call?.stop()
    this.#call = null
    this.#announced = null
  }
}

export const codexVoice = new CodexVoice()

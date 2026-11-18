/**
 * agent-voice.svelte.ts — the agent's own realtime voice ("native Live") for the active session
 * (view-models layer).
 *
 * Entity: the native voice call of the active session. Available when the provider declares
 * `capabilities.voice` (Codex today); the user opts in from the Live pane, and `Live`'s toggle then
 * opens this call instead of the Gemini secretary. The voice hands work to the agent on the
 * session's own thread, and both the conversation and the agent's turns arrive as chat messages
 * through the normal session updates — this VM owns only the call and its status.
 *
 * Slice: codex-voice-poc.
 */

import {
  type AgentVoiceDetail,
  listAgentVoices,
  loadNativeVoicePref,
  loadVoicePref,
  saveNativeVoicePref,
  saveVoicePref,
  speakAgentVoice,
  startAgentVoice,
  stopAgentVoice,
} from "$lib/adapters/voice/agent-voice.js"
import {
  type RealtimeVoiceCall,
  type RealtimeVoiceEvent,
  startRealtimeVoiceCall,
} from "$lib/engines/realtime-voice-call.js"
import { playVoicePreview } from "$lib/engines/voice-preview.js"
import type { AgentSession } from "./agent-session.svelte"

export type AgentVoiceStatus = "idle" | "connecting" | "live" | "error"

export interface AgentVoiceDeps {
  session: AgentSession
  /** Instructions for the voice model, in the UI language. */
  getInstructions: () => string
  /** Spoken prefix when the agent waits for a permission the voice cannot give. */
  getPermissionSpeech: () => string
}

export class AgentVoice {
  status = $state<AgentVoiceStatus>("idle")
  error = $state<string | null>(null)
  /** User preference: use the agent's native voice in Live when the session supports it. */
  preferNative = $state(loadNativeVoicePref())
  /** Voices of the agent's voice (loaded once the native voice is selected). */
  voices = $state<string[]>([])
  defaultVoice = $state<string | null>(null)
  /** User's chosen voice; null = the provider's default. */
  voice = $state<string | null>(loadVoicePref())
  /** Per voice: description, accent and sample clip, when the provider knows them. */
  voiceDetails = $state<Record<string, AgentVoiceDetail>>({})
  /** The voice whose sample is playing, if any. */
  previewing = $state<string | null>(null)
  #stopPreview: (() => void) | null = null

  readonly #deps: AgentVoiceDeps
  #call: RealtimeVoiceCall | null = null
  #target: { agentId: string; sessionId: string } | null = null
  #disposeWatch: (() => void) | null = null
  #announced: string | null = null
  #voicesFor: string | null = null
  #voicesRetry: ReturnType<typeof setTimeout> | null = null

  constructor(deps: AgentVoiceDeps) {
    this.#deps = deps
    // Load the voice list once per session when the native voice becomes selected.
    $effect.root(() => {
      $effect(() => {
        const { agentId, sessionId } = deps.session
        if (!this.selected || !agentId || !sessionId || this.#voicesFor === sessionId) return
        this.#voicesFor = sessionId
        if (this.#voicesRetry !== null) clearTimeout(this.#voicesRetry)
        void this.#loadVoices(agentId, sessionId)
      })
    })
  }

  /** The voice the next call will use. */
  get effectiveVoice(): string | null {
    return this.voice ?? this.defaultVoice
  }

  setVoice(voice: string): void {
    this.voice = voice
    saveVoicePref(voice)
  }

  /** Plays the sample of `voice` (default: the chosen one); a second call on the same voice stops it. */
  togglePreview(voice = this.effectiveVoice): void {
    const playing = this.previewing
    this.#stopPreview?.()
    if (!voice || playing === voice) return
    const url = this.voiceDetails[voice]?.previewUrl
    if (!url) return
    this.previewing = voice
    this.#stopPreview = playVoicePreview(url, () => {
      if (this.previewing === voice) this.previewing = null
      this.#stopPreview = null
    })
  }

  async #loadVoices(agentId: string, sessionId: string, attempt = 0): Promise<void> {
    try {
      const list = await listAgentVoices(agentId, sessionId)
      this.voices = list.voices
      this.defaultVoice = list.default
      this.voiceDetails = list.details ?? {}
      // A saved voice this provider does not offer would make start fail — fall back to the default.
      if (this.voice !== null && !list.voices.includes(this.voice)) this.voice = null
    } catch {
      // Typically the session is not ready yet right after it opens. The call itself works without
      // a list, so retry a few times quietly instead of leaving the picker empty.
      this.#retryVoices(agentId, sessionId, attempt)
    }
  }

  #retryVoices(agentId: string, sessionId: string, attempt: number): void {
    const delay = AgentVoice.#VOICES_RETRY_MS[attempt]
    if (delay === undefined) return
    this.#voicesRetry = setTimeout(() => {
      this.#voicesRetry = null
      const { agentId: a, sessionId: s } = this.#deps.session
      if (this.selected && a === agentId && s === sessionId)
        void this.#loadVoices(agentId, sessionId, attempt + 1)
    }, delay)
  }

  static readonly #VOICES_RETRY_MS = [1_000, 3_000, 8_000]

  /** The active session's provider implements the voice contract. */
  get supported(): boolean {
    return this.#deps.session.capabilities?.voice === true
  }

  /** Live should run the native voice rather than the secretary. */
  get selected(): boolean {
    return this.preferNative && this.supported
  }

  get active(): boolean {
    return this.status === "connecting" || this.status === "live"
  }

  setPreferNative(on: boolean): void {
    this.preferNative = on
    saveNativeVoicePref(on)
  }

  async toggle(): Promise<void> {
    if (this.active) return this.stop()
    return this.start()
  }

  async start(): Promise<void> {
    const { agentId, sessionId } = this.#deps.session
    if (this.active || !agentId || !sessionId) return
    const target = { agentId, sessionId }
    this.#target = target
    this.error = null
    this.status = "connecting"
    try {
      this.#call = await startRealtimeVoiceCall({
        negotiate: (sdp) =>
          startAgentVoice(
            agentId,
            sessionId,
            sdp,
            this.#deps.getInstructions(),
            this.voice ?? undefined,
          ),
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
    if (target) await stopAgentVoice(target.agentId, target.sessionId).catch(() => {})
  }

  #onEvent(e: RealtimeVoiceEvent): void {
    if (e.type === "state") {
      if (e.state === "live") this.status = "live"
      if (e.state === "closed" && this.active) this.status = "idle"
    } else if (e.type === "error") {
      this.#fail(e.message)
    }
    // transcripts and delegations reach the chat through the session itself
  }

  /** Ends the call when the user leaves the session; speaks pending permission requests. */
  #watch(target: { agentId: string; sessionId: string }): void {
    const session = this.#deps.session
    this.#disposeWatch = $effect.root(() => {
      $effect(() => {
        // Deferred: stop() disposes this effect root, which must not happen from inside it.
        if (session.sessionId !== target.sessionId) queueMicrotask(() => void this.stop())
      })
      $effect(() => {
        const pending = session.pendingPermission
        const title = pending ? (pending.params.toolCall?.title ?? "") : null
        if (title === null || title === this.#announced || this.status !== "live") return
        this.#announced = title
        const text = `${this.#deps.getPermissionSpeech()} ${title}`.trim()
        void speakAgentVoice(target.agentId, target.sessionId, text).catch(() => {})
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

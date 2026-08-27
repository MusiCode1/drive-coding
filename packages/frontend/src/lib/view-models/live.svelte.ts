/**
 * Live — view-model for Gemini Live secretary session.
 *
 * Composes adapter (fetchLiveToken) + provider (geminiLive) → LiveSessionEngine.
 *
 * Slice: live-secretary, Commit 0 — outgoing path to AgentSession.
 */

import type { MessageKey } from "@drive-coding/core/i18n"
import { canDispatchPrompt } from "@drive-coding/core/voice/live-dispatch"
import {
  buildLiveAgentPrompt,
  formatSecretaryToAgent,
} from "@drive-coding/core/voice/live-agent-prompt"
import { formatAgentDelivery, formatPermissionPending } from "@drive-coding/core/voice/live-prompt"
import { isUnpromptedSend } from "@drive-coding/core/voice/unprompted-guard"
import { mapPermissionOptions } from "$lib/types/permission"
import { geminiLive } from "../adapters/voice/live/gemini"
import { fetchLiveToken } from "../adapters/voice/live-token"
import { LiveAudioSink } from "../engines/live-audio-sink"
import {
  LiveSessionEngine,
  type LiveSessionState,
  type LiveTranscriptEntry,
} from "../engines/live-session"
import { MicFrames } from "../engines/mic-frames"
import type { AgentSession } from "./agent-session.svelte"
import type { Mic } from "./mic.svelte"

export type { LiveSessionState, LiveTranscriptEntry }

export class Live {
  readonly #mic: Mic
  readonly #session: AgentSession
  readonly #engine: LiveSessionEngine
  readonly #frames: MicFrames
  readonly #sink: LiveAudioSink
  #pendingAgentDelivery = false
  #notifiedPermissionKey: string | null = null
  /** Set when agent delivery is sent; cleared on first user transcript fragment. */
  #deliveredSinceUserSpoke = false
  /** One-shot agent instruction per Live open cycle. */
  #agentPromptSent = false
  #lastUserTranscriptIdSeen: number | undefined = undefined

  state: LiveSessionState = $state("closed")
  transcript: LiveTranscriptEntry[] = $state([])
  error: MessageKey | null = $state(null)
  /** Reactive bridge — fed by LiveAudioSink, not read from sink.isPlaying directly. */
  isSpeaking: boolean = $state(false)

  constructor(opts: {
    mic: Mic
    session: AgentSession
    language?: "he" | "en"
    voiceName?: string
  }) {
    this.#mic = opts.mic
    this.#session = opts.session
    this.#frames = new MicFrames()
    this.#sink = new LiveAudioSink({
      sampleRate: geminiLive.outputSampleRate,
      onPlayingChange: (playing) => {
        this.isSpeaking = playing
      },
    })
    this.#engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => {
          const result = await fetchLiveToken({
            language: opts.language,
            voiceName: opts.voiceName,
          })
          return {
            token: result.token,
            model: result.model,
            sessionConfig: result.sessionConfig,
          }
        },
        provider: geminiLive,
      },
      frames: this.#frames,
      audioSink: this.#sink,
    })

    this.#engine.on("state", (s) => {
      this.state = s
      if (s === "open") this.error = null
      if (s === "closed") this.#agentPromptSent = false
    })
    this.#engine.on("transcript", (entry) => {
      this.transcript = [...this.#engine.transcript]
      if (entry.role !== "user") return
      const id = this.#engine.transcript.at(-1)?.id
      if (id === undefined) return
      if (id === this.#lastUserTranscriptIdSeen) return
      this.#lastUserTranscriptIdSeen = id
      this.#deliveredSinceUserSpoke = false
    })
    this.#engine.on("action", (action) => {
      this.#handleAction(action)
    })

    $effect(() => {
      if (this.#session.turnState === "idle") {
        this.#deliverAgentAnswerIfPending()
      }
    })

    $effect(() => {
      this.#notifyPendingPermissionIfNeeded()
    })
  }

  get isOpen(): boolean {
    return this.state === "open" || this.state === "connecting"
  }

  /** false while push-to-talk is active (§4.3 mutual exclusion). */
  get canOpen(): boolean {
    return this.#mic.state === "idle" && this.state !== "connecting"
  }

  async toggle(): Promise<void> {
    if (this.isOpen) {
      this.#engine.close()
      return
    }
    if (!this.canOpen) return

    this.error = null
    try {
      await this.#frames.start()
      await this.#engine.open()
      if (this.state === "error") {
        this.error = "live.error.connect"
      } else if (this.state === "open" && !this.#agentPromptSent) {
        this.#agentPromptSent = true
        void this.#session.sendPrompt(buildLiveAgentPrompt())
      }
    } catch (e: unknown) {
      this.error =
        e instanceof Error && e.message === "live.token.noApiKey"
          ? "live.error.noApiKey"
          : "live.error.connect"
      this.#engine.close()
    }
  }

  #dispatchGate(text: string) {
    return canDispatchPrompt({
      status: this.#session.status,
      hasClient: this.#session.hasAcpClient,
      hasSessionId: this.#session.sessionId !== null,
      isRemoteView: this.#session.isRemoteView,
      text,
    })
  }

  #lastFinalUserTranscript(): string {
    for (let i = this.transcript.length - 1; i >= 0; i--) {
      const entry = this.transcript[i]
      if (entry?.role === "user" && entry.final) return entry.text
    }
    return ""
  }

  #handleAction(action: { id: string; name: string; args: Record<string, unknown> }): void {
    switch (action.name) {
      case "compose_prompt": {
        const text = typeof action.args.text === "string" ? action.args.text : ""
        if (isUnpromptedSend({ deliveredSinceUserSpoke: this.#deliveredSinceUserSpoke })) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: "unprompted",
          })
          return
        }
        const verdict = this.#dispatchGate(text)
        if (!verdict.ok) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: verdict.reason,
          })
          return
        }
        void this.#session.sendPrompt(formatSecretaryToAgent(text))
        this.#engine.sendActionResult(action.id, action.name, { status: "sent" })
        this.#pendingAgentDelivery = true
        break
      }
      case "forward": {
        const text = this.#lastFinalUserTranscript()
        if (isUnpromptedSend({ deliveredSinceUserSpoke: this.#deliveredSinceUserSpoke })) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: "unprompted",
          })
          return
        }
        const verdict = this.#dispatchGate(text)
        if (!verdict.ok) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: verdict.reason,
          })
          return
        }
        void this.#session.sendPrompt(formatSecretaryToAgent(text))
        this.#engine.sendActionResult(action.id, action.name, { status: "sent" })
        this.#pendingAgentDelivery = true
        break
      }
      case "cancel_turn": {
        void this.#session.cancelTurn()
        this.#pendingAgentDelivery = false
        this.#engine.sendActionResult(action.id, action.name, { status: "sent" })
        break
      }
      case "answer_permission": {
        const optionId = typeof action.args.optionId === "string" ? action.args.optionId : ""
        const pending = this.#session.pendingPermission
        if (!pending) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: "no-pending-permission",
          })
          break
        }
        const allowed = mapPermissionOptions(pending.params).some((o) => o.optionId === optionId)
        if (!optionId || !allowed) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "not_sent",
            reason: "invalid-option",
          })
          break
        }
        this.#session.resolvePermission(optionId)
        this.#engine.sendActionResult(action.id, action.name, { status: "sent" })
        break
      }
      default:
        break
    }
  }

  #deliverAgentAnswerIfPending(): void {
    if (!this.isOpen || !this.#pendingAgentDelivery) return
    const answer = this.#session.recentAssistantMessages(1)[0]?.trim()
    if (!answer) return
    this.#engine.sendContext(formatAgentDelivery(answer), "speakable")
    this.#pendingAgentDelivery = false
    this.#deliveredSinceUserSpoke = true
  }

  #notifyPendingPermissionIfNeeded(): void {
    const pending = this.#session.pendingPermission
    if (!pending) {
      this.#notifiedPermissionKey = null
      return
    }
    if (!this.isOpen) return

    const key =
      pending.requestId !== undefined
        ? String(pending.requestId)
        : pending.params.toolCall.toolCallId
    if (this.#notifiedPermissionKey === key) return

    const options = mapPermissionOptions(pending.params)
    this.#engine.sendContext(
      formatPermissionPending({
        // `title` is optional upstream; the marker line must still name something
        // the driver can act on, so fall back rather than emit "undefined" aloud.
        toolTitle: pending.params.toolCall.title ?? pending.params.toolCall.kind ?? "",
        options,
      }),
      "speakable",
    )
    this.#notifiedPermissionKey = key
  }

  /** @internal test hook — turn-boundary delivery without relying on $effect timing. */
  deliverAgentAnswerIfPending(): void {
    this.#deliverAgentAnswerIfPending()
  }

  /** @internal test hook — unprompted guard flag state. */
  deliveredSinceUserSpokeForTest(): boolean {
    return this.#deliveredSinceUserSpoke
  }

  /** @internal test hook — mutation / DoD 7: force flag without touching delivery path. */
  setDeliveredSinceUserSpokeForTest(value: boolean): void {
    this.#deliveredSinceUserSpoke = value
  }
}

/**
 * Live — view-model for Gemini Live secretary session.
 *
 * Composes adapter (fetchLiveToken) + provider (geminiLive) → LiveSessionEngine.
 *
 * Slice: live-secretary, Commit 0 — outgoing path to AgentSession.
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import type { MessageKey } from "@drive-coding/core/i18n"
import { canDispatchPrompt } from "@drive-coding/core/voice/live-dispatch"
import {
  formatListConfigSnapshot,
  validateAppSetting,
  type ListConfigInput,
  type SelectChoiceInput,
} from "@drive-coding/core/voice/live-config"
import {
  conversationHasLiveAgentPreamble,
  formatSecretaryDispatch,
} from "@drive-coding/core/voice/live-agent-prompt"
import { formatAgentDelivery, formatConfigSeedProse, formatPermissionPending } from "@drive-coding/core/voice/live-prompt"
import { buildLiveSeed } from "@drive-coding/core/voice/live-seed"
import { formatMemoryForPrompt, type MemoryItem } from "@drive-coding/core/voice/live-memory"
import { searchSessionBubbles } from "@drive-coding/core/voice/live-search"
import { parseRecentBool, parseRecentCount, readRecentBubbles } from "@drive-coding/core/voice/live-read-recent"
import { isUnpromptedSend } from "@drive-coding/core/voice/unprompted-guard"
import {
  loadAlwaysMemory,
  rememberAlways,
  rememberSession,
  saveAlwaysMemory,
} from "$lib/adapters/live-memory-store"
import { mapPermissionOptions } from "$lib/types/permission"
import {
  LIVE_SEED_LABELS,
  mapBubblesToLiveSeed,
  mapBubblesToRecent,
  mapSessionTurnState,
} from "$lib/util/live-seed-from-session"
import { geminiLive } from "../adapters/voice/live/gemini"
import { fetchLiveToken } from "../adapters/voice/live-token"
import { LiveAudioSink } from "../engines/live-audio-sink"
import {
  LiveSessionEngine,
  type LiveSessionState,
  type LiveTranscriptEntry,
} from "../engines/live-session"
import { LiveVad } from "../engines/live-vad"
import { MicFrames } from "../engines/mic-frames"
import type { AgentSession } from "./agent-session.svelte"
import type { Mic } from "./mic.svelte"
import type { Settings } from "./settings.svelte"
import { PALETTES, type ThemeVM } from "./theme.svelte"

export type { LiveSessionState, LiveTranscriptEntry }

/** off=null, low=4000, medium=8000, high=16000 — same as SessionOptionsPanel */
const THINKING_TOKEN_VALUES: Record<string, number | null> = {
  off: null,
  low: 4000,
  medium: 8000,
  high: 16000,
}

type SelectOpt = { value: string; name: string }

function flattenSelectOptions(option: SessionConfigOption): SelectOpt[] {
  if (option.type !== "select") return []
  const sel = option as Extract<SessionConfigOption, { type: "select" }>
  return sel.options.flatMap((item) =>
    "options" in item
      ? item.options.map((o) => ({ value: o.value, name: o.name }))
      : [{ value: item.value, name: item.name }],
  )
}

function toConfigChoices(items: SelectOpt[]): SelectChoiceInput[] {
  return items.map((o) => ({ id: o.value, name: o.name }))
}

export class Live {
  readonly #mic: Mic
  readonly #session: AgentSession
  readonly #getSettings: () => Settings
  readonly #getTheme: () => ThemeVM
  readonly #engine: LiveSessionEngine
  readonly #frames: MicFrames
  readonly #sink: LiveAudioSink
  readonly #vad: LiveVad
  readonly #vadLoad: Promise<void>
  #pendingAgentDelivery = false
  #notifiedPermissionKey: string | null = null
  /** Set when agent delivery is sent; cleared on first user transcript fragment. */
  #deliveredSinceUserSpoke = false
  #lastUserTranscriptIdSeen: number | undefined = undefined
  /** Session-scoped secretary memory (RAM). Cleared when Live class is recreated. */
  #sessionMemory: MemoryItem[] = []
  /** Cross-session memory — loaded from localStorage on construct. */
  #alwaysMemory: MemoryItem[] = loadAlwaysMemory()

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
    /** Read at each mint — settings.liveVoice (avoids stale constructor capture). */
    getVoiceName?: () => string
    /** Read at action time — Settings created before Live in layout. */
    getSettings: () => Settings
    /** Read at action time — ThemeVM created after Live; getter avoids stale capture. */
    getTheme: () => ThemeVM
  }) {
    this.#mic = opts.mic
    this.#session = opts.session
    this.#getSettings = opts.getSettings
    this.#getTheme = opts.getTheme
    this.#frames = new MicFrames()
    this.#sink = new LiveAudioSink({
      sampleRate: geminiLive.outputSampleRate,
      onPlayingChange: (playing) => {
        this.isSpeaking = playing
      },
    })
    this.#vad = new LiveVad()
    this.#vadLoad = this.#vad.load()
    this.#engine = new LiveSessionEngine({
      connector: {
        fetchToken: async () => {
          const result = await fetchLiveToken({
            language: opts.language,
            voiceName: opts.getVoiceName?.() ?? opts.voiceName,
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
      speechFilter: this.#vad,
    })

    this.#engine.on("state", (s) => {
      this.state = s
      if (s === "open") this.error = null
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
      await this.#vadLoad
      if (this.#vad.loadFailed) {
        this.error = "live.error.vadLoad"
      }
      await this.#frames.start()
      await this.#engine.open()
      if (this.state === "error") {
        this.error = "live.error.connect"
      } else if (this.state === "open") {
        this.#injectSeedAndMemory()
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

  /** First successful dispatch prepends the explanation unless it is already in the ACP transcript. */
  #sendToAgent(text: string): void {
    const includePreamble = !conversationHasLiveAgentPreamble(this.#conversationTexts())
    void this.#session.sendPrompt(formatSecretaryDispatch(text, { includePreamble }))
  }

  #conversationTexts(): string[] {
    const texts: string[] = []
    const last = this.#session.lastUserMessage
    if (last) texts.push(last)
    for (const bubble of this.#session.bubbles ?? []) {
      if (bubble.kind !== "user") continue
      texts.push(bubble.segments.map((s) => s.text).join(""))
    }
    return texts
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
        this.#sendToAgent(text)
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
        this.#sendToAgent(text)
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
      case "search_session": {
        const query = typeof action.args.query === "string" ? action.args.query : ""
        const bubbles = mapBubblesToLiveSeed(this.#session.bubbles ?? [])
        const result = searchSessionBubbles(bubbles, query)
        this.#engine.sendActionResult(action.id, action.name, result)
        break
      }
      case "read_recent": {
        const items = mapBubblesToRecent(this.#session.bubbles ?? [])
        const result = readRecentBubbles(items, {
          count: parseRecentCount(action.args.count),
          thoughts: parseRecentBool(action.args.thoughts) ?? false,
          toolCalls: parseRecentBool(action.args.toolCalls) ?? false,
          messages: parseRecentBool(action.args.messages) ?? true,
        })
        this.#engine.sendActionResult(action.id, action.name, result)
        break
      }
      case "remember_session": {
        const text = typeof action.args.text === "string" ? action.args.text : ""
        const id = typeof action.args.id === "string" ? action.args.id : undefined
        if (!text) {
          this.#engine.sendActionResult(action.id, action.name, {
            ok: false,
            items: this.#sessionMemory,
            full: false,
            reason: "empty-text",
          })
          break
        }
        const result = rememberSession(this.#sessionMemory, { text, id })
        this.#sessionMemory = [...result.items]
        this.#engine.sendActionResult(action.id, action.name, result)
        break
      }
      case "remember_always": {
        const text = typeof action.args.text === "string" ? action.args.text : ""
        const id = typeof action.args.id === "string" ? action.args.id : undefined
        if (!text) {
          this.#engine.sendActionResult(action.id, action.name, {
            ok: false,
            items: this.#alwaysMemory,
            full: false,
            reason: "empty-text",
          })
          break
        }
        const result = rememberAlways(this.#alwaysMemory, { text, id })
        if (result.ok) {
          this.#alwaysMemory = [...result.items]
          saveAlwaysMemory(this.#alwaysMemory)
        }
        this.#engine.sendActionResult(action.id, action.name, result)
        break
      }
      case "list_config": {
        const snapshot = formatListConfigSnapshot(this.#buildListConfigInput())
        this.#engine.sendActionResult(action.id, action.name, { status: "ok", ...snapshot })
        break
      }
      case "set_session_config": {
        const id = typeof action.args.id === "string" ? action.args.id : ""
        const rawValue = typeof action.args.value === "string" ? action.args.value : ""
        if (this.#session.status !== "connected") {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "error",
            reason: "not-connected",
          })
          break
        }
        if (id === "thinking") {
          if (!this.#session.supports?.thinkingTokens) {
            this.#engine.sendActionResult(action.id, action.name, {
              status: "error",
              reason: "unknown-id",
            })
            break
          }
          const level = rawValue as keyof typeof THINKING_TOKEN_VALUES
          if (!(level in THINKING_TOKEN_VALUES)) {
            this.#engine.sendActionResult(action.id, action.name, {
              status: "error",
              reason: "invalid-value",
            })
            break
          }
          void this.#session.setThinkingTokens(THINKING_TOKEN_VALUES[level] ?? null)
          this.#engine.sendActionResult(action.id, action.name, { status: "ok", id, value: rawValue })
          break
        }
        const validation = this.#validateSessionConfigValue(id, rawValue)
        if (!validation.ok) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "error",
            reason: validation.reason,
          })
          break
        }
        void this.#session.applyConfigOption(id, validation.parsed)
        this.#engine.sendActionResult(action.id, action.name, {
          status: "ok",
          id,
          value: validation.parsed,
        })
        break
      }
      case "set_app_setting": {
        const key = typeof action.args.key === "string" ? action.args.key : ""
        const value = typeof action.args.value === "string" ? action.args.value : ""
        const themeChoices = [...PALETTES]
        const verdict = validateAppSetting(key, value, { themeChoices })
        if (!verdict.ok) {
          this.#engine.sendActionResult(action.id, action.name, {
            status: "error",
            reason: verdict.reason,
          })
          break
        }
        const settings = this.#getSettings()
        const theme = this.#getTheme()
        switch (key) {
          case "screenWakeLock":
            settings.setScreenWakeLock(value === "true")
            break
          case "locale":
            settings.setLocale(value as "he" | "en")
            break
          case "theme":
            theme.setPalette(value as (typeof PALETTES)[number])
            break
        }
        this.#engine.sendActionResult(action.id, action.name, { status: "ok", key, value })
        break
      }
      default:
        this.#engine.sendActionResult(action.id, action.name, {
          status: "not_sent",
          reason: "unknown-action",
        })
        break
    }
  }

  /** Silent chat seed + memory layers right after Live opens. */
  #injectSeedAndMemory(): void {
    const bubbles = mapBubblesToLiveSeed(this.#session.bubbles ?? [])
    const pending = this.#session.pendingPermission
    const toolCall = pending?.params.toolCall
    const seed = buildLiveSeed(
      {
        bubbles,
        turnState: mapSessionTurnState(this.#session.turnState, pending != null),
        pendingPermission: pending
          ? {
              toolName:
                (toolCall && "title" in toolCall && typeof toolCall.title === "string"
                  ? toolCall.title
                  : undefined) ||
                (toolCall && "name" in toolCall && typeof toolCall.name === "string"
                  ? toolCall.name
                  : undefined) ||
                (toolCall && "kind" in toolCall && typeof toolCall.kind === "string"
                  ? toolCall.kind
                  : undefined) ||
                "tool",
            }
          : null,
        lastUserMessage: this.#session.lastUserMessage || null,
      },
      LIVE_SEED_LABELS,
    )
    for (const turn of seed.turns) {
      this.#engine.sendContext(turn.text, "silent")
    }

    const combined = [...this.#alwaysMemory, ...this.#sessionMemory]
    const mem = formatMemoryForPrompt(combined)
    if (mem.length > 0) {
      this.#engine.sendContext(`Secretary memory:\n${mem}`, "silent")
    }

    const configSnap = formatListConfigSnapshot(this.#buildListConfigInput())
    this.#engine.sendContext(formatConfigSeedProse(configSnap), "silent")
  }

  #buildListConfigInput(): ListConfigInput {
    const s = this.#session
    const settings = this.#getSettings()
    const theme = this.#getTheme()

    const sessionPart: ListConfigInput["session"] = {
      connected: s.status === "connected",
      options: [],
    }

    const configOptions = s.configOptions ?? []

    if ((s.models?.availableModels?.length ?? 0) > 0) {
      const models = s.models!
      const current = models.availableModels.find((m) => m.modelId === models.currentModelId)
      sessionPart.model = {
        id: models.currentModelId,
        name: current?.name,
        choices: models.availableModels.map((m) => ({ id: m.modelId, name: m.name })),
      }
    } else {
      const modelOpt = configOptions.find((o) => o.category === "model")
      if (modelOpt?.type === "select") {
        const choices = flattenSelectOptions(modelOpt)
        if (choices.length > 0) {
          sessionPart.model = {
            id: modelOpt.currentValue ?? "",
            name: modelOpt.name,
            choices: toConfigChoices(choices),
          }
        }
      }
    }

    if ((s.modes?.availableModes?.length ?? 0) > 0) {
      const modes = s.modes!
      const current = modes.availableModes.find((m) => m.id === modes.currentModeId)
      sessionPart.mode = {
        id: modes.currentModeId,
        name: current?.name,
        choices: modes.availableModes.map((m) => ({ id: m.id, name: m.name })),
      }
    } else {
      const modeOpt = configOptions.find((o) => o.category === "mode")
      if (modeOpt?.type === "select") {
        const choices = flattenSelectOptions(modeOpt)
        if (choices.length > 0) {
          sessionPart.mode = {
            id: modeOpt.currentValue ?? "",
            name: modeOpt.name,
            choices: toConfigChoices(choices),
          }
        }
      }
    }

    const extraOptions = configOptions.filter(
      (o) => o.category !== "model" && o.category !== "mode",
    )
    for (const opt of extraOptions) {
      if (opt.type === "select") {
        const choices = flattenSelectOptions(opt)
        if (choices.length === 0) continue
        sessionPart.options.push({
          id: opt.id,
          name: opt.name,
          type: "select",
          current: opt.currentValue ?? null,
          choices: toConfigChoices(choices),
        })
      } else if (opt.type === "boolean") {
        sessionPart.options.push({
          id: opt.id,
          name: opt.name,
          type: "boolean",
          current: opt.currentValue,
        })
      }
    }

    if (s.supports?.thinkingTokens) {
      sessionPart.thinkingAvailable = true
    }

    return {
      session: sessionPart,
      app: {
        screenWakeLock: settings.screenWakeLock,
        locale: settings.locale,
        theme: theme.palette,
        themeChoices: [...PALETTES],
      },
    }
  }

  #validateSessionConfigValue(
    id: string,
    rawValue: string,
  ):
    | { ok: true; parsed: string | boolean }
    | { ok: false; reason: "unknown-id" | "invalid-value" } {
    const snap = formatListConfigSnapshot(this.#buildListConfigInput())

    if (id === "model") {
      if (!snap.session.model) return { ok: false, reason: "unknown-id" }
      if (!snap.session.model.choices.some((c) => c.id === rawValue)) {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true, parsed: rawValue }
    }

    if (id === "mode") {
      if (!snap.session.mode) return { ok: false, reason: "unknown-id" }
      if (!snap.session.mode.choices.some((c) => c.id === rawValue)) {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true, parsed: rawValue }
    }

    const opt = snap.session.options.find((o) => o.id === id)
    if (!opt) return { ok: false, reason: "unknown-id" }

    if (opt.type === "boolean") {
      if (rawValue !== "true" && rawValue !== "false") {
        return { ok: false, reason: "invalid-value" }
      }
      return { ok: true, parsed: rawValue === "true" }
    }

    if (!opt.choices?.some((c) => c.id === rawValue)) {
      return { ok: false, reason: "invalid-value" }
    }
    return { ok: true, parsed: rawValue }
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

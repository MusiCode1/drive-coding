import type {
  AcpTransport,
  CacheStore,
  ServerMessage,
  SessionNotification,
} from "@drive-coding/core"
import { extractProviderError } from "@drive-coding/core/acp/provider-error"
import type { Cache } from "@drive-coding/core/cache/types"
import { createLogger } from "@drive-coding/core/log"
import { generateText } from "ai"
import type {
  NarrateContext,
  NarrationGenerator,
  NarrationValue,
  ToolCallForNarrate,
} from "../voice/narration.js"
import { narrateToolCall } from "../voice/narration.js"
import {
  speakSentence,
  splitIntoSentences,
  transcribeUserAudio,
  translateText,
  type VoiceCallbacks,
  type VoiceConfig,
} from "../voice/pipeline.js"
import type { VoiceRegistries } from "../voice/providers.js"
import type { RecordingsStore } from "./recordings-store.js"

export type Subscriber = (msg: ServerMessage) => void

/**
 * Summarise ToolCallContent[] to a short text preview for UI.
 * Content types: `content` (Content block — text/image), `diff`, `terminal`.
 * For Slice 5.5 we collapse everything to a single string; richer rendering
 * (collapsible diff, live terminal) is Slice 7.
 */
function summariseToolContent(items: ReadonlyArray<unknown>): string {
  const parts: string[] = []
  for (const item of items) {
    if (!item || typeof item !== "object") continue
    const it = item as Record<string, unknown>
    if (it.type === "content" && it.content && typeof it.content === "object") {
      const inner = it.content as Record<string, unknown>
      if (inner.type === "text" && typeof inner.text === "string") {
        parts.push(inner.text)
      }
    } else if (it.type === "diff" && typeof it.path === "string") {
      parts.push(`diff: ${it.path}`)
    } else if (it.type === "terminal") {
      parts.push("terminal output")
    }
  }
  const joined = parts.join("\n")
  // Cap at 2000 chars to avoid choking the WS frame on huge file reads.
  return joined.length > 2000 ? `${joined.slice(0, 2000)}…` : joined
}

/**
 * AgentSession holds an AcpTransport and a set of WS subscribers.
 * All subscribers receive every broadcast event (multi-tab fan-out).
 * Slice 5: extended with sendAudioPrompt for voice round-trip.
 * Tier 1 (Phase 4): full coordination — thought buffer, narration, IDs.
 */
export type AgentSession = {
  readonly agentId: string
  /** Subscribe to broadcast events. Returns an unsubscribe function. */
  readonly subscribe: (cb: Subscriber) => () => void
  /** Send a text prompt to the agent. Broadcasts thinking/chunks/done/error events. */
  readonly sendPrompt: (text: string) => Promise<void>
  /**
   * Send audio prompt — full voice round-trip:
   * STT → ACP → sentence batching → translation → TTS → audio_chunk broadcasts.
   * Tier 1: also handles thought TTS, tool-call narration, ID tracking.
   */
  readonly sendAudioPrompt: (
    audioBytes: Uint8Array,
    mimeType: string,
    voiceConfig: VoiceConfig,
    callbacks: VoiceCallbacks,
    registries: VoiceRegistries,
    cache: CacheStore,
  ) => Promise<void>
  /** Cancel in-flight prompt. */
  readonly cancel: () => Promise<void>
  /** Shutdown the transport. */
  readonly shutdown: () => Promise<void>
}

export function createAgentSession(opts: {
  agentId: string
  transport: AcpTransport
  /** Optional: callback to retrieve stderr lines from the running agent bridge. */
  getStderr?: () => string[]
  /**
   * Slice 8a: session history support.
   * When provided, the session broadcasts history_start → history_chunks → history_done
   * on the next microtask (giving callers time to subscribe before events fire).
   */
  historyBuffer?: SessionNotification[]
  historySessionId?: string
  /** Slice 8a: when provided, audio blobs are saved before STT + audio_recording_saved emitted. */
  recordingsStore?: RecordingsStore
}): AgentSession {
  const baseLog = createLogger("backend.session").child({ agentId: opts.agentId })
  const subscribers = new Set<Subscriber>()

  // PROMPT-1: busy flag — prevents concurrent prompts from corrupting state.
  let isBusy = false

  // Cancel signal for in-flight audio prompt TTS queue.
  let audioPromptCancelled = false

  function broadcast(msg: ServerMessage): void {
    for (const sub of subscribers) {
      try {
        sub(msg)
      } catch (e) {
        baseLog.error({ err: e }, "subscriber threw")
      }
    }
  }

  // ── Slice 8a: History replay ────────────────────────────────────────────────
  // If a historyBuffer was provided (agent created with existingSessionId), schedule
  // history broadcast for the next microtask so callers can subscribe first.
  if (opts.historyBuffer !== undefined && opts.historySessionId) {
    const buffer = opts.historyBuffer
    const sessionId = opts.historySessionId
    queueMicrotask(() => {
      broadcast({ type: "history_start", agentId: opts.agentId, sessionId })
      for (const notification of buffer) {
        const update = notification.update
        switch (update.sessionUpdate) {
          case "agent_message_chunk":
          case "agent_thought_chunk":
          case "user_message_chunk": {
            const content = update.content
            if (content.type !== "text") break
            const kind =
              update.sessionUpdate === "agent_message_chunk"
                ? ("message" as const)
                : update.sessionUpdate === "agent_thought_chunk"
                  ? ("thought" as const)
                  : ("user_message" as const)
            broadcast({
              type: "history_chunk",
              kind,
              text: content.text,
              messageId: crypto.randomUUID(),
            })
            break
          }
          case "tool_call": {
            broadcast({
              type: "history_tool_call",
              toolCallId: String(update.toolCallId),
              title: "title" in update && typeof update.title === "string" ? update.title : "",
              ...("kind" in update && update.kind != null ? { kind: String(update.kind) } : {}),
              ...("status" in update && update.status != null
                ? { status: String(update.status) }
                : {}),
            })
            break
          }
          default:
            break
        }
      }
      broadcast({ type: "history_done" })
    })
  }

  /**
   * Generic notification handler used by sendPrompt (text path).
   * Broadcasts text_chunk, tool_call, etc. without voice-specific logic.
   */
  function handleNotification(notification: SessionNotification): void {
    const update = notification.update

    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const content = update.content
        if (content.type === "text") {
          broadcast({
            type: "text_chunk",
            kind: "message",
            text: content.text,
          })
        }
        break
      }
      case "agent_thought_chunk": {
        const content = update.content
        if (content.type === "text") {
          broadcast({
            type: "text_chunk",
            kind: "thought",
            text: content.text,
          })
        }
        break
      }
      case "tool_call":
      case "tool_call_update": {
        broadcast({
          type: "tool_call",
          toolCallId: String(update.toolCallId),
          title: "title" in update && typeof update.title === "string" ? update.title : "tool call",
          ...(update.kind != null ? { kind: update.kind } : {}),
          ...(update.status != null ? { status: update.status } : {}),
          ...(update.locations != null && update.locations.length > 0
            ? { locations: update.locations.map((l) => l.path) }
            : {}),
          ...(update.content != null && update.content.length > 0
            ? { content: summariseToolContent(update.content) }
            : {}),
        })
        break
      }
      default:
        break
    }
  }

  return {
    agentId: opts.agentId,

    subscribe(cb) {
      subscribers.add(cb)
      return () => subscribers.delete(cb)
    },

    async sendPrompt(text) {
      // PROMPT-1: reject concurrent prompts
      if (isBusy) {
        broadcast({ type: "error", code: "BUSY", message: "כבר בעיבוד הודעה אחרת" })
        return
      }
      isBusy = true

      broadcast({ type: "thinking" })

      try {
        let totalMessageChars = 0

        const response = await opts.transport.prompt({ text }, (notification) => {
          handleNotification(notification)
          // Track message chars for PROMPT-17 provider error detection
          const update = notification.update
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            totalMessageChars += update.content.text.length
          }
        })

        if (response.stopReason !== "end_turn") {
          baseLog.warn({ stopReason: response.stopReason }, "non-end-turn stopReason")
        }

        // PROMPT-17: if model returned nothing and stderr shows a provider error, surface it
        if (totalMessageChars === 0 && response.stopReason === "end_turn" && opts.getStderr) {
          const stderrLines = opts.getStderr()
          const providerErr = extractProviderError(stderrLines)
          if (providerErr) {
            broadcast({
              type: "error",
              code: "PROVIDER_ERROR",
              message: `שגיאת provider: ${providerErr}`,
            })
          }
        }

        broadcast({
          type: "done",
          stopReason: response.stopReason,
        })
      } catch (e) {
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
      } finally {
        isBusy = false
      }
    },

    async sendAudioPrompt(audioBytes, mimeType, voiceConfig, callbacks, registries, cache) {
      const promptId = crypto.randomUUID().slice(0, 8)
      const log = baseLog.ns("audio").child({ promptId })
      const t0 = performance.now()

      log.info({ bytes: audioBytes.length, mimeType }, "sendAudioPrompt start")

      // ── 0. Save recording (Slice 8a) ─────────────────────────────────────────
      // Persist the raw audio BEFORE STT so the user can replay it later.
      if (opts.recordingsStore) {
        try {
          const tRec = performance.now()
          const { id: recordingId } = await opts.recordingsStore.save(audioBytes, mimeType)
          log.debug({ recordingId, dur: performance.now() - tRec }, "recording saved")
          broadcast({
            type: "audio_recording_saved",
            recordingId,
            mimeType,
          })
        } catch (e) {
          // Non-fatal — recording storage failure should not block the voice pipeline
          log.warn({ err: String(e) }, "recording save failed")
        }
      }

      // ── 1. STT ──────────────────────────────────────────────────────────────
      const tStt = performance.now()
      const sttRes = await transcribeUserAudio(
        { bytes: audioBytes, mimeType },
        voiceConfig,
        { stt: registries.stt },
        log,
      )

      if (sttRes.isErr()) {
        log.warn({ err: sttRes.error }, "STT failed")
        callbacks.onError(sttRes.error)
        return
      }

      const userText = sttRes.value
      log.info({ dur: performance.now() - tStt, len: userText.length }, "STT done")

      // STT-8: empty transcript → done immediately, skip ACP prompt
      if (!userText.trim()) {
        broadcast({ type: "done", stopReason: "end_turn" })
        return
      }

      callbacks.onSttPartial(userText)

      // ── 2. State ─────────────────────────────────────────────────────────────
      const userMessage = userText // stable snapshot for narration context

      let acpMessageBuffer = "" // accumulates message chunks between sentence boundaries
      let acpThoughtBuffer = "" // accumulates thought chunks

      let currentMessageId: string | null = null // UUID for current message stream
      let currentThoughtId: string | null = null // UUID for current thought stream

      // FIFO max 3 recent assistant messages — context for narrateToolCall
      const recentMessages: string[] = []

      // ── TtsJob union ─────────────────────────────────────────────────────────
      type TtsJob =
        | { kind: "message"; text: string; segmentId: string; messageId: string }
        | { kind: "thought"; text: string; segmentId: string; messageId: string }
        | {
            kind: "narration"
            toolCallId: string
            ctx: NarrateContext
            tool: ToolCallForNarrate
            segmentId: string
            messageId: string
          }

      const sentenceQueue: TtsJob[] = []
      let ttsActive = false

      // Reset cancel flag for this call
      audioPromptCancelled = false

      // In-memory narration cache (per audio prompt — resets between calls)
      const narrationCacheMap = new Map<string, NarrationValue>()
      const internalNarrationCache: Cache<NarrationValue> = {
        get: async (k) => narrationCacheMap.get(k) ?? null,
        set: async (k, v) => {
          narrationCacheMap.set(k, v)
        },
        has: async (k) => narrationCacheMap.has(k),
      }

      // Narration generator backed by the translator model
      const narrationGenerator: NarrationGenerator = {
        async generateContent(prompt: string): Promise<string> {
          const model =
            registries.translator[voiceConfig.translatorModel as keyof typeof registries.translator]
          if (!model) return ""
          try {
            const { text } = await generateText({ model, prompt })
            return text
          } catch (e) {
            baseLog.warn({ err: e }, "narration gen returned empty")
            return ""
          }
        },
      }

      // ── 3. processQueue ──────────────────────────────────────────────────────
      async function processQueue(): Promise<void> {
        if (ttsActive) {
          log
            .ns("tts")
            .debug(
              { queueLen: sentenceQueue.length },
              "processQueue called but ttsActive=true — skip",
            )
          return
        }
        log.ns("tts").debug({ queueLen: sentenceQueue.length }, "ttsActive: false→true")
        ttsActive = true
        while (sentenceQueue.length > 0 && !audioPromptCancelled) {
          const job = sentenceQueue.shift()
          if (job === undefined) break
          log.ns("tts").debug(
            {
              kind: job.kind,
              segmentId:
                job.kind !== "narration" ? job.segmentId.slice(0, 8) : job.segmentId.slice(0, 8),
            },
            "processing job",
          )

          let textToSpeak: string
          let originalText: string

          if (job.kind === "narration") {
            // Narrate the tool call in Hebrew
            const nr = await narrateToolCall(
              job.ctx,
              job.tool,
              narrationGenerator,
              internalNarrationCache,
            )
            if (nr.isErr()) {
              callbacks.onError(nr.error)
              continue
            }
            textToSpeak = nr.value
            originalText = nr.value
            // Broadcast narration text to update tool card
            broadcast({
              type: "tool_call_update",
              toolCallId: job.toolCallId,
              narration: textToSpeak,
            })
          } else {
            // Translate message or thought
            const tr = await translateText(
              job.text,
              voiceConfig,
              { translator: registries.translator },
              null,
            )
            if (tr.isErr()) {
              log.warn({ err: tr.error, charLen: job.text.length }, "translation failed — skip")
              callbacks.onError(tr.error)
              // continue — don't drop remaining queue items (Phase 1 fix preserved)
              continue
            }
            textToSpeak = tr.value
            originalText = job.text
            callbacks.onTranslation?.(job.text, tr.value)
          }

          if (audioPromptCancelled) break

          // TTS → broadcast audio_chunk with full Tier 1 metadata
          const ttsRes = await speakSentence(
            textToSpeak,
            voiceConfig,
            { tts: registries.tts },
            cache,
            (mp3Base64) => {
              broadcast({
                type: "audio_chunk",
                mp3Base64,
                segmentId: job.segmentId,
                messageId: job.messageId,
                kind: job.kind,
                originalText,
                translatedText: textToSpeak,
              })
              // Backward compat — existing tests capture audio via callbacks
              callbacks.onAudioChunk(mp3Base64)
            },
            log,
          )
          if (ttsRes.isErr()) callbacks.onError(ttsRes.error)
        }
        log.ns("tts").debug({}, "ttsActive: true→false")
        ttsActive = false
      }

      // ── 4. Buffer flushers ────────────────────────────────────────────────────

      async function flushMessage(): Promise<void> {
        const text = acpMessageBuffer.trim()
        acpMessageBuffer = ""
        if (!text) return
        if (!currentMessageId) currentMessageId = crypto.randomUUID()
        const msgId = currentMessageId

        // Update FIFO recentMessages for narration context
        recentMessages.push(text)
        if (recentMessages.length > 3) recentMessages.shift()

        sentenceQueue.push({
          kind: "message",
          text,
          segmentId: crypto.randomUUID(),
          messageId: msgId,
        })
        currentMessageId = null
        await processQueue()
      }

      async function flushThought(): Promise<void> {
        const text = acpThoughtBuffer.trim()
        acpThoughtBuffer = ""
        if (!text) return
        if (!currentThoughtId) currentThoughtId = crypto.randomUUID()
        const thoughtId = currentThoughtId

        sentenceQueue.push({
          kind: "thought",
          text,
          segmentId: crypto.randomUUID(),
          messageId: thoughtId,
        })
        currentThoughtId = null
        await processQueue()
      }

      // ── 5. ACP prompt ─────────────────────────────────────────────────────────
      broadcast({ type: "thinking" })

      log.info({ len: userText.length }, "→ ACP prompt")
      const tAcp = performance.now()
      let promptStopReason = "end_turn"
      let totalMessageChars = 0

      try {
        const response = await opts.transport.prompt({ text: userText }, (notification) => {
          const update = notification.update

          switch (update.sessionUpdate) {
            case "agent_message_chunk": {
              const content = update.content
              if (content.type !== "text") break
              const chunk = content.text
              totalMessageChars += chunk.length

              // PROMPT-12: if thought was buffering, flush it synchronously-first
              if (acpThoughtBuffer.length > 0) {
                void flushThought()
              }

              if (!currentMessageId) currentMessageId = crypto.randomUUID()
              broadcast({
                type: "text_chunk",
                kind: "message",
                text: chunk,
                messageId: currentMessageId,
              })

              acpMessageBuffer += chunk
              const { sentences, remaining } = splitIntoSentences(acpMessageBuffer)
              acpMessageBuffer = remaining
              for (const s of sentences) {
                // Update recentMessages for each completed sentence (used by narrateToolCall)
                recentMessages.push(s)
                if (recentMessages.length > 3) recentMessages.shift()
                sentenceQueue.push({
                  kind: "message",
                  text: s,
                  segmentId: crypto.randomUUID(),
                  messageId: currentMessageId,
                })
              }
              if (sentences.length > 0) {
                processQueue().catch((e) => callbacks.onError(String(e)))
              }
              break
            }

            case "agent_thought_chunk": {
              const content = update.content
              if (content.type !== "text") break
              const chunk = content.text

              // PROMPT-11: if message was buffering, flush it synchronously-first
              if (acpMessageBuffer.length > 0) {
                void flushMessage()
              }

              if (!currentThoughtId) currentThoughtId = crypto.randomUUID()
              broadcast({
                type: "text_chunk",
                kind: "thought",
                text: chunk,
                messageId: currentThoughtId,
              })

              acpThoughtBuffer += chunk
              const { sentences, remaining } = splitIntoSentences(acpThoughtBuffer)
              acpThoughtBuffer = remaining
              for (const s of sentences) {
                sentenceQueue.push({
                  kind: "thought",
                  text: s,
                  segmentId: crypto.randomUUID(),
                  messageId: currentThoughtId,
                })
              }
              if (sentences.length > 0) {
                processQueue().catch((e) => callbacks.onError(String(e)))
              }
              break
            }

            case "tool_call": {
              const toolCallId = String(update.toolCallId)
              const title =
                "title" in update && typeof update.title === "string" ? update.title : ""
              const kind =
                "kind" in update && typeof update.kind === "string" ? update.kind : undefined
              const status =
                "status" in update && typeof update.status === "string" ? update.status : undefined

              // Broadcast tool_call event for UI display
              broadcast({
                type: "tool_call",
                toolCallId,
                title: title || "tool call",
                ...(kind != null ? { kind } : {}),
                ...(status != null ? { status } : {}),
              })

              // Queue narration only on initial pending tool_call
              if (status === "pending" || status === undefined) {
                // Flush buffers (synchronous parts run immediately; await yields)
                void flushMessage()
                void flushThought()

                const ctxSnapshot: NarrateContext = {
                  userMessage,
                  recentMessages: [...recentMessages],
                }
                const toolForNarrate: ToolCallForNarrate = {
                  toolCallId,
                  kind,
                  title,
                }
                sentenceQueue.push({
                  kind: "narration",
                  toolCallId,
                  ctx: ctxSnapshot,
                  tool: toolForNarrate,
                  segmentId: crypto.randomUUID(),
                  messageId: crypto.randomUUID(),
                })
                processQueue().catch((e) => callbacks.onError(String(e)))
              }
              break
            }

            case "tool_call_update": {
              // Broadcast status updates but don't re-narrate
              const toolCallId = String(update.toolCallId)
              const status =
                "status" in update && typeof update.status === "string" ? update.status : undefined
              const kind =
                "kind" in update && typeof update.kind === "string" ? update.kind : undefined
              broadcast({
                type: "tool_call",
                toolCallId,
                title:
                  "title" in update && typeof update.title === "string" ? update.title : toolCallId,
                ...(kind != null ? { kind } : {}),
                ...(status != null ? { status } : {}),
              })
              break
            }

            default:
              break
          }
        })
        promptStopReason = response.stopReason
        log.info(
          { dur: performance.now() - tAcp, stopReason: promptStopReason },
          "← ACP prompt done",
        )
      } catch (e) {
        log.error({ err: e }, "ACP prompt failed")
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
        callbacks.onError(`ACP failed: ${e instanceof Error ? e.message : String(e)}`)
        return
      }

      // PROMPT-17: surface provider error when model returns 0 message chars
      if (totalMessageChars === 0 && promptStopReason === "end_turn" && opts.getStderr) {
        const stderrLines = opts.getStderr()
        const providerErr = extractProviderError(stderrLines)
        if (providerErr) {
          broadcast({
            type: "error",
            code: "PROVIDER_ERROR",
            message: `שגיאת provider: ${providerErr}`,
          })
        }
      }

      // ── 6. Flush trailing buffers ──────────────────────────────────────────
      await flushMessage()
      await flushThought()

      // ── 7. Wait for TTS queue to drain ────────────────────────────────────
      let attempts = 0
      while (ttsActive && attempts < 300) {
        await new Promise((r) => setTimeout(r, 100))
        attempts++
      }

      // Drain safety — retry if items remain after polling
      let drainAttempts = 0
      while (sentenceQueue.length > 0 && drainAttempts < 10) {
        drainAttempts++
        await processQueue()
        if (ttsActive) {
          await new Promise((r) => setTimeout(r, 50))
        }
      }

      log.info(
        { dur: performance.now() - t0, stopReason: promptStopReason },
        "sendAudioPrompt done",
      )
      broadcast({
        type: "done",
        stopReason: promptStopReason,
      })
    },

    async cancel() {
      audioPromptCancelled = true
      await opts.transport.cancel()
    },

    async shutdown() {
      await opts.transport.shutdown()
    },
  }
}

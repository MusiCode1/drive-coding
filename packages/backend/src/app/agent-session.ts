import type {
  AcpTransport,
  CacheStore,
  ServerMessage,
  SessionNotification,
} from "@drive-coding/core"
import type { Cache } from "@drive-coding/core/cache/types"
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
}): AgentSession {
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
        console.error("[agent-session] subscriber threw:", e)
      }
    }
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
        const response = await opts.transport.prompt({ text }, handleNotification)

        if (response.stopReason !== "end_turn") {
          console.warn(`[agent-session] prompt completed with stopReason=${response.stopReason}`)
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
      // ── 1. STT ──────────────────────────────────────────────────────────────
      const sttRes = await transcribeUserAudio({ bytes: audioBytes, mimeType }, voiceConfig, {
        stt: registries.stt,
      })

      if (sttRes.isErr()) {
        callbacks.onError(sttRes.error)
        return
      }

      const userText = sttRes.value

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
          } catch {
            return ""
          }
        },
      }

      // ── 3. processQueue ──────────────────────────────────────────────────────
      async function processQueue(): Promise<void> {
        if (ttsActive) return
        ttsActive = true
        while (sentenceQueue.length > 0 && !audioPromptCancelled) {
          const job = sentenceQueue.shift()
          if (job === undefined) break

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
              console.warn(
                `[voice/pipeline] Translation failed, skipping sentence (${job.text.length}ch): ${tr.error}`,
              )
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
          )
          if (ttsRes.isErr()) callbacks.onError(ttsRes.error)
        }
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

      let promptStopReason = "end_turn"

      try {
        const response = await opts.transport.prompt({ text: userText }, (notification) => {
          const update = notification.update

          switch (update.sessionUpdate) {
            case "agent_message_chunk": {
              const content = update.content
              if (content.type !== "text") break
              const chunk = content.text

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
      } catch (e) {
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
        callbacks.onError(`ACP failed: ${e instanceof Error ? e.message : String(e)}`)
        return
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

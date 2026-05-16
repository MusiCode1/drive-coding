import type {
  AcpTransport,
  CacheStore,
  ServerMessage,
  SessionNotification,
} from "@drive-coding/core"
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
 * AgentSession holds an AcpTransport and a set of WS subscribers.
 * All subscribers receive every broadcast event (multi-tab fan-out).
 * Slice 5: extended with sendAudioPrompt for voice round-trip.
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
}): AgentSession {
  const subscribers = new Set<Subscriber>()

  function broadcast(msg: ServerMessage): void {
    for (const sub of subscribers) {
      try {
        sub(msg)
      } catch (e) {
        console.error("[agent-session] subscriber threw:", e)
      }
    }
  }

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
      case "tool_call": {
        broadcast({
          type: "tool_call",
          toolCallId: String(update.toolCallId),
          title: update.title,
        })
        break
      }
      // Other update kinds (plan, usage, etc.) — silent in Slice 4/5
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
      broadcast({ type: "thinking" })

      try {
        const response = await opts.transport.prompt({ text }, handleNotification)

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
      }
    },

    async sendAudioPrompt(audioBytes, mimeType, voiceConfig, callbacks, registries, cache) {
      // 1. STT
      const sttRes = await transcribeUserAudio({ bytes: audioBytes, mimeType }, voiceConfig, {
        stt: registries.stt,
      })

      if (sttRes.isErr()) {
        callbacks.onError(sttRes.error)
        return
      }

      const userText = sttRes.value
      callbacks.onSttPartial(userText)

      // 2. Send user text to ACP agent, accumulate text_chunks
      broadcast({ type: "thinking" })

      let acpBuffer = ""
      const sentenceQueue: string[] = []
      let ttsActive = false
      // lastAssistantText accumulates for future STT context (Slice 6+)
      let _lastAssistantText = ""

      // Process queue of sentences: translate → TTS
      async function processQueue(): Promise<void> {
        if (ttsActive) return
        ttsActive = true
        while (sentenceQueue.length > 0) {
          const sentence = sentenceQueue.shift()
          if (sentence === undefined) break

          // Translate the sentence
          const trRes = await translateText(sentence, voiceConfig, {
            translator: registries.translator,
          })
          if (trRes.isErr()) {
            callbacks.onError(trRes.error)
            ttsActive = false
            return
          }

          callbacks.onTranslation?.(sentence, trRes.value)

          // TTS the translated sentence
          const ttsRes = await speakSentence(
            trRes.value,
            voiceConfig,
            { tts: registries.tts },
            cache,
            callbacks.onAudioChunk,
          )
          if (ttsRes.isErr()) {
            callbacks.onError(ttsRes.error)
          }

          _lastAssistantText += `${trRes.value} `
        }
        ttsActive = false
      }

      try {
        await opts.transport.prompt({ text: userText }, (notification) => {
          // Forward to text_chunk subscribers (display streaming text)
          handleNotification(notification)

          // Also accumulate for voice pipeline
          const update = notification.update
          if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
            acpBuffer += update.content.text
            const { sentences, remaining } = splitIntoSentences(acpBuffer)
            acpBuffer = remaining
            if (sentences.length > 0) {
              sentenceQueue.push(...sentences)
              // fire-and-forget — don't await here so ACP streaming continues
              processQueue().catch((e) => callbacks.onError(String(e)))
            }
          }
        })
      } catch (e) {
        broadcast({
          type: "error",
          code: "PROMPT_FAILED",
          message: e instanceof Error ? e.message : String(e),
        })
        callbacks.onError(`ACP failed: ${e instanceof Error ? e.message : String(e)}`)
        return
      }

      // 3. Flush trailing buffer (last partial sentence)
      if (acpBuffer.trim().length > 0) {
        sentenceQueue.push(acpBuffer.trim())
        acpBuffer = ""
        await processQueue()
      }

      // 4. Wait for TTS queue to drain
      // Simple polling — if ttsActive, wait in small increments
      let attempts = 0
      while (ttsActive && attempts < 300) {
        await new Promise((r) => setTimeout(r, 100))
        attempts++
      }

      broadcast({
        type: "done",
        stopReason: "end_turn",
      })
    },

    async cancel() {
      await opts.transport.cancel()
    },

    async shutdown() {
      await opts.transport.shutdown()
    },
  }
}

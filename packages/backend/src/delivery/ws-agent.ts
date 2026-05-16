import type { CacheStore } from "@drive-coding/core"
import { ClientMessage, type ServerMessage } from "@drive-coding/core"
import { type } from "arktype"
import type { ServerWebSocket, WebSocketHandler } from "bun"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { VoiceConfig } from "../voice/pipeline.js"
import type { VoiceRegistries } from "../voice/providers.js"

export type AgentWsData = {
  kind: "agent"
  agentId: string
  unsubscribe?: () => void
}

function send(ws: ServerWebSocket<AgentWsData>, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg))
  } catch {
    // ws already closed — ignore
  }
}

/**
 * Default voice configuration for Slice 5.
 * Slice 8 will allow per-agent override.
 */
const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  sttModel: "gemini/flash-context",
  ttsModel: "elevenlabs/v3",
  // Sarah — pleasant Hebrew-capable voice. ElevenLabs requires voice_id, not name.
  ttsVoiceId: "EXAVITQu4vr4xnSDxMaL",
  translatorModel: "gemini/flash-lite",
  targetLang: "he",
}

/**
 * WebSocket handler for /ws/agent/:id
 *
 * Protocol (drive-coding-ws):
 *   Client → Server: ping | prompt | cancel | audio  (ClientMessage)
 *   Server → Client: connected | thinking | text_chunk | tool_call | done | error
 *                    stt_partial | audio_chunk | translation  (ServerMessage)
 */
export function createAgentWsHandler(deps: {
  orchestrator: AgentOrchestrator
  registries: VoiceRegistries
  cache: CacheStore
}): {
  websocket: WebSocketHandler<AgentWsData>
  tryUpgrade: (req: Request, server: ReturnType<typeof Bun.serve>) => Response | undefined
} {
  const websocket: WebSocketHandler<AgentWsData> = {
    open(ws) {
      const agentId = ws.data.agentId
      const session = deps.orchestrator.getSession(agentId)
      if (!session) {
        send(ws, { type: "error", code: "AGENT_NOT_FOUND", message: agentId })
        ws.close(1008, "agent not found")
        return
      }

      send(ws, { type: "connected", agentId })

      // Subscribe to session broadcasts
      ws.data.unsubscribe = session.subscribe((msg) => send(ws, msg))
    },

    async message(ws, raw) {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        send(ws, { type: "error", code: "INVALID_JSON", message: "invalid json" })
        return
      }

      const result = ClientMessage(parsed)
      if (result instanceof type.errors) {
        send(ws, { type: "error", code: "INVALID_MSG", message: result.summary })
        return
      }

      const session = deps.orchestrator.getSession(ws.data.agentId)
      if (!session) {
        send(ws, { type: "error", code: "AGENT_NOT_FOUND", message: ws.data.agentId })
        return
      }

      switch (result.type) {
        case "ping":
          send(ws, { type: "pong", echoOf: "ping", serverTime: Date.now() })
          break

        case "prompt":
          // fire-and-forget — broadcasts via subscriber pattern
          session.sendPrompt(result.text).catch((e) => {
            console.error("[ws-agent] sendPrompt failed:", e)
          })
          break

        case "cancel":
          await session.cancel().catch((e) => {
            console.error("[ws-agent] cancel failed:", e)
          })
          break

        case "audio": {
          // Decode base64 audio
          const audioBytes = Buffer.from(result.audioBase64, "base64")

          // Voice callbacks — fan out to this WS client
          const voiceCallbacks = {
            onSttPartial: (text: string) => send(ws, { type: "stt_partial", text }),
            onAudioChunk: (mp3Base64: string) => send(ws, { type: "audio_chunk", mp3Base64 }),
            onTranslation: (original: string, translated: string) =>
              send(ws, { type: "translation", original, translated }),
            onError: (message: string) => send(ws, { type: "error", code: "VOICE_ERROR", message }),
          }

          // fire-and-forget (done is broadcast by sendAudioPrompt)
          session
            .sendAudioPrompt(
              new Uint8Array(audioBytes),
              result.mimeType,
              DEFAULT_VOICE_CONFIG,
              voiceCallbacks,
              deps.registries,
              deps.cache,
            )
            .catch((e) => {
              console.error("[ws-agent] sendAudioPrompt failed:", e)
              send(ws, { type: "error", code: "VOICE_ERROR", message: String(e) })
            })
          break
        }
      }
    },

    close(ws) {
      ws.data.unsubscribe?.()
    },
  }

  function tryUpgrade(req: Request, server: ReturnType<typeof Bun.serve>): Response | undefined {
    const url = new URL(req.url)
    const match = url.pathname.match(/^\/ws\/agent\/([^/]+)$/)
    if (!match) return undefined

    const agentId = match[1] ?? ""
    const upgraded = server.upgrade(req, {
      data: { kind: "agent", agentId } satisfies AgentWsData,
    })
    if (upgraded) return undefined
    return new Response("WS upgrade failed", { status: 426 })
  }

  return { websocket, tryUpgrade }
}

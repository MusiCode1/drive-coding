import type { CacheStore } from "@drive-coding/core"
import { ClientMessage, type ServerMessage } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { type } from "arktype"
import type { ServerWebSocket, WebSocketHandler } from "bun"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"
import type { VoiceConfig } from "../voice/pipeline.js"
import type { VoiceRegistries } from "../voice/providers.js"

const wsWireLog = createLogger("backend.ws.wire")
const wsAgentLog = createLogger("backend.ws.agent")

export type AgentWsData = {
  kind: "agent"
  agentId: string
  unsubscribe?: () => void
}

function send(ws: ServerWebSocket<AgentWsData>, msg: ServerMessage): void {
  const json = JSON.stringify(msg)
  wsWireLog.ns("tx").trace({ agentId: ws.data.agentId, type: msg.type, len: json.length }, "frame")
  try {
    ws.send(json)
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
      wsAgentLog.child({ agentId }).info({}, "WS connect")
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
      const rawStr = String(raw)
      wsWireLog.ns("rx").trace(
        {
          agentId: ws.data.agentId,
          len: rawStr.length,
          text: rawStr.length > 1000 ? `${rawStr.slice(0, 1000)}…` : rawStr,
        },
        "frame",
      )
      let parsed: unknown
      try {
        parsed = JSON.parse(rawStr)
      } catch {
        wsAgentLog
          .child({ agentId: ws.data.agentId })
          .warn(
            { raw: rawStr.length > 200 ? `${rawStr.slice(0, 200)}…` : rawStr },
            "JSON parse failed",
          )
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
            wsAgentLog
              .child({ agentId: ws.data.agentId })
              .error({ err: e, op: "sendPrompt" }, "operation failed")
          })
          break

        case "cancel":
          await session.cancel().catch((e) => {
            wsAgentLog
              .child({ agentId: ws.data.agentId })
              .error({ err: e, op: "cancel" }, "operation failed")
          })
          break

        case "audio": {
          // Decode base64 audio
          const audioBytes = Buffer.from(result.audioBase64, "base64")

          // Voice callbacks — fan out to this WS client.
          //
          // NOTE: onAudioChunk is intentionally a no-op. audio_chunk events are
          // broadcast with full Tier 1 metadata (segmentId, messageId, kind,
          // originalText, translatedText) via session.subscribe(). Sending here
          // would emit a *second* audio_chunk WS frame without metadata, which
          // bypasses the frontend's segmentId-keyed dedup and causes each TTS
          // segment to be played twice. The callback field is retained because
          // VoiceCallbacks declares it (legacy tests pass a counting impl).
          const voiceCallbacks = {
            onSttPartial: (text: string) => send(ws, { type: "stt_partial", text }),
            onAudioChunk: (_mp3Base64: string) => {
              /* no-op — see comment above */
            },
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
              wsAgentLog
                .child({ agentId: ws.data.agentId })
                .error({ err: e, op: "sendAudioPrompt" }, "operation failed")
              send(ws, { type: "error", code: "VOICE_ERROR", message: String(e) })
            })
          break
        }
      }
    },

    close(ws) {
      wsAgentLog.child({ agentId: ws.data.agentId }).info({}, "WS disconnect")
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

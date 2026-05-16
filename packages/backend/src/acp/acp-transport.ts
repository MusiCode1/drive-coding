import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type {
  AcpCapabilities,
  AcpTransport,
  PromptResponse,
  SessionNotification,
} from "@drive-coding/core"
import { WebSocket } from "ws"
import { createClientImpl } from "./client-impl.js"
import { wsToStreams } from "./ws-streams.js"

export type AcpTransportOptions = {
  /** ws://127.0.0.1:<port>/ */
  readonly wsUrl: string
  readonly cwd: string
  readonly protocolVersion?: number
}

/**
 * Creates an AcpTransport that connects to a stdio-to-ws bridge via WebSocket.
 *
 * The transport:
 *  1. Opens a WS connection to the bridge
 *  2. Converts ws frames ↔ byte streams via wsToStreams
 *  3. Wraps in ndJsonStream (NDJSON encoding/decoding expected by SDK)
 *  4. Creates a ClientSideConnection with the SDK
 *  5. Performs initialize + newSession handshake
 *  6. Returns an AcpTransport ready for prompt/cancel/shutdown
 */
export async function createAcpWsTransport(opts: AcpTransportOptions): Promise<AcpTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.wsUrl)

    // Timeout: 10s for WS open + handshake
    const timeout = setTimeout(() => {
      if (ws.readyState !== ws.OPEN) {
        ws.terminate()
        reject(new Error("ACP WS connection timeout"))
      }
    }, 10_000)

    ws.on("open", () => {
      ;(async () => {
        try {
          const { readable, writable } = wsToStreams(ws)

          // ndJsonStream wraps raw byte streams into AnyMessage streams
          // that the SDK's Connection reads/writes
          const stream = ndJsonStream(writable, readable)

          // Mutable reference for the sessionUpdate callback
          let onUpdateHandler: ((n: SessionNotification) => void) | null = null

          const clientImpl = createClientImpl({
            onSessionUpdate(notification) {
              onUpdateHandler?.(notification)
            },
          })

          const conn = new ClientSideConnection((_agent) => clientImpl, stream)

          // 1. Initialize
          const initResult = await conn.initialize({
            protocolVersion: opts.protocolVersion ?? 1,
            clientCapabilities: {},
          })

          const capabilities: AcpCapabilities = {
            loadSession: initResult.agentCapabilities?.loadSession ?? false,
          }

          // 2. New session
          const sessionResult = await conn.newSession({
            cwd: opts.cwd,
            mcpServers: [],
          })

          const sessionId = sessionResult.sessionId

          clearTimeout(timeout)

          const transport: AcpTransport = {
            async start(_input) {
              return { sessionId, capabilities }
            },

            async prompt(input, onUpdate) {
              onUpdateHandler = onUpdate
              try {
                const response: PromptResponse = await conn.prompt({
                  sessionId,
                  prompt: [{ type: "text", text: input.text }],
                })
                return response
              } finally {
                onUpdateHandler = null
              }
            },

            async cancel() {
              await conn.cancel({ sessionId })
            },

            async shutdown() {
              if (ws.readyState === ws.OPEN) {
                ws.close()
              }
            },
          }

          resolve(transport)
        } catch (e) {
          clearTimeout(timeout)
          ws.terminate()
          reject(e)
        }
      })()
    })

    ws.on("error", (err) => {
      clearTimeout(timeout)
      reject(new Error(`ACP WS error: ${err.message}`))
    })
  })
}

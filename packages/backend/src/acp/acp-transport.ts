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
    const t0 = Date.now()
    const log = (msg: string) => console.log(`[acp] +${Date.now() - t0}ms ${msg}`)

    log(`connecting to ${opts.wsUrl}`)

    // Timeout: 45s for the full handshake (WS open + initialize + newSession).
    // opencode acp can take 10-20s to spawn + initialize on a cold start
    // (npm cache miss, model auth check), and newSession itself may take a
    // few more seconds while opencode reads AGENTS.md and project context.
    // bridge-manager spawn timeout is 30s — this must be >= that.
    const HANDSHAKE_TIMEOUT_MS = 45_000
    const timeout = setTimeout(() => {
      log(`handshake timeout (${HANDSHAKE_TIMEOUT_MS}ms)`)
      ws.terminate()
      reject(new Error(`ACP handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms`))
    }, HANDSHAKE_TIMEOUT_MS)

    ws.on("open", () => {
      log("ws open")
      ;(async () => {
        try {
          // Wait for stdio-to-ws to spawn the agent subprocess and send its
          // handshake `{"type":"connected"}`. If we send `initialize` before
          // this, stdio-to-ws drops the frame (no subprocess to write to yet)
          // and we hang waiting for a response that never comes.
          log("waiting for stdio-to-ws handshake")
          await new Promise<void>((res, rej) => {
            const handshakeTimeout = setTimeout(() => {
              ws.off("message", onMsg)
              rej(new Error("stdio-to-ws handshake not received"))
            }, 10_000)
            const onMsg = (data: Buffer | string) => {
              const text = typeof data === "string" ? data : data.toString("utf8")
              if (text.includes('"connected"')) {
                clearTimeout(handshakeTimeout)
                ws.off("message", onMsg)
                res()
              }
              // (any other early frames will be replayed via wsToStreams once
              // we attach below — but ws.on() is fire-and-forget; safer to
              // attach BEFORE the handshake event arrives. Since the only
              // pre-handshake frame is `connected` itself, we lose nothing.)
            }
            ws.on("message", onMsg)
          })
          log("← stdio-to-ws connected")

          // stdio-to-ws sends `connected` the moment the WS upgrade completes —
          // BEFORE the agent subprocess has finished spawning. If we send
          // `initialize` immediately, stdio-to-ws drops the frame (no live
          // stdin to write to yet). Wait a bit for the subprocess to come up.
          // Empirically 500-1000ms is enough for opencode acp cold start.
          // TODO: stdio-to-ws should emit a second frame when subprocess is
          // ready — file an issue upstream.
          await new Promise((r) => setTimeout(r, 1500))
          log("subprocess warmup done")

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
          log("→ initialize")
          const initResult = await conn.initialize({
            protocolVersion: opts.protocolVersion ?? 1,
            clientCapabilities: {
              fs: { readTextFile: true, writeTextFile: true },
            },
            clientInfo: {
              name: "drive-coding",
              version: "0.1.0",
            },
          })
          log(`← initialize ok (agent=${initResult.agentInfo?.name ?? "?"})`)

          const capabilities: AcpCapabilities = {
            loadSession: initResult.agentCapabilities?.loadSession ?? false,
          }

          // 2. New session
          log(`→ newSession (cwd=${opts.cwd})`)
          const sessionResult = await conn.newSession({
            cwd: opts.cwd,
            mcpServers: [],
          })

          const sessionId = sessionResult.sessionId
          log(`← newSession ok (sessionId=${sessionId})`)

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
          // Detect ACP-defined `auth_required` JSON-RPC error and surface
          // it as a typed error so the caller can show an auth UI instead
          // of a generic "connection closed" message.
          // ACP error code: -32000 with data: { code: "auth_required", ... }
          // (the SDK wraps these as `RequestError`).
          const err = e as { code?: number; data?: { code?: string }; message?: string }
          if (err?.data?.code === "auth_required") {
            const authErr = new Error(
              `ACP agent requires authentication: ${err.message ?? "auth_required"}`,
            )
            ;(authErr as Error & { kind?: string }).kind = "auth_required"
            reject(authErr)
            return
          }
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

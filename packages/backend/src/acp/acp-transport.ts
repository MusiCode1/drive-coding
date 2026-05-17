import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type {
  AcpCapabilities,
  AcpError,
  AcpTransport,
  PromptResponse,
  SessionNotification,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { ResultAsync } from "neverthrow"
import { WebSocket } from "ws"
import { createClientImpl } from "./client-impl.js"
import { wsToStreams } from "./ws-streams.js"

const baseLog = createLogger("backend.acp.transport")

export type AcpTransportOptions = {
  /** ws://127.0.0.1:<port>/ */
  readonly wsUrl: string
  readonly cwd: string
  readonly protocolVersion?: number
  /** Warmup delay (ms) after stdio-to-ws connected frame. Default 1500. */
  readonly warmupDelayMs?: number
}

/** Uniform session info returned by session/list across all CLI kinds. */
export type SessionInfo = {
  readonly sessionId: string
  readonly cwd: string
  readonly title: string
  readonly updatedAt: string
}

// ─── Internal WS setup helper ─────────────────────────────────────────────────

type WsSetup = {
  conn: ClientSideConnection
  capabilities: AcpCapabilities
  setOnUpdate: (handler: ((n: SessionNotification) => void) | null) => void
  ws: WebSocket
}

/**
 * Opens a WS connection to a stdio-to-ws bridge, waits for the `connected`
 * handshake, applies the warmup delay, runs the ACP `initialize` handshake,
 * and returns the raw connection setup.
 *
 * Does NOT call session/new or session/load — caller decides which to use.
 */
function setupWsAndInitialize(opts: {
  wsUrl: string
  warmupDelayMs: number
  protocolVersion?: number
}): Promise<WsSetup> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.wsUrl)
    const t0 = Date.now()
    const transportLog = baseLog.child({ wsUrl: opts.wsUrl })

    transportLog.debug({}, "connecting")

    const HANDSHAKE_TIMEOUT_MS = 45_000
    const timeout = setTimeout(() => {
      transportLog.warn(
        { dur: Date.now() - t0, timeoutMs: HANDSHAKE_TIMEOUT_MS },
        "handshake timeout",
      )
      ws.terminate()
      reject(new Error(`ACP handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms`))
    }, HANDSHAKE_TIMEOUT_MS)

    ws.on("open", () => {
      transportLog.debug({}, "ws open")
      ;(async () => {
        try {
          transportLog.debug({}, "waiting for stdio-to-ws handshake")
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
            }
            ws.on("message", onMsg)
          })
          transportLog.debug({}, "← stdio-to-ws connected")

          if (opts.warmupDelayMs > 0) {
            await new Promise((r) => setTimeout(r, opts.warmupDelayMs))
          }
          transportLog.debug({}, "subprocess warmup done")

          const { readable, writable } = wsToStreams(ws)
          const stream = ndJsonStream(writable, readable)

          let onUpdateHandler: ((n: SessionNotification) => void) | null = null

          const clientImpl = createClientImpl({
            onSessionUpdate(notification) {
              onUpdateHandler?.(notification)
            },
          })

          const conn = new ClientSideConnection((_agent) => clientImpl, stream)

          const tInit = Date.now()
          transportLog.debug({}, "→ initialize")
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
          transportLog.info(
            { dur: Date.now() - tInit, agent: initResult.agentInfo?.name ?? "?" },
            "initialize done",
          )

          const capabilities: AcpCapabilities = {
            loadSession: initResult.agentCapabilities?.loadSession ?? false,
          }

          clearTimeout(timeout)
          resolve({
            conn,
            capabilities,
            setOnUpdate: (h) => {
              onUpdateHandler = h
            },
            ws,
          })
        } catch (e) {
          clearTimeout(timeout)
          ws.terminate()
          // Detect ACP-defined `auth_required` JSON-RPC error and surface it as
          // a typed error so the caller can show an auth UI instead of a generic
          // "connection closed" message. ACP error code: -32000 with
          // data: { code: "auth_required", ... }.
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

// ─── createAcpWsTransport (existing, uses session/new) ───────────────────────

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
  const { conn, capabilities, setOnUpdate, ws } = await setupWsAndInitialize({
    wsUrl: opts.wsUrl,
    warmupDelayMs: opts.warmupDelayMs ?? 1500,
    protocolVersion: opts.protocolVersion,
  })

  const tNew = Date.now()
  const transportLog = baseLog.child({ wsUrl: opts.wsUrl, cwd: opts.cwd })
  transportLog.debug({ cwd: opts.cwd }, "→ newSession")
  const sessionResult = await conn.newSession({
    cwd: opts.cwd,
    mcpServers: [],
  })

  const sessionId = sessionResult.sessionId
  transportLog.info({ dur: Date.now() - tNew, sessionId }, "newSession done")

  const transport: AcpTransport = {
    async start(_input) {
      return { sessionId, capabilities }
    },

    async prompt(input, onUpdate) {
      setOnUpdate(onUpdate)
      try {
        const response: PromptResponse = await conn.prompt({
          sessionId,
          prompt: [{ type: "text", text: input.text }],
        })
        return response
      } finally {
        setOnUpdate(null)
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

  return transport
}

// ─── listSessionsFromBridge ──────────────────────────────────────────────────

/**
 * Lists ACP sessions for a given bridge endpoint.
 * - Calls ACP session/list after initialize (no session creation).
 * - Returns ok([]) if CLI doesn't support session/list (error code -32601).
 * - Returns err({ kind: 'transport', ... }) on WS errors.
 * - Closes the WS connection when done.
 */
export function listSessionsFromBridge(opts: {
  wsUrl: string
  cwd: string
  /** Warmup delay after connected frame. Default 1500ms. Pass 0 in tests. */
  warmupDelayMs?: number
}): ResultAsync<readonly SessionInfo[], AcpError> {
  return ResultAsync.fromPromise(
    _listSessionsImpl(opts),
    (e): AcpError => ({
      kind: "transport",
      message: e instanceof Error ? e.message : String(e),
    }),
  )
}

async function _listSessionsImpl(opts: {
  wsUrl: string
  cwd: string
  warmupDelayMs?: number
}): Promise<readonly SessionInfo[]> {
  const { conn, ws } = await setupWsAndInitialize({
    wsUrl: opts.wsUrl,
    warmupDelayMs: opts.warmupDelayMs ?? 1500,
  })

  try {
    let sessions: readonly SessionInfo[] = []
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await (conn as any).listSessions({})
      const raw: unknown[] = (res as { sessions?: unknown[] })?.sessions ?? []
      sessions = raw.map((s): SessionInfo => {
        const item = s as Record<string, unknown>
        return {
          sessionId: String(item["sessionId"] ?? ""),
          cwd: String(item["cwd"] ?? ""),
          title: String(item["title"] ?? ""),
          updatedAt: String(item["updatedAt"] ?? ""),
        }
      })
    } catch (e: unknown) {
      // -32601: Method not found → fallback empty (e.g. Gemini doesn't support session/list)
      const err = e as { code?: number }
      if (err?.code === -32601) {
        sessions = []
      } else {
        throw e
      }
    }
    return sessions
  } finally {
    if (ws.readyState === (ws as unknown as { OPEN: number }).OPEN) {
      ws.close()
    }
  }
}

// ─── createAcpWsLoadTransport (uses session/load instead of session/new) ─────

/**
 * Creates an AcpTransport that loads an existing session (session/load) instead
 * of creating a new one (session/new).
 *
 * History notifications received during session/load are forwarded to
 * `onHistoryUpdate`. After the load resolves, `onHistoryUpdate` is cleared so
 * future prompt() notifications are handled by prompt's own onUpdate.
 *
 * The returned transport implements the same AcpTransport interface as
 * createAcpWsTransport, with `start()` returning the loaded sessionId.
 */
export async function createAcpWsLoadTransport(opts: {
  wsUrl: string
  cwd: string
  sessionId: string
  onHistoryUpdate: (n: SessionNotification) => void
  /** Warmup delay after connected frame. Default 1500ms. Pass 0 in tests. */
  warmupDelayMs?: number
}): Promise<AcpTransport> {
  const { conn, capabilities, setOnUpdate, ws } = await setupWsAndInitialize({
    wsUrl: opts.wsUrl,
    warmupDelayMs: opts.warmupDelayMs ?? 1500,
  })

  const tLoad = Date.now()
  const loadLog = baseLog.child({ wsUrl: opts.wsUrl, cwd: opts.cwd })

  // Set history update handler BEFORE calling loadSession so notifications
  // that arrive during the load are forwarded.
  setOnUpdate(opts.onHistoryUpdate)

  let loadedSessionId = opts.sessionId
  try {
    loadLog.debug({ sessionId: opts.sessionId, cwd: opts.cwd }, "→ loadSession")
    // The ACP SDK's loadSession is called via `as any` because the typed API
    // may not include it depending on SDK version (same pattern as v1).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await (conn as any).loadSession({
      sessionId: opts.sessionId,
      cwd: opts.cwd,
      mcpServers: [],
    })
    loadedSessionId = (res as { sessionId?: string })?.sessionId ?? opts.sessionId
    loadLog.info({ dur: Date.now() - tLoad, sessionId: loadedSessionId }, "loadSession done")
  } finally {
    // Clear history handler — future prompt() calls use their own onUpdate
    setOnUpdate(null)
  }

  const transport: AcpTransport = {
    async start(_input) {
      return { sessionId: loadedSessionId, capabilities }
    },

    async prompt(input, onUpdate) {
      setOnUpdate(onUpdate)
      try {
        const response: PromptResponse = await conn.prompt({
          sessionId: loadedSessionId,
          prompt: [{ type: "text", text: input.text }],
        })
        return response
      } finally {
        setOnUpdate(null)
      }
    },

    async cancel() {
      await conn.cancel({ sessionId: loadedSessionId })
    },

    async shutdown() {
      if (ws.readyState === (ws as unknown as { OPEN: number }).OPEN) {
        ws.close()
      }
    },
  }

  return transport
}

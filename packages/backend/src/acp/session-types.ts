/**
 * session-types.ts — SessionInfo type + listSessionsFromBridge helper.
 *
 * Extracted from acp-transport.ts (Phase 4 cleanup, Slice 10).
 * acp-transport.ts was deleted; only these two exports were still in use.
 */

import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import type { AcpError } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { ResultAsync } from "neverthrow"
import { WebSocket } from "ws"

const baseLog = createLogger("backend.acp.session-list")

// ─── SessionInfo ──────────────────────────────────────────────────────────────

/** Uniform session info returned by session/list across all CLI kinds. */
export type SessionInfo = {
  readonly sessionId: string
  readonly cwd: string
  readonly title: string
  readonly updatedAt: string
}

// ─── Minimal WS + ACP handshake (for listSessions only) ──────────────────────

async function _openAndInitialize(opts: {
  wsUrl: string
  warmupDelayMs: number
}): Promise<{ conn: ClientSideConnection; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(opts.wsUrl)
    const _log = baseLog.child({ wsUrl: opts.wsUrl })

    const HANDSHAKE_TIMEOUT_MS = 45_000
    const timeout = setTimeout(() => {
      ws.terminate()
      reject(new Error(`ACP handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms`))
    }, HANDSHAKE_TIMEOUT_MS)

    ws.on("open", () => {
      ;(async () => {
        try {
          // Wait for stdio-to-ws connected frame
          await new Promise<void>((res, rej) => {
            const t = setTimeout(() => {
              ws.off("message", onMsg)
              rej(new Error("stdio-to-ws handshake not received"))
            }, 10_000)
            const onMsg = (data: Buffer | string) => {
              const text = typeof data === "string" ? data : data.toString("utf8")
              if (text.includes('"connected"')) {
                clearTimeout(t)
                ws.off("message", onMsg)
                res()
              }
            }
            ws.on("message", onMsg)
          })

          if (opts.warmupDelayMs > 0) {
            await new Promise((r) => setTimeout(r, opts.warmupDelayMs))
          }

          // Build streams manually (no ws-streams.ts dependency)
          let readController: ReadableStreamDefaultController<Uint8Array> | null = null
          const readable = new ReadableStream<Uint8Array>({
            start(c) {
              readController = c
            },
          })
          const encoder = new TextEncoder()
          const writable = new WritableStream<Uint8Array>({
            write(chunk) {
              const text = new TextDecoder().decode(chunk)
              // Split on \n, send each line as a WS frame with \n suffix
              for (const line of text.split("\n")) {
                if (line.trim()) ws.send(`${line}\n`)
              }
            },
          })
          ws.on("message", (data: Buffer | string) => {
            const text = typeof data === "string" ? data : data.toString("utf8")
            if (text.includes('"connected"') || text.includes('"heartbeat"')) return
            readController?.enqueue(encoder.encode(text))
          })

          const stream = ndJsonStream(writable, readable)
          const conn = new ClientSideConnection(
            // biome-ignore lint/suspicious/noExplicitAny: minimal Client impl for listSessions only
            (_agent) => ({ async sessionUpdate(_p: any) {} }) as any,
            stream,
          )

          await conn.initialize({
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
            clientInfo: { name: "drive-coding-list", version: "0.1.0" },
          })

          clearTimeout(timeout)
          resolve({ conn, ws })
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
  const { conn, ws } = await _openAndInitialize({
    wsUrl: opts.wsUrl,
    warmupDelayMs: opts.warmupDelayMs ?? 1500,
  })

  try {
    let sessions: readonly SessionInfo[] = []
    try {
      // biome-ignore lint/suspicious/noExplicitAny: ACP SDK conn.listSessions not typed
      const res = await (conn as any).listSessions({})
      const raw: unknown[] = (res as { sessions?: unknown[] })?.sessions ?? []
      sessions = raw.map((s): SessionInfo => {
        const item = s as Record<string, unknown>
        return {
          sessionId: String(item.sessionId ?? ""),
          cwd: String(item.cwd ?? ""),
          title: String(item.title ?? ""),
          updatedAt: String(item.updatedAt ?? ""),
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

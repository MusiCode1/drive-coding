/**
 * client.ts — createAcpClient: high-level ACP client for FE
 *
 * Flow (data-driven readiness — F-1 followup, post-stdio-to-ws):
 * 1. WS connect to /ws/agent/<agentId> + wait for `open`.
 * 2. Build streams (wsToWebStreams → ndJsonStream → ClientSideConnection).
 * 3. initialize() with fs caps = false, wrapped in Promise.race with 10s timeout.
 *    Readiness is proven by the ACP response itself — no synthetic handshake frame.
 *    If no response within INIT_TIMEOUT_MS → close WS, throw "ACP initialize timeout".
 * 4. Start heartbeat $/ping every 25s (NAT/proxy keepalive).
 *
 * auth_required (MIN-7): if initialize throws with data.code === "auth_required",
 * rethrow with kind = "auth_required" so UI can display "<cli> auth login" message.
 *
 * No auto-reconnect — UI shows "connection lost, refresh" (§1 line 44).
 */
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { createClientImpl } from "./client-impl.js"
import { wsToWebStreams } from "./ws-to-streams.js"

const INIT_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 25_000

export async function createAcpClient(
  agentId: string,
  onUpdate: (n: SessionNotification) => void,
  onClose?: (code: number, reason: string) => void,
) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)
  // BE may forward binary `Buffer` frames from child stdout (NDJSON bytes).
  // Without binaryType=arraybuffer, browser delivers them as Blob — harder to decode
  // synchronously in the stream pipeline. arraybuffer keeps the decode path uniform.
  ws.binaryType = "arraybuffer"

  // MED-8: listen for WS close events throughout the session
  // code 1008 = "agent in use by another tab" (set by ws-agent.ts on multi-tab collision)
  // code 1011 = "bridge crashed" (set by ws-agent.ts when bridge dies)
  ws.addEventListener("close", (ev: CloseEvent) => {
    onClose?.(ev.code, ev.reason)
  })

  // 1. Wait for WS open
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true })
  })

  // 2. Build streams + connection — SDK starts reading from the pipe immediately.
  const { readable, writable } = wsToWebStreams(ws)
  const stream = ndJsonStream(writable, readable)

  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection((_agent) => client, stream)

  // 3. initialize with fs caps = false — wrapped in Promise.race with 10s timeout.
  //    Receiving a valid ACP response is itself the readiness signal; no synthetic
  //    handshake frame is needed. If the BE pipe or the child is broken, the
  //    timeout fires with a clear error.
  let initTimer: ReturnType<typeof setTimeout> | undefined
  let initResult: Awaited<ReturnType<typeof conn.initialize>>
  try {
    initResult = await Promise.race([
      conn.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
        },
        clientInfo: { name: "drive-coding", version: "0.2.0" },
      }),
      new Promise<never>((_, reject) => {
        initTimer = setTimeout(() => {
          reject(
            new Error(
              `ACP initialize timeout after ${INIT_TIMEOUT_MS}ms — no response from agent (bridge or child unresponsive)`,
            ),
          )
        }, INIT_TIMEOUT_MS)
      }),
    ])
    if (initTimer !== undefined) clearTimeout(initTimer)
  } catch (e) {
    if (initTimer !== undefined) clearTimeout(initTimer)
    // MIN-7: auth_required error — rethrow with kind for UI
    const err = e as { code?: number; data?: { code?: string }; message?: string }
    if (err?.data?.code === "auth_required") {
      const authErr = new Error(
        `ACP agent requires authentication: ${err.message ?? "auth_required"}. ` +
          `הפעל ב-shell: '<cli> auth login'.`,
      )
      ;(authErr as Error & { kind?: string }).kind = "auth_required"
      ws.close()
      throw authErr
    }
    ws.close()
    throw e
  }

  // 4. Heartbeat $/ping every 25s — prevent NAT/proxy idle eviction
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(`${JSON.stringify({ jsonrpc: "2.0", method: "$/ping" })}\n`)
    }
  }, HEARTBEAT_INTERVAL_MS)

  return {
    conn,
    capabilities: initResult.agentCapabilities,

    /** Create a new ACP session */
    async newSession(opts: { cwd: string }) {
      return conn.newSession({ cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * Load an existing ACP session by sessionId.
     * SDK 0.21.1: loadSession is a typed method on ClientSideConnection (acp.d.ts:294).
     * No `as any` needed — CRIT-2 fix.
     * May throw -32601 if CLI does not support loadSession capability.
     */
    async loadSession(opts: { cwd: string; sessionId: string }) {
      return conn.loadSession({ sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * List sessions from the agent.
     * SDK 0.21.1: listSessions is typed (acp.d.ts:322). No `as any` — CRIT-2 fix.
     * May throw -32601 if CLI does not support listSessions capability.
     */
    async listSessions() {
      return conn.listSessions({})
    },

    /** Send a text prompt in the given session */
    async prompt(sessionId: string, text: string) {
      return conn.prompt({ sessionId, prompt: [{ type: "text", text }] })
    },

    /** Cancel current operation in the given session */
    async cancel(sessionId: string) {
      return conn.cancel({ sessionId })
    },

    /** Close the ACP connection and stop heartbeat */
    close() {
      clearInterval(heartbeat)
      try {
        ws.close()
      } catch {
        // already closed
      }
    },
  }
}

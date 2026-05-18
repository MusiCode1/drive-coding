/**
 * client.ts — createAcpClient: high-level ACP client for FE
 *
 * Flow:
 * 1. WS connect to /ws/agent/<agentId>
 * 2. Wait for stdio-to-ws {"type":"connected"} frame (10s timeout — MED-4)
 * 3. 1500ms warmup — subprocess needs time to stabilize before initialize
 * 4. Build streams (wsToWebStreams → ndJsonStream → ClientSideConnection)
 * 5. initialize() with fs caps = false (CRIT-3 decision, smoke-tested in Phase 2)
 * 6. Start heartbeat $/ping every 25s (NAT/proxy keepalive)
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

const WARMUP_DELAY_MS = 1500
const HANDSHAKE_TIMEOUT_MS = 10_000
const HEARTBEAT_INTERVAL_MS = 25_000

export async function createAcpClient(
  agentId: string,
  onUpdate: (n: SessionNotification) => void,
  onClose?: (code: number, reason: string) => void,
) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)
  // BE forwards `Buffer` frames from stdio-to-ws (binary by default).
  // Without this, browser delivers them as Blob → onMsg handler's `typeof === "string"`
  // path mis-fires and the handshake "connected" frame is silently dropped → timeout.
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

  // 2. Wait for stdio-to-ws {"type":"connected"} handshake frame (10s timeout)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener("message", onMsg)
      ws.close()
      reject(
        new Error(
          `stdio-to-ws handshake timeout after ${HANDSHAKE_TIMEOUT_MS}ms — subprocess may not be running`,
        ),
      )
    }, HANDSHAKE_TIMEOUT_MS)

    const decoder = new TextDecoder()
    const onMsg = (ev: MessageEvent) => {
      let text: string
      if (typeof ev.data === "string") text = ev.data
      else if (ev.data instanceof ArrayBuffer) text = decoder.decode(ev.data)
      else text = "" // Blob is unexpected after binaryType=arraybuffer
      if (text.includes('"type":"connected"')) {
        clearTimeout(timer)
        ws.removeEventListener("message", onMsg)
        resolve()
      }
    }
    ws.addEventListener("message", onMsg)
  })

  // 3. Warmup — subprocess needs ~1.5s to stabilize after stdio-to-ws connected
  // (observed: initialize sent too early → message dropped silently)
  await new Promise((r) => setTimeout(r, WARMUP_DELAY_MS))

  // 4. Build streams + connection
  const { readable, writable } = wsToWebStreams(ws)
  const stream = ndJsonStream(writable, readable)

  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection((_agent) => client, stream)

  // 5. initialize with fs caps = false
  let initResult: Awaited<ReturnType<typeof conn.initialize>>
  try {
    initResult = await conn.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
      clientInfo: { name: "drive-coding", version: "0.2.0" },
    })
  } catch (e) {
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

  // 6. Heartbeat $/ping every 25s — prevent NAT/proxy idle eviction
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

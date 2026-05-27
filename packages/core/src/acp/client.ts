/**
 * client.ts — createAcpClient: transport-agnostic ACP client.
 *
 * Flow (data-driven readiness):
 * 1. Caller hands in an open `AcpTransport`. Transport must be ready
 *    to send/receive bytes before this is called (e.g. WS already in OPEN state).
 * 2. Build streams pipeline: transport.readable/writable → ndJsonStream →
 *    ClientSideConnection.
 * 3. initialize() with fs caps = false, wrapped in Promise.race with 10s timeout.
 *    Readiness is proven by the ACP response itself — no synthetic handshake frame.
 *    If no response within INIT_TIMEOUT_MS → close transport, throw timeout.
 *
 * auth_required: if initialize throws with data.code === "auth_required",
 * rethrow with kind = "auth_required" so UI can display "<cli> auth login" message.
 *
 * Lifecycle decisions OUT of this module:
 *   - Heartbeat / NAT keepalive — transport-specific concern. WS transport
 *     does this internally (see WsAcpTransport). Stdio + mock don't need it.
 *   - onClose subscription — caller registers directly on the transport
 *     BEFORE passing it here.
 *   - Auto-reconnect — not handled at any layer. UI shows "refresh" prompt.
 */
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { createClientImpl } from "./client-impl.js"
import type { AcpTransport } from "./transport.js"

const DEFAULT_INIT_TIMEOUT_MS = 10_000

export type AcpClientOptions = {
  /** Override the initialize timeout. Defaults to 10s. Tests pass a small value. */
  initTimeoutMs?: number
}

export type AcpClient = {
  conn: ClientSideConnection
  capabilities: Awaited<ReturnType<ClientSideConnection["initialize"]>>["agentCapabilities"]
  newSession(opts: { cwd: string }): ReturnType<ClientSideConnection["newSession"]>
  loadSession(opts: {
    cwd: string
    sessionId: string
  }): ReturnType<ClientSideConnection["loadSession"]>
  listSessions(): ReturnType<ClientSideConnection["listSessions"]>
  prompt(sessionId: string, text: string): ReturnType<ClientSideConnection["prompt"]>
  cancel(sessionId: string): ReturnType<ClientSideConnection["cancel"]>
  close(): void
}

export async function createAcpClient(
  transport: AcpTransport,
  onUpdate: (n: SessionNotification) => void,
  options: AcpClientOptions = {},
): Promise<AcpClient> {
  const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS

  // Build streams + connection — SDK starts reading from the pipe immediately.
  const stream = ndJsonStream(transport.writable, transport.readable)
  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection((_agent) => client, stream)

  // initialize with fs caps = false — wrapped in Promise.race with the timeout.
  // Receiving a valid ACP response is itself the readiness signal; no synthetic
  // handshake frame is needed. If the transport or the agent is unresponsive,
  // the timeout fires with a clear error.
  let initTimer: ReturnType<typeof setTimeout> | undefined
  let initResult: Awaited<ReturnType<typeof conn.initialize>>
  const initPromise = conn.initialize({
    protocolVersion: 1,
    clientCapabilities: {
      fs: { readTextFile: false, writeTextFile: false },
    },
    clientInfo: { name: "drive-coding", version: "0.2.0" },
  })
  // Mark initPromise as handled to suppress unhandled-rejection if the race
  // resolves via timeout. The actual rejection (if any) is still observed
  // by Promise.race below.
  initPromise.catch(() => {})
  try {
    initResult = await Promise.race([
      initPromise,
      new Promise<never>((_, reject) => {
        initTimer = setTimeout(() => {
          reject(
            new Error(
              `ACP initialize timeout after ${initTimeoutMs}ms — no response from agent (transport or child unresponsive)`,
            ),
          )
        }, initTimeoutMs)
      }),
    ])
    if (initTimer !== undefined) clearTimeout(initTimer)
  } catch (e) {
    if (initTimer !== undefined) clearTimeout(initTimer)
    // auth_required error — rethrow with kind for UI
    const err = e as { code?: number; data?: { code?: string }; message?: string }
    if (err?.data?.code === "auth_required") {
      const authErr = new Error(
        `ACP agent requires authentication: ${err.message ?? "auth_required"}. ` +
          `הפעל ב-shell: '<cli> auth login'.`,
      )
      ;(authErr as Error & { kind?: string }).kind = "auth_required"
      transport.close()
      throw authErr
    }
    transport.close()
    throw e
  }

  return {
    conn,
    capabilities: initResult.agentCapabilities,

    /** Create a new ACP session */
    async newSession(opts: { cwd: string }) {
      return conn.newSession({ cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * Load an existing ACP session by sessionId.
     * May throw -32601 if CLI does not support loadSession capability.
     */
    async loadSession(opts: { cwd: string; sessionId: string }) {
      return conn.loadSession({ sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] })
    },

    /**
     * List sessions from the agent.
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

    /** Close the underlying transport */
    close() {
      transport.close()
    },
  }
}

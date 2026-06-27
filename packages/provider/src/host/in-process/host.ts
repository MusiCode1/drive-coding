/**
 * host.ts — InProcessHost: hosts ClaudeAcpAgent in-process via sdk@1.0.0.
 *
 * Two independent connects (from brief §4 Commit 0):
 *   agentConn = agentApp.connect(clientApp)  → AgentConnection (agent-side)
 *   clientConn = clientApp.connect(agentApp) → ClientConnection (client-side)
 *
 * start()   — initialize via clientConn.agent → NormalizedCapabilities
 * callExt() — ext request via clientConn.agent
 * close()   — closes both connections
 *
 * ⚠️ Two-SDK containment: all sdk@1.0.0 and claude-agent-acp imports stay
 * inside this file + client-bridge.ts + claude/capabilities.ts.
 * No sdk@1.0.0 types appear in the exported InProcessHost interface.
 */

import { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import type { ClientContext } from "acp-sdk-v1"
import { agent, client, methods } from "acp-sdk-v1"
import type { AdapterHost, NormalizedCapabilities } from "../types.js"
import { mapClaudeCapabilities } from "./claude/capabilities.js"
import { makeAcpClientFromCtx } from "./client-bridge.js"

/** Public interface — no sdk@1.0.0 types leak here */
export type InProcessHost = AdapterHost

/**
 * Optional ext request handlers registered on the AgentApp before any connection.
 * Key = ACP method name (e.g. "ext/ping"), value = handler receiving params.
 * The handler must return a Record<string, unknown> (JSON-serializable).
 */
export type ExtHandlers = Record<
  string,
  (params: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>
>

/**
 * Creates an in-process host that runs ClaudeAcpAgent without spawning a child process.
 *
 * Lifecycle:
 *   const host = createClaudeInProcessHost({ extHandlers: { "ext/ping": (p) => ({ pong: true }) } })
 *   const { capabilities } = await host.start({ cwd: "/path" })
 *   const result = await host.callExt("ext/ping", { msg: "hello" })
 *   await host.close()
 */
export function createClaudeInProcessHost(options?: { extHandlers?: ExtHandlers }): InProcessHost {
  // sdk@1.0.0 objects — all internal, never exported
  let claudeAgent: ClaudeAcpAgent | undefined
  let agentConnClose: (() => void) | undefined
  let clientConnClose: (() => void) | undefined
  // clientCtx saved from start(), used by callExt (ClientContext from sdk@1.0.0)
  let clientCtx: ClientContext | undefined

  // ext notification callbacks registered via onExtNotification()
  const extNotificationListeners = new Set<
    (method: string, params: Record<string, unknown>) => void
  >()

  // Build AgentApp — handles agent-side ACP requests
  let agentApp = agent({ name: "drive-coding-inprocess-host" })
    .onRequest(methods.agent.initialize, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before initialize")
      return claudeAgent.initialize(ctx.params)
    })
    .onRequest(methods.agent.session.new, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/new")
      return claudeAgent.newSession(ctx.params)
    })

  // Register ext handlers (ext registry — additive, zero-config by default)
  for (const [method, handler] of Object.entries(options?.extHandlers ?? {})) {
    agentApp = agentApp.onRequest(
      method,
      { parse: (p: unknown) => p as Record<string, unknown> },
      (ctx) => handler(ctx.params),
    )
  }

  // Build ClientApp — handles client-side ACP requests from the agent
  const clientApp = client({ name: "drive-coding-inprocess-client" })
    .onRequest(methods.client.session.requestPermission, (_ctx) => {
      // Default: cancel all permission requests (no UI yet — future F-track)
      return { outcome: { outcome: "cancelled" as const } }
    })
    .onNotification(methods.client.session.update, (_ctx) => {
      // No-op: session updates are handled by the agent lifecycle layer
    })
    .onRequest(methods.client.fs.readTextFile, (_ctx) => {
      return { content: "" }
    })
    .onRequest(methods.client.fs.writeTextFile, (_ctx) => {
      return {}
    })

  return {
    async start(_opts: { cwd: string }): Promise<{ capabilities: NormalizedCapabilities }> {
      // Connection 1 (agent-side): agentApp.connect(clientApp) → AgentConnection
      // connection.client is AgentContext — used to create ClaudeAcpAgent
      const agentConn = agentApp.connect(clientApp)
      agentConnClose = () => agentConn.close()

      // Assign claudeAgent BEFORE any message processing (pattern from spike + acp-agent.js)
      claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(agentConn.client))

      // Connection 2 (client-side): clientApp.connect(agentApp) → ClientConnection
      // clientConn.agent is ClientContext — used for initialize + callExt
      const clientConn = clientApp.connect(agentApp)
      clientConnClose = () => clientConn.close()
      // Save ClientContext for callExt (used after start() returns)
      clientCtx = clientConn.agent

      // Call initialize via clientConn.agent (ClientContext)
      const initResult = await clientConn.agent.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "drive-coding-host", version: "0.0.0" },
      })

      const capabilities = mapClaudeCapabilities(initResult)
      return { capabilities }
    },

    async callExt(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      if (!clientCtx) throw new Error("callExt called before start()")
      return clientCtx.request<Record<string, unknown>>(method, params)
    },

    onExtNotification(cb: (method: string, params: Record<string, unknown>) => void): () => void {
      extNotificationListeners.add(cb)
      return () => {
        extNotificationListeners.delete(cb)
      }
    },

    async close(): Promise<void> {
      clientConnClose?.()
      agentConnClose?.()
      extNotificationListeners.clear()
    },
  }
}

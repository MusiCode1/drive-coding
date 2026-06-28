/**
 * host.ts — InProcessHost: hosts ClaudeAcpAgent in-process via sdk@1.0.0.
 *
 * Single connection model (brief §3 🟡#1 fix):
 *   agentApp.connect(clientApp) → AgentConnection (agent-side)
 *   The peer ClientApp side carries the SessionUpdateRouter that routes
 *   session/update notifications to ActiveSessions.
 *
 * We access the ClientContext via agentApp.onConnect(), which receives the
 * AgentConnection. From there, we also wire ClaudeAcpAgent.
 *
 * The clientApp peer (the "other side") handles client-side requests and
 * automatically routes session/update notifications via its built-in
 * SessionUpdateRouter (ClientApp constructor withHandler).
 *
 * For the client-initiated calls (initialize, buildSession, callExt), we
 * use clientApp.connectWith(agentApp, ...) to get a ClientContext — but we
 * need it to be on the SAME connection pair as ClaudeAcpAgent so that
 * session/update notifications route correctly.
 *
 * SOLUTION: Use a single connection pair created by agentApp.connect(clientApp).
 * To get ClientContext from that pair, we use clientApp.connectWith(agentApp)
 * to get a ClientContext — this creates a NEW pair. BUT we need the ClientContext
 * from the SAME pair as ClaudeAcpAgent.
 *
 * ACTUAL SOLUTION: Use clientApp.connect(agentApp) as the single connection.
 * This returns ClientConnection with .agent = ClientContext. SIMULTANEOUSLY,
 * we reach into the peer AgentConnection to get AgentContext for ClaudeAcpAgent.
 * We do this via agentApp.onConnect() which is called when clientApp connects to it.
 *
 * ⚠️ Two-SDK containment: all sdk@1.0.0 and claude-agent-acp imports stay
 * inside this file + client-bridge.ts + claude/capabilities.ts.
 * No sdk@1.0.0 types appear in the exported InProcessHost interface.
 */

import { ClaudeAcpAgent } from "@agentclientprotocol/claude-agent-acp"
import type { ActiveSession, AgentConnection, ClientContext } from "acp-sdk-v1"
import { agent, client, methods, RequestError } from "acp-sdk-v1"
import { parseExtParams } from "../../extensions/index.js"
import type { NormalizedCapabilities } from "../../types.js"
import { mapClaudeCapabilities } from "./capabilities.js"
import { makeAcpClientFromCtx } from "./client-bridge.js"
import { getQuery } from "./query-access.js"
import { claudeRenameSession } from "./rename.js"

/**
 * Public interface — no sdk@1.0.0 types leak here.
 * Independent interface (not an alias to AdapterHost) per brief §3 🟡#6.
 */
export interface InProcessHost {
  start(opts: { cwd: string }): Promise<{ capabilities: NormalizedCapabilities }>
  newSession(opts: { cwd: string }): Promise<{ sessionId: string }>
  prompt(
    opts: { sessionId: string; text: string },
    onUpdate: (u: Record<string, unknown>) => void,
  ): Promise<{ stopReason: string }>
  /**
   * Rename a session by sessionId.
   * Two-SDK containment: only strings in the signature — no SDK types leak.
   * Tries { dir: cwd-from-newSession } first; falls back to search-all on error.
   */
  rename(sessionId: string, title: string): Promise<void>
  callExt(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>
  onExtNotification(cb: (method: string, params: Record<string, unknown>) => void): () => void
  close(): Promise<void>
}

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
 *   const host = createClaudeInProcessHost()
 *   const { capabilities } = await host.start({ cwd: "/path" })
 *   const { sessionId } = await host.newSession({ cwd: "/path" })
 *   const { stopReason } = await host.prompt({ sessionId, text: "hello" }, (u) => console.log(u))
 *   await host.close()
 *
 * Connection architecture:
 *   clientApp.connect(agentApp) → single pair (ClientConnection + peer AgentConnection)
 *   - ClientContext (clientConn.agent) used for initialize, buildSession, callExt
 *   - AgentContext (captured via agentApp.onConnect) used for ClaudeAcpAgent
 *   Both AgentContext and ClientContext share the same memory stream pair,
 *   so session/update notifications from ClaudeAcpAgent reach the correct
 *   SessionUpdateRouter on the ClientApp side (same connection).
 */
export function createClaudeInProcessHost(options?: { extHandlers?: ExtHandlers }): InProcessHost {
  // sdk@1.0.0 objects — all internal, never exported
  let claudeAgent: ClaudeAcpAgent | undefined
  let clientCtx: ClientContext | undefined
  let agentConn: AgentConnection | undefined

  // Active sessions keyed by sessionId — sdk@1.0.0 ActiveSession objects (internal, not exported)
  const activeSessions = new Map<string, ActiveSession>()

  // sessionId → cwd map: populated in newSession() so rename() can scope the lookup.
  // Additive — no existing code modified (brief §3 avigail #3).
  const sessionCwd = new Map<string, string>()

  // ext notification callbacks registered via onExtNotification()
  const extNotificationListeners = new Set<
    (method: string, params: Record<string, unknown>) => void
  >()

  // Build AgentApp — handles agent-side ACP requests
  // Wire ALL session methods so ClaudeAcpAgent can handle them (mirror runAcp in acp-agent.js)
  // Use onConnect to capture the AgentConnection and create ClaudeAcpAgent BEFORE
  // any messages are processed. This ensures claudeAgent is set when initialize arrives.
  let agentApp = agent({ name: "drive-coding-inprocess-host" })
    .onConnect((conn) => {
      agentConn = conn
      // Assign claudeAgent with the AgentContext from THIS connection.
      // This is the same connection that the peer ClientContext (clientCtx) uses,
      // so session/update notifications will route correctly to ActiveSessions.
      claudeAgent = new ClaudeAcpAgent(makeAcpClientFromCtx(conn.client))
    })
    .onRequest(methods.agent.initialize, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before initialize")
      return claudeAgent.initialize(ctx.params)
    })
    .onRequest(methods.agent.session.new, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/new")
      return claudeAgent.newSession(ctx.params)
    })
    .onRequest(methods.agent.session.prompt, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/prompt")
      // claudeAgent.prompt receives a single arg (the params object) per brief §3 🟡#2
      return claudeAgent.prompt(ctx.params)
    })
    .onRequest(methods.agent.session.load, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/load")
      return claudeAgent.loadSession(ctx.params)
    })
    .onRequest(methods.agent.session.setConfigOption, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/set_config_option")
      return claudeAgent.setSessionConfigOption(ctx.params)
    })
    .onNotification(methods.agent.session.cancel, (ctx) => {
      if (!claudeAgent) return
      claudeAgent.cancel(ctx.params)
    })
    .onRequest(methods.agent.session.fork, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/fork")
      return claudeAgent.unstable_forkSession(ctx.params)
    })
    .onRequest(methods.agent.session.list, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/list")
      return claudeAgent.listSessions(ctx.params)
    })
    .onRequest(methods.agent.session.delete, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/delete")
      return claudeAgent.deleteSession(ctx.params)
    })
    .onRequest(methods.agent.session.resume, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/resume")
      return claudeAgent.resumeSession(ctx.params)
    })
    .onRequest(methods.agent.session.close, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/close")
      return claudeAgent.closeSession(ctx.params)
    })
    .onRequest(methods.agent.session.setMode, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before session/set_mode")
      return claudeAgent.setSessionMode(ctx.params)
    })
    .onRequest(methods.agent.authenticate, (ctx) => {
      if (!claudeAgent) throw new Error("claudeAgent not set before authenticate")
      return claudeAgent.authenticate(ctx.params)
    })

  // Register ext handlers (ext registry — additive, zero-config by default)
  for (const [method, handler] of Object.entries(options?.extHandlers ?? {})) {
    agentApp = agentApp.onRequest(
      method,
      { parse: (p: unknown) => p as Record<string, unknown> },
      (ctx) => handler(ctx.params),
    )
  }

  // Internal handler: _drive/setThinkingTokens
  // Closes over claudeAgent (set in onConnect). Must NOT go through options.extHandlers —
  // that signature receives only params and cannot close over claudeAgent.
  // Runs only after newSession (onConnect fires first → claudeAgent guaranteed), but we guard anyway.
  agentApp = agentApp.onRequest(
    "_drive/setThinkingTokens",
    { parse: (p: unknown) => p as Record<string, unknown> },
    async (ctx) => {
      if (!claudeAgent) throw new Error("_drive/setThinkingTokens called before start()")
      // Validate at the host boundary — invalid params must surface as RequestError.invalidParams
      // (not internalError). The SDK wraps any plain Error as internalError, so we catch here.
      // n=null is valid (no-limit); SDK setMaxThinkingTokens accepts null.
      let parsed: ReturnType<typeof parseExtParams<"_drive/setThinkingTokens">>
      try {
        parsed = parseExtParams("_drive/setThinkingTokens", ctx.params)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        throw RequestError.invalidParams({}, msg)
      }
      const { sessionId, n } = parsed
      await getQuery(claudeAgent, sessionId).setMaxThinkingTokens(n)
      return { ok: true }
    },
  )

  // Build ClientApp — handles client-side ACP requests from the agent.
  // The ClientApp constructor installs a SessionUpdateRouter middleware (withHandler)
  // that intercepts all session/update notifications and routes them to the correct
  // ActiveSession queue. This is the key mechanism for streaming.
  // We do NOT register onNotification(session/update) here — the SDK's built-in
  // router handles it. Unknown notifications are silently dropped by the SDK.
  const clientApp = client({ name: "drive-coding-inprocess-client" })
    .onRequest(methods.client.session.requestPermission, (_ctx) => {
      // Default: cancel all permission requests (no UI yet — future F-track)
      return { outcome: { outcome: "cancelled" as const } }
    })
    .onRequest(methods.client.fs.readTextFile, (_ctx) => {
      return { content: "" }
    })
    .onRequest(methods.client.fs.writeTextFile, (_ctx) => {
      return {}
    })

  return {
    async start(_opts: { cwd: string }): Promise<{ capabilities: NormalizedCapabilities }> {
      // Single connection: clientApp.connect(agentApp)
      // This creates a memory stream pair. The AgentApp side handles agent requests
      // (via its handlers including onConnect which creates ClaudeAcpAgent).
      // The ClientApp side handles client requests and routes session/update notifications.
      // clientConn.agent is the ClientContext for this connection — used for ALL operations.
      const clientConn = clientApp.connect(agentApp)
      clientCtx = clientConn.agent

      // Call initialize via clientCtx (ClientContext from the single connection)
      // Note: agentApp.onConnect fires synchronously during clientApp.connect(agentApp),
      // so claudeAgent is already set by the time this request is processed.
      const initResult = await clientCtx.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: "drive-coding-host", version: "0.0.0" },
      })

      const capabilities = mapClaudeCapabilities(initResult)
      return { capabilities }
    },

    async newSession(opts: { cwd: string }): Promise<{ sessionId: string }> {
      if (!clientCtx) throw new Error("newSession called before start()")

      // Build session via clientCtx.buildSession() per brief §3 🟡#1 and 🔴#3
      // mcpServers:[] is required by NewSessionRequest schema (🔴#3)
      // clientCtx is from the same connection as ClaudeAcpAgent's AgentContext,
      // so session/update notifications will be routed to this ActiveSession correctly.
      const activeSession = await clientCtx.buildSession({ cwd: opts.cwd, mcpServers: [] }).start()

      const sessionId = activeSession.sessionId as string
      // Store the ActiveSession for use in prompt()
      activeSessions.set(sessionId, activeSession)
      // Store the cwd so rename() can scope its lookup to this project directory
      sessionCwd.set(sessionId, opts.cwd)

      return { sessionId }
    },

    async prompt(
      opts: { sessionId: string; text: string },
      onUpdate: (u: Record<string, unknown>) => void,
    ): Promise<{ stopReason: string }> {
      if (!clientCtx) throw new Error("prompt called before start()")

      const activeSession = activeSessions.get(opts.sessionId)
      if (!activeSession) {
        throw new Error(`No active session for sessionId: ${opts.sessionId}`)
      }

      // Start the prompt — returns PromptResponse when the turn completes.
      // The same completion is also queued as a "stop" message for nextUpdate().
      const promptPromise = activeSession.prompt(opts.text)

      // Drain updates until we get a "stop" message.
      // nextUpdate() returns ActiveSessionMessage:
      //   { kind: "session_update", update } | { kind: "stop", stopReason }
      // The session/update notifications arrive via the ClientApp's SessionUpdateRouter
      // (built-in middleware in ClientApp constructor).
      let done = false
      while (!done) {
        const msg = await activeSession.nextUpdate()
        if (msg.kind === "stop") {
          done = true
        } else {
          // Forward the raw update to the caller
          // Normalization is deferred to cutover/features per brief §2
          onUpdate(msg.update as Record<string, unknown>)
        }
      }

      // Await the final PromptResponse (already resolved since stop was received)
      const response = await promptPromise
      return { stopReason: response.stopReason as string }
    },

    async rename(sessionId: string, title: string): Promise<void> {
      // Look up the cwd for this session (populated in newSession).
      // Pass it to claudeRenameSession for a scoped lookup; falls back to search-all.
      const cwd = sessionCwd.get(sessionId)
      await claudeRenameSession(sessionId, title, cwd)
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
      // Dispose all active sessions before closing the connection
      for (const activeSession of activeSessions.values()) {
        activeSession.dispose()
      }
      activeSessions.clear()
      sessionCwd.clear()

      // Close the AgentConnection (which closes the underlying memory stream pair)
      agentConn?.close()
      extNotificationListeners.clear()
    },
  }
}

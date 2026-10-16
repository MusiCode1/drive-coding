import type { AuthMethod } from "@agentclientprotocol/sdk"
import type { SessionStatus } from "@drive-coding/core/session"
import { deleteAgent } from "$lib/adapters/agents-api"
import { HttpConnection, type HttpConnectionDeps } from "$lib/session/http-connection"
import type { RemoteTerminal } from "$lib/session/remote-stream-events"
import type { SessionView } from "$lib/session/session-view"
import { applyManualTitleFromAttach } from "./agent-session-manual-title"
import {
  clearRemotePendingUi,
  type PendingRequestDeps,
  type PendingRequestState,
} from "./agent-session-pending"
import type { ErrorScope } from "./error-scope.svelte"
import { formatAcpError } from "./format-acp-error"

type HttpDeps = Omit<HttpConnectionDeps, "discardCreatedAgent" | "setAgent">

/** Builds HttpConnection with captured release identity (B4 — keeps AgentSession smaller). */
export function newHttpConnection(
  connectionId: string,
  deps: HttpDeps & {
    setAgentId: (agentId: string) => void
  },
): HttpConnection {
  const connection = new HttpConnection({
    ...deps,
    discardCreatedAgent: (agentId) => {
      void deleteAgent(agentId).catch(() => {})
    },
    setAgent: (agentId) => {
      deps.setAgentId(agentId)
      connection.captureReleaseIdentity(agentId, connectionId)
    },
  })
  return connection
}

/** VM HTTP wiring with stale-connection guards (B4 fix round 1). */
export type AgentSessionHttpWire = {
  connectionId: string
  getBoundConnection(): HttpConnection | unknown | null
  prepare: HttpConnectionDeps["prepare"]
  setAgentId(agentId: string): void
  viewOptions: HttpConnectionDeps["viewOptions"]
  enterSession: HttpConnectionDeps["enterSession"]
  bindView(view: SessionView): void
  applyTitle: HttpConnectionDeps["applyTitle"]
  onConnected(): void | Promise<void>
  rememberedConfig: HttpConnectionDeps["rememberedConfig"]
  failed: HttpConnectionDeps["failed"]
  missingSessionId: HttpConnectionDeps["missingSessionId"]
  terminal?: HttpConnectionDeps["terminal"]
}

export function createAgentSessionHttpConnection(wire: AgentSessionHttpWire): HttpConnection {
  let connection!: HttpConnection
  const stale = () => wire.getBoundConnection() !== connection
  connection = newHttpConnection(wire.connectionId, {
    isBound: () => !stale(),
    prepare: wire.prepare,
    setAgentId: (agentId) => {
      if (stale()) return
      wire.setAgentId(agentId)
    },
    viewOptions: wire.viewOptions,
    enterSession: wire.enterSession,
    bindView: (view) => {
      if (stale()) return
      wire.bindView(view)
    },
    applyTitle: wire.applyTitle,
    connected: async () => {
      if (stale()) return
      await wire.onConnected()
    },
    rememberedConfig: wire.rememberedConfig,
    terminal: (view, fact) => {
      if (!stale()) wire.terminal?.(view, fact)
    },
    failed: (error, keepAgent) => {
      if (stale()) return
      wire.failed(error, keepAgent)
    },
    missingSessionId: (keepAgent) => {
      if (stale()) return
      wire.missingSessionId(keepAgent)
    },
  })
  return connection
}

type HttpUi = Parameters<typeof applyManualTitleFromAttach>[0] &
  PendingRequestState & {
    authMethods: readonly AuthMethod[]
    cwd: string | null
    isLoadingHistory: boolean
  }
type HttpBinding = {
  state: HttpUi
  connectionId: string
  getBoundConnection(): unknown
  view(): SessionView | null
  operations: { invalidate(): void }
  errors: ErrorScope
  transcript: { replace(bubbles: []): void }
  answered: PendingRequestDeps["answered"]
  prepareIdentity(agent: Parameters<HttpConnectionDeps["prepare"]>[0]): void
  bindView(view: SessionView): void
  enterSession(sessionId: string): void
  rememberedConfig(): Promise<void>
  onSseReconnected(): void
  cleanup(keepAgent: boolean): void
  status(status: SessionStatus): void
  endScope(): void
  turnIdle(): void
}

/** HTTP wiring shell. References existing owners; it does not mirror their state. */
export function createAgentSessionHttpBinding(d: HttpBinding): HttpConnection {
  const current = (view?: SessionView) => !view || !d.view() || d.view() === view
  const terminal = (view: SessionView, fact: RemoteTerminal) => {
    if (!current(view)) return
    d.operations.invalidate()
    clearRemotePendingUi(d.state, d.answered)
    d.state.isLoadingHistory = false
    d.turnIdle()
    d.errors.surface(
      fact.reason === "taken-over"
        ? "session taken over"
        : fact.reason === "unavailable"
          ? "agent unavailable"
          : "invalid HTTP stream context",
    )
    d.status("error")
    d.endScope()
  }
  return createAgentSessionHttpConnection({
    connectionId: d.connectionId,
    getBoundConnection: d.getBoundConnection,
    prepare: (agent) => {
      d.operations.invalidate()
      d.errors.reset()
      d.state.authMethods = []
      d.transcript.replace([])
      d.prepareIdentity(agent)
      d.answered.permissionId = null
      d.answered.elicitationId = null
      d.status("connecting")
      d.state.cwd = agent.cwd
    },
    setAgentId: (agentId) => {
      d.state.agentId = agentId
    },
    viewOptions: () => ({
      headers: { "Acp-Connection-Id": d.connectionId },
      onSseReconnected: d.onSseReconnected,
    }),
    enterSession: d.enterSession,
    bindView: (view) => {
      if (d.view() !== view) {
        d.operations.invalidate()
        d.state.isLoadingHistory = false
      }
      d.bindView(view)
    },
    applyTitle: (agent) => applyManualTitleFromAttach(d.state, agent, false),
    onConnected: () => d.status("connected"),
    rememberedConfig: d.rememberedConfig,
    failed: (error, keepAgent) => {
      d.cleanup(keepAgent)
      d.errors.surface(formatAcpError(error))
      d.status("error")
    },
    missingSessionId: (keepAgent) => {
      d.cleanup(keepAgent)
      d.errors.surface("remote mode: backend did not provide a sessionId")
      d.status("error")
    },
    terminal,
  })
}

import { deleteAgent } from "$lib/adapters/agents-api"
import { HttpConnection, type HttpConnectionDeps } from "$lib/session/http-connection"
import type { SessionView } from "$lib/session/session-view"

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
}

export function createAgentSessionHttpConnection(wire: AgentSessionHttpWire): HttpConnection {
  let connection!: HttpConnection
  const stale = () => wire.getBoundConnection() !== connection
  connection = newHttpConnection(wire.connectionId, {
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

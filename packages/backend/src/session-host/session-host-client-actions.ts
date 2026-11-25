import type {
  SessionConfigOption,
  SessionListQuery,
  SessionState,
} from "@drive-coding/core/session"
import type { AcpClient } from "@drive-coding/provider/client"
import type { ExtendedSessionHost } from "./session-host.js"

type ClientActions = Pick<
  ExtendedSessionHost,
  "setMode" | "setConfigOption" | "extMethod" | "setSessionModel" | "listSessions" | "deleteSession"
> & { getAgentCapabilities(): AcpClient["capabilities"] }

type ClientActionDeps = {
  client: AcpClient
  isDisposed(): boolean
  getSessionId(): SessionState["sessionId"]
  setConfigOptions(configOptions: SessionConfigOption[]): void
}

export function createSessionHostClientActions({
  client,
  isDisposed,
  getSessionId,
  setConfigOptions,
}: ClientActionDeps): ClientActions {
  return {
    async setMode(modeId: string): Promise<void> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      const sessionId = getSessionId()
      if (!sessionId) throw new Error("No session")
      await client.setSessionMode({ sessionId, modeId })
    },

    async setConfigOption(configId: string, value: string | boolean): Promise<void> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      const sessionId = getSessionId()
      if (!sessionId) throw new Error("No session")
      // slice http-state-gaps C1: capture configOptions from CLI response (last-write-wins)
      const result = await client.setSessionConfigOption({
        sessionId,
        configId,
        value,
      })
      const configOptions = Array.isArray(result?.configOptions)
        ? (result.configOptions as SessionConfigOption[])
        : null
      if (configOptions !== null) setConfigOptions(configOptions)
    },

    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      return client.extMethod(method, params)
    },

    async setSessionModel(model: string): Promise<void> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      const sessionId = getSessionId()
      if (!sessionId) throw new Error("No session")
      await client.setSessionModel({ sessionId, modelId: model })
    },
    // ─── slice remote-session-mgmt C1: session list/delete + capabilities ───
    // Passthroughs — JSON-RPC errors (incl. code -32601) propagate AS-IS; the rpc
    // route maps them. No wrapping/absorbing here.

    async listSessions(options?: SessionListQuery) {
      if (isDisposed()) throw new Error("SessionHost disposed")
      return client.listSessions(options)
    },

    async deleteSession(sessionId: string): Promise<void> {
      if (isDisposed()) throw new Error("SessionHost disposed")
      await client.deleteSession(sessionId)
    },

    getAgentCapabilities() {
      return client.capabilities
    },
  }
}

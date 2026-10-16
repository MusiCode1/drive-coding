import { createAgent, releaseConnection } from "$lib/adapters/agents-api"
import type { AgentInput, CloseMode, Connection } from "./connection"
import { createRemoteView } from "./create-session-view"
import type { RemoteSessionViewOptions } from "./remote-session-view"
import type { SessionView } from "./session-view"

export type HttpConnectionDeps = {
  prepare: (agent: AgentInput) => void
  setAgent: (agentId: string) => void
  viewOptions: () => Pick<RemoteSessionViewOptions, "headers" | "onSseReconnected">
  enterSession: (sessionId: string) => void
  bindView: (view: SessionView) => void
  applyTitle: (agent: Extract<AgentInput, { kind: "existing-http" }>) => void
  connected: (isNew: boolean) => Promise<void>
  rememberedConfig: () => Promise<void>
  failed: (error: unknown, keepAgent: boolean) => void
  missingSessionId: (keepAgent: boolean) => void
}

export class HttpConnection implements Connection {
  #view: SessionView | null = null
  #pendingView: SessionView | null = null

  constructor(private readonly deps: HttpConnectionDeps) {}

  adoptExistingView(view: SessionView): void {
    this.#view = view
  }

  reconnect(): Promise<void> {
    return Promise.resolve()
  }

  cancelReconnect(): void {}

  release(agentId: string, connectionId: string): void {
    void releaseConnection(agentId, connectionId)
  }

  close(_mode: CloseMode): void {
    const view = this.#view ?? this.#pendingView
    if (this.#view === view) this.#view = null
    if (this.#pendingView === view) this.#pendingView = null
    if (view) void view.close().catch(() => {})
  }

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") throw new Error("HttpConnection requires an HTTP agent")
    const isNew = agent.kind === "new"
    this.deps.prepare(agent)
    let attached = false
    try {
      const agentId = isNew
        ? (
            await createAgent({
              cwd: agent.cwd,
              cliKind: agent.cliKind,
              systemPrompt: agent.systemPrompt,
            })
          ).agentId
        : agent.agentId
      this.deps.setAgent(agentId)
      const view = await createRemoteView(
        { agentId, ...this.deps.viewOptions() },
        {
          onCreated: (created) => {
            this.#pendingView = created
          },
        },
      )
      if (this.#pendingView === view) this.#pendingView = null
      this.#view = view
      const sessionId = view.state.sessionId
      if (sessionId == null) {
        await view.close()
        this.#view = null
        this.deps.missingSessionId(!isNew)
        return
      }
      this.deps.enterSession(sessionId)
      if (!isNew) this.deps.applyTitle(agent)
      this.deps.bindView(view)
      await this.deps.connected(isNew)
      attached = true
    } catch (error) {
      const pending = this.#pendingView
      if (this.#pendingView === pending) this.#pendingView = null
      if (pending) void pending.close().catch(() => {})
      this.deps.failed(error, !isNew)
    }
    if (attached && isNew) {
      try {
        await this.deps.rememberedConfig()
      } catch {
        // Configuration restoration is optional; it cannot tear down a live host.
      }
    }
  }
}

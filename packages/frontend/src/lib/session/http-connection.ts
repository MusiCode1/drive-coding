import { createAgent, releaseConnection } from "$lib/adapters/agents-api"
import type { AgentInput, Connection, LeaveIntent } from "./connection"
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
  release?: (agentId: string) => Promise<void>
}

export class HttpConnection implements Connection {
  #view: SessionView | null = null
  #agentId: string | null = null
  #closePromise: Promise<void> | null = null
  #releasePromise: Promise<void> | null = null

  constructor(private readonly deps: HttpConnectionDeps) {}

  adoptView(view: SessionView, agentId: string | null): void {
    this.#view = view
    this.#agentId = agentId
  }

  releaseNow(): Promise<void> {
    if (this.#releasePromise) return this.#releasePromise
    const agentId = this.#agentId
    if (!agentId) return Promise.resolve()
    const connectionId = this.deps.viewOptions().headers?.["Acp-Connection-Id"]
    let request: Promise<void>
    if (this.deps.release) request = this.deps.release(agentId)
    else if (connectionId) request = releaseConnection(agentId, connectionId)
    else return Promise.resolve()
    this.#releasePromise = request.catch(() => {})
    return this.#releasePromise
  }

  close(intent: LeaveIntent): Promise<void> {
    if (this.#closePromise) return this.#closePromise
    const view = this.#view
    this.#view = null
    this.#closePromise = (async () => {
      try {
        await view?.close()
      } catch {
        // Release/termination must continue even if the view was already closed.
      }
      if (intent.kind === "preserve-agent") await this.releaseNow()
    })()
    return this.#closePromise
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
      // A new agent must be owned by the VM before view creation, so failed SSE is cleaned.
      this.deps.setAgent(agentId)
      const view = await createRemoteView({ agentId, ...this.deps.viewOptions() })
      this.adoptView(view, agentId)
      const sessionId = view.state.sessionId
      if (sessionId == null) {
        await view.close()
        this.deps.missingSessionId(!isNew)
        return
      }
      this.deps.enterSession(sessionId)
      if (!isNew) this.deps.applyTitle(agent)
      this.deps.bindView(view)
      await this.deps.connected(isNew)
      attached = true
    } catch (error) {
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

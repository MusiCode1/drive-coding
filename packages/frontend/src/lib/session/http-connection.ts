import { createAgent } from "$lib/adapters/agents-api"
import type { AgentInput, CloseMode, Connection } from "./connection"
import { ConnectionAllocation } from "./connection-allocation"
import { isSetupLive, nextSetupEpoch, type SetupEpoch } from "./connection-owner-lifecycle"
import { ConnectionRelease } from "./connection-release"
import { createRemoteView } from "./create-session-view"
import type { RemoteSessionViewOptions } from "./remote-session-view"
import type { SessionView } from "./session-view"

export type HttpConnectionDeps = {
  isBound?: () => boolean
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
  discardCreatedAgent?: (agentId: string) => void
}

type HttpAttempt = {
  current: () => boolean
  view?: SessionView
  closed: WeakSet<SessionView>
  agentId?: string
  created: boolean
}

export class HttpConnection implements Connection {
  #attempt: HttpAttempt | undefined
  #setupEpoch: SetupEpoch = 0
  #allocation = new ConnectionAllocation()
  #release = new ConnectionRelease()

  constructor(private readonly deps: HttpConnectionDeps) {}

  captureReleaseIdentity(agentId: string, connectionId: string): void {
    this.#release.capture(agentId, connectionId, this.#setupEpoch)
  }

  updateReleaseAgent(agentId: string): void {
    this.#release.updateAgent(agentId, this.#setupEpoch)
  }

  deleteAgentOnce(agentId: string): void {
    this.#allocation.deleteOnce(agentId, this.deps.discardCreatedAgent)
  }

  #beginAttempt(created: boolean): HttpAttempt {
    const epoch = nextSetupEpoch(this.#setupEpoch)
    this.#setupEpoch = epoch
    const attempt: HttpAttempt = {
      current: () => isSetupLive(epoch, this.#setupEpoch) && (this.deps.isBound?.() ?? true),
      closed: new WeakSet(),
      created,
    }
    this.#attempt = attempt
    return attempt
  }

  adoptExistingView(view: SessionView): void {
    this.#beginAttempt(false).view = view
  }

  reconnect(): Promise<void> {
    return Promise.resolve()
  }

  cancelReconnect(): void {}

  release(): void {
    this.#release.release()
  }

  #closeView(attempt: HttpAttempt, view = attempt.view): Promise<void> {
    if (!view || attempt.closed.has(view)) return Promise.resolve()
    attempt.closed.add(view)
    return view.close().catch(() => {})
  }

  #discardLate(attempt: HttpAttempt): boolean {
    if (attempt.current()) return false
    void this.#closeView(attempt)
    if (attempt.created && attempt.agentId) this.deleteAgentOnce(attempt.agentId)
    return true
  }

  close(_mode: CloseMode): void {
    this.#setupEpoch = nextSetupEpoch(this.#setupEpoch)
    if (this.#attempt) void this.#closeView(this.#attempt)
  }

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") throw new Error("HttpConnection requires an HTTP agent")
    const isNew = agent.kind === "new"
    const attempt = this.#beginAttempt(isNew)
    this.deps.prepare(agent)
    let ready = false
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
      attempt.agentId = agentId
      if (this.#discardLate(attempt)) return
      this.deps.setAgent(agentId)
      const view = await createRemoteView(
        { agentId, ...this.deps.viewOptions() },
        {
          onReady: (readyView) => {
            if (this.#discardLate(attempt)) return false
            const sessionId = readyView.state.sessionId
            if (sessionId == null) {
              void this.#closeView(attempt)
              if (!this.#discardLate(attempt)) this.deps.missingSessionId(!isNew)
              return false
            }
            this.deps.enterSession(sessionId)
            if (!isNew) this.deps.applyTitle(agent)
            this.deps.bindView(readyView)
            ready = true
          },
          onCreated: (created) => {
            attempt.view = created
            this.#discardLate(attempt)
          },
        },
      )
      attempt.view = view
      if (this.#discardLate(attempt)) return
      if (!ready) return
      await this.deps.connected(isNew)
      if (this.#discardLate(attempt)) return
      if (isNew) {
        try {
          await this.deps.rememberedConfig()
        } catch {
          // Optional configuration cannot tear down a live host.
        }
      }
    } catch (error) {
      void this.#closeView(attempt)
      if (this.#discardLate(attempt)) return
      if (attempt.created && attempt.agentId) this.deleteAgentOnce(attempt.agentId)
      this.deps.failed(error, !isNew)
    }
  }
}

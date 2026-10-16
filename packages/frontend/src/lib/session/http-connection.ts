import { createAgent, releaseConnection } from "$lib/adapters/agents-api"
import type { AgentInput, CloseMode, Connection } from "./connection"
import { isSetupLive, nextSetupEpoch, type SetupEpoch } from "./connection-owner-lifecycle"
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
  discardCreatedAgent?: (agentId: string) => void
}

export class HttpConnection implements Connection {
  #view: SessionView | null = null
  #pendingView: SessionView | null = null
  #setupEpoch: SetupEpoch = 0
  #teardownDone = false
  #releaseAgentId: string | null = null
  #releaseConnectionId: string | null = null
  #releaseDone = false

  constructor(private readonly deps: HttpConnectionDeps) {}

  captureReleaseIdentity(agentId: string, connectionId: string): void {
    this.#releaseAgentId = agentId
    this.#releaseConnectionId = connectionId
    this.#releaseDone = false
  }

  updateReleaseAgent(agentId: string): void {
    this.#releaseAgentId = agentId
    this.#releaseDone = false
  }

  adoptExistingView(view: SessionView): void {
    this.#view = view
  }

  reconnect(): Promise<void> {
    return Promise.resolve()
  }

  cancelReconnect(): void {}

  release(): void {
    if (this.#releaseDone) return
    const agentId = this.#releaseAgentId
    const connectionId = this.#releaseConnectionId
    if (!agentId || !connectionId) return
    this.#releaseDone = true
    void releaseConnection(agentId, connectionId)
  }

  #bumpSetupEpoch(): SetupEpoch {
    this.#setupEpoch = nextSetupEpoch(this.#setupEpoch)
    return this.#setupEpoch
  }

  #isLive(epoch: SetupEpoch): boolean {
    return isSetupLive(epoch, this.#setupEpoch)
  }

  #clearViewRef(view: SessionView | null | undefined): void {
    if (!view) return
    if (this.#view === view) this.#view = null
    if (this.#pendingView === view) this.#pendingView = null
  }

  close(_mode: CloseMode): void {
    this.#bumpSetupEpoch()
    if (this.#teardownDone) return
    const view = this.#view ?? this.#pendingView
    this.#clearViewRef(view)
    if (view) void view.close().catch(() => {})
    this.#teardownDone = true
  }

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") throw new Error("HttpConnection requires an HTTP agent")
    const isNew = agent.kind === "new"
    const epoch = this.#bumpSetupEpoch()
    this.#teardownDone = false
    this.deps.prepare(agent)
    let attached = false
    let createdAgentId: string | undefined
    let openPending: SessionView | null = null
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
      createdAgentId = isNew ? agentId : undefined
      if (!this.#isLive(epoch)) {
        if (createdAgentId) this.deps.discardCreatedAgent?.(createdAgentId)
        return
      }

      this.deps.setAgent(agentId)
      const view = await createRemoteView(
        { agentId, ...this.deps.viewOptions() },
        {
          onCreated: (created) => {
            if (this.#isLive(epoch)) {
              openPending = created
              this.#pendingView = created
            } else void created.close().catch(() => {})
          },
        },
      )
      if (!this.#isLive(epoch)) {
        void view.close().catch(() => {})
        if (createdAgentId) this.deps.discardCreatedAgent?.(createdAgentId)
        return
      }
      if (this.#pendingView === view) this.#pendingView = null
      openPending = null
      this.#view = view
      const sessionId = view.state.sessionId
      if (sessionId == null) {
        const staleView = view
        await staleView.close()
        this.#clearViewRef(staleView)
        if (this.#isLive(epoch)) this.deps.missingSessionId(!isNew)
        return
      }
      if (!this.#isLive(epoch)) {
        void view.close().catch(() => {})
        if (createdAgentId) this.deps.discardCreatedAgent?.(createdAgentId)
        return
      }
      this.deps.enterSession(sessionId)
      if (!isNew) this.deps.applyTitle(agent)
      this.deps.bindView(view)
      await this.deps.connected(isNew)
      if (!this.#isLive(epoch)) {
        void view.close().catch(() => {})
        if (createdAgentId) this.deps.discardCreatedAgent?.(createdAgentId)
        return
      }
      attached = true
    } catch (error) {
      const orphan = openPending
      this.#clearViewRef(orphan)
      if (orphan != null) void (orphan as SessionView).close().catch(() => {})
      if (this.#isLive(epoch)) {
        if (createdAgentId) this.deps.discardCreatedAgent?.(createdAgentId)
        this.deps.failed(error, !isNew)
      }
    }
    if (attached && isNew && this.#isLive(epoch)) {
      try {
        await this.deps.rememberedConfig()
      } catch {
        // Configuration restoration is optional; it cannot tear down a live host.
      }
    }
  }
}

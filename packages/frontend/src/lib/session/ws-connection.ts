import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk"
import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import { type AcpClient, createAcpClient } from "@drive-coding/provider/client"
import {
  createAgent,
  deleteAgent,
  notifySessionAttached,
  releaseConnection,
} from "$lib/adapters/agents-api"
import { sendDetachFrame } from "$lib/view-models/agent-session-detach-frame"
import type { AgentInput, CloseMode, Connection } from "./connection"
import { isSetupLive, nextSetupEpoch, type SetupEpoch } from "./connection-owner-lifecycle"
import type { LocalSessionView } from "./local-session-view"
import { WsReconnectController, type WsReconnectDeps } from "./ws-reconnect-controller"

type SessionConfigResult = {
  configOptions?: SessionConfigOption[] | null
  models?: {
    currentModelId: string
    availableModels: Array<{ modelId: string; name: string; description?: string | null }>
  } | null
  modes?: SessionModeState | null
}

export type { WsReconnectDeps } from "./ws-reconnect-controller"

export type WsConnectionDeps = {
  connectionId: string
  prepareNew: () => void
  setAgent: (agentId: string, cwd: string, cliKind: string) => void
  url: (agentId: string) => string
  onClose: (code: number, reason: string) => void
  bindLocalView: () => LocalSessionView
  callbacks: (view: LocalSessionView) => Parameters<typeof createAcpClient>[1]
  setClient: (client: AcpClient) => void
  sessionMeta: () => Record<string, unknown> | undefined
  enterSession: (sessionId: string | null) => void
  adoptLocalView: (client: AcpClient, sessionId: string) => void
  captureSessionConfig: (result: SessionConfigResult) => void
  connected: () => Promise<void>
  failed: (error: unknown) => void
  prepareExisting: (agent: Extract<AgentInput, { kind: "existing-ws" }>) => void
  failedExisting: () => void
  reconnect?: WsReconnectDeps
}

/** The sole owner of a live ACP WebSocket for this session. */
export class WsConnection implements Connection {
  #transport: WsAcpTransport | null = null
  #client: AcpClient | null = null
  #localView: LocalSessionView | null = null
  #connecting = false
  #controller: WsReconnectController | null
  #setupEpoch: SetupEpoch = 0
  #teardownDone = false
  #releaseAgentId: string | null = null
  #releaseConnectionId: string | null = null
  #releaseDone = false

  constructor(private readonly deps: WsConnectionDeps) {
    this.#controller = deps.reconnect ? new WsReconnectController(this, deps, deps.reconnect) : null
  }

  get transport(): WsAcpTransport | null {
    return this.#transport
  }

  captureReleaseIdentity(agentId: string, connectionId: string): void {
    this.#releaseAgentId = agentId
    this.#releaseConnectionId = connectionId
    this.#releaseDone = false
  }

  updateReleaseAgent(agentId: string): void {
    this.#releaseAgentId = agentId
    this.#releaseDone = false
  }

  adoptTransport(transport: WsAcpTransport): void {
    this.#transport = transport
  }

  beginWarmTransport(url: string): WsAcpTransport {
    const transport = new WsAcpTransport(url)
    this.#connecting = true
    this.adoptTransport(transport)
    return transport
  }

  finishWarmTransport(transport: WsAcpTransport): void {
    if (this.#transport === transport) this.#connecting = false
  }

  discardCreatedAgent(agentId: string): void {
    void deleteAgent(agentId).catch(() => {})
  }

  discardTransport(transport: WsAcpTransport): void {
    transport.close()
    if (this.#transport === transport) {
      this.#transport = null
      this.#connecting = false
    }
  }

  async closeAndDiscardTransport(transport: WsAcpTransport): Promise<void> {
    await transport.closeAndWait()
    if (this.#transport === transport) {
      this.#transport = null
      this.#connecting = false
    }
  }

  cancelConnectingTransport(): void {
    if (this.#connecting && this.#transport) this.discardTransport(this.#transport)
  }

  async closeOwnedTransport(): Promise<void> {
    const transport = this.#transport
    if (!transport) return
    await transport.closeAndWait()
    if (this.#transport !== transport) return
    this.#transport = null
    this.deps.reconnect?.clearClient()
  }

  cancelReconnect(): void {
    this.#controller?.cancel()
  }

  bindLocalView(): LocalSessionView {
    const view = this.deps.bindLocalView()
    this.#localView = view
    return view
  }

  setClient(client: AcpClient): void {
    this.#client = client
    this.deps.setClient(client)
  }

  adoptLocalView(client: AcpClient, sessionId: string): void {
    this.deps.adoptLocalView(client, sessionId)
  }

  /** Warm failure: dispose partial local view only (B3 — no client.close here). */
  disposeFailedWarmView(): void {
    const localView = this.#localView
    if (this.#localView === localView) this.#localView = null
    localView?.dispose()
  }

  /** Cold prepare: synchronous client close before pending cancel (B3). */
  closeClientForCold(): void {
    const client = this.#client
    if (this.#client === client) this.#client = null
    try {
      client?.close()
    } catch {
      /* already closed */
    }
  }

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

  #discardLate(
    epoch: SetupEpoch,
    partial: {
      createdAgentId?: string
      transport?: WsAcpTransport
      client?: AcpClient
      localView?: LocalSessionView
    },
  ): boolean {
    if (this.#isLive(epoch)) return false
    if (partial.createdAgentId) void deleteAgent(partial.createdAgentId).catch(() => {})
    if (partial.client) {
      try {
        partial.client.close()
      } catch {
        /* closed */
      }
    } else if (partial.transport) {
      try {
        partial.transport.close()
      } catch {
        /* closed */
      }
    }
    partial.localView?.dispose()
    return true
  }

  close(mode: CloseMode): void {
    this.#bumpSetupEpoch()
    if (this.#teardownDone && mode.kind !== "recover") return

    const transport = this.#transport
    const client = this.#client
    const localView = this.#localView

    if (mode.kind === "end-view" || mode.kind === "preserve-agent") {
      this.#controller?.cancel()
    }

    if (mode.kind === "preserve-agent" && transport) {
      sendDetachFrame(transport)
    }

    let clientClosed = false
    try {
      if (client) {
        try {
          client.close()
          clientClosed = true
        } catch {
          /* already closed */
        }
      }
    } finally {
      if (localView) void localView.close().catch(() => localView.dispose())
    }

    if (!clientClosed && transport && mode.kind !== "recover") {
      try {
        transport.close()
      } catch {
        /* wire already closed */
      }
    }

    if (this.#client === client) this.#client = null
    if (this.#localView === localView) this.#localView = null

    if (mode.kind !== "recover") {
      if (this.#transport === transport) {
        this.#transport = null
        this.#connecting = false
      }
      this.#teardownDone = true
    }
  }

  async reconnect(): Promise<void> {
    await this.#controller?.reconnectNow()
  }

  async onUnexpectedClose(code: number, reason: string): Promise<void> {
    await this.#controller?.onUnexpectedClose(code, reason)
  }

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") {
      if (!agent.sessionId) throw new Error("existing WS agent requires sessionId")
      this.deps.prepareExisting(agent)
      this.captureReleaseIdentity(agent.agentId, this.deps.connectionId)
      if (!this.#controller) throw new Error("existing WS agent requires reconnect policy")
      await this.#controller.attachExisting(agent.agentId)
      return
    }
    if (agent.kind !== "new") throw new Error("WsConnection requires a WS agent")

    const epoch = this.#bumpSetupEpoch()
    this.#teardownDone = false
    this.deps.prepareNew()
    let createdAgentId: string | undefined
    let transport: WsAcpTransport | undefined
    let localView: LocalSessionView | undefined
    let client: AcpClient | undefined
    try {
      const created = await createAgent({
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        systemPrompt: agent.systemPrompt,
      })
      createdAgentId = created.agentId
      if (this.#discardLate(epoch, { createdAgentId })) return

      this.deps.setAgent(created.agentId, agent.cwd, agent.cliKind)
      this.captureReleaseIdentity(created.agentId, this.deps.connectionId)
      transport = new WsAcpTransport(this.deps.url(created.agentId))
      this.adoptTransport(transport)
      transport.onClose((code, reason) => {
        if (this.#transport === transport) this.deps.onClose(code, reason)
      })
      await transport.waitForOpen()
      if (this.#discardLate(epoch, { createdAgentId, transport })) return

      localView = this.bindLocalView()
      client = await createAcpClient(transport, this.deps.callbacks(localView))
      if (this.#discardLate(epoch, { createdAgentId, transport, client, localView })) return

      this.setClient(client)
      const meta = this.deps.sessionMeta()
      const result = await client.newSession({
        cwd: agent.cwd,
        mcpServers: [],
        ...(meta && { _meta: meta }),
      })
      if (this.#discardLate(epoch, { createdAgentId, transport, client, localView })) return

      const sessionId = (result as { sessionId?: string }).sessionId ?? null
      this.deps.enterSession(sessionId)
      if (!sessionId) throw new Error("newSession returned no sessionId")
      this.adoptLocalView(client, sessionId)
      this.deps.captureSessionConfig(result)
      await notifySessionAttached(created.agentId, sessionId).catch(() => {})
      if (this.#discardLate(epoch, { createdAgentId, transport, client, localView })) return

      await this.deps.connected()
      if (!this.#isLive(epoch)) {
        this.#discardLate(epoch, { createdAgentId, transport, client, localView })
        return
      }
    } catch (error) {
      if (this.#isLive(epoch)) {
        this.#discardLate(epoch, {
          createdAgentId,
          transport,
          client,
          localView,
        })
        this.deps.failed(error)
      }
    }
  }
}

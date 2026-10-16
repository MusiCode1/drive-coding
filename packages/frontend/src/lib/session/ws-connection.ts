import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk"
import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import { type AcpClient, createAcpClient } from "@drive-coding/provider/client"
import { createAgent, notifySessionAttached, releaseConnection } from "$lib/adapters/agents-api"
import { sendDetachFrame } from "$lib/view-models/agent-session-detach-frame"
import type { AgentInput, CloseMode, Connection } from "./connection"
import { ConnectionAllocation } from "./connection-allocation"
import { isSetupLive, nextSetupEpoch, type SetupEpoch } from "./connection-owner-lifecycle"
import { guardAcpCallbacks } from "./guard-acp-callbacks"
import type { LocalSessionView } from "./local-session-view"
import {
  runWsLoadAttempt,
  type WsLoadHooks,
  type WsLoadInput,
  type WsLoadOptions,
} from "./ws-load-attempt"
import { WsReconnectController, type WsReconnectDeps } from "./ws-reconnect-controller"
import { WsResourceAttempt } from "./ws-resource-attempt"

export type SessionConfigResult = {
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
  isBound?: () => boolean
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

/** The sole owner of a live ACP WebSocket and each of its setup generations. */
export class WsConnection implements Connection {
  #attempt: WsResourceAttempt | undefined
  #transports = new WeakMap<WsAcpTransport, WsResourceAttempt>()
  #connecting = false
  #controller: WsReconnectController | null
  #setupEpoch: SetupEpoch = 0
  #allocation = new ConnectionAllocation()
  #releaseAgentId: string | null = null
  #releaseConnectionId: string | null = null

  constructor(private readonly deps: WsConnectionDeps) {
    this.#controller = deps.reconnect ? new WsReconnectController(this, deps, deps.reconnect) : null
  }

  get transport(): WsAcpTransport | null {
    return this.#attempt?.transport ?? null
  }

  beginAttempt(allowed: () => boolean = () => true): WsResourceAttempt {
    if (this.#attempt) this.#attempt.active = false
    const epoch = nextSetupEpoch(this.#setupEpoch)
    this.#setupEpoch = epoch
    const attempt = new WsResourceAttempt(
      () => isSetupLive(epoch, this.#setupEpoch) && (this.deps.isBound?.() ?? true) && allowed(),
    )
    this.#attempt = attempt
    return attempt
  }

  captureReleaseIdentity(agentId: string, connectionId: string): void {
    this.#releaseAgentId = agentId
    this.#releaseConnectionId = connectionId
  }

  updateReleaseAgent(agentId: string): void {
    this.captureReleaseIdentity(agentId, this.deps.connectionId)
  }

  deleteAgentOnce(agentId: string): void {
    this.#allocation.deleteOnce(agentId)
  }

  discardCreatedAgent(agentId: string): void {
    this.deleteAgentOnce(agentId)
  }

  adoptTransport(transport: WsAcpTransport): void {
    this.ownTransport(this.#attempt ?? this.beginAttempt(), transport)
  }

  ownTransport(attempt: WsResourceAttempt, raw: WsAcpTransport): WsAcpTransport {
    const transport = attempt.ownTransport(raw)
    this.#transports.set(transport, attempt)
    return transport
  }

  beginWarmTransport(url: string): WsAcpTransport {
    const attempt = this.beginAttempt()
    this.#connecting = true
    return this.ownTransport(attempt, new WsAcpTransport(url))
  }

  finishWarmTransport(transport: WsAcpTransport): void {
    if (this.transport === transport) this.#connecting = false
  }

  callbacks(view: LocalSessionView, allowed: () => boolean = () => true) {
    const attempt = this.#attempt
    const supplied = this.deps.callbacks(view)
    return guardAcpCallbacks(
      typeof supplied === "function" ? { onUpdate: supplied } : supplied,
      () => !!attempt && attempt.view === view && attempt.current() && allowed(),
    )
  }

  discardTransport(transport: WsAcpTransport): void {
    const attempt = this.#transports.get(transport)
    attempt?.closeTransport()
    if (attempt === this.#attempt) this.#connecting = false
  }

  async closeAndDiscardTransport(transport: WsAcpTransport): Promise<void> {
    const attempt = this.#transports.get(transport)
    await attempt?.closeTransportAndWait()
    if (attempt === this.#attempt && attempt) {
      attempt.transport = undefined
      this.#connecting = false
    }
  }

  cancelConnectingTransport(): void {
    if (this.#connecting && this.transport) this.discardTransport(this.transport)
  }

  async closeOwnedTransport(): Promise<void> {
    const attempt = this.#attempt
    if (!attempt) return
    attempt.active = false
    await attempt.closeTransportAndWait()
    if (this.#attempt !== attempt) return
    attempt.disposeView()
    attempt.transport = undefined
    // The transport's close already ended this client generation.
    attempt.client = undefined
    this.deps.reconnect?.clearClient()
  }

  cancelReconnect(): void {
    this.#controller?.cancel()
  }

  bindLocalView(): LocalSessionView {
    const attempt = this.#attempt?.active ? this.#attempt : this.beginAttempt()
    const view = this.deps.bindLocalView()
    attempt.view = view
    return view
  }

  setClient(client: AcpClient): void {
    const attempt = this.#attempt ?? this.beginAttempt()
    attempt.client = client
    this.deps.setClient(client)
  }

  adoptLocalView(client: AcpClient, sessionId: string): void {
    if (this.#attempt) this.#attempt.adopted = true
    this.deps.adoptLocalView(client, sessionId)
  }

  disposeFailedWarmView(): void {
    this.#attempt?.disposeView()
  }

  closeClientForCold(): void {
    this.#attempt?.closeClient()
  }

  release(): void {
    const agentId = this.#releaseAgentId
    const connectionId = this.#releaseConnectionId
    if (agentId && connectionId && this.#allocation.releaseOnce(agentId))
      void releaseConnection(agentId, connectionId)
  }

  discardLate(attempt: WsResourceAttempt): boolean {
    if (attempt.current()) return false
    attempt.close()
    if (attempt.created && attempt.agentId) this.deleteAgentOnce(attempt.agentId)
    return true
  }

  close(mode: CloseMode): void {
    const attempt = this.#attempt
    const wasActive = attempt?.active
    if (attempt) attempt.active = false
    if (mode.kind !== "recover") this.#controller?.cancel()
    if (mode.kind === "preserve-agent" && wasActive && attempt.transport)
      sendDetachFrame(attempt.transport)
    attempt?.close()
    this.#connecting = false
  }

  async reconnect(): Promise<void> {
    await this.#controller?.reconnectNow()
  }

  async onUnexpectedClose(code: number, reason: string): Promise<void> {
    await this.#controller?.onUnexpectedClose(code, reason)
  }

  loadSession(input: WsLoadInput, hooks: WsLoadHooks, options?: WsLoadOptions): Promise<void> {
    return runWsLoadAttempt(this, this.deps, input, hooks, options)
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
    const attempt = this.beginAttempt()
    attempt.created = true
    this.deps.prepareNew()
    try {
      const created = await createAgent({
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        systemPrompt: agent.systemPrompt,
      })
      attempt.agentId = created.agentId
      if (this.discardLate(attempt)) return
      this.deps.setAgent(created.agentId, agent.cwd, agent.cliKind)
      this.captureReleaseIdentity(created.agentId, this.deps.connectionId)
      const transport = this.ownTransport(
        attempt,
        new WsAcpTransport(this.deps.url(created.agentId)),
      )
      transport.onClose((code, reason) => {
        if (attempt.current()) this.deps.onClose(code, reason)
      })
      await transport.waitForOpen()
      if (this.discardLate(attempt)) return
      const view = this.bindLocalView()
      attempt.client = await createAcpClient(transport, this.callbacks(view))
      if (this.discardLate(attempt)) return
      const client = attempt.client
      this.setClient(client)
      const meta = this.deps.sessionMeta()
      const result = await client.newSession({
        cwd: agent.cwd,
        mcpServers: [],
        ...(meta && { _meta: meta }),
      })
      if (this.discardLate(attempt)) return
      const sessionId = (result as { sessionId?: string }).sessionId ?? null
      this.deps.enterSession(sessionId)
      if (!sessionId) throw new Error("newSession returned no sessionId")
      this.adoptLocalView(client, sessionId)
      this.deps.captureSessionConfig(result)
      await notifySessionAttached(created.agentId, sessionId).catch(() => {})
      if (this.discardLate(attempt)) return
      await this.deps.connected()
      this.discardLate(attempt)
    } catch (error) {
      if (this.discardLate(attempt)) return
      this.deps.failed(error)
    }
  }
}

import type { SessionConfigOption, SessionModeState } from "@agentclientprotocol/sdk"
import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import { type AcpClient, createAcpClient } from "@drive-coding/provider/client"
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import type { AgentInput, Connection } from "./connection"
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
  prepareNew: () => void
  setAgent: (agentId: string, cwd: string, cliKind: string) => void
  url: (agentId: string) => string
  setTransport: (transport: WsAcpTransport) => void
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
  /** Replaced by owner-owned warm I/O when the VM consumer is wired in phase 2. */
  openExisting: (agent: Extract<AgentInput, { kind: "existing-ws" }>) => Promise<void>
  reconnect?: WsReconnectDeps
}

/** The sole owner of a live ACP WebSocket for this session. */
export class WsConnection implements Connection {
  #transport: WsAcpTransport | null = null
  #connecting = false
  #controller: WsReconnectController | null

  constructor(private readonly deps: WsConnectionDeps) {
    this.#controller = deps.reconnect ? new WsReconnectController(this, deps, deps.reconnect) : null
  }

  get transport(): WsAcpTransport | null {
    return this.#transport
  }

  adoptTransport(transport: WsAcpTransport): void {
    this.#transport = transport
    this.deps.setTransport(transport)
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

  async reconnect(): Promise<void> {
    await this.#controller?.reconnectNow()
  }

  async onUnexpectedClose(code: number, reason: string): Promise<void> {
    await this.#controller?.onUnexpectedClose(code, reason)
  }

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") {
      if (!agent.sessionId) throw new Error("existing WS agent requires sessionId")
      await this.deps.openExisting(agent)
      return
    }
    if (agent.kind !== "new") throw new Error("WsConnection requires a WS agent")

    this.deps.prepareNew()
    try {
      const { agentId } = await createAgent({
        cwd: agent.cwd,
        cliKind: agent.cliKind,
        systemPrompt: agent.systemPrompt,
      })
      this.deps.setAgent(agentId, agent.cwd, agent.cliKind)
      const transport = new WsAcpTransport(this.deps.url(agentId))
      this.adoptTransport(transport)
      transport.onClose(this.deps.onClose)
      await transport.waitForOpen()
      const localView = this.deps.bindLocalView()
      const client = await createAcpClient(transport, this.deps.callbacks(localView))
      this.deps.setClient(client)
      const meta = this.deps.sessionMeta()
      const result = await client.newSession({
        cwd: agent.cwd,
        mcpServers: [],
        ...(meta && { _meta: meta }),
      })
      const sessionId = (result as { sessionId?: string }).sessionId ?? null
      this.deps.enterSession(sessionId)
      if (!sessionId) throw new Error("newSession returned no sessionId")
      this.deps.adoptLocalView(client, sessionId)
      this.deps.captureSessionConfig(result)
      await notifySessionAttached(agentId, sessionId).catch(() => {})
      await this.deps.connected()
    } catch (error) {
      this.deps.failed(error)
    }
  }
}

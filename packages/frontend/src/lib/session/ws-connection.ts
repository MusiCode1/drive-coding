import { WsAcpTransport } from "@drive-coding/acp-wire/browser"
import { type AcpClient, createAcpClient } from "@drive-coding/provider/client"
import { createAgent, notifySessionAttached } from "$lib/adapters/agents-api"
import type { AgentInput, Connection } from "./connection"
import type { LocalSessionView } from "./local-session-view"

type SessionResult = Awaited<ReturnType<AcpClient["newSession"]>>

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
  captureSessionConfig: (result: SessionResult) => void
  connected: () => Promise<void>
  failed: (error: unknown) => void
  /** Temporary B3 debt: warm WS I/O remains in AgentSession. */
  openExisting: (agent: Extract<AgentInput, { kind: "existing-ws" }>) => Promise<void>
}

export class WsConnection implements Connection {
  constructor(private readonly deps: WsConnectionDeps) {}

  async open(agent: AgentInput): Promise<void> {
    if (agent.kind === "existing-ws") {
      // Runtime boundary too: JavaScript callers can bypass the TypeScript discriminant.
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
      this.deps.setTransport(transport)
      transport.onClose(this.deps.onClose)
      await transport.waitForOpen()

      // The observer must exist before client creation: callbacks are frozen there.
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

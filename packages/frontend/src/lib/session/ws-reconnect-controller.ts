import type { AcpClient } from "@drive-coding/provider/client"
import { deleteAgent, getAgent, listAgents } from "$lib/adapters/agents-api"
import type { WsConnection, WsConnectionDeps } from "./ws-connection"
import { WsReconnectAttempt } from "./ws-reconnect-attempt"
import { runWarmReconnect } from "./ws-warm-reconnect"

export type ColdResult =
  | { kind: "connected"; agentId: string }
  | { kind: "failed"; preservedSessionId: string; failedAgentId?: string }

export type ReconnectContext = {
  sessionId: string
  cwd: string
  cliKind: string
  agentId: string | null
  hidden: boolean
  detached: boolean
  tearingDown: boolean
  remote: boolean
  terminalError: boolean
}

export type WsReconnectDeps = {
  context: () => ReconnectContext | null
  snapshot: () => void
  setStatus: (status: "connecting" | "connected" | "disconnected") => void
  setAttempt: (attempt: number) => void
  setTerminal: (kind: "takeover" | "host-active" | "crash", detail?: string) => void
  clearTransientError: () => void
  clearClient: () => void
  prepareWarm: (agentId: string) => void
  setAttachedClient: (client: AcpClient) => void
  startReplay: () => void
  finishReplay: () => void
  disposeFailedWarm: () => void
  cold: (isCurrent: () => boolean) => Promise<ColdResult>
  connected: () => void
}

export class WsReconnectController {
  readonly attempt = new WsReconnectAttempt()
  #loop: Promise<void> | null = null

  constructor(
    private readonly owner: WsConnection,
    private readonly deps: WsConnectionDeps,
    private readonly reconnect: WsReconnectDeps,
  ) {}

  cancel(): void {
    this.attempt.cancel()
    this.owner.cancelConnectingTransport()
    this.reconnect.setAttempt(0)
  }

  async reconnectNow(): Promise<void> {
    this.cancel()
    await this.#tryReconnect(this.attempt.generation)
  }

  async onUnexpectedClose(code: number, reason: string): Promise<void> {
    if (code === 1000 || code === 1001) return
    const context = this.reconnect.context()
    if (
      !context ||
      context.detached ||
      context.tearingDown ||
      context.remote ||
      context.terminalError
    )
      return
    if (code === 4409 || (code === 1008 && reason === "session-host-active")) {
      this.cancel()
      this.reconnect.setTerminal(code === 4409 ? "takeover" : "host-active")
      return
    }
    const generation = this.attempt.generation
    const info = context.agentId ? await getAgent(context.agentId).catch(() => null) : null
    if (generation !== this.attempt.generation) return
    if (info?.agent.status === "crashed" && info.agent.crashReason) {
      this.cancel()
      this.reconnect.setTerminal("crash", info.agent.crashReason)
      return
    }
    this.reconnect.clearTransientError()
    this.reconnect.setStatus("disconnected")
    if (context.hidden || this.#loop) return
    this.cancel()
    const loopGeneration = this.attempt.generation
    this.#loop = this.#runLoop(loopGeneration).finally(() => {
      this.#loop = null
    })
  }

  #current(generation: number): boolean {
    return this.attempt.isCurrent(generation, () => {
      const context = this.reconnect.context()
      return !!context && !context.detached && !context.tearingDown && !context.remote
    })
  }

  async #runLoop(generation: number): Promise<void> {
    const delays = [1000, 2000, 4000, 8000, 16000]
    for (let index = 0; index < delays.length; index++) {
      if (!this.#current(generation)) return
      this.reconnect.setAttempt(index + 1)
      await this.attempt.wait(delays[index] ?? 16000)
      if (!this.#current(generation)) return
      const result = await this.#tryReconnect(generation)
      if (result !== "failed") return
    }
    if (this.#current(generation)) {
      this.reconnect.setAttempt(0)
      this.reconnect.setStatus("disconnected")
    }
  }

  async #tryReconnect(
    generation: number,
  ): Promise<"connected" | "failed" | "terminal" | "cancelled"> {
    if (!this.#current(generation)) return "cancelled"
    const context = this.reconnect.context()
    if (!context) return "cancelled"
    this.reconnect.snapshot()
    if (this.owner.transport) await this.owner.closeOwnedTransport()
    if (!this.#current(generation)) return "cancelled"
    const found = await this.attempt.awaitCurrent(
      listAgents().catch(() => []),
      generation,
      () => this.#current(generation),
    )
    if (found.kind === "cancelled") return "cancelled"
    const reusable = found.value.find(
      (agent) =>
        agent.acpSessionId === context.sessionId &&
        agent.cwd === context.cwd &&
        agent.status !== "crashed" &&
        agent.status !== "closed",
    )
    if (reusable) {
      const warm = await runWarmReconnect(
        this.owner,
        this.deps,
        this.reconnect,
        this.attempt,
        reusable.id,
        context,
        generation,
        () => this.#current(generation),
      )
      if (warm === "connected") {
        this.reconnect.setAttempt(0)
        this.reconnect.connected()
        return "connected"
      }
      if (warm === "terminal") return "terminal"
      if (!this.#current(generation)) return "cancelled"
    }
    const coldTask: Promise<ColdResult> = this.reconnect
      .cold(() => this.#current(generation))
      .catch(() => ({ kind: "failed", preservedSessionId: context.sessionId }))
    const coldResult = await this.attempt.awaitCurrent(coldTask, generation, () =>
      this.#current(generation),
    )
    if (coldResult.kind === "cancelled") return "cancelled"
    const cold = coldResult.value
    if (!this.#current(generation)) return "cancelled"
    if (cold.kind === "connected") {
      if (context.agentId && context.agentId !== cold.agentId)
        void deleteAgent(context.agentId).catch(() => {})
      this.reconnect.setAttempt(0)
      this.reconnect.connected()
      return "connected"
    }
    if (cold.failedAgentId && cold.failedAgentId !== context.agentId)
      void deleteAgent(cold.failedAgentId).catch(() => {})
    return "failed"
  }
}

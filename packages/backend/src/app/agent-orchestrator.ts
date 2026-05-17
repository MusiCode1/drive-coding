import type { Agent, AgentRegistry, BridgeManager, CreateAgentInput } from "@drive-coding/core"
import { extractProviderError } from "@drive-coding/core/acp/provider-error"
import { createAcpWsTransport } from "../acp/acp-transport.js"
import type { BridgeHandleWithStderr } from "../acp/bridge-manager.js"
import { type AgentSession, createAgentSession } from "./agent-session.js"

export type AgentOrchestrator = {
  /** Create an agent (registry) + spawn bridge + ACP attach. On failure: status='crashed'. */
  createAndSpawn(input: CreateAgentInput): Promise<Agent>

  /** Delete agent + kill bridge + shutdown session. */
  deleteAndKill(id: string): Promise<void>

  /** Get live AgentSession for a given agent id. Null if not found or not ready. */
  getSession(id: string): AgentSession | null
}

/** BridgeManager with optional spawnWithStderr extension (added in Slice 5.6). */
type ExtendedBridgeManager = BridgeManager & {
  spawnWithStderr?: (
    bridgeId: string,
    input: Parameters<BridgeManager["spawn"]>[1],
  ) => Promise<BridgeHandleWithStderr>
}

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: ExtendedBridgeManager
}): AgentOrchestrator {
  const sessions = new Map<string, AgentSession>()
  // Stores stderr getters keyed by agent id, for crash extraction
  const stderrGetters = new Map<string, () => string[]>()

  // Wire crash handler: when a bridge dies unexpectedly, mark agent as crashed
  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        // Try to extract a provider-specific crash reason from stderr
        const getStderr = stderrGetters.get(bridgeId)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined

        await deps.registry.update(bridgeId, { status: "crashed", crashReason })
        stderrGetters.delete(bridgeId)
      }
      const session = sessions.get(bridgeId)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(bridgeId)
      }
      console.warn(`[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}`)
    } catch (e) {
      console.error("[orchestrator] crash cleanup failed:", e)
    }
  })

  return {
    async createAndSpawn(input: CreateAgentInput): Promise<Agent> {
      // 1. Create with status='starting'
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      try {
        // 2. Spawn bridge — waits for port detection (up to 30s)
        // Prefer spawnWithStderr for stderr access; fall back to plain spawn.
        let handle: BridgeHandleWithStderr | Awaited<ReturnType<BridgeManager["spawn"]>>
        if (deps.bridgeManager.spawnWithStderr) {
          handle = await deps.bridgeManager.spawnWithStderr(agent.id, {
            cliKind: input.cliKind,
            cwd: input.cwd,
            modelOverride: input.modelOverride ?? null,
          })
          stderrGetters.set(agent.id, (handle as BridgeHandleWithStderr).getStderr)
        } else {
          handle = await deps.bridgeManager.spawn(agent.id, {
            cliKind: input.cliKind,
            cwd: input.cwd,
            modelOverride: input.modelOverride ?? null,
          })
        }

        // 3. ACP handshake: initialize + session/new
        const transport = await createAcpWsTransport({
          wsUrl: handle.wsUrl,
          cwd: input.cwd,
        })
        const { sessionId, capabilities: _caps } = await transport.start({ cwd: input.cwd })

        // 4. Create AgentSession for fan-out
        // Wire getStderr so provider errors surface after empty responses (PROMPT-17)
        const getStderr = stderrGetters.get(agent.id)
        const agentSession = createAgentSession({
          agentId: agent.id,
          transport,
          ...(getStderr ? { getStderr } : {}),
        })
        sessions.set(agent.id, agentSession)

        // 5. Mark ready
        const updated = await deps.registry.update(agent.id, {
          status: "ready",
          bridgePort: handle.port,
          acpSessionId: sessionId,
        })
        return updated
      } catch (e) {
        // Try to extract a provider error from stderr before marking crashed
        const getStderr = stderrGetters.get(agent.id)
        const crashReason = getStderr ? (extractProviderError(getStderr()) ?? undefined) : undefined
        stderrGetters.delete(agent.id)

        await deps.registry.update(agent.id, { status: "crashed", crashReason }).catch(() => {})
        throw new Error(
          `spawn/attach failed for agent ${agent.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },

    async deleteAndKill(id: string): Promise<void> {
      const agent = await deps.registry.get(id)
      if (!agent) return

      // Gracefully mark closed first
      try {
        await deps.registry.update(id, { status: "closed" })
      } catch {
        // ignore
      }

      // Shutdown ACP session
      const session = sessions.get(id)
      if (session) {
        await session.shutdown().catch(() => {})
        sessions.delete(id)
      }

      // Kill bridge process
      await deps.bridgeManager.kill(id)

      // Clean up stderr getter
      stderrGetters.delete(id)

      // Remove from registry
      try {
        await deps.registry.delete(id)
      } catch {
        // ignore if already gone
      }
    },

    getSession(id: string): AgentSession | null {
      return sessions.get(id) ?? null
    },
  }
}

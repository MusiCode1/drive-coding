import type { Agent, AgentRegistry, BridgeManager, CreateAgentInput } from "@drive-coding/core"

export type AgentOrchestrator = {
  /** create an agent (registry) + spawn bridge. On failure, agent.status='crashed'. */
  createAndSpawn(input: CreateAgentInput): Promise<Agent>

  /** delete agent + kill bridge. */
  deleteAndKill(id: string): Promise<void>
}

export function createAgentOrchestrator(deps: {
  registry: AgentRegistry
  bridgeManager: BridgeManager
}): AgentOrchestrator {
  // Wire crash handler: כש-bridge מת בלי שביקשנו, סמן agent כ-crashed
  deps.bridgeManager.onCrash(async (bridgeId, exitCode) => {
    try {
      const existing = await deps.registry.get(bridgeId)
      if (existing && existing.status !== "closed") {
        await deps.registry.update(bridgeId, { status: "crashed" })
        console.warn(`[orchestrator] bridge ${bridgeId} crashed with code ${exitCode}`)
      }
    } catch (e) {
      console.error("[orchestrator] failed to update status on crash:", e)
    }
  })

  return {
    async createAndSpawn(input: CreateAgentInput): Promise<Agent> {
      // 1. Create with status='starting'
      const agent = await deps.registry.create(input)
      await deps.registry.update(agent.id, { status: "starting" })

      // 2. Spawn bridge — ממתינים לport detection (עד 30s)
      try {
        const handle = await deps.bridgeManager.spawn(agent.id, {
          cliKind: input.cliKind,
          cwd: input.cwd,
          modelOverride: input.modelOverride ?? null,
        })

        // 3. Update with port + ready
        const updated = await deps.registry.update(agent.id, {
          status: "ready",
          bridgePort: handle.port,
        })
        return updated
      } catch (e) {
        // spawn נכשל — סמן כ-crashed
        await deps.registry.update(agent.id, { status: "crashed" })
        throw new Error(
          `Failed to spawn bridge for agent ${agent.id}: ${e instanceof Error ? e.message : String(e)}`,
        )
      }
    },

    async deleteAndKill(id: string): Promise<void> {
      const agent = await deps.registry.get(id)
      if (!agent) return

      // Update status first
      try {
        await deps.registry.update(id, { status: "closed" })
      } catch {
        // ignore
      }

      // Kill bridge
      await deps.bridgeManager.kill(id)

      // Remove from registry
      try {
        await deps.registry.delete(id)
      } catch {
        // ignore (already deleted)
      }
    },
  }
}

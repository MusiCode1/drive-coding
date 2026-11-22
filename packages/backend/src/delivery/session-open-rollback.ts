import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { AgentOrchestrator } from "../app/agent-orchestrator.js"

const log = createLogger("backend.mcp")

export async function withSessionOpenRollback<T>(
  deps: { registry: AgentRegistry; orchestrator: AgentOrchestrator },
  agentId: string,
  finishOpen: () => Promise<T>,
): Promise<T> {
  try {
    return await finishOpen()
  } catch (error) {
    try {
      await deps.orchestrator.deleteAndKill(agentId)
    } catch (err) {
      log.warn({ err, agentId }, "session_open rollback close failed")
    }

    let status: string
    try {
      status = (await deps.registry.get(agentId))
        ? "Agent close failed"
        : "Agent removed (registry entry deleted through normal close; process termination was not verified)"
    } catch (err) {
      log.warn({ err, agentId }, "session_open rollback verification failed")
      status = "Agent close status unknown"
    }

    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${message}. ${status} · agent=${agentId}`, { cause: error })
  }
}

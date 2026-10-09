/** server-on-session-attached.ts — onSessionAttached callback for SessionHost registry. */
import type { Agent, AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { recordHistoryAttachFromPatch } from "./delivery/http-agents-history.js"
import type { SessionHistoryStore } from "./history/session-history-store.js"
import type { OnSessionAttached } from "./session-host/registry.js"

const log = createLogger("backend.server")

export function createOnSessionAttached(deps: {
  registry: AgentRegistry
  sessionHistoryStore: SessionHistoryStore
  acpSessionIdCache: Map<string, string>
}): OnSessionAttached {
  return async (agentId, sessionId, cwd) => {
    const agent = await deps.registry.get(agentId)
    if (!agent || agent.status === "closed") {
      log.warn({ agentId, sessionId }, "onSessionAttached: agent missing or closed — skipped")
      return
    }
    const patch: Partial<Pick<Agent, "status" | "acpSessionId" | "cwd">> = {
      status: "ready",
      acpSessionId: sessionId,
    }
    if (cwd !== undefined) patch.cwd = cwd
    await deps.registry.update(agentId, patch)
    deps.acpSessionIdCache.set(agentId, sessionId)
    recordHistoryAttachFromPatch(deps.sessionHistoryStore, agentId, agent, sessionId, cwd ?? agent.cwd)
  }
}

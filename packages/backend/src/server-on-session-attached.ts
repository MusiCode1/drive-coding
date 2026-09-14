/**
 * server-on-session-attached.ts — onSessionAttached callback for SessionHost registry.
 */

import type { Agent, BridgeKind } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { AgentRegistry } from "@drive-coding/core"
import type { ProjectsRegistry } from "./app/projects-registry.js"
import type { OnSessionAttached } from "./session-host/registry.js"

const log = createLogger("backend.server")

export function createOnSessionAttached(deps: {
  registry: AgentRegistry
  projectsRegistry: ProjectsRegistry
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
    const effectiveCwd = cwd ?? agent.cwd
    await deps.projectsRegistry.recordCwd(effectiveCwd, agent.cliKind as BridgeKind)
    await deps.projectsRegistry.recordSession(effectiveCwd, sessionId)
  }
}

/**
 * server-session-host-opts.ts — SessionHost registry opts wired from server.ts.
 */

import type { AgentRegistry } from "@drive-coding/core"
import type { AgentOrchestrator } from "./app/agent-orchestrator.js"
import { resolveCloseOnTurnEndGraceMs } from "./session-host/close-on-turn-end.js"
import type { AgentEventBus } from "./session-host/agent-events.js"
import { agentEventSessionHostOpts } from "./delivery/agent-events-boot.js"
import { createStallSuspectedEmitter } from "./session-host/agent-events-stall.js"
import { createOnSessionAttached } from "./server-on-session-attached.js"
import type { ProjectsRegistry } from "./app/projects-registry.js"
import { createLogger } from "@drive-coding/core/log"

const log = createLogger("backend.server")

export function createSessionHostRegistryOpts(deps: {
  registry: AgentRegistry
  projectsRegistry: ProjectsRegistry
  acpSessionIdCache: Map<string, string>
  agentEventBus: AgentEventBus
  getOrchestrator: () => AgentOrchestrator | null
  evictionController: Parameters<
    typeof import("./session-host/http/index.js").createAndRegisterSessionHostHttp
  >[2]["evictionController"]
}) {
  return {
    onSessionAttached: createOnSessionAttached({
      registry: deps.registry,
      projectsRegistry: deps.projectsRegistry,
      acpSessionIdCache: deps.acpSessionIdCache,
    }),
    evictionController: deps.evictionController,
    getAcpSessionId: (agentId: string) => deps.acpSessionIdCache.get(agentId),
    getPermissionPolicy: async (agentId: string) => {
      const agent = await deps.registry.get(agentId)
      return agent?.permissionPolicy
    },
    getCloseOnTurnEnd: async (agentId: string) => {
      const agent = await deps.registry.get(agentId)
      return agent?.closeOnTurnEnd === true
    },
    onScheduleCloseOnTurnEnd: (agentId: string) => {
      const graceMs = resolveCloseOnTurnEndGraceMs(process.env.CLOSE_ON_TURN_END_GRACE_MS)
      setTimeout(() => {
        void deps.getOrchestrator()?.deleteAndKill(agentId).catch((err) => {
          log.warn({ err, agentId }, "closeOnTurnEnd: deleteAndKill failed after grace")
        })
      }, graceMs)
    },
    ...agentEventSessionHostOpts(deps.agentEventBus),
    onStallSuspected: createStallSuspectedEmitter(deps.agentEventBus),
  }
}

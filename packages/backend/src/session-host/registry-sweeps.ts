/**
 * registry-sweeps.ts — ownership TTL + stall sweeps for AgentSessionRegistry (slice be-events-subscribe C2).
 */

import { createLogger } from "@drive-coding/core/log"
import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { HostEntry } from "./registry.js"
import { startAgentStallSweep } from "./agent-events-stall-sweep.js"

const log = createLogger("backend.session-host.registry")

export function wireRegistrySweeps(deps: {
  map: Map<string, HostEntry>
  connectionRegistry: ConnectionRegistry
  httpOwnerTtlMs: number
  httpSweepMs: number
  onStallSuspected?: (agentId: string, silentMs: number) => void
  _stallSweepMs?: number
  _stallSuspectMs?: number
}): void {
  const httpSweep = setInterval(() => {
    const now = Date.now()
    for (const [agentId, entry] of deps.map) {
      if (deps.connectionRegistry.getOwner(agentId)?.via !== "http") continue
      const lastSeen = deps.connectionRegistry.getLastSeenAt(agentId)
      if (lastSeen === null) continue
      if (now - lastSeen <= deps.httpOwnerTtlMs) continue
      log.info(
        { agentId, staleMs: now - lastSeen },
        "HTTP owner stale — releasing ownership (holder retained)",
      )
      deps.connectionRegistry.markDetached(agentId)
      entry.broadcaster.close()
    }
  }, deps.httpSweepMs)
  httpSweep.unref()

  if (deps.onStallSuspected) {
    startAgentStallSweep({
      map: deps.map,
      connectionRegistry: deps.connectionRegistry,
      onStallSuspected: deps.onStallSuspected,
      _stallSweepMs: deps._stallSweepMs,
      _stallSuspectMs: deps._stallSuspectMs,
    })
  }
}

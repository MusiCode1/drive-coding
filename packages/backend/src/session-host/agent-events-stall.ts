/**
 * agent-events-stall.ts — stall-suspected detection (slice be-events-subscribe C2).
 */

import type { AgentEventBus } from "./agent-events.js"
import { resolveStallSuspectMs } from "./agent-events.js"
import type { ExtendedSessionHost } from "./session-host.js"
import type { ConnectionRegistry } from "../acp/connection-registry.js"

export function computeSilentMs(
  now: number,
  turnStartedAt: number,
  lastActivityAt: number | null,
): number {
  return now - Math.max(turnStartedAt, lastActivityAt ?? 0)
}

export type StallSweepHostEntry = {
  host: ExtendedSessionHost
}

export function runStallSweep(deps: {
  now: number
  map: ReadonlyMap<string, StallSweepHostEntry>
  connectionRegistry: ConnectionRegistry
  stallSuspectMs: number
  onStallSuspected: (agentId: string, silentMs: number) => void
}): void {
  for (const [agentId, entry] of deps.map) {
    const { host } = entry
    if (host.state.turnState === "idle") continue
    if (host.getStallReported()) continue
    const turnStartedAt = host.getTurnStartedAt()
    if (turnStartedAt <= 0) continue
    const lastActivityAt = deps.connectionRegistry.getRuntimeInfo(agentId)?.lastMessageAt ?? null
    const silentMs = computeSilentMs(deps.now, turnStartedAt, lastActivityAt)
    if (silentMs < deps.stallSuspectMs) continue
    host.markStallReported()
    deps.onStallSuspected(agentId, silentMs)
  }
}

export function createStallSuspectedEmitter(eventBus: AgentEventBus) {
  return (agentId: string, silentMs: number) => {
    eventBus.emit({
      kind: "stall-suspected",
      agentId,
      at: Date.now(),
      silentMs,
    })
  }
}

export function resolveStallSweepMs(deps: { _stallSweepMs?: number }): number {
  return deps._stallSweepMs ?? 30_000
}

export function resolveStallSuspectMsFromEnv(deps: { _stallSuspectMs?: number }): number {
  return deps._stallSuspectMs ?? resolveStallSuspectMs(process.env.STALL_SUSPECT_MS)
}

/**
 * agent-events-stall-sweep.ts — interval wiring for stall-suspected (slice be-events-subscribe C2).
 */

import type { ConnectionRegistry } from "../acp/connection-registry.js"
import type { HostEntry } from "./registry.js"
import {
  resolveStallSuspectMsFromEnv,
  resolveStallSweepMs,
  runStallSweep,
} from "./agent-events-stall.js"

export function startAgentStallSweep(deps: {
  map: Map<string, HostEntry>
  connectionRegistry: ConnectionRegistry
  onStallSuspected: (agentId: string, silentMs: number) => void
  _stallSweepMs?: number
  _stallSuspectMs?: number
}): ReturnType<typeof setInterval> {
  const stallSuspectMs = resolveStallSuspectMsFromEnv(deps)
  const sweepMs = resolveStallSweepMs(deps)
  const interval = setInterval(() => {
    runStallSweep({
      now: Date.now(),
      map: deps.map,
      connectionRegistry: deps.connectionRegistry,
      stallSuspectMs,
      onStallSuspected: deps.onStallSuspected,
    })
  }, sweepMs)
  interval.unref()
  return interval
}

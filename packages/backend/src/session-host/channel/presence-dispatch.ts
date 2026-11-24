import os from "node:os"
import { deriveMachineStats } from "@drive-coding/core"
import type { ChannelResponse } from "@drive-coding/core/session"
import { httpCacheGet, httpCacheSet } from "../../delivery/http-cache.js"
import type { AgentSessionRegistry } from "../registry.js"

export function dispatchPresence(
  sessionRegistry: AgentSessionRegistry,
  agentId: string,
  connectionId: string | undefined,
): ChannelResponse {
  // Only inbound presence refreshes viewer ownership, including on cache hits.
  if (connectionId !== undefined) {
    sessionRegistry.touchConnection(agentId, connectionId)
  }
  const key = `presence:${agentId}`
  const cached = httpCacheGet(key)
  if (cached !== undefined) return { status: 200, body: cached }

  const agent = sessionRegistry.getRuntimeInfo(agentId)
  const machine = deriveMachineStats({
    totalMemBytes: os.totalmem(),
    freeMemBytes: os.freemem(),
    loadAvg1: os.loadavg()[0] ?? 0,
    cpuCount: os.cpus().length,
  })
  const body = { ok: true, agent, machine }
  httpCacheSet(key, body)
  return { status: 200, body }
}

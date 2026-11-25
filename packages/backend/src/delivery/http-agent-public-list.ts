import { type Agent, type AgentPublic, type AgentRegistry, toAgentPublic } from "@drive-coding/core"
import type { Hono } from "hono"
import { httpCacheGet, httpCacheSet } from "./http-cache.js"

export type AgentListRuntime = {
  getRuntimeInfo(id: string): {
    // In-process agents have no child PID.
    pid: number | null
    attached: boolean
    busy: boolean
    lastMessageAt: number | null
    lastSeenAt: number | null
    via: "ws" | "http" | null
  } | null
  getConnectionCount(id: string): number
}

export function toHttpAgentPublic(agent: Agent): AgentPublic {
  const result = toAgentPublic(agent)
  if (result.userNotes !== undefined) result.agentNotes = result.userNotes
  if (result.sessionFields !== undefined) result.agentFields = result.sessionFields
  return result
}

export function registerAgentPublicList(
  app: Hono,
  registry: AgentRegistry,
  runtime: AgentListRuntime | undefined,
): void {
  app.get("/api/agents", async (c) => {
    c.header("Cache-Control", "no-store")
    const cached = httpCacheGet("agents")
    if (cached !== undefined) return c.json(cached)
    const all = await registry.list()
    const body = {
      agents: all.map((agent) => {
        const info = runtime?.getRuntimeInfo(agent.id)
        return {
          ...toHttpAgentPublic(agent),
          pid: info?.pid ?? null,
          attached: info?.attached ?? false,
          busy: info?.busy ?? false,
          lastMessageAt: info?.lastMessageAt ?? null,
          lastSeenAt: info?.lastSeenAt ?? null,
          attachedVia: info?.via,
          connectionCount: runtime?.getConnectionCount(agent.id) ?? 0,
        }
      }),
    }
    httpCacheSet("agents", body)
    return c.json(body)
  })
}

/**
 * agent-events-http.ts — HTTP routes for agent event subscriptions (slice be-events-subscribe).
 */

import { AgentSubscribeBody } from "@drive-coding/core"
import type { AgentRegistry } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentEventBus } from "../session-host/agent-events.js"

export function registerAgentEventsHttp(
  app: Hono,
  deps: { registry: AgentRegistry; eventBus: AgentEventBus },
): void {
  app.post("/api/agents/:id/subscribe", async (c) => {
    const targetId = c.req.param("id")
    const target = await deps.registry.get(targetId)
    if (!target) return c.json({ error: "agent not found" }, 404)

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const parsed = AgentSubscribeBody(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }
    deps.eventBus.subscribe(targetId, parsed.subscriberAgentId, {
      includeLastAssistantText: parsed.includeLastAssistantText === true,
    })
    return c.body(null, 204)
  })
}

/**
 * After createAndSpawn — auto-subscribe notifyOnDone when set on create input.
 */
export function subscribeNotifyOnDone(
  eventBus: AgentEventBus,
  agentId: string,
  notifyOnDone: string | undefined,
  options?: { includeLastAssistantText?: boolean },
): void {
  if (notifyOnDone !== undefined && notifyOnDone !== "") {
    eventBus.subscribe(agentId, notifyOnDone, {
      includeLastAssistantText: options?.includeLastAssistantText === true,
    })
  }
}

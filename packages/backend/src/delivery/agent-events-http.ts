/**
 * agent-events-http.ts — HTTP routes for agent event subscriptions (slice be-events-subscribe).
 */

import type { AgentRegistry } from "@drive-coding/core"
import { AgentSubscribeBody, AgentUnsubscribeBody } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import { SCOPE_DENIED_BODY, whenScopedWriteAllowed } from "../scope-write.js"
import type { AgentEventBus } from "../session-host/agent-events.js"
import type { AgentSessionRegistry } from "../session-host/registry.js"

export function registerAgentEventsHttp(
  app: Hono,
  deps: {
    registry: AgentRegistry
    eventBus: AgentEventBus
    agentSessionRegistry: AgentSessionRegistry
  },
): void {
  app.post("/api/agents/:id/subscribe", async (c) => {
    const targetId = c.req.param("id")
    const target = await deps.registry.get(targetId)
    if (!target) return c.json({ error: "agent not found", code: "agent_not_found" }, 404)

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
    return whenScopedWriteAllowed((name) => c.req.header(name), {
      targetId: parsed.subscriberAgentId,
      watchedId: targetId,
      verb: "subscribe",
      registry: deps.registry,
      sessionRegistry: deps.agentSessionRegistry,
    }).then((allowed) => {
      if (!allowed) return c.json(SCOPE_DENIED_BODY, 403)
      deps.eventBus.subscribe(targetId, parsed.subscriberAgentId, {
        includeLastAssistantText: parsed.includeLastAssistantText === true,
      })
      return c.body(null, 204)
    })
  })

  app.delete("/api/agents/:id/subscribe", (c) =>
    c.req.json<unknown>().then<Response, Response>(
      (body) => {
        const parsed = AgentUnsubscribeBody(body)
        if (parsed instanceof type.errors) {
          return c.json({ error: parsed.summary }, 400)
        }

        const watchedId = c.req.param("id")
        return whenScopedWriteAllowed((name) => c.req.header(name), {
          targetId: parsed.subscriberAgentId,
          watchedId,
          verb: "unsubscribe",
          registry: deps.registry,
          sessionRegistry: deps.agentSessionRegistry,
        }).then<Response>((allowed) => {
          if (!allowed) return c.json(SCOPE_DENIED_BODY, 403)
          deps.eventBus.unsubscribe(watchedId, parsed.subscriberAgentId)
          return c.body(null, 204)
        })
      },
      () => c.json({ error: "invalid json" }, 400),
    ),
  )
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

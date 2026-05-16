import { type AgentRegistry, CreateAgentInput, toAgentPublic } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"

export function registerAgentsHttp(app: Hono, deps: { registry: AgentRegistry }): void {
  // GET /api/agents — רשימה
  app.get("/api/agents", async (c) => {
    const all = await deps.registry.list()
    return c.json({ agents: all.map(toAgentPublic) })
  })

  // POST /api/agents — יצירה
  app.post("/api/agents", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const parsed = CreateAgentInput(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    const agent = await deps.registry.create(parsed)
    return c.json({ agent: toAgentPublic(agent) }, 201)
  })

  // GET /api/agents/:id — פרטי agent
  app.get("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    return c.json({ agent: toAgentPublic(agent) })
  })

  // DELETE /api/agents/:id — מחיקה
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    try {
      await deps.registry.delete(id)
      return c.body(null, 204)
    } catch {
      return c.json({ error: "agent not found" }, 404)
    }
  })
}

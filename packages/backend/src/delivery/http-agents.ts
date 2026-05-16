import { type AgentRegistry, CreateAgentInput, toAgentPublic } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"

export function registerAgentsHttp(
  app: Hono,
  deps: { registry: AgentRegistry; orchestrator: AgentOrchestrator },
): void {
  // GET /api/agents — רשימה
  app.get("/api/agents", async (c) => {
    const all = await deps.registry.list()
    return c.json({ agents: all.map(toAgentPublic) })
  })

  // POST /api/agents — יצירה דרך orchestrator
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

    try {
      const agent = await deps.orchestrator.createAndSpawn(parsed)
      return c.json({ agent: toAgentPublic(agent) }, 201)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      return c.json({ error: msg }, 500)
    }
  })

  // GET /api/agents/:id — פרטי agent
  app.get("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)
    return c.json({ agent: toAgentPublic(agent) })
  })

  // DELETE /api/agents/:id — מחיקה דרך orchestrator
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const existing = await deps.registry.get(id)
    if (!existing) return c.json({ error: "agent not found" }, 404)

    await deps.orchestrator.deleteAndKill(id)
    return c.body(null, 204)
  })
}

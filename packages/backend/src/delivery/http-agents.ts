import { type AgentRegistry, CliKind, toAgentPublic, validateCwd } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import type { ProjectsRegistry } from "../app/projects-registry"

/**
 * Backend-only extension of CreateAgentInput — includes existingSessionId
 * for Slice 8a session loading. Defined here because it extends core schema.
 */
const CreateAgentInputFull = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
  "existingSessionId?": "string | null",
})

export function registerAgentsHttp(
  app: Hono,
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    projectsRegistry?: ProjectsRegistry
  },
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

    // Validate with full schema (includes optional existingSessionId for Slice 8a)
    const parsed = CreateAgentInputFull(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    // Validate cwd path — rejects double-encoded paths, NUL bytes, relative paths, etc.
    const cwdResult = validateCwd(parsed.cwd)
    if (cwdResult.isErr()) {
      const e = cwdResult.error
      return c.json({ error: `invalid cwd: ${e.kind}`, detail: e }, 400)
    }

    try {
      // null → undefined: HTTP schema accepts null (JSON compat), orchestrator expects string | undefined
      const result = await deps.orchestrator.createAndSpawn({
        ...parsed,
        cwd: cwdResult.value, // use normalised cwd (trailing slash stripped)
        existingSessionId: parsed.existingSessionId ?? undefined,
      })
      // Return CreateAndSpawnResult shape (Slice 10)
      return c.json(result, 201)
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

  /**
   * POST /api/agents/:id/session-attached
   *
   * Slice 10 Phase 1: FE calls this after ACP handshake succeeds.
   * Updates registry status → "ready", records cwd + sessionId in projectsRegistry.
   *
   * Body: { sessionId: string }
   * Response: { ok: true }
   *
   * MED-9 guard: if agent is already "ready" with a DIFFERENT acpSessionId → 409.
   */
  app.post("/api/agents/:id/session-attached", async (c) => {
    const agentId = c.req.param("id")

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const { sessionId } = body as Record<string, unknown>
    if (typeof sessionId !== "string" || !sessionId) {
      return c.json({ error: "sessionId is required" }, 400)
    }

    const agent = await deps.registry.get(agentId)
    if (!agent) return c.json({ error: "agent not found" }, 404)

    // MED-9 idempotent guard: if already ready with a DIFFERENT sessionId → conflict
    if (agent.status === "ready" && agent.acpSessionId && agent.acpSessionId !== sessionId) {
      return c.json({ error: "agent already attached to a different session" }, 409)
    }

    // Mark ready + record session
    await deps.registry.update(agentId, { status: "ready", acpSessionId: sessionId })

    if (deps.projectsRegistry) {
      await deps.projectsRegistry.recordCwd(
        agent.cwd,
        agent.cliKind as import("@drive-coding/core").BridgeKind,
      )
      await deps.projectsRegistry.recordSession(agent.cwd, sessionId)
    }

    return c.json({ ok: true })
  })
}

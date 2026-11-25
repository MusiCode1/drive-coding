import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import { isMaster, subtreeIds, verifyToken } from "../agent-scope.js"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import { closeAllAgents } from "../app/close-all-agents.js"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { readScopeToken, SCOPE_DENIED_BODY } from "../scope-write.js"
import { parseCreateAgentBody } from "./create-agent-input.js"
import {
  type AgentListRuntime,
  registerAgentPublicList,
  toHttpAgentPublic,
} from "./http-agent-public-list.js"
import { registerAgentsPatchHttp } from "./http-agents-patch.js"
import { CF_ACCESS_EMAIL_HEADER, readOpenedByEmail } from "./opened-by-email.js"

const log = createLogger("backend.agents.http")

export { PatchAgentInput } from "./http-agents-patch.js"

/**
 * הרחבת צד-שרת בלבד של CreateAgentInput — כולל existingSessionId
 * עבור טעינת סשן ב-Slice 8a. מוגדר ב-create-agent-input.ts (slice session-bus-mcp C1)
 * כדי ש-POST /api/agents ו-session_open לא ייסחפו.
 */

export function registerAgentsHttp(
  app: Hono,
  deps: {
    registry: AgentRegistry
    orchestrator: AgentOrchestrator
    sessionHistoryStore: SessionHistoryStore
    bridgeManager?: AgentListRuntime
    env: NodeJS.ProcessEnv
  },
): void {
  registerAgentPublicList(app, deps.registry, deps.bridgeManager)

  // POST /api/agents — יצירה דרך orchestrator
  app.post("/api/agents", async (c) => {
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    // מאמת מול הסכימה המלאה (כולל existingSessionId אופציונלי עבור Slice 8a)
    const parsed = parseCreateAgentBody(body, deps.env)
    if (!parsed.ok) {
      return c.json(parsed.error.body, parsed.error.status)
    }

    const email = readOpenedByEmail(c.req.header(CF_ACCESS_EMAIL_HEADER))
    log.info(
      { accessEmailHeader: email ? CF_ACCESS_EMAIL_HEADER : "none" },
      "openedByEmail attribution",
    )
    if (email) {
      parsed.value.openedByEmail = email
    }

    try {
      const result = await deps.orchestrator.createAndSpawn(parsed.value)
      // מחזיר את מבנה CreateAndSpawnResult (סלייס 10)
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
    if (!agent) return c.json({ error: "agent not found", code: "agent_not_found" }, 404)
    return c.json({ agent: toHttpAgentPublic(agent) })
  })

  /**
   * DELETE /api/agents — end every agent at once.
   *
   * Registered before the `:id` route because Hono matches in order and `:id`
   * would otherwise never let a bare `/api/agents` through.
   *
   * 200 with a per-agent report rather than 204: a bulk close whose whole point
   * is "make sure nothing is left running" has to say which ones are left. The
   * status stays 200 even with failures — the operation ran; the body is the
   * result.
   */
  app.delete("/api/agents", async (c): Promise<Response> => {
    const token = readScopeToken((name) => c.req.header(name))
    if (!token || isMaster(token)) {
      return deps.orchestrator.deleteAllAndKill().then((result) => c.json(result, 200))
    }
    const caller = verifyToken(token)
    if (!caller) return c.json(SCOPE_DENIED_BODY, 403)
    return deps.registry.list().then<Response>((agents) => {
      const subtree = subtreeIds(agents, caller.agentId)
      const skipped = agents
        .filter(({ id }) => !subtree.has(id))
        .map(({ id }) => ({ id, reason: "scope" as const }))
      return closeAllAgents(
        () => Promise.resolve(agents.filter(({ id }) => subtree.has(id))),
        (id) => deps.orchestrator.deleteAndKill(id),
      ).then((result) => c.json({ ...result, skipped }, 200))
    })
  })

  // DELETE /api/agents/:id — מחיקה דרך orchestrator
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const existing = await deps.registry.get(id)
    if (!existing) return c.json({ error: "agent not found", code: "agent_not_found" }, 404)

    await deps.orchestrator.deleteAndKill(id)
    return c.body(null, 204)
  })

  registerAgentsPatchHttp(app, {
    registry: deps.registry,
    sessionHistoryStore: deps.sessionHistoryStore,
  })
}

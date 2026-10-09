import {
  type Agent,
  type AgentRegistry,
  type BridgeKind,
  toAgentPublic,
  validateCwd,
} from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { registerAgentsPatchHttp } from "./http-agents-patch.js"
import { parseCreateAgentBody } from "./create-agent-input.js"
import { httpCacheGet, httpCacheSet } from "./http-cache.js"
import {
  CF_ACCESS_EMAIL_HEADER,
  readOpenedByEmail,
} from "./opened-by-email.js"

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
    // pid: number | null — in-process connections (claude) have no child process (CUT-3b-iii-2).
    bridgeManager?: {
      getRuntimeInfo(id: string): {
        pid: number | null
        attached: boolean
        busy: boolean
        lastMessageAt: number | null
        lastSeenAt: number | null
        via: "ws" | "http" | null
      } | null
      getConnectionCount(id: string): number
    }
    env: NodeJS.ProcessEnv
  },
): void {
  // GET /api/agents — רשימה (מועשרת ב-pid+attached+via אם bridgeManager זמין)
  // slice ownership-truth C3: מיפוי מפורש ומלא של 5 שדות — לא spread.
  // spread היה מוחק שדות קיימים אם getRuntimeInfo לא היה מחזיר את כולם.
  // slice liveness C2: מטמון קצר (1.5ש׳) + no-store נקודתי. המטמון מתבטל
  // ב-markOwned/markDetached (connection-registry) — אחרת attached:true מעופש.
  app.get("/api/agents", async (c) => {
    c.header("Cache-Control", "no-store")
    const cached = httpCacheGet("agents")
    if (cached !== undefined) return c.json(cached)
    const all = await deps.registry.list()
    const body = {
      agents: all.map((a) => {
        const rt = deps.bridgeManager?.getRuntimeInfo(a.id)
        return {
          ...toAgentPublic(a),
          pid: rt?.pid ?? null,
          attached: rt?.attached ?? false,
          busy: rt?.busy ?? false,
          lastMessageAt: rt?.lastMessageAt ?? null,
          lastSeenAt: rt?.lastSeenAt ?? null,
          attachedVia: rt?.via,
          connectionCount: deps.bridgeManager?.getConnectionCount(a.id) ?? 0,
        }
      }),
    }
    httpCacheSet("agents", body)
    return c.json(body)
  })

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
    if (!agent) return c.json({ error: "agent not found" }, 404)
    return c.json({ agent: toAgentPublic(agent) })
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
  app.delete("/api/agents", (c) => deps.orchestrator.deleteAllAndKill().then((r) => c.json(r, 200)))

  // DELETE /api/agents/:id — מחיקה דרך orchestrator
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const existing = await deps.registry.get(id)
    if (!existing) return c.json({ error: "agent not found" }, 404)

    await deps.orchestrator.deleteAndKill(id)
    return c.body(null, 204)
  })

  registerAgentsPatchHttp(app, {
    registry: deps.registry,
    sessionHistoryStore: deps.sessionHistoryStore,
  })
}

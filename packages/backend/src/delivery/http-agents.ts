import { type AgentRegistry, CliKind, toAgentPublic, validateCwd, validateFlags } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import type { ProjectsRegistry } from "../app/projects-registry"

/**
 * הרחבת צד-שרת בלבד של CreateAgentInput — כולל existingSessionId
 * עבור טעינת סשן ב-Slice 8a. מוגדר כאן כי זה מרחיב את סכימת הליבה.
 * vnext-B2: הוסף flags? — חייב להיות גם כאן (schema כפול) כדי שלא יפול בשקט.
 */
const CreateAgentInputFull = type({
  cliKind: CliKind,
  cwd: "string >= 1",
  "modelOverride?": "string | null",
  "existingSessionId?": "string | null",
  "flags?": "string[]",
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

    // מאמת מול הסכימה המלאה (כולל existingSessionId אופציונלי עבור Slice 8a)
    const parsed = CreateAgentInputFull(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    // מאמת נתיב cwd — דוחה נתיבים בקידוד כפול, בתי NUL, נתיבים יחסיים, וכו'.
    const cwdResult = validateCwd(parsed.cwd)
    if (cwdResult.isErr()) {
      const e = cwdResult.error
      return c.json({ error: `invalid cwd: ${e.kind}`, detail: e }, 400)
    }

    // מאמת flags — דוחה NUL bytes, תווי בקרה, flag ריק (vnext-B2).
    // validation כאן (HTTP layer) ולא ב-orchestrator: רק כאן מוחזר 400 — orchestrator זורק→500.
    if (parsed.flags !== undefined) {
      const flagsResult = validateFlags(parsed.flags)
      if (flagsResult.isErr()) {
        const e = flagsResult.error
        return c.json({ error: `invalid flags: ${e.kind}`, detail: e }, 400)
      }
    }

    try {
      // null → undefined: סכימת ה-HTTP מקבלת null (תאימות JSON), ה-orchestrator מצפה ל-string | undefined
      const result = await deps.orchestrator.createAndSpawn({
        ...parsed,
        cwd: cwdResult.value, // משתמש ב-cwd מנורמל (לוכסן סוגר הוסר)
        existingSessionId: parsed.existingSessionId ?? undefined,
      })
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
   * Slice 10 Phase 1: ה-FE קורא לזה אחרי הצלחת ה-ACP handshake.
   * מעדכן את סטטוס ה-registry ל-"ready", מתעד cwd + sessionId ב-projectsRegistry.
   *
   * גוף הבקשה (Body): { sessionId: string, replace?: true }
   *   replace: כשמורם (warm switch), מאפשר דריסת sessionId קיים. ללא replace → guard MED-9 פעיל.
   * תגובה (Response): { ok: true }
   *
   * שומר MED-9: אם הסוכן כבר "ready" עם acpSessionId אחר → 409 (רק כש-replace !== true).
   */
  app.post("/api/agents/:id/session-attached", async (c) => {
    const agentId = c.req.param("id")

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    const { sessionId, replace } = body as Record<string, unknown>
    if (typeof sessionId !== "string" || !sessionId) {
      return c.json({ error: "sessionId is required" }, 400)
    }

    const agent = await deps.registry.get(agentId)
    if (!agent) return c.json({ error: "agent not found" }, 404)

    // שומר MED-9: חוסם דריסה לא-מכוונת. warm switch מצהיר replace:true ועוקף ביודעין.
    if (replace !== true && agent.status === "ready" && agent.acpSessionId && agent.acpSessionId !== sessionId) {
      return c.json({ error: "agent already attached to a different session" }, 409)
    }

    // מסמן כ-ready ומתעד סשן
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

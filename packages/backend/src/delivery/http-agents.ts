import {
  type Agent,
  type AgentRegistry,
  type BridgeKind,
  toAgentPublic,
  validateCwd,
} from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import type { ProjectsRegistry } from "../app/projects-registry"
import { parseCreateAgentBody } from "./create-agent-input.js"
import { httpCacheGet, httpCacheSet } from "./http-cache.js"

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
    projectsRegistry?: ProjectsRegistry
    // אופציונלי בכוונה — call-sites קיימים בטסט לא מעבירים אותו (slice active-agents)
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
    }
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
    const parsed = parseCreateAgentBody(body)
    if (!parsed.ok) {
      return c.json(parsed.error.body, parsed.error.status)
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

  // DELETE /api/agents/:id — מחיקה דרך orchestrator
  app.delete("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    const existing = await deps.registry.get(id)
    if (!existing) return c.json({ error: "agent not found" }, 404)

    await deps.orchestrator.deleteAndKill(id)
    return c.body(null, 204)
  })

  /**
   * PATCH /api/agents/:id — עדכון גנרי (whitelist) — דלת אחת במקום שלוש
   * (slice agent-patch-unify): מבטל POST …/session-attached ו-POST …/persistent.
   * (slice session-title-in-process-list) — ה-BE שכבת-אחסון טיפשה, לא מפענח wire בעצמו;
   * ה-client (agent-session VM) דוחף לכאן את הכותרת שקיבל מ-session_info_update.
   *
   * ⚠️ הגנת-גנריות load-bearing (אביגיל אימתה אמפירית) — **שלוש** שכבות:
   * (א) `.onUndeclaredKey("reject")` על ה-schema — דוחה body עם מפתחות זרים (400).
   *     שומרת על מחלקה 3 ("לעולם-לא-מ-HTTP": bridgePort, crashReason, id, cliKind,
   *     createdAt, modelOverride) — אלה קיימים בטיפוס `AgentRegistry.update`, אז בלי
   *     השכבה הזו לקוח יכול לזייף "הסוכן קרס".
   * (ב) `status` מוצהר אך **מצומצם לליטרל `"ready"`** — PATCH {status:"crashed"} נדחה
   *     כבר בסכימה (400). ההגנה עברה מ"בדיקת-מפתח" ל"בדיקת-תחום-ערכים".
   * (ג) extract מפורש שדה-שדה ל-`registry.update`, **אף פעם לא spread** — וגם:
   *     מפתח שערכו `undefined` **לעולם אינו נכנס** לאובייקט ה-patch. `registry.update`
   *     מבצע ב-runtime `{ ...existing, ...patch }` בלי סינון (ה-Pick ב-ports.ts הוא
   *     type-only, ו-`exactOptionalPropertyTypes` כבוי — המהדר לא תופס את זה).
   *     בלי שומר-ה-undefined, `PATCH {title}` על agent עם acpSessionId/cwd קיימים
   *     היה מוחק אותם בשקט (המסלול חי ב-#pushTitleToServer אחרי כל מעבר-סשן).
   *
   * שלוש מחלקות-שדה (המודל שמחליף את "מוצהר/לא-מוצהר"):
   *   שדות-משתמש (title, persistent) — PATCH חופשי, עצמאיים, ללא שומר.
   *   עובדת-חיבור (acpSessionId + status + cwd) — רק כמקשה אחת, שומר-409, תופעת-לוואי.
   *   לעולם-לא-מ-HTTP — נדחים ב-400 (שכבה א).
   */
  const PatchAgentInput = type({
    "title?": "string | null",
    "persistent?": "boolean",
    "acpSessionId?": "string >= 1",
    "status?": "'ready'", // D1 — ליטרל, לא string
    "cwd?": "string >= 1",
    "replace?": "boolean", // D3 — דגל-בקרה, לעולם לא מגיע ל-registry.update
  }).onUndeclaredKey("reject")

  app.patch("/api/agents/:id", async (c) => {
    const id = c.req.param("id")
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const parsed = PatchAgentInput(body)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }

    // D2 — צימוד: status/cwd בלי acpSessionId → 400. "עובדת-חיבור" היא אטומית;
    // זה מה שחוסם את PATCH {title, status:"ready"} גם אחרי ש-status הפך שדה מוצהר.
    // חייב לרוץ *לפני* registry.get — אחרת agent לא-קיים היה מחזיר 404 במקום 400
    // (השער היה נשאר אדום על מימוש נכון — ר' §3.5 סדר-הבדיקות).
    if (
      (parsed.status !== undefined || parsed.cwd !== undefined) &&
      parsed.acpSessionId === undefined
    ) {
      return c.json({ error: "status/cwd require acpSessionId" }, 400)
    }

    // D5 — cwd עובר validateCwd לפני שהוא נוגע ברישום, בדיוק כמו ב-POST /api/agents.
    // גם זו בדיקה-אחרי-parse שחייבת לרוץ לפני registry.get.
    let validatedCwd: string | undefined
    if (parsed.cwd !== undefined) {
      const cwdResult = validateCwd(parsed.cwd)
      if (cwdResult.isErr()) {
        const e = cwdResult.error
        return c.json({ error: `invalid cwd: ${e.kind}`, detail: e }, 400)
      }
      validatedCwd = cwdResult.value
    }

    const agent = await deps.registry.get(id)
    if (!agent) return c.json({ error: "agent not found" }, 404)

    // D3 — שומר MED-9. 🔴 קורא את ה-*סוכן* (agent.status / agent.acpSessionId),
    // לא את ה-*בקשה* (parsed.status). קריאה הפוכה הייתה פותחת עקיפה: PATCH
    // {acpSessionId:"hijack"} לבדו (חוקי תחת D2 — הצימוד דורש acpSessionId כשיש
    // status/cwd, לא להפך) הייתה דורסת סשן קיים במקום לקבל 409.
    if (
      parsed.replace !== true &&
      parsed.acpSessionId !== undefined &&
      agent.status === "ready" &&
      agent.acpSessionId &&
      agent.acpSessionId !== parsed.acpSessionId
    ) {
      return c.json({ error: "agent already attached to a different session" }, 409)
    }

    // D4 — שכבה (ג): extract מפורש שדה-שדה. מפתח שערכו undefined אינו נכנס לפatch.
    const patch: Partial<Pick<Agent, "title" | "persistent" | "status" | "acpSessionId" | "cwd">> =
      {}
    // guard: title absent (undefined) → no-op, שלא לנקות כותרת קיימת בטעות.
    // title: null = clear מכוון (הסכמה מתירה); string = set.
    if (parsed.title !== undefined) patch.title = parsed.title
    if (parsed.persistent !== undefined) patch.persistent = parsed.persistent
    if (parsed.status !== undefined) patch.status = parsed.status
    if (parsed.acpSessionId !== undefined) patch.acpSessionId = parsed.acpSessionId
    if (validatedCwd !== undefined) patch.cwd = validatedCwd

    if (Object.keys(patch).length > 0) {
      await deps.registry.update(id, patch)
    }

    // D7 — תופעות-הלוואי מותנות: יורות רק כש-acpSessionId נוכח (זו עובדת-חיבור),
    // ועם cwd ?? agent.cwd (ה-PATCH הזה לא בהכרח שינה cwd). בלי התניה, כל
    // PATCH {title} היה רושם פרויקט ודורס lastSessionId.
    if (deps.projectsRegistry && parsed.acpSessionId !== undefined) {
      const effectiveCwd = validatedCwd ?? agent.cwd
      await deps.projectsRegistry.recordCwd(effectiveCwd, agent.cliKind as BridgeKind)
      await deps.projectsRegistry.recordSession(effectiveCwd, parsed.acpSessionId)
    }

    return c.json({ ok: true })
  })
}

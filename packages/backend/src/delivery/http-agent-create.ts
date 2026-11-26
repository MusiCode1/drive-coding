import { createLogger } from "@drive-coding/core/log"
import type { Hono } from "hono"
import type { AgentOrchestrator } from "../app/agent-orchestrator"
import { type NotifyOnDoneScopeCheck, readScopeToken, SCOPE_DENIED_BODY } from "../scope-write.js"
import { parseCreateAgentBody } from "./create-agent-input.js"
import { CF_ACCESS_EMAIL_HEADER, readOpenedByEmail } from "./opened-by-email.js"

const log = createLogger("backend.agents.http")

export function registerAgentCreateHttp(
  app: Hono,
  deps: {
    orchestrator: AgentOrchestrator
    checkNotifyOnDone?: NotifyOnDoneScopeCheck
    env: NodeJS.ProcessEnv
  },
): void {
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

    const spawn = async (): Promise<Response> => {
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
    }

    const subscriber = parsed.value.notifyOnDone
    if (!subscriber) return spawn()
    if (!deps.checkNotifyOnDone) return c.json(SCOPE_DENIED_BODY, 403)

    const token = readScopeToken((name) => c.req.header(name))
    return deps
      .checkNotifyOnDone(token, subscriber)
      .then<Response>((allowed) => (allowed ? spawn() : c.json(SCOPE_DENIED_BODY, 403)))
  })
}

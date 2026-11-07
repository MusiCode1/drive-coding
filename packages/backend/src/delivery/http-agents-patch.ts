/**
 * PATCH /api/agents/:id — extracted from http-agents.ts (size ratchet + slice history).
 */

import { type Agent, type AgentRegistry, validateCwd } from "@drive-coding/core"
import { type } from "arktype"
import type { Hono } from "hono"
import type { SessionHistoryStore } from "../history/session-history-store.js"
import { recordHistoryAttachFromPatch } from "./http-agents-history.js"

export const PatchAgentInput = type({
  "title?": "string | null",
  "titleManual?": "boolean",
  "userNotes?": "string",
  "persistent?": "boolean",
  "acpSessionId?": "string >= 1",
  "status?": "'ready'",
  "cwd?": "string >= 1",
  "replace?": "boolean",
}).onUndeclaredKey("reject")

export type AgentsPatchDeps = {
  registry: AgentRegistry
  sessionHistoryStore: SessionHistoryStore
}

export function registerAgentsPatchHttp(app: Hono, deps: AgentsPatchDeps): void {
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

    if (
      (parsed.status !== undefined || parsed.cwd !== undefined) &&
      parsed.acpSessionId === undefined
    ) {
      return c.json({ error: "status/cwd require acpSessionId" }, 400)
    }

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

    if (
      parsed.replace !== true &&
      parsed.acpSessionId !== undefined &&
      agent.status === "ready" &&
      agent.acpSessionId &&
      agent.acpSessionId !== parsed.acpSessionId
    ) {
      return c.json({ error: "agent already attached to a different session" }, 409)
    }

    const patch: Partial<
      Pick<
        Agent,
        "title" | "titleManual" | "userNotes" | "persistent" | "status" | "acpSessionId" | "cwd"
      >
    > = {}
    if (parsed.title !== undefined) patch.title = parsed.title
    if (parsed.titleManual !== undefined) patch.titleManual = parsed.titleManual
    if (parsed.userNotes !== undefined) patch.userNotes = parsed.userNotes
    if (parsed.persistent !== undefined) patch.persistent = parsed.persistent
    if (parsed.status !== undefined) patch.status = parsed.status
    if (parsed.acpSessionId !== undefined) patch.acpSessionId = parsed.acpSessionId
    if (validatedCwd !== undefined) patch.cwd = validatedCwd

    if (Object.keys(patch).length > 0) {
      await deps.registry.update(id, patch)
    }

    if (parsed.acpSessionId !== undefined) {
      recordHistoryAttachFromPatch(
        deps.sessionHistoryStore,
        id,
        agent,
        parsed.acpSessionId,
        validatedCwd ?? agent.cwd,
      )
    }

    return c.json({ ok: true })
  })
}

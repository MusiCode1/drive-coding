/**
 * http-scope-policy.ts — GET/PATCH /api/scope-policy (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../agent-scope.ts

import type { AgentRegistry } from "@drive-coding/core"
import {
  hasScopePolicyPatchKey,
  hasScopePolicyPerAgentPatchKey,
  ScopePolicyPatchBodySchema,
  ScopePolicyPerAgentPatchBodySchema,
} from "@drive-coding/core/schemas/scope-policy"
import { type } from "arktype"
import type { Hono } from "hono"
import { NOT_A_SECURITY_BOUNDARY } from "../agent-scope.js"
import {
  getEffectiveScopePolicyForAgent,
  getScopePolicySnapshot,
  mergeAgentScopePolicyPatch,
  setScopePolicyOverride,
} from "../scope-policy.js"

void NOT_A_SECURITY_BOUNDARY

export type HttpScopePolicyDeps = {
  registry: AgentRegistry
}

export function registerHttpScopePolicy(app: Hono, deps: HttpScopePolicyDeps): void {
  app.get("/api/scope-policy", async (c) => {
    c.header("Cache-Control", "no-store")
    const agentId = c.req.query("agent")?.trim()
    if (!agentId) {
      return c.json(getScopePolicySnapshot())
    }
    const agent = await deps.registry.get(agentId)
    if (!agent) {
      return c.json({ error: "agent not found" }, 404)
    }
    return c.json(getEffectiveScopePolicyForAgent(agent))
  })

  app.patch("/api/scope-policy", async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }

    if (typeof raw === "object" && raw !== null && "agent" in raw) {
      const parsed = ScopePolicyPerAgentPatchBodySchema(raw)
      if (parsed instanceof type.errors) {
        return c.json({ error: parsed.summary }, 400)
      }
      if (!hasScopePolicyPerAgentPatchKey(parsed.policies)) {
        return c.json({ error: "policies must include at least one group key" }, 400)
      }
      const existing = await deps.registry.get(parsed.agent)
      if (!existing) {
        return c.json({ error: "agent not found" }, 404)
      }
      // NOT_A_SECURITY_BOUNDARY: any HTTP client may set per-agent policy; visibility is in sources.
      const scopePolicies = mergeAgentScopePolicyPatch(existing.scopePolicies, parsed.policies)
      const updated = await deps.registry.update(parsed.agent, { scopePolicies })
      const snap = getEffectiveScopePolicyForAgent(updated)
      c.header("Cache-Control", "no-store")
      return c.json(snap)
    }

    const parsed = ScopePolicyPatchBodySchema(raw)
    if (parsed instanceof type.errors) {
      return c.json({ error: parsed.summary }, 400)
    }
    if (!hasScopePolicyPatchKey(parsed.policies)) {
      return c.json({ error: "policies must include at least one group key" }, 400)
    }
    const snap = setScopePolicyOverride(parsed.policies)
    c.header("Cache-Control", "no-store")
    return c.json(snap)
  })
}

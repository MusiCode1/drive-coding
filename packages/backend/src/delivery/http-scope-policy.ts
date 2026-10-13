/**
 * http-scope-policy.ts — GET/PATCH /api/scope-policy (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../agent-scope.ts

import {
  hasScopePolicyPatchKey,
  ScopePolicyPatchBodySchema,
} from "@drive-coding/core/schemas/scope-policy"
import { type } from "arktype"
import type { Hono } from "hono"
import { NOT_A_SECURITY_BOUNDARY } from "../agent-scope.js"
import { getScopePolicySnapshot, setScopePolicyOverride } from "../scope-policy.js"

void NOT_A_SECURITY_BOUNDARY

export function registerHttpScopePolicy(app: Hono): void {
  app.get("/api/scope-policy", (c) => {
    c.header("Cache-Control", "no-store")
    return c.json(getScopePolicySnapshot())
  })

  app.patch("/api/scope-policy", async (c) => {
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
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

/**
 * rpc.ts — POST /api/agents/:id/rpc (S4 C3).
 *
 * Dispatches RPC calls to the ExtendedSessionHost.
 * Returns 202 Accepted with {version} — does NOT wait for agent response.
 *
 * Supported methods:
 *   - prompt    — host.prompt(sessionId, content, meta?)
 *   - cancel    — host.cancel(sessionId)
 *   - setMode   — host.setMode(modeId)
 *   - setConfigOption — host.setConfigOption(configId, value)
 *   - extMethod — host.extMethod(method, params)
 *   - setSessionModel — host.setSessionModel(model)  (slice remote-session-view C4)
 *
 * Returns 404 if connection not found (registry.getOrCreateHost returns undefined).
 * Returns 202 Accepted with {version: host.state.version} on success.
 *
 * ⚠️ prompt/cancel are non-blocking (slice session-host-pending-surface C3-ד):
 * a synchronous launch failure (bad params, unknown method) stays an ordinary
 * HTTP response (400); an async turn failure travels through the state channel
 * (host.prompt already wrote lastTurnError before its promise settled) — the
 * `.catch` here is a log-only safety net (prevents unhandledRejection), NOT
 * `() => {}` (that would swap a loud failure for a silent one).
 *
 * ─── slice session-host-http C3 (TDD) ───
 * ─── slice remote-session-view C4: + setSessionModel (TDD) ───
 * ─── slice session-host-pending-surface C3-ד (TDD): non-blocking prompt/cancel + ArkType ───
 */

import { createLogger } from "@drive-coding/core/log"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

const log = createLogger("backend.session-host.rpc")

// ⚠️ "meta?": "object" מסיק object | undefined — tsc דוחה את ההעברה ל-
// host.prompt(meta?: Record<string, unknown>). "[string]": "unknown" עוקף זאת.
const PromptParams = type({
  sessionId: "string",
  content: "string",
  "meta?": { "[string]": "unknown" },
})
const CancelParams = type({ sessionId: "string" })

/**
 * registerRpcRoute — registers POST /api/agents/:id/rpc on the Hono app.
 */
export function registerRpcRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/rpc", async (c) => {
    const agentId = c.req.param("id")

    // Look up or create host
    const result = await registry.getOrCreateHost(agentId)
    if (!result) {
      return c.json({ error: "Agent connection not found" }, 404)
    }
    const { host } = result

    // Parse request body
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json({ error: "invalid json" }, 400)
    }
    const body = raw as Record<string, unknown>
    const method = body.method as string | undefined
    const params = (body.params ?? {}) as Record<string, unknown>

    // Dispatch to host method
    switch (method) {
      case "prompt": {
        const p = PromptParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        void host.prompt(p.sessionId, p.content, p.meta).catch((e) => {
          log.warn({ err: e }, "prompt turn failed") // ← state already carries lastTurnError
        })
        break // no await — 202 immediately, as the JSDoc above already promises
      }
      case "cancel": {
        const p = CancelParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        void host.cancel(p.sessionId).catch((e) => log.warn({ err: e }, "cancel failed"))
        break
      }
      case "setMode": {
        const modeId = params.modeId as string
        await host.setMode(modeId)
        break
      }
      case "setConfigOption": {
        const configId = params.configId as string
        const value = params.value as string | boolean
        await host.setConfigOption(configId, value)
        break
      }
      case "extMethod": {
        const extMethodName = params.method as string
        const extParams = (params.params ?? {}) as Record<string, unknown>
        await host.extMethod(extMethodName, extParams)
        break
      }
      case "setSessionModel": {
        const model = params.model as string
        await host.setSessionModel(model)
        break
      }
      default: {
        return c.json({ error: `Unknown method: ${String(method)}` }, 400)
      }
    }

    // 202 Accepted — fire and forget; version for client sync
    return c.json({ version: host.state.version }, 202)
  })
}

/**
 * rpc.ts — POST /api/agents/:id/rpc (S4 C3).
 *
 * Dispatches RPC calls to the ExtendedSessionHost.
 *
 * Fire-and-forget methods — 202 Accepted with {version}, no result body:
 *   - prompt / cancel / setMode / setConfigOption / extMethod / setSessionModel
 *
 * Blocking methods with a REAL result (slice remote-session-mgmt C3) — the FE
 * needs the list/confirmation. Each case below returns EXPLICITLY (200/400/502):
 * a `break` would fall through to the shared `return c.json({version}, 202)`
 * and break the contract.
 *   - listSessions  → 200 {sessions, sessionCapabilities} | 502 {error, code?}
 *   - loadSession   → 200 {sessionId, version} | 400 (bad params / no cwd) | 502
 *   - deleteSession → 200 {ok:true} | 200 {ok:false, unsupported:true} (-32601) | 502
 *
 * Returns 404 if connection not found (registry.getOrCreateHost → {ok:false}),
 * except reason:"evict-timeout" (a stuck WS tab, not a dead agent) → 503
 * (slice host-result-reason C1).
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
 * ─── slice remote-session-mgmt C3 (TDD): blocking listSessions/loadSession/deleteSession ───
 */

import { createLogger } from "@drive-coding/core/log"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"

const log = createLogger("backend.session-host.rpc")

// ⚠️ "meta?": "object" מסיק object | undefined — tsc דוחה את ההעברה ל-
// host.prompt(meta?: Record<string, unknown>). "[string]": "unknown" עוקף זאת.
//
// ─── slice remote-images C1: PromptBlocks ContentBlock schema ───
// חמשת הווריאנטים לפי SDK schema/types.gen.d.ts:236. annotations/_meta לא
// צריכים הצהרה — ArkType משמר מפתחות לא-מוצהרים (נבדק בהרצה).
const TextBlock         = type({ type: "'text'",          text: "string" })
const ImageBlock        = type({ type: "'image'",         mimeType: "string", data: "string" })
const AudioBlock        = type({ type: "'audio'",         mimeType: "string", data: "string" })
const ResourceLinkBlock = type({ type: "'resource_link'", name: "string",     uri: "string" })
const ResourceBlock     = type({ type: "'resource'",      resource: "object" })
const ContentBlockSchema = TextBlock.or(ImageBlock).or(AudioBlock).or(ResourceLinkBlock).or(ResourceBlock)
const PromptContent = ContentBlockSchema.array()

const PromptParams = type({
  sessionId: "string",
  content: type("string").or(PromptContent),
  "meta?": { "[string]": "unknown" },
})
const CancelParams = type({ sessionId: "string" })
const LoadSessionParams = type({ sessionId: "string", "cwd?": "string" })
const DeleteSessionParams = type({ sessionId: "string" })

// ─── slice remote-session-mgmt C3: JSON-RPC error mapping ───
// A JSON-RPC error is not necessarily an Error instance — the `code` sits on a
// thrown object (same shape the VM reads, agent-session.svelte.ts). Read safely.

function codeOf(e: unknown): number | undefined {
  if (typeof e === "object" && e !== null) {
    const code = (e as { code?: unknown }).code
    if (typeof code === "number") return code
  }
  return undefined
}

function messageOf(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const message = (e as { message?: unknown }).message
    if (typeof message === "string" && message.length > 0) return message
  }
  return String(e)
}

/**
 * registerRpcRoute — registers POST /api/agents/:id/rpc on the Hono app.
 */
export function registerRpcRoute(app: Hono, registry: AgentSessionRegistry): void {
  app.post("/api/agents/:id/rpc", async (c) => {
    const agentId = c.req.param("id")

    // Look up or create host
    const result = await registry.getOrCreateHost(agentId)
    if (!result.ok) {
      // slice host-result-reason C1: evict-timeout is transient (a stuck WS tab,
      // not a dead agent) → 503. The other three reasons are final → 404, unchanged.
      const status = result.reason === "evict-timeout" ? 503 : 404
      return c.json({ error: "Agent connection not found" }, status)
    }
    const { host } = result.entry
    // slice ownership-handoff C4b: touch lastSeenAt — rpc extends HTTP ownership TTL
    registry.touchOwner(agentId)

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
        void host.prompt(p.sessionId, p.content as string | PromptBlocks, p.meta).catch((e) => {
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
      // ─── slice remote-session-mgmt C3: BLOCKING mappings with a real result ───
      // ⚠️ each case `return`s explicitly (200/400/502). A `break` here would fall
      // through to the shared `return c.json({version}, 202)` below and break the
      // contract — the FE needs the list/confirmation in the body.
      case "listSessions": {
        try {
          const r = await host.listSessions()
          const sessions = Array.isArray(r.sessions) ? r.sessions : []
          return c.json(
            {
              sessions,
              sessionCapabilities: host.agentCapabilities?.sessionCapabilities ?? null,
            },
            200,
          )
        } catch (e) {
          const code = codeOf(e)
          return c.json(
            code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
            502,
          )
        }
      }
      case "loadSession": {
        const p = LoadSessionParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        const cwd = p.cwd ?? registry.getCwd(agentId)
        if (!cwd) return c.json({ error: "no cwd available" }, 400)
        try {
          const r = await host.loadSession({ cwd, sessionId: p.sessionId })
          // The agents registry must learn the newly-attached session
          // (status/acpSessionId — remote-warm-reconnect plumbing). catch+warn:
          // a reporting failure must not fail the switch itself.
          try {
            // slice agent-patch-unify C2: מעביר את ה-cwd שכבר חושב למעלה (params
            // או fallback) — זו החוליה שהייתה חסרה בשרשרת ה-cwd (§3).
            await registry.notifySessionAttached(agentId, r.sessionId, cwd)
          } catch (err) {
            log.warn({ err, agentId }, "notifySessionAttached after loadSession failed")
          }
          return c.json({ sessionId: r.sessionId, version: host.state.version }, 200)
        } catch (e) {
          const code = codeOf(e)
          return c.json(
            code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
            502,
          )
        }
      }
      case "deleteSession": {
        const p = DeleteSessionParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        try {
          await host.deleteSession(p.sessionId)
          return c.json({ ok: true }, 200)
        } catch (e) {
          // -32601 (CLI without delete capability) → graceful, like local
          if (codeOf(e) === -32601) return c.json({ ok: false, unsupported: true }, 200)
          const code = codeOf(e)
          return c.json(
            code === undefined ? { error: messageOf(e) } : { error: messageOf(e), code },
            502,
          )
        }
      }
      default: {
        return c.json({ error: `Unknown method: ${String(method)}` }, 400)
      }
    }

    // 202 Accepted — fire and forget; version for client sync
    return c.json({ version: host.state.version }, 202)
  })
}

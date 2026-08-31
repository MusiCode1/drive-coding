/**
 * rpc.ts — POST /api/agents/:id/rpc (S4 C3).
 *
 * Dispatches RPC calls to the ExtendedSessionHost.
 *
 * Fire-and-forget methods — 202 Accepted with {version}, no result body
 * (when `waitMs` is absent or 0):
 *   - session/prompt · session/cancel · session/set_mode · session/set_config_option
 *   - _drive/ext · _drive/set_session_model
 *
 * Same six methods with top-level `waitMs` (1..60000) — 200 with result body:
 *   - success: { version, ok:true, timedOut:false, messagesSince? (prompt only), result? (extMethod only) }
 *   - turn failure: { version, ok:false, timedOut:false, error:{message,code?}, messagesSince? (prompt only) }
 *   - timeout: { version, ok:false, timedOut:true } — turn keeps running; use /events SSE
 *   Invalid waitMs on these methods → 400 {error}. Above 60000 / non-integer / negative → 400 (not clamp).
 *
 * Blocking methods with a REAL result (slice remote-session-mgmt C3) — the FE
 * needs the list/confirmation. Each case below returns EXPLICITLY (200/400/502):
 * a `break` would fall through to the shared `return c.json({version}, 202)`
 * and break the contract. Management methods ignore `waitMs` silently (valid or invalid).
 *   - session/list   → 200 {sessions, sessionCapabilities} | 502 {error, code?}
 *   - session/load   → 200 {sessionId, version} | 400 (bad params / no cwd) | 502
 *   - session/delete → 200 {ok:true} | 200 {ok:false, unsupported:true} (-32601) | 502
 *
 * Returns 404 if connection not found (registry.getOrCreateHost → {ok:false}),
 * except reason:"evict-timeout" (a stuck WS tab, not a dead agent) → 503
 * (slice host-result-reason C1).
 *
 * ⚠️ prompt/cancel are non-blocking without waitMs (slice session-host-pending-surface C3-ד):
 * a synchronous launch failure (bad params, unknown method) stays an ordinary
 * HTTP response (400); an async turn failure travels through the state channel
 * (host.prompt already wrote lastTurnError before its promise settled) — the
 * `.catch` here is a log-only safety net (prevents unhandledRejection), NOT
 * `() => {}` (that would swap a loud failure for a silent one).
 *
 * ⚠️ With waitMs the HTTP handler is a **watcher**, not an owner: client disconnect
 * does NOT cancel the turn. A timeout returns 200 {timedOut:true}; late rejections
 * after timeout are logged via the same log.warn safety net (slice rpc-wait §5).
 *
 * ⚠️ cancel ok:true with waitMs means "sent", not "executed" — session-host wraps
 * client.cancel in catch {} so the promise never rejects.
 *
 * ─── slice session-host-http C3 (TDD) ───
 * ─── slice remote-session-view C4: + setSessionModel (TDD) ───
 * ─── slice session-host-pending-surface C3-ד (TDD): non-blocking prompt/cancel + ArkType ───
 * ─── slice remote-session-mgmt C3 (TDD): blocking listSessions/loadSession/deleteSession ───
 * ─── slice acp-method-names: שמות קנוניים; השמות הישנים מתקבלים בחלון-מעבר ───
 * ─── slice rpc-wait (TDD): optional waitMs on the six fire-and-forget methods ───
 */

import type { AgentRegistry } from "@drive-coding/core"
import { createLogger } from "@drive-coding/core/log"
import { canonicalRpcMethod, RPC_METHODS } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import type { Hono } from "hono"
import { optionalAgentMcpServers } from "../../agent-identity.js"
import { getSelfBaseUrl } from "../../instances.js"
import type { AgentSessionRegistry } from "../registry.js"
import { guardRpcRoute } from "./rpc-scope.js"
import { parseWaitMs, raceKeepRunning } from "./rpc-wait.js"

const log = createLogger("backend.session-host.rpc")

/** Methods whose success path is the shared 202 — honor top-level waitMs. */
const RPC_WAIT_METHODS = new Set<string>([
  RPC_METHODS.prompt,
  RPC_METHODS.cancel,
  RPC_METHODS.setMode,
  RPC_METHODS.setConfigOption,
  RPC_METHODS.extMethod,
  RPC_METHODS.setSessionModel,
])

// ⚠️ "meta?": "object" מסיק object | undefined — tsc דוחה את ההעברה ל-
// host.prompt(meta?: Record<string, unknown>). "[string]": "unknown" עוקף זאת.
//
// ─── slice remote-images C1: PromptBlocks ContentBlock schema ───
// חמשת הווריאנטים לפי SDK schema/types.gen.d.ts:236. annotations/_meta לא
// צריכים הצהרה — ArkType משמר מפתחות לא-מוצהרים (נבדק בהרצה).
const TextBlock = type({ type: "'text'", text: "string" })
const ImageBlock = type({ type: "'image'", mimeType: "string", data: "string" })
const AudioBlock = type({ type: "'audio'", mimeType: "string", data: "string" })
const ResourceLinkBlock = type({ type: "'resource_link'", name: "string", uri: "string" })
const ResourceBlock = type({ type: "'resource'", resource: "object" })
const ContentBlockSchema = TextBlock.or(ImageBlock)
  .or(AudioBlock)
  .or(ResourceLinkBlock)
  .or(ResourceBlock)
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

function rpcWaitErrorField(error: unknown): { message: string; code?: number } {
  const code = codeOf(error)
  const message = messageOf(error)
  return code === undefined ? { message } : { message, code }
}

async function respondRpcWait<T>(
  host: { state: { version: number } },
  work: Promise<T>,
  waitMs: number,
  onLateSettle: (error: unknown) => void,
  onSuccess?: (value: T) => Record<string, unknown>,
): Promise<{ status: 200; body: Record<string, unknown> }> {
  const raced = await raceKeepRunning(work, waitMs, onLateSettle)
  if (raced.outcome === "timedOut") {
    return { status: 200, body: { version: host.state.version, ok: false, timedOut: true } }
  }
  if (raced.outcome === "rejected") {
    return {
      status: 200,
      body: {
        version: host.state.version,
        ok: false,
        timedOut: false,
        error: rpcWaitErrorField(raced.error),
      },
    }
  }
  const extra = onSuccess ? onSuccess(raced.value) : {}
  return {
    status: 200,
    body: { version: host.state.version, ok: true, timedOut: false, ...extra },
  }
}

/**
 * registerRpcRoute — registers POST /api/agents/:id/rpc on the Hono app.
 */
export function registerRpcRoute(
  app: Hono,
  registry: AgentSessionRegistry,
  agentRegistry: AgentRegistry,
): void {
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
    // slice acp-method-names: שם-המתודה מנורמל לצורתו הקנונית לפני הניתוב.
    // ⚠️ **שתי הצורות מתקבלות בכוונה.** ה-FE הוא נכס-סטטי מצונן: טאב שנפתח
    // לפני הפריסה (או PWA שמגיש מהמטמון) ימשיך לשלוח `prompt`. בלי ההקבלה
    // הוא היה מקבל 400 — כלומר הפרומפט פשוט לא קורה, בלי שום סימן למשתמש.
    const rawMethod = body.method as string | undefined
    const method = canonicalRpcMethod(rawMethod)
    const params = (body.params ?? {}) as Record<string, unknown>
    const waitParsed = parseWaitMs(body.waitMs)
    if (waitParsed === "invalid" && method !== undefined && RPC_WAIT_METHODS.has(method)) {
      return c.json({ error: "invalid waitMs" }, 400)
    }
    const waitMs = waitParsed === "invalid" ? null : waitParsed

    return guardRpcRoute(c, agentId, method, agentRegistry, registry, async () => {
    switch (method) {
      case RPC_METHODS.prompt: {
        const p = PromptParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        if (waitMs === null) {
          const promptWork = host.prompt(p.sessionId, p.content as string | PromptBlocks, p.meta)
          void promptWork.catch((e) => {
            log.warn({ err: e }, "prompt turn failed") // ← state already carries lastTurnError
          })
          break // no await — 202 immediately, as the JSDoc above already promises
        }
        const from = host.state.messages.length
        const promptWork = host.prompt(p.sessionId, p.content as string | PromptBlocks, p.meta)
        const raced = await raceKeepRunning(promptWork, waitMs, (e) => {
          log.warn({ err: e }, "prompt turn failed")
        })
        if (raced.outcome === "timedOut") {
          return c.json({ version: host.state.version, ok: false, timedOut: true }, 200)
        }
        const messagesSince = host.state.messages.slice(from)
        if (raced.outcome === "rejected") {
          const code = codeOf(raced.error)
          const message = messageOf(raced.error)
          return c.json(
            {
              version: host.state.version,
              ok: false,
              timedOut: false,
              error: code === undefined ? { message } : { message, code },
              messagesSince,
            },
            200,
          )
        }
        return c.json(
          { version: host.state.version, ok: true, timedOut: false, messagesSince },
          200,
        )
      }
      case RPC_METHODS.cancel: {
        const p = CancelParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        if (waitMs === null) {
          void host.cancel(p.sessionId).catch((e) => log.warn({ err: e }, "cancel failed"))
          break
        }
        const waited = await respondRpcWait(host, host.cancel(p.sessionId), waitMs, (e) =>
          log.warn({ err: e }, "cancel failed"),
        )
        return c.json(waited.body, waited.status)
      }
      case RPC_METHODS.setMode: {
        const modeId = params.modeId as string
        if (waitMs === null) {
          await host.setMode(modeId)
          break
        }
        const waited = await respondRpcWait(host, host.setMode(modeId), waitMs, (e) =>
          log.warn({ err: e }, "setMode failed"),
        )
        return c.json(waited.body, waited.status)
      }
      case RPC_METHODS.setConfigOption: {
        const configId = params.configId as string
        const value = params.value as string | boolean
        if (waitMs === null) {
          await host.setConfigOption(configId, value)
          break
        }
        const waited = await respondRpcWait(
          host,
          host.setConfigOption(configId, value),
          waitMs,
          (e) => log.warn({ err: e }, "setConfigOption failed"),
        )
        return c.json(waited.body, waited.status)
      }
      case RPC_METHODS.extMethod: {
        const extMethodName = params.method as string
        const extParams = (params.params ?? {}) as Record<string, unknown>
        if (waitMs === null) {
          await host.extMethod(extMethodName, extParams)
          break
        }
        const waited = await respondRpcWait(
          host,
          host.extMethod(extMethodName, extParams),
          waitMs,
          (e) => log.warn({ err: e }, "extMethod failed"),
          (result) => ({ result }),
        )
        return c.json(waited.body, waited.status)
      }
      case RPC_METHODS.setSessionModel: {
        const model = params.model as string
        if (waitMs === null) {
          await host.setSessionModel(model)
          break
        }
        const waited = await respondRpcWait(host, host.setSessionModel(model), waitMs, (e) =>
          log.warn({ err: e }, "setSessionModel failed"),
        )
        return c.json(waited.body, waited.status)
      }
      // ─── slice remote-session-mgmt C3: BLOCKING mappings with a real result ───
      // ⚠️ each case `return`s explicitly (200/400/502). A `break` here would fall
      // through to the shared `return c.json({version}, 202)` below and break the
      // contract — the FE needs the list/confirmation in the body.
      case RPC_METHODS.listSessions: {
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
      case RPC_METHODS.loadSession: {
        const p = LoadSessionParams(params)
        if (p instanceof type.errors) return c.json({ error: p.summary }, 400)
        const cwd = p.cwd ?? registry.getCwd(agentId)
        if (!cwd) return c.json({ error: "no cwd available" }, 400)
        try {
          const mcpServers = optionalAgentMcpServers(
            agentId,
            getSelfBaseUrl(),
            host.agentCapabilities,
          )
          const r = await host.loadSession({
            cwd,
            sessionId: p.sessionId,
            ...(mcpServers !== undefined && { mcpServers }),
          })
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
      case RPC_METHODS.deleteSession: {
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
        // ⚠️ מדווחים את השם ש**נשלח**, לא את התוצאה המנורמלת (שהיא undefined
        // בדיוק במקרה הזה) — אחרת ההודעה היא "Unknown method: undefined"
        // וזורקת את הפרט היחיד שמאפשר לאבחן.
        return c.json({ error: `Unknown method: ${String(rawMethod)}` }, 400)
      }
    }

    // 202 Accepted — fire and forget; version for client sync
    return c.json({ version: host.state.version }, 202)
    })
  })
}

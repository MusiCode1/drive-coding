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
 *   - session/new    → 200 {sessionId, version} | 400 (no cwd) | 502
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
import { AGENT_ID_HEADER } from "../../agent-identity.js"
import { type } from "arktype"
import type { Hono } from "hono"
import type { AgentSessionRegistry } from "../registry.js"
import { guardRpcRoute } from "./rpc-scope.js"
import { dispatchRpcPrompt, PromptParams, resolveCallerSenderForPrompt } from "./rpc-prompt.js"
import {
  DeleteSessionParams,
  LoadSessionParams,
  NewSessionParams,
  tryDispatchBlockingSessionRpc,
} from "./rpc-session-mgmt.js"
import { respondRpcWait } from "./rpc-respond-wait.js"
import { parseWaitMs } from "./rpc-wait.js"

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

export {
  AudioBlock,
  ImageBlock,
  PromptParams,
  ResourceBlock,
  ResourceLinkBlock,
  TextBlock,
} from "./rpc-prompt.js"

export const CancelParams = type({ sessionId: "string" })
export { DeleteSessionParams, LoadSessionParams, NewSessionParams } from "./rpc-session-mgmt.js"

/**
 * registerRpcRoute — registers POST /api/agents/:id/rpc on the Hono app.
 */
export function registerRpcRoute(app: Hono, registry: AgentSessionRegistry, agentRegistry: AgentRegistry): void {
  app.post("/api/agents/:id/rpc", async (c) => {
    const agentId = c.req.param("id")
    const result = await registry.getOrCreateHost(agentId)
    if (!result.ok) {
      // slice host-result-reason C1: evict-timeout is transient (a stuck WS tab,
      // not a dead agent) → 503. The other three reasons are final → 404, unchanged.
      const status = result.reason === "evict-timeout" ? 503 : 404
      return c.json({ error: "Agent connection not found" }, status)
    }
    const { host } = result.entry

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
        const callerSender = await resolveCallerSenderForPrompt(
          agentRegistry,
          c.req.header(AGENT_ID_HEADER),
        )
        const outcome = await dispatchRpcPrompt(
          host,
          p.sessionId,
          p.content as string | PromptBlocks,
          p.meta,
          waitMs,
          callerSender,
        )
        if (outcome.kind === "accepted") break
        return c.json(outcome.body, outcome.status)
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
      case RPC_METHODS.listSessions:
      case RPC_METHODS.loadSession:
      case RPC_METHODS.newSession:
      case RPC_METHODS.deleteSession: {
        const blocking = await tryDispatchBlockingSessionRpc(
          c,
          method,
          params,
          host,
          registry,
          agentId,
        )
        if (blocking) return blocking
        break
      }
      default: {
        // ⚠️ מדווחים את השם ש**נשלח**, לא את התוצאה המנורמלת (שהיא undefined
        // בדיוק במקרה הזה) — אחרת ההודעה היא "Unknown method: undefined"
        // וזורקת את הפרט היחיד שמאפשר לאבחן.
        return c.json({ error: `Unknown method: ${String(rawMethod)}` }, 400)
      }
    }

    return c.json({ version: host.state.version }, 202) // fire-and-forget; version for client sync
    })
  })
}

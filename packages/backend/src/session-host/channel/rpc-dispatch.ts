/**
 * RPC dispatch shared by session transports.
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
 * needs the list/confirmation. Each case below returns EXPLICITLY (200/400/409/502):
 * a `break` would fall through to the shared `return {status: 202, body: {version}}`
 * and break the contract. Management methods ignore `waitMs` silently (valid or invalid).
 *   - session/list   → 200 {sessions, sessionCapabilities} | 502 {error, code?}
 *   - session/load   → 200 {sessionId, version} | 400 (bad params / no cwd) | 409 (session_busy: any load during turn) | 502
 *   - session/new    → 200 {sessionId, version} | 400 (no cwd) | 502
 *   - session/delete → 200 {ok:true} | 200 {ok:false, unsupported:true} (-32601) | 502
 *
 * Returns 404 for a missing or dead agent connection, and 401 when the
 * provider requires authentication during host creation.
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
import { type ChannelResponse, canonicalRpcMethod, RPC_METHODS } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { type } from "arktype"
import { AGENT_ID_HEADER } from "../../agent-identity.js"
import { readScopeToken } from "../../scope-write.js"
import type { AgentSessionRegistry, HostResult } from "../registry.js"
import type { CallerContext } from "./caller-context.js"
import { hostFailureResponse, hostThrowResponse } from "./host-failure.js"
import { dispatchRpcPrompt, PromptParams, resolveCallerSenderForPrompt } from "./rpc-prompt.js"
import { respondRpcWait } from "./rpc-respond-wait.js"
import { preflightRpcScopeDenied } from "./rpc-scope.js"
import { tryDispatchBlockingSessionRpc } from "./rpc-session-mgmt.js"
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

export type RpcDispatchDeps = { registry: AgentRegistry; sessionRegistry: AgentSessionRegistry }

export async function dispatchRpcBody(
  { registry: agentRegistry, sessionRegistry: registry }: RpcDispatchDeps,
  agentId: string,
  raw: unknown,
  caller: CallerContext,
): Promise<ChannelResponse> {
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
    return { status: 400, body: { error: "invalid waitMs" } }
  }
  const waitMs = waitParsed === "invalid" ? null : waitParsed

  const scopeDenied = await preflightRpcScopeDenied(
    caller,
    agentId,
    method,
    agentRegistry,
    registry,
  )
  if (scopeDenied) return scopeDenied

  let result: HostResult
  try {
    result = await registry.getOrCreateHost(agentId)
  } catch (err) {
    const response = hostThrowResponse(err)
    if (response) return response
    throw err
  }
  if (!result.ok) return hostFailureResponse(result)
  const { host } = result.entry

  switch (method) {
    case RPC_METHODS.prompt: {
      const p = PromptParams(params)
      if (p instanceof type.errors) return { status: 400, body: { error: p.summary } }
      const callerSender = await resolveCallerSenderForPrompt(
        agentRegistry,
        caller.header(AGENT_ID_HEADER),
      )
      const outcome = await dispatchRpcPrompt(
        host,
        p.sessionId,
        p.content as string | PromptBlocks,
        p.meta,
        waitMs,
        callerSender,
        { token: readScopeToken((name) => caller.header(name)), targetId: agentId },
      )
      if (outcome.kind === "accepted") break
      return { status: outcome.status, body: outcome.body }
    }
    case RPC_METHODS.cancel: {
      const p = CancelParams(params)
      if (p instanceof type.errors) return { status: 400, body: { error: p.summary } }
      if (waitMs === null) {
        void host.cancel(p.sessionId).catch((e) => log.warn({ err: e }, "cancel failed"))
        break
      }
      const waited = await respondRpcWait(host, host.cancel(p.sessionId), waitMs, (e) =>
        log.warn({ err: e }, "cancel failed"),
      )
      return waited
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
      return waited
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
      return waited
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
      return waited
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
      return waited
    }
    case RPC_METHODS.listSessions:
    case RPC_METHODS.loadSession:
    case RPC_METHODS.newSession:
    case RPC_METHODS.deleteSession: {
      const blocking = await tryDispatchBlockingSessionRpc(method, params, host, registry, agentId)
      if (blocking) return blocking
      break
    }
    default: {
      // ⚠️ מדווחים את השם ש**נשלח**, לא את התוצאה המנורמלת (שהיא undefined
      // בדיוק במקרה הזה) — אחרת ההודעה היא "Unknown method: undefined"
      // וזורקת את הפרט היחיד שמאפשר לאבחן.
      return { status: 400, body: { error: `Unknown method: ${String(rawMethod)}` } }
    }
  }

  return { status: 202, body: { version: host.state.version } } // fire-and-forget; version for client sync
}

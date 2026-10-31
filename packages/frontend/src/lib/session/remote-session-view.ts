/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת דרך HTTP+SSE (S4 routes):
 * - GET  /api/agents/:id/events  — SSE snapshot+patches (דרך SSEReader)
 * - POST /api/agents/:id/rpc     — session/prompt · session/cancel · session/set_mode
 *                                  session/set_config_option · _drive/ext · _drive/set_session_model
 * - POST /api/agents/:id/reply   — respond ל-permission/elicitation
 *
 * Session management (slice remote-session-mgmt C4 + remote warm newSession):
 * listSessions/loadSession/deleteSession/newSession go through the BE rpc
 * (blocking mappings, real results).
 *
 * Reactivity: SessionViewDelivery מחזיק state קנוני יחיד; view.state הוא getter אליו.
 * reader הרשת היחיד מזין producer טהור שמחשב FrameData, וה-delivery מוסר אותו
 * לכותב סינכרוני שמחיל transcript ומפרסם state ב-core slot המקורי של הפריים.
 * ה-holder ב-VM משקף רק את הפריים שנצרך; כשל UI מפסיק רק את מסירת הפריימים אליו.
 *
 * ─── slice remote-session-view C2+C3 (TDD) ───
 * ─── slice session-host-pending-surface C4: respond() — exact routing, no fallback ───
 */

import { RPC_METHODS, type SessionState } from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
import { registerView, unregisterView, type ViewDebugInfo } from "$lib/debug/session-registry"
import {
  dispatchRemoteReply,
  remoteHttpPost,
  resolveRemoteReplyKind,
} from "./remote-request-actions.js"
import { RemoteSessionReplacement } from "./remote-session-replacement"
import { RemoteStreamDelivery } from "./remote-stream-delivery"
import type { RemoteTerminal } from "./remote-stream-events"
import type { SessionView } from "./session-view.js"
import { type ProjectionSink, SessionViewDelivery } from "./session-view-delivery"
import { SSEReader } from "./sse-reader.js"

export const ACP_CONNECTION_ID_HEADER = "Acp-Connection-Id"

/** ext methods שדורשות return value אמיתי — לא נתמכות ב-remote mode (§C2 decision #3). */
const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])

const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionViewOptions = {
  /** HTTP headers לכל בקשה (auth וכו'). */
  headers?: Record<string, string>
  projection?: ProjectionSink
  onReady?: (view: RemoteSessionView) => boolean | undefined
  /** slice liveness C4: hook חיצוני כשה-SSE מתחבר מחדש (ניקוי באנר presence). */
  onSseReconnected?: () => void
  onTerminal?: (view: RemoteSessionView, fact: RemoteTerminal) => void
  /** @internal לבדיקות — override global fetch. */
  _fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** @internal לבדיקות — override setTimeout-based sleep (מועבר ל-SSEReader). */
  _sleep?: (ms: number) => Promise<void>
  /**
   * @internal לבדיקות — override השעון שמודד אורך-חיי-חיבור (מועבר ל-SSEReader).
   * slice sse-liveness Commit 4: היה חסר — בלעדיו אי-אפשר לבדוק את הגלאי
   * (וגם לא STABLE_CONNECTION_MS) מהשכבה הזו, רק ישירות על SSEReader.
   */
  _now?: () => number
}

/**
 * RemoteSessionView — מימוש SessionView שמתחבר ל-SessionHost בשרת (HTTP+SSE).
 *
 * Usage:
 *   const view = new RemoteSessionView("agent-1", "https://be.example.com")
 *   await view.connect()
 *   // יש לקשור ProjectionSink לפני connect; view.state קנוני ופעולות נשלחות ב-RPC
 *   await view.close()  // כשמסיימים
 */
export class RemoteSessionView implements SessionView {
  readonly #agentId: string
  readonly #baseUrl: string
  readonly #headers: Record<string, string>
  readonly #connectionId: string
  readonly #onSseReconnected?: () => void
  readonly #onTerminal?: RemoteSessionViewOptions["onTerminal"]
  readonly #doFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly #reader: SSEReader

  #sessionId: string | null = null
  readonly #replacement = new RemoteSessionReplacement()
  /**
   * slice remote-session-mgmt C4: raw sessionCapabilities from the listSessions
   * response (the BE ships them on that one round-trip). `supportsSessionDelete`
   * derives from them — false until the first listSessions answer.
   */
  #sessionCapabilities: { delete?: unknown; [key: string]: unknown } | null = null

  #delivery = new SessionViewDelivery()
  readonly #onReady?: (view: RemoteSessionView) => boolean | undefined

  readonly #ingress = new RemoteStreamDelivery({
    delivery: this.#delivery,
    replacement: this.#replacement,
    terminal: (fact) => this.#onTerminal?.(this, fact),
    dispose: () => {
      this.#reader.close()
      this.#delivery.dispose()
      unregisterView(this)
    },
    adoptSession: (sessionId) => {
      this.#sessionId = sessionId
    },
    reconnected: () => this.#onSseReconnected?.(),
  })

  constructor(agentId: string, baseUrl: string, opts: RemoteSessionViewOptions = {}) {
    this.#agentId = agentId
    this.#baseUrl = baseUrl
    registerView(this) // תצפית בלבד — ר' debug/session-registry.ts
    this.#connectionId =
      opts.headers?.[ACP_CONNECTION_ID_HEADER] ??
      (typeof crypto !== "undefined" ? crypto.randomUUID() : "remote-view")
    this.#headers = {
      [ACP_CONNECTION_ID_HEADER]: this.#connectionId,
      ...opts.headers,
    }
    this.#onSseReconnected = opts.onSseReconnected
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    // replaced on connect() by the SSE snapshot — this is just a safe pre-connect default

    this.#reader = new SSEReader(this.#eventsUrl(), {
      headers: this.#headers,
      _fetch: opts._fetch,
      _sleep: opts._sleep,
      _now: opts._now,
    })
    this.#onTerminal = opts.onTerminal

    this.#onReady = opts.onReady
    if (opts.projection) this.#delivery.bind(opts.projection)
  }

  // ─── SessionView: state ───

  bindProjection(sink: ProjectionSink): void {
    this.#delivery.bind(sink)
  }

  get state(): SessionState {
    return this.#delivery.state
  }

  /**
   * תמונת-מצב שטוחה לניפוי. **קריאה-בלבד** — אף פעם לא רפרנס חי.
   * `lastVersion` הוא הנתון שחסם את אבחון #41 במשך שעה: פרטי, ובלי שום
   * מסלול להוציאו בבילד פריוויו.
   */
  debugInfo(): ViewDebugInfo {
    return {
      agentId: this.#agentId,
      sessionId: this.#sessionId,
      lastVersion: this.#ingress.lastVersion,
      messages: this.#delivery.state.messages.length,
      status: this.#delivery.state.status,
      turnState: this.#delivery.state.turnState,
      closed: this.#ingress.closed,
    }
  }

  // ─── C3: water-mark getters (Speaker consumes these) ───

  get lastReadMessageId(): string | null {
    return this.#ingress.lastReadMessageId
  }

  get lastReadSegmentIndex(): number {
    return this.#ingress.lastReadSegmentIndex
  }

  // ─── Lifecycle ───

  /** @internal M8 — memoizes the in-flight/completed connect() call (see below). */
  #connectPromise: Promise<void> | null = null
  /** @internal round-2 finding #3 — set by close(); connect() rejects explicitly after. */

  /**
   * מתחבר ל-SSE, מאחזר snapshot (כולל sessionId), ומתחיל להאזין ל-patches.
   *
   * calev-heavy M8: לא הייתה re-entrant — קריאה שנייה (בטעות, למשל מ-double-mount
   * ב-Svelte) הייתה יוצרת חיבור SSE שני + `#drainPatches` שני על אותו state,
   * ומכפילה כל patch נכנס. מדוד: `segments=["once","once"]`. תוקן: `connect()`
   * ממוחזרת — קריאה שנייה (גם אחרי שהראשונה כבר הסתיימה) מחזירה את אותה הבטחה,
   * ולעולם לא פותחת חיבור שני.
   *
   * calev-heavy round 2 finding #2: אותו תיקון היה ממחזר גם promise **שנדחה** —
   * כישלון חולף בחיבור הראשון (BE עוד לא עלה) היה מרעיל את ה-view לצמיתות, כי כל
   * ניסיון חוזר קיבל את אותה דחייה בלי לשלוח אף בקשת HTTP. תוקן: memoization רק
   * להצלחה — על דחייה, `#connectPromise` מתאפס כדי שניסיון חוזר יפתח חיבור אמיתי.
   *
   * calev-heavy round 2 finding #3: `connect()` אחרי `close()` היה no-op שקט
   * (מחזיר promise מוצלח ישן בלי לפתוח שום stream). תוקן: זורק שגיאה מפורשת —
   * view סגור הוא terminal; לחיבור חדש יש לבנות instance חדש (תואם ל-LocalSessionView
   * ול-contract של close() ב-session-view.ts, ונמנע מהמורכבות של שחזור ה-patches
   * stream שכבר נסגר סופית).
   */
  async connect(): Promise<void> {
    if (this.#ingress.closed) {
      throw new Error(
        "RemoteSessionView: connect() called after close() — construct a new instance",
      )
    }
    if (this.#connectPromise) return this.#connectPromise
    this.#connectPromise = this.#doConnect().catch((err: unknown) => {
      // Only successful connections are memoized — a transient failure must not
      // permanently poison this instance (round 2 finding #2).
      this.#connectPromise = null
      throw err
    })
    return this.#connectPromise
  }

  async #doConnect(): Promise<void> {
    const { initial, events } = await this.#reader.connect()
    if (this.#ingress.closed) return
    this.#ingress.prime(initial)
    const terminal = this.#reader.terminalFact
    if (terminal) {
      this.#ingress.terminal(terminal)
      return
    }
    const accepted = this.#onReady?.(this) !== false
    if (this.#reader.terminalFact) {
      this.#ingress.terminal(this.#reader.terminalFact)
      return
    }
    if (!accepted || this.#ingress.closed) return
    this.#delivery.requireSink()
    this.#ingress.snapshot(initial, true)
    if (!this.#ingress.closed) void this.#ingress.consume(events)
  }

  /**
   * סוגר את חיבור ה-SSE ומפנה משאבים.
   * HTTP viewer detach: clears local projection only — no POST /reply, cancel, or delete.
   *
   * טרמינלי (round 2 finding #3): אחרי close(), connect() זורק — לא ניתן לפתוח
   * מחדש את אותו instance.
   */
  async close(): Promise<void> {
    if (!this.#ingress.beginClose()) return
    this.#delivery.state = {
      ...this.#delivery.state,
      pending: { permission: null, elicitation: null },
    }
    unregisterView(this)
    this.#reader.close()
    this.#delivery.dispose()
  }

  get hostIncarnation(): string | undefined {
    return this.#ingress.closed ? undefined : this.#ingress.hostIncarnation
  }

  // ─── Session management — slice remote-session-mgmt C4 + remote warm newSession ───

  /**
   * Warm ACP session/new on the existing HTTP host (BE reset + session/new).
   * cwd optional — route falls back to connection cwd (400 if neither).
   * Updates #sessionId and state.sessionId from the rpc response (same as loadSession).
   */
  newSession(cwd?: string): Promise<void> {
    return this.#replaceSession(undefined, cwd)
  }

  /**
   * Switches the active session through the BE (host.loadSession — switch
   * semantics). cwd is optional: sent only when provided; the route falls back
   * to the connection's cwd (400 if neither).
   *
   * Both sessionId sources are updated from the rpc response: #sessionId and
   * #state.sessionId (sessionId is not in update-session's fields — without the
   * state write it would stay stale across the switch).
   */
  loadSession(sessionId: string, cwd?: string): Promise<void> {
    return this.#replaceSession(sessionId, cwd)
  }

  #replaceSession(sessionId: string | undefined, cwd?: string): Promise<void> {
    const current = this.#ingress.captureContext()
    return this.#replacement.run(async () => {
      const method = sessionId === undefined ? RPC_METHODS.newSession : RPC_METHODS.loadSession
      const res = (await this.#rpc(method, {
        ...(sessionId !== undefined && { sessionId }),
        ...(cwd && { cwd }),
      })) as { sessionId?: unknown } | undefined
      if (!current()) throw new Error("RemoteSessionView: obsolete replacement")
      const attached =
        typeof res?.sessionId === "string" && res.sessionId.length > 0 ? res.sessionId : sessionId
      if (attached === undefined) {
        throw new Error("RemoteSessionView: newSession returned no sessionId")
      }
      this.#sessionId = attached
      this.#delivery.state = { ...this.#delivery.state, sessionId: attached }
    })
  }

  /**
   * Lists sessions + captures sessionCapabilities (delete gating) in one
   * round-trip. Sessions are normalized here (like LocalSessionView) — the VM
   * consumes them as-is. A -32601 (CLI without list capability) surfaces as an
   * error carrying `.code` (#post parses the 502 body) → the VM degrades to an
   * empty list gracefully instead of showing a generic "502".
   */
  async listSessions(): Promise<SessionInfo[]> {
    const current = this.#ingress.captureContext()
    const res = (await this.#rpc(RPC_METHODS.listSessions, {})) as
      | { sessions?: unknown; sessionCapabilities?: unknown }
      | undefined
    if (!current()) throw new Error("RemoteSessionView: obsolete list result")
    this.#sessionCapabilities =
      (res?.sessionCapabilities as
        | { delete?: unknown; [key: string]: unknown }
        | null
        | undefined) ?? null
    const sessions = res?.sessions
    const raw = Array.isArray(sessions) ? (sessions as unknown[]) : []
    return raw.map(normalizeSessionInfo)
  }

  /** The delete capability, as advertised by the last listSessions answer. */
  get supportsSessionDelete(): boolean {
    return this.#sessionCapabilities?.delete != null
  }

  /**
   * Deletes a session. The BE maps -32601 to `{ok:false, unsupported:true}` —
   * re-thrown with `code: -32601` so the VM handles it gracefully exactly like
   * local (button hidden / false return).
   */
  async deleteSession(sessionId: string): Promise<void> {
    const res = (await this.#rpc(RPC_METHODS.deleteSession, { sessionId })) as
      | { ok?: unknown; unsupported?: unknown }
      | undefined
    if (res?.unsupported === true) {
      const err = new Error(
        "RemoteSessionView: deleteSession is not supported by this CLI",
      ) as Error & { code: number }
      err.code = -32601
      throw err
    }
  }

  // ─── RPC methods ───

  /**
   * שולח prompt. string או PromptBlocks — passthrough ל-rpc.ts שמקבל את שניהם
   * לאחר slice remote-images C1.
   */
  async prompt(content: string | PromptBlocks, meta?: Record<string, unknown>): Promise<void> {
    await this.#rpc(RPC_METHODS.prompt, { sessionId: this.#sessionId, content, meta })
  }

  async cancel(): Promise<void> {
    await this.#rpc(RPC_METHODS.cancel, { sessionId: this.#sessionId })
  }

  async setMode(mode: string): Promise<void> {
    await this.#rpc(RPC_METHODS.setMode, { sessionId: this.#sessionId, modeId: mode })
  }

  async setConfigOption(key: string, value: unknown): Promise<void> {
    await this.#rpc(RPC_METHODS.setConfigOption, {
      sessionId: this.#sessionId,
      configId: key,
      value,
    })
  }

  async setSessionModel(model: string): Promise<void> {
    await this.#rpc(RPC_METHODS.setSessionModel, { sessionId: this.#sessionId, model })
  }

  async extMethod(method: string, params: unknown): Promise<unknown> {
    if (RETURN_VALUE_EXT_METHODS.has(method)) {
      throw new Error(NOT_SUPPORTED_EXT_RETURN_VALUE)
    }
    return this.#rpc(RPC_METHODS.extMethod, { sessionId: this.#sessionId, method, params })
  }

  // ─── Reply (permission/elicitation) ───

  /**
   * גוזר kind מ-state.pending: התאמה מדויקת, בלי fallback.
   *
   * slice session-host-pending-surface C4: ה-BE מקצה requestId ממונה משותף
   * יחיד (session-host.ts) — שני kinds לעולם לא חולקים id, אז אין כאן מקום
   * ל"עדיפות". id שלא תואם אף pending קיים הוא no-op שקט (כמו
   * LocalSessionView.respond) — לא נשלחת שום בקשה.
   */
  async respond(requestId: number, result: unknown): Promise<void> {
    if (this.#ingress.closed) return
    return this.#respond(requestId, result)
  }
  async #respond(requestId: number, result: unknown): Promise<void> {
    if (resolveRemoteReplyKind(this.#delivery, requestId) === undefined) return
    await dispatchRemoteReply(
      this.#httpPostContext(),
      this.#delivery,
      this.#replyUrl(),
      requestId,
      result,
      this.#ingress.closed,
      this.#ingress.terminalFact,
    )
  }

  #httpPostContext() {
    return {
      doFetch: this.#doFetch,
      headers: this.#headers,
      assertCurrent: this.#ingress.guardHttpResult(),
    }
  }

  // ─── Private: HTTP helpers ───

  #eventsUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/events`
  }

  #rpcUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/rpc`
  }

  #replyUrl(): string {
    return `${this.#baseUrl}/api/agents/${this.#agentId}/reply`
  }

  async #rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    const res = await this.#post(this.#rpcUrl(), { method, params })
    return res
  }

  /**
   * calev-heavy M4: never checked `res.ok` — a 404/400/500 was silently treated as
   * success. Measured: setMode that caused a 500 on the BE "succeeded" from the
   * caller's point of view. A failed prompt would look like a hang to the user,
   * not an error. Network errors already propagate (fetch rejects); only the HTTP
   * layer was swallowed.
   *
   * slice remote-session-mgmt C4: on !ok the body IS parsed now — the BE ships
   * 502 {error, code?} for CLI failures (e.g. -32601). Without parsing, the VM
   * would show a generic "502" instead of handling unsupported methods
   * gracefully. `.code` is attached to the thrown error when numeric.
   */
  async #post(url: string, body: unknown, localClose = false): Promise<unknown> {
    return remoteHttpPost(
      {
        doFetch: this.#doFetch,
        headers: this.#headers,
        assertCurrent: this.#ingress.guardHttpResult(localClose),
      },
      url,
      body,
    )
  }
}

// ─── Factory ───

/**
 * createRemoteSessionView — נוחות ליצירת RemoteSessionView.
 * סינכרוני בכוונה (תואם ל-brief C4) — הקורא (S6, טרם נבנה) אחראי לקרוא
 * ל-connect() בעצמו לפני שימוש; זה אינו נחווט כאן (avigail plan-gate r3 #11,
 * מרדכי: "זה נסגר ב-S6, לא אצלך").
 */
export function createRemoteSessionView(
  agentId: string,
  baseUrl: string,
  opts?: RemoteSessionViewOptions,
): RemoteSessionView {
  return new RemoteSessionView(agentId, baseUrl, opts)
}

// ─── Re-export for convenience ───
export type { SessionView } from "./session-view.js"

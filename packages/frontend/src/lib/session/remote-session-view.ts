/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת דרך HTTP+SSE (S4 routes):
 * - GET  /api/agents/:id/events  — SSE snapshot+patches (דרך SSEReader)
 * - POST /api/agents/:id/rpc     — prompt/cancel/setMode/setConfigOption/setSessionModel/extMethod
 * - POST /api/agents/:id/reply   — respond ל-permission/elicitation
 *
 * Session management (newSession/loadSession/listSessions/deleteSession) זורקות —
 * ה-backend מנהל sessions (§5.1 lifecycle), ה-FE לא.
 *
 * Reactivity: RemoteSessionView רק מתחזק state + מזרים patches (עוטף כל Patch בודד
 * מ-SSEReader ל-[patch] כדי להתאים ל-VM's ReadableStream<Patch[]>). ה-VM עושה את
 * ההחלה הממוקדת על Bubble[] (consumeViewPatches/applyPatchMutable, S1/S2) — לא כאן.
 * state עצמו מתעדכן דרך applyPatch (core, טהור/immutable) — לא כותבים applyPatch חדש.
 *
 * ─── slice remote-session-view C2+C3 (TDD) ───
 */

import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import type { SessionInfo } from "$lib/adapters/sessions"
import type { SessionView } from "./session-view.js"
import { SSEReader } from "./sse-reader.js"

/** ext methods שדורשות return value אמיתי — לא נתמכות ב-remote mode (§C2 decision #3). */
const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])

const NOT_SUPPORTED_SESSION_MGMT = "not supported in remote mode — backend manages sessions"
const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionViewOptions = {
  /** HTTP headers לכל בקשה (auth וכו'). */
  headers?: Record<string, string>
  /** @internal לבדיקות — override global fetch. */
  _fetch?: (url: string, init?: RequestInit) => Promise<Response>
  /** @internal לבדיקות — override setTimeout-based sleep (מועבר ל-SSEReader). */
  _sleep?: (ms: number) => Promise<void>
}

/**
 * RemoteSessionView — מימוש SessionView שמתחבר ל-SessionHost בשרת (HTTP+SSE).
 *
 * Usage:
 *   const view = new RemoteSessionView("agent-1", "https://be.example.com")
 *   await view.connect()
 *   // view.state / view.patches מתעדכנים; view.prompt(...) וכו' שולחות RPC
 *   await view.close()  // כשמסיימים
 */
export class RemoteSessionView implements SessionView {
  readonly #agentId: string
  readonly #baseUrl: string
  readonly #headers: Record<string, string>
  readonly #doFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly #reader: SSEReader

  #state: SessionState
  #sessionId: string | null = null

  // ─── patches stream (עטוף — Patch בודד מ-SSEReader → [patch]) ───
  #patchesCtrl: ReadableStreamDefaultController<Patch[]> | null = null
  readonly patches: ReadableStream<Patch[]>

  // ─── C3: Speaker water-mark (§8.1) — מונע הקראה כפולה אחרי reconnect ───
  #lastReadMessageId: string | null = null
  #lastReadSegmentIndex = 0
  /** גרסת ה-patch/snapshot האחרונה שהוחלה על state — לצורך השוואה ב-reconnect mid-turn. */
  #lastVersion = 0

  constructor(agentId: string, baseUrl: string, opts: RemoteSessionViewOptions = {}) {
    this.#agentId = agentId
    this.#baseUrl = baseUrl
    this.#headers = opts.headers ?? {}
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    // replaced on connect() by the SSE snapshot — this is just a safe pre-connect default
    this.#state = createInitialSessionState({ sessionId: null })

    this.#reader = new SSEReader(this.#eventsUrl(), {
      headers: this.#headers,
      _fetch: opts._fetch,
      _sleep: opts._sleep,
    })
    this.#reader.onReconnected = this.#handleReconnected.bind(this)

    this.patches = new ReadableStream<Patch[]>({
      start: (ctrl) => {
        this.#patchesCtrl = ctrl
      },
    })
  }

  // ─── SessionView: state ───

  get state(): SessionState {
    return this.#state
  }

  // ─── C3: water-mark getters (Speaker consumes these) ───

  get lastReadMessageId(): string | null {
    return this.#lastReadMessageId
  }

  get lastReadSegmentIndex(): number {
    return this.#lastReadSegmentIndex
  }

  // ─── Lifecycle ───

  /** מתחבר ל-SSE, מאחזר snapshot (כולל sessionId), ומתחיל להאזין ל-patches. */
  async connect(): Promise<void> {
    const { snapshot, patches } = await this.#reader.connect()
    this.#state = snapshot
    this.#sessionId = snapshot.sessionId
    this.#lastVersion = snapshot.version
    void this.#drainPatches(patches)
  }

  /**
   * סוגר את חיבור ה-SSE ומפנה משאבים.
   * מבטל pending permission/elicitation כ-cancelled (חוזה SessionView.close —
   * avigail plan-gate r3 #10) לפני הניתוק, דרך respond() (POST /reply) — הbackend
   * הוא שמחזיק את ה-pending האמיתי, ה-remote view רק משדר את הביטול אליו.
   */
  async close(): Promise<void> {
    const { permission, elicitation } = this.#state.pending
    if (permission) {
      await this.respond(permission.requestId, { outcome: { outcome: "cancelled" } }).catch(() => {
        // best-effort — ה-SSE כבר בדרך להיסגר, לא חוסמים את הסגירה על כשל reply
      })
    }
    if (elicitation) {
      await this.respond(elicitation.requestId, { action: "cancel" }).catch(() => {
        // best-effort
      })
    }
    // מנקה pending מקומית — הופך close() לאידמפוטנטי (קריאה חוזרת לא תשלח /reply שוב).
    this.#state = { ...this.#state, pending: { permission: null, elicitation: null } }
    this.#reader.close()
    try {
      this.#patchesCtrl?.close()
    } catch {
      // already closed
    }
  }

  // ─── Incoming patches: apply to state (core applyPatch) + wrap + emit ───

  async #drainPatches(patches: ReadableStream<Patch>): Promise<void> {
    const reader = patches.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        this.#applyIncoming(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  #applyIncoming(patch: Patch): void {
    // calev-heavy B1: PatchesBroadcaster.subscribe() replays up to 64 buffered patches
    // to every new subscriber — including reconnects, and even the very first connect
    // if patches happened before this client attached. Those patches are already
    // reflected in the snapshot (frame-zero) / in whatever #lastVersion already covers.
    // Applying them again duplicates messages/segments (measured: "hello"+" world"
    // appearing twice after one server-side drop). Skip anything already applied.
    if (patch.version <= this.#lastVersion) return
    this.#state = applyPatch(this.#state, patch)
    this.#lastVersion = patch.version
    this.#advanceWaterMark(patch)
    this.#emit([patch])
  }

  #emit(patches: Patch[]): void {
    try {
      this.#patchesCtrl?.enqueue(patches)
    } catch {
      // stream cancelled by consumer — ignore
    }
  }

  // ─── C3: Speaker water-mark ───

  /** כשמגיע append-segment — מקדם את ה-water-mark (מסמן להקראה). */
  #advanceWaterMark(patch: Patch): void {
    if (patch.op !== "append-segment") return
    const msg = this.#state.messages.find((m) => m.id === patch.targetId)
    if (!msg || msg.role === "tool") return
    this.#lastReadMessageId = msg.id
    this.#lastReadSegmentIndex = msg.segments.length - 1
  }

  // ─── C3: reconnect mid-turn — full state replacement אם פספסנו נתונים ───

  /**
   * calev-heavy B2+M6 (מרדכי: "הפשוט ביותר הוא ש-reconnect יחליף את כל ה-state
   * מה-snapshot, לא reset חלקי"):
   *
   * B2 — ה-`reset` patch op (core apply-patch.ts) נושא רק messages/nextMessageSeq/
   * nextSegmentSeq; שאר השדות (status/turnState/pending/modes/configOptions/title/
   * contextUsage/quota) לא נגעים. מדד: פרמישן שעלתה בזמן שהחיבור נותק אף פעם לא
   * מוצגת (state.pending נשאר מהמצב הישן) — ה-UI תקוע עד ה-timeout. הפתרון: **מחליפים
   * את #state כולו מה-snapshot** (לא applyPatch על reset חלקי) — עדיין פולטים reset
   * patch דרך patches כדי שה-VM יבנה מחדש את ה-bubbles מ-snapshot.messages.
   *
   * M6 — version הוא מונה פר-host (מתאפס אחרי restart של ה-BE). ההשוואה
   * `snapshot.version <= #lastVersion` לא אמינה לבד אחרי restart (version חדש
   * יכול להיות *נמוך* מהישן). משווים גם sessionId: אם ה-snapshot מגיע מ-session
   * אחר (BE restart יצר session חדש) — מחליפים תמיד, בלי קשר ל-version, ומרעננים
   * את #sessionId (שלא התעדכן קודם אחרי reconnect).
   */
  #handleReconnected(snapshot: SessionState): void {
    const sessionChanged = snapshot.sessionId !== this.#sessionId
    if (!sessionChanged && snapshot.version <= this.#lastVersion) {
      // אותו session, כבר מעודכן — לא פספסנו כלום.
      return
    }
    const resetPatch: Patch = {
      version: snapshot.version,
      op: "reset",
      messages: snapshot.messages,
      nextMessageSeq: snapshot.nextMessageSeq,
      nextSegmentSeq: snapshot.nextSegmentSeq,
    }
    this.#state = snapshot
    this.#sessionId = snapshot.sessionId
    this.#lastVersion = snapshot.version
    this.#lastReadMessageId = null
    this.#lastReadSegmentIndex = 0
    this.#emit([resetPatch])
  }

  // ─── Session management — backend manages sessions ───

  newSession(): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  loadSession(_sessionId: string): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  listSessions(): Promise<SessionInfo[]> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  deleteSession(_sessionId: string): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
  }

  // ─── RPC methods ───

  /**
   * שולח prompt. רק string נתמך ב-remote mode — הbackend (rpc.ts:46) עושה
   * `params.content as string` בלי serialization אמיתי, כך ש-PromptBlocks (מערך)
   * היה נשבר בשקט (avigail plan-gate r3 #7: היה נכנס כטקסט לא-תקין ל-segment).
   * הרחבת ה-BE לתמוך ב-PromptBlocks שייכת ל-S4 (לא לסלייס הזה) — לכן זורקים כאן
   * במקום לשלוח מידע פגום.
   */
  async prompt(content: string | PromptBlocks, meta?: Record<string, unknown>): Promise<void> {
    if (typeof content !== "string") {
      throw new Error("RemoteSessionView: PromptBlocks not supported in remote mode — text only")
    }
    await this.#rpc("prompt", { sessionId: this.#sessionId, content, meta })
  }

  async cancel(): Promise<void> {
    await this.#rpc("cancel", { sessionId: this.#sessionId })
  }

  async setMode(mode: string): Promise<void> {
    await this.#rpc("setMode", { sessionId: this.#sessionId, modeId: mode })
  }

  async setConfigOption(key: string, value: unknown): Promise<void> {
    await this.#rpc("setConfigOption", { sessionId: this.#sessionId, configId: key, value })
  }

  async setSessionModel(model: string): Promise<void> {
    await this.#rpc("setSessionModel", { sessionId: this.#sessionId, model })
  }

  async extMethod(method: string, params: unknown): Promise<unknown> {
    if (RETURN_VALUE_EXT_METHODS.has(method)) {
      throw new Error(NOT_SUPPORTED_EXT_RETURN_VALUE)
    }
    return this.#rpc("extMethod", { sessionId: this.#sessionId, method, params })
  }

  // ─── Reply (permission/elicitation) ───

  /**
   * גוזר kind מ-state.pending: permission נבדק ראשון (עדיפות ב-edge case נדיר
   * שבו שניהם pending עם אותו requestId — תואם ל-reply.ts:30 warning).
   */
  async respond(requestId: number, result: unknown): Promise<void> {
    const kind =
      this.#state.pending.permission?.requestId === requestId
        ? "permission"
        : this.#state.pending.elicitation?.requestId === requestId
          ? "elicitation"
          : "permission"
    await this.#post(this.#replyUrl(), { kind, requestId, result })
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
   */
  async #post(url: string, body: unknown): Promise<unknown> {
    const res = await this.#doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#headers },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`RemoteSessionView: POST ${url} failed with status ${res.status}`)
    }
    if (!res.json) return undefined
    try {
      return await res.json()
    } catch {
      return undefined
    }
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

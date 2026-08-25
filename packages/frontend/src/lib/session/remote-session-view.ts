/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת דרך HTTP+SSE (S4 routes):
 * - GET  /api/agents/:id/events  — SSE snapshot+patches (דרך SSEReader)
 * - POST /api/agents/:id/rpc     — session/prompt · session/cancel · session/set_mode
 *                                  session/set_config_option · _drive/ext · _drive/set_session_model
 * - POST /api/agents/:id/reply   — respond ל-permission/elicitation
 *
 * Session management (slice remote-session-mgmt C4): listSessions/loadSession/
 * deleteSession go through the BE rpc (blocking mappings, real results);
 * newSession still throws — session creation stays BE-owned (§5.1).
 *
 * Reactivity: RemoteSessionView רק מתחזק state + מזרים patches (עוטף כל Patch בודד
 * מ-SSEReader ל-[patch] כדי להתאים ל-VM's ReadableStream<Patch[]>). ה-VM עושה את
 * ההחלה הממוקדת על Bubble[] (consumeViewPatches/applyPatchMutable, S1/S2) — לא כאן.
 * state עצמו מתעדכן דרך applyPatch (core, טהור/immutable) — לא כותבים applyPatch חדש.
 *
 * ─── slice remote-session-view C2+C3 (TDD) ───
 * ─── slice session-host-pending-surface C4: respond() — exact routing, no fallback ───
 */

import {
  applyPatch,
  createInitialSessionState,
  type Patch,
  RPC_METHODS,
  reduce,
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { normalizeSessionInfo, type SessionInfo } from "$lib/adapters/sessions"
import { registerView, unregisterView, type ViewDebugInfo } from "$lib/debug/session-registry"
import { connWarn } from "$lib/util/conn-log"
import type { SessionView } from "./session-view.js"
import type { WireUpdateBatch } from "./sse-reader"
import { SSEReader } from "./sse-reader.js"

/** ext methods שדורשות return value אמיתי — לא נתמכות ב-remote mode (§C2 decision #3). */
const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])

const NOT_SUPPORTED_SESSION_MGMT = "not supported in remote mode — backend manages sessions"
const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteSessionViewOptions = {
  /** HTTP headers לכל בקשה (auth וכו'). */
  headers?: Record<string, string>
  /** slice liveness C4: hook חיצוני כשה-SSE מתחבר מחדש (ניקוי באנר presence). */
  onSseReconnected?: () => void
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
 *   // view.state / view.patches מתעדכנים; view.prompt(...) וכו' שולחות RPC
 *   await view.close()  // כשמסיימים
 */
export class RemoteSessionView implements SessionView {
  readonly #agentId: string
  readonly #baseUrl: string
  readonly #headers: Record<string, string>
  readonly #onSseReconnected?: () => void
  readonly #doFetch: (url: string, init?: RequestInit) => Promise<Response>
  readonly #reader: SSEReader

  #state: SessionState
  #sessionId: string | null = null
  /**
   * slice remote-session-mgmt C4: raw sessionCapabilities from the listSessions
   * response (the BE ships them on that one round-trip). `supportsSessionDelete`
   * derives from them — false until the first listSessions answer.
   */
  #sessionCapabilities: { delete?: unknown; [key: string]: unknown } | null = null

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
    registerView(this) // תצפית בלבד — ר' debug/session-registry.ts
    this.#headers = opts.headers ?? {}
    this.#onSseReconnected = opts.onSseReconnected
    this.#doFetch = opts._fetch ?? ((u, init) => globalThis.fetch(u, init))
    // replaced on connect() by the SSE snapshot — this is just a safe pre-connect default
    this.#state = createInitialSessionState({ sessionId: null })

    this.#reader = new SSEReader(this.#eventsUrl(), {
      headers: this.#headers,
      _fetch: opts._fetch,
      _sleep: opts._sleep,
      _now: opts._now,
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

  /**
   * תמונת-מצב שטוחה לניפוי. **קריאה-בלבד** — אף פעם לא רפרנס חי.
   * `lastVersion` הוא הנתון שחסם את אבחון #41 במשך שעה: פרטי, ובלי שום
   * מסלול להוציאו בבילד פריוויו.
   */
  debugInfo(): ViewDebugInfo {
    return {
      agentId: this.#agentId,
      sessionId: this.#sessionId,
      lastVersion: this.#lastVersion,
      messages: this.#state.messages.length,
      status: this.#state.status,
      turnState: this.#state.turnState,
      closed: this.#isClosed,
    }
  }

  // ─── C3: water-mark getters (Speaker consumes these) ───

  get lastReadMessageId(): string | null {
    return this.#lastReadMessageId
  }

  get lastReadSegmentIndex(): number {
    return this.#lastReadSegmentIndex
  }

  // ─── Lifecycle ───

  /** @internal M8 — memoizes the in-flight/completed connect() call (see below). */
  #connectPromise: Promise<void> | null = null
  /** @internal round-2 finding #3 — set by close(); connect() rejects explicitly after. */
  #isClosed = false

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
    if (this.#isClosed) {
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
    const { snapshot, updates } = await this.#reader.connect()
    this.#state = snapshot
    this.#sessionId = snapshot.sessionId
    this.#lastVersion = snapshot.version
    // ─── slice remote-warm-reconnect C3: hydration ───
    // חיבור ראשון יכול לשאת את כל ההיסטוריה (warm reconnect ל-host קיים; ב-attachRemote
    // רגיל ה-snapshot ריק). פולטים patch reset סינתטי מה-snapshot כדי שה-VM יבנה
    // bubbles — בדיוק הטכניקה של #handleReconnected למטה.
    // ⚠️ קונקרטי: ישירות דרך #emit (לא #applyIncoming — ה-watermark היה חוסם כל
    // גרסה), version = snapshot.version (בלי לגעת ב-#lastVersion, כבר מעודכן),
    // **לפני** #drainPatches — סדר דטרמיניסטי בערוץ ה-VM. רגרסיה: "היסטוריה לא מוכפלת".
    if (snapshot.messages.length > 0) {
      const resetPatch: Patch = {
        version: snapshot.version,
        op: "reset",
        messages: snapshot.messages,
        nextMessageSeq: snapshot.nextMessageSeq,
        nextSegmentSeq: snapshot.nextSegmentSeq,
      }
      this.#emit([resetPatch])
    }
    void this.#drainUpdates(updates)
  }

  /**
   * סוגר את חיבור ה-SSE ומפנה משאבים.
   * מבטל pending permission/elicitation כ-cancelled (חוזה SessionView.close —
   * avigail plan-gate r3 #10) לפני הניתוק, דרך respond() (POST /reply) — הbackend
   * הוא שמחזיק את ה-pending האמיתי, ה-remote view רק משדר את הביטול אליו.
   *
   * טרמינלי (round 2 finding #3): אחרי close(), connect() זורק — לא ניתן לפתוח
   * מחדש את אותו instance.
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
    this.#isClosed = true
    unregisterView(this)
    this.#reader.close()
    try {
      this.#patchesCtrl?.close()
    } catch {
      // already closed
    }
  }

  // ─── Incoming patches: apply to state (core applyPatch) + wrap + emit ───

  async #drainUpdates(updates: ReadableStream<WireUpdateBatch>): Promise<void> {
    const reader = updates.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        try {
          this.#applyIncoming(value)
        } catch (err) {
          // calev-heavy round 2 finding #1: a single unexpected/malformed patch
          // must not kill the whole drain loop — `void this.#drainPatches(...)`
          // is fire-and-forget, so an uncaught throw here would become a silent
          // unhandled rejection and every subsequent patch would be lost forever.
          // Skip this one patch, keep draining. calev-heavy round 3: staying
          // silent here was itself wrong — SSEReader now validates patches before
          // they even reach this point (round 3 root-cause fix), so reaching this
          // catch means something unexpected slipped through; log it so it's not
          // invisible.
          console.warn("RemoteSessionView: error applying patch, skipping", err)
        }
      }
    } finally {
      reader.releaseLock()
    }
  }

  /**
   * ─── slice acp-wire-session-update ───
   * מקבל **batch של `session/update`** במקום `Patch` יחיד, ומקפל אותו כאן
   * ב-`reduce` — אותו reducer בדיוק שמסלול ה-WS משתמש בו. ⇒ שתי התעבורות
   * מתאחדות על קיפול יחיד, וה-`Patch` נשאר יחידת-ההחלה הפנימית בלבד.
   */
  #applyIncoming(batch: WireUpdateBatch): void {
    // calev-heavy B1: PatchesBroadcaster.subscribe() replays up to 64 buffered patches
    // to every new subscriber — including reconnects, and even the very first connect
    // if patches happened before this client attached. Those patches are already
    // reflected in the snapshot (frame-zero) / in whatever #lastVersion already covers.
    // Applying them again duplicates messages/segments (measured: "hello"+" world"
    // appearing twice after one server-side drop). Skip anything already applied.
    if (batch.version <= this.#lastVersion) return

    let state = this.#state
    const produced: Patch[] = []
    for (const update of batch.updates) {
      const { state: next, patches } = reduce(state, update)
      state = next
      produced.push(...patches)
    }
    // ⚠️ **ה-version נדרס לזה של השרת.** `reduce` מקדם מונה מקומי אחד לכל
    // update, וה-batch יכול להחזיק כמה — ספירה מקומית הייתה מסיטה את המונה
    // מזה של השרת בהדרגה, ואז כל השוואת-watermark הופכת לשקר. זו בדיוק
    // רגרסיית-הגרסה שבאג #41 נבנה סביבה.
    this.#state = { ...state, version: batch.version }
    this.#lastVersion = batch.version
    for (const p of produced) this.#advanceWaterMark(p)
    if (produced.length > 0) this.#emit(produced)
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
      //
      // 🔴 …אלא אם ה-host נבנה מחדש: אז ה-snapshot מגיע עם version **נמוך**
      // (‏replay גס יותר מ-streaming — ר' bugs/41), וכל תוכן חדש נזרק **בשקט**.
      // הזעקה אינה מתקנת — היא הופכת כשל-שקט לכשל-נראה.
      if (snapshot.version < this.#lastVersion) {
        connWarn("sse-version-regression", {
          got: snapshot.version,
          have: this.#lastVersion,
          sessionId: snapshot.sessionId,
        })
      }
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
    this.#onSseReconnected?.()
  }

  // ─── Session management — slice remote-session-mgmt C4 ───

  /**
   * ❌ newSession stays throwing (documented): creating a session means a fresh
   * connection through createAgent — out of this slice's scope.
   */
  newSession(): Promise<void> {
    return Promise.reject(new Error(NOT_SUPPORTED_SESSION_MGMT))
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
  async loadSession(sessionId: string, cwd?: string): Promise<void> {
    const res = (await this.#rpc(RPC_METHODS.loadSession, {
      sessionId,
      ...(cwd && { cwd }),
    })) as { sessionId?: unknown } | undefined
    const attached =
      typeof res?.sessionId === "string" && res.sessionId.length > 0 ? res.sessionId : sessionId
    this.#sessionId = attached
    this.#state = { ...this.#state, sessionId: attached }
  }

  /**
   * Lists sessions + captures sessionCapabilities (delete gating) in one
   * round-trip. Sessions are normalized here (like LocalSessionView) — the VM
   * consumes them as-is. A -32601 (CLI without list capability) surfaces as an
   * error carrying `.code` (#post parses the 502 body) → the VM degrades to an
   * empty list gracefully instead of showing a generic "502".
   */
  async listSessions(): Promise<SessionInfo[]> {
    const res = (await this.#rpc(RPC_METHODS.listSessions, {})) as
      | { sessions?: unknown; sessionCapabilities?: unknown }
      | undefined
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
    const kind =
      this.#state.pending.permission?.requestId === requestId
        ? "permission"
        : this.#state.pending.elicitation?.requestId === requestId
          ? "elicitation"
          : undefined
    if (kind === undefined) return // no-op שקט — id לא תואם אף pending קיים
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
   *
   * slice remote-session-mgmt C4: on !ok the body IS parsed now — the BE ships
   * 502 {error, code?} for CLI failures (e.g. -32601). Without parsing, the VM
   * would show a generic "502" instead of handling unsupported methods
   * gracefully. `.code` is attached to the thrown error when numeric.
   */
  async #post(url: string, body: unknown): Promise<unknown> {
    const res = await this.#doFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...this.#headers },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      let payload: { error?: unknown; code?: unknown } | undefined
      if (res.json) {
        try {
          payload = (await res.json()) as { error?: unknown; code?: unknown }
        } catch {
          payload = undefined
        }
      }
      const detail =
        payload && typeof payload.error === "string" && payload.error.length > 0
          ? ` (${payload.error})`
          : ""
      const err = new Error(
        `RemoteSessionView: POST ${url} failed with status ${res.status}${detail}`,
      ) as Error & { code?: number }
      if (payload && typeof payload.code === "number") err.code = payload.code
      throw err
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

/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת באמצעות SessionPipe ומקפל עדכוני מצב.
 *
 * Session management (slice remote-session-mgmt C4 + remote warm newSession):
 * listSessions/loadSession/deleteSession/newSession go through the BE rpc
 * (blocking mappings, real results).
 *
 * Reactivity: RemoteSessionView מקפל את העדכונים מ-FrameReader באמצעות reduce
 * ומזרים את ה-patches שהקיפול הפיק. ה-VM עושה את
 * ההחלה הממוקדת על Bubble[] (consumeViewPatches/applyPatchMutable, S1/S2) — לא כאן.
 *
 * ─── slice remote-session-view C2+C3 (TDD) ───
 * ─── slice session-host-pending-surface C4: respond() — exact routing, no fallback ───
 */

import {
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
import {
  cancelPendingOnViewClose,
  drainRemoteUpdates,
  readTerminalError,
  snapshotResetPatch,
} from "./remote-session-stream"
import type { SessionView, ViewEmission } from "./session-view.js"
import type { WireUpdateBatch } from "./wire/frame-decode"
import { FrameReader } from "./wire/frame-reader"
import { resultOf, type SessionPipe } from "./wire/pipe"
import type { SSEReaderOptions } from "./wire/reader-types"

/** ext methods שדורשות return value אמיתי — לא נתמכות ב-remote mode (§C2 decision #3). */
const RETURN_VALUE_EXT_METHODS = new Set<string>(["_drive/getQuota"])

const NOT_SUPPORTED_EXT_RETURN_VALUE = "not supported in remote mode — use state instead"

export type RemoteViewOptions = Pick<SSEReaderOptions, "_sleep" | "_now" | "_fetch"> & {
  connectionId?: string
  baseUrl?: string
  /** Called after a reconnect replaces the view state. */
  onSseReconnected?: () => void
}

/** RemoteSessionView — the stateful SessionView backed by the server session host. */
export class RemoteSessionView implements SessionView {
  readonly #agentId: string
  readonly #pipe: SessionPipe
  readonly #onSseReconnected?: () => void
  readonly #reader: FrameReader
  readonly #agentMetadataOptions: Parameters<typeof readTerminalError>[2]
  readonly connectionId?: string

  #state: SessionState
  #sessionId: string | null = null
  /**
   * slice remote-session-mgmt C4: raw sessionCapabilities from the listSessions
   * response (the BE ships them on that one round-trip). `supportsSessionDelete`
   * derives from them — false until the first listSessions answer.
   */
  #sessionCapabilities: { delete?: unknown; [key: string]: unknown } | null = null

  // ─── patches stream (ViewEmission: patches + raw wire updates) ───
  #patchesCtrl: ReadableStreamDefaultController<ViewEmission> | null = null
  readonly patches: ReadableStream<ViewEmission>

  // ─── C3: Speaker water-mark (§8.1) — מונע הקראה כפולה אחרי reconnect ───
  #lastReadMessageId: string | null = null
  #lastReadSegmentIndex = 0
  /** גרסת ה-patch/snapshot האחרונה שהוחלה על state — לצורך השוואה ב-reconnect mid-turn. */
  #lastVersion = 0

  constructor(agentId: string, pipe: SessionPipe, opts: RemoteViewOptions = {}) {
    this.#agentId = agentId
    this.#pipe = pipe
    this.connectionId = opts.connectionId
    this.#agentMetadataOptions = { baseUrl: opts.baseUrl, fetcher: opts._fetch }
    registerView(this) // תצפית בלבד — ר' debug/session-registry.ts
    this.#onSseReconnected = opts.onSseReconnected
    // Replaced on connect() by the snapshot.
    this.#state = createInitialSessionState({ sessionId: null })

    this.#reader = new FrameReader(pipe.frames, opts)
    this.#reader.onReconnected = this.#handleReconnected.bind(this)

    this.patches = new ReadableStream<ViewEmission>({
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
      closed: this.#lifetime.signal.aborted,
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
  readonly #lifetime = new AbortController()

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
    if (this.#lifetime.signal.aborted) {
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
      this.#emit([snapshotResetPatch(snapshot)])
    }
    void drainRemoteUpdates(updates, (batch) => this.#applyIncoming(batch))
      .then(() =>
        readTerminalError(this.#agentId, this.#lifetime.signal, this.#agentMetadataOptions),
      )
      .then((reason) => {
        if (reason) this.#emit([], [], reason)
      })
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
    this.#lifetime.abort()
    const pending = this.#state.pending
    if (pending.permission || pending.elicitation) {
      await cancelPendingOnViewClose(pending, this.respond.bind(this))
    }
    // מנקה pending מקומית — הופך close() לאידמפוטנטי (קריאה חוזרת לא תשלח /reply שוב).
    this.#state = { ...this.#state, pending: { permission: null, elicitation: null } }
    unregisterView(this)
    this.#reader.close()
    this.#pipe.close()
    try {
      this.#patchesCtrl?.close()
    } catch {
      // already closed
    }
  }

  // ─── Incoming patches: apply to state (core applyPatch) + wrap + emit ───

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
    if (produced.length > 0 || batch.updates.length > 0) {
      this.#emit(produced, batch.updates)
    }
  }

  #emit(patches: Patch[], updates: unknown[] = [], terminalError?: string): void {
    try {
      this.#patchesCtrl?.enqueue({ patches, updates, ...(terminalError ? { terminalError } : {}) })
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
    this.#state = snapshot
    this.#sessionId = snapshot.sessionId
    this.#lastVersion = snapshot.version
    this.#lastReadMessageId = null
    this.#lastReadSegmentIndex = 0
    this.#emit([snapshotResetPatch(snapshot)])
    this.#onSseReconnected?.()
  }

  // ─── Session management — slice remote-session-mgmt C4 + remote warm newSession ───

  /**
   * Warm ACP session/new on the existing HTTP host (BE reset + session/new).
   * cwd optional — route falls back to connection cwd (400 if neither).
   * Updates #sessionId and state.sessionId from the rpc response (same as loadSession).
   */
  async newSession(cwd?: string): Promise<void> {
    const res = (await this.#rpc(RPC_METHODS.newSession, {
      ...(cwd && { cwd }),
    })) as { sessionId?: unknown } | undefined
    const attached =
      typeof res?.sessionId === "string" && res.sessionId.length > 0 ? res.sessionId : null
    if (!attached) throw new Error("RemoteSessionView: newSession returned no sessionId")
    this.#sessionId = attached
    this.#state = { ...this.#state, sessionId: attached }
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
   * error carrying `.code` (resultOf reads the response body) → the VM degrades to an
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
    resultOf(
      await this.#pipe.rpc.call("reply", { kind, requestId, result }),
      this.#pipe.rpc.label("reply"),
    )
  }

  async #rpc(method: string, params: Record<string, unknown>): Promise<unknown> {
    return resultOf(
      await this.#pipe.rpc.call("rpc", { method, params }),
      this.#pipe.rpc.label("rpc"),
    )
  }
}

// ─── Re-export for convenience ───
export type { SessionView } from "./session-view.js"

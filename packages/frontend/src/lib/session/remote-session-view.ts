/**
 * remote-session-view.ts — RemoteSessionView מממש את SessionView port.
 *
 * מתחבר ל-SessionHost בשרת באמצעות SessionPipe ומקפל עדכוני מצב.
 *
 * Session management (slice remote-session-mgmt C4 + remote warm newSession):
 * listSessions/loadSession/deleteSession/newSession go through the BE rpc
 * (blocking mappings, real results).
 *
 * Reactivity: live updates are folded in HistorySync and streamed as ViewEmission patches.
 *
 * ─── slice remote-session-view C2+C3 (TDD) ───
 * ─── slice session-host-pending-surface C4: respond() — exact routing, no fallback ───
 */

import {
  createInitialSessionState,
  type Patch,
  type SessionState,
} from "@drive-coding/core/session"
import type { PromptBlocks } from "@drive-coding/provider/client"
import { registerView, type ViewDebugInfo } from "$lib/debug/session-registry"
import type { HistorySync } from "./history-sync"
import { advanceReadWaterMark, emitView, enqueueEmission } from "./remote-session-emission"
import { wireRemoteHistorySync } from "./remote-session-history-port"
import { closeRemoteSession } from "./remote-session-close"
import { openRemoteSession } from "./remote-session-connect"
import {
  type RemoteSessionRpcDeps,
  remoteCancel,
  remoteDeleteSession,
  remoteExtMethod,
  remoteListSessions,
  remoteLoadSession,
  remoteNewSession,
  remotePrompt,
  remoteRespond,
  remoteSetConfigOption,
  remoteSetMode,
  remoteSetSessionModel,
  remoteSupportsSessionDelete,
} from "./remote-session-view-rpc"
import type { SessionView, ViewEmission, ViewTerminal } from "./session-view.js"
import { FrameReader } from "./wire/frame-reader"
import type { SessionPipe } from "./wire/pipe"
import type { SSEReaderOptions } from "./wire/reader-types"

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
  readonly #history: HistorySync
  readonly #sleep: (ms: number) => Promise<void>
  readonly #agentMetadataOptions: Parameters<typeof readTerminalEmission>[2]
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
    this.#sleep = opts._sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    // Replaced on connect() by the snapshot.
    this.#state = createInitialSessionState({ sessionId: null })

    this.#reader = new FrameReader(pipe.frames, opts)
    this.#history = wireRemoteHistorySync(
      pipe,
      this.#reader,
      {
        getState: () => this.#state,
        getLastVersion: () => this.#lastVersion,
        getSessionId: () => this.#sessionId,
        setSessionId: (id) => {
          this.#sessionId = id
        },
        setState: (state, version) => {
          this.#state = { ...state, version }
          this.#lastVersion = version
          this.#sessionId = state.sessionId
        },
        emit: (emission) => this.#enqueue(emission),
        onReconnected: () => this.#onSseReconnected?.(),
        resetReadMark: () => {
          this.#lastReadMessageId = null
          this.#lastReadSegmentIndex = 0
        },
        advanceWaterMark: (patch) => this.#advanceWaterMark(patch),
      },
      this.#sleep,
    )

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

  get history(): HistorySync {
    return this.#history
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
   * A closed view cannot reopen its patch stream. Create a new instance to attach again.
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
    await openRemoteSession({
      history: this.#history,
      reader: this.#reader,
      applyOpening: (opening) => {
        this.#state = opening.state
        this.#sessionId = opening.state.sessionId
        this.#lastVersion = opening.state.version
      },
      emit: (p, u, t) => this.#emit(p, u, t),
      agentId: this.#agentId,
      lifetime: this.#lifetime.signal,
      agentMetadataOptions: this.#agentMetadataOptions,
    })
  }

  async close(): Promise<void> {
    this.#lifetime.abort()
    await closeRemoteSession(this, {
      state: this.#state,
      setState: (s) => {
        this.#state = s
      },
      respond: this.respond.bind(this),
      history: this.#history,
      reader: this.#reader,
      pipe: this.#pipe,
      patchesCtrl: this.#patchesCtrl,
    })
  }

  #enqueue(emission: ViewEmission): void {
    enqueueEmission(this.#patchesCtrl, emission)
  }

  #emit(patches: Patch[], updates: unknown[] = [], terminal?: ViewTerminal): void {
    emitView(this.#patchesCtrl, patches, updates, terminal)
  }

  #advanceWaterMark(patch: Patch): void {
    const mark = advanceReadWaterMark(this.#state, patch)
    if (!mark) return
    this.#lastReadMessageId = mark.messageId
    this.#lastReadSegmentIndex = mark.segmentIndex
  }

  #rpcDeps(): RemoteSessionRpcDeps {
    return {
      pipe: this.#pipe,
      getState: () => this.#state,
      setState: (state) => {
        this.#state = state
      },
      getSessionId: () => this.#sessionId,
      setSessionId: (id) => {
        this.#sessionId = id
      },
      getSessionCapabilities: () => this.#sessionCapabilities,
      setSessionCapabilities: (caps) => {
        this.#sessionCapabilities = caps
      },
    }
  }

  newSession = (cwd?: string) => remoteNewSession(this.#rpcDeps(), cwd)
  loadSession = (sessionId: string, cwd?: string) => remoteLoadSession(this.#rpcDeps(), sessionId, cwd)
  listSessions = () => remoteListSessions(this.#rpcDeps())
  get supportsSessionDelete(): boolean {
    return remoteSupportsSessionDelete(this.#rpcDeps())
  }
  deleteSession = (sessionId: string) => remoteDeleteSession(this.#rpcDeps(), sessionId)
  prompt = (content: string | PromptBlocks, meta?: Record<string, unknown>) =>
    remotePrompt(this.#rpcDeps(), content, meta)
  cancel = () => remoteCancel(this.#rpcDeps())
  setMode = (mode: string) => remoteSetMode(this.#rpcDeps(), mode)
  setConfigOption = (key: string, value: unknown) => remoteSetConfigOption(this.#rpcDeps(), key, value)
  setSessionModel = (model: string) => remoteSetSessionModel(this.#rpcDeps(), model)
  extMethod = (method: string, params: unknown) => remoteExtMethod(this.#rpcDeps(), method, params)
  respond = (requestId: number, result: unknown) => remoteRespond(this.#rpcDeps(), requestId, result)
}

// ─── Re-export for convenience ───
export type { SessionView } from "./session-view.js"

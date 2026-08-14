/**
 * session-host.ts — SessionHost (C2) + createSessionHostFromConnection (C4).
 *
 * ACP client wrapper that holds SessionState and runs reduce on every
 * session/update notification. Exposes:
 *   - state: SessionState  (readonly, replaced on each update — immutable)
 *   - patches: ReadableStream<Patch>  (broadcast channel — S4 will consume)
 *   - prompt(sessionId, content, meta?)  — synthesizes user message before client.prompt
 *   - newSession / loadSession / cancel  — delegate to AcpClient
 *
 * C2: createSessionHost — takes `createClient` factory (injectable for tests).
 *
 * C4: createSessionHostFromConnection — takes a ProviderConnection and wires:
 *   - InProcessAcpTransport (conn.wire + conn.onCrash)
 *   - AcpClient with PendingRequests for permission + elicitation
 *   - Extended SessionHost API: respondPermission / respondElicitation
 *
 * ─── slice session-host-core C2+C4 (TDD + integration) ───
 * ─── slice session-host-pending-surface C2+C3+C4 (TDD + integration) ───
 * ─── slice session-host-pending-surface hotfix: waiting-before-add-message order ───
 * ─── slice remote-session-mgmt C1+C2 (TDD): list/delete passthrough, loadSession as switch ───
 */

import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import type { Patch, SessionConfigOption, SessionState } from "@drive-coding/core/session"
import {
  applyPatch,
  applyPendingRequest,
  applyTurnEnd,
  applyTurnStart,
  applyUserMessage,
  clearPendingRequest,
  createInitialSessionState,
  reduce,
  synthesizeUserMessage,
} from "@drive-coding/core/session"
import type { AcpClient, AcpClientCallbacks, AcpClientOptions } from "@drive-coding/provider/client"
import { createAcpClient } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { createInProcessAcpTransport } from "./in-process-acp-transport.js"
import { createPendingRequests } from "./pending-requests.js"

// ─── C2: createSessionHost ───────────────────────────────────────────────────

export type SessionHostDeps = {
  /**
   * Factory for creating AcpClient — injectable for tests.
   * In production: (cb) => createAcpClient(transport, cb)
   * In tests: captures cb, returns mock client
   */
  createClient(callbacks: AcpClientCallbacks): Promise<AcpClient>
}

export type SessionHost = {
  /** Current SessionState — replaced (not mutated) on each update. */
  readonly state: SessionState

  /**
   * ReadableStream of patches produced by reduce + prompt synthesis.
   * S4 will tee this into SSE fan-out. Each patch carries a version number.
   * Note: a ReadableStream can only be read once; in S4 it will be tee()'d.
   */
  readonly patches: ReadableStream<Patch>

  /**
   * prompt — synthesizes a user message (synthesizeUserMessage + applyUserMessage),
   * emits the add-message patch, then forwards to client.prompt.
   * meta is opaque (passthrough §9); stored in message.meta.
   */
  prompt(sessionId: string, content: string, meta?: Record<string, unknown>): Promise<void>

  /** Delegates to AcpClient.newSession */
  newSession(opts: { cwd: string; _meta?: Record<string, unknown> }): Promise<{ sessionId: string }>

  /** Delegates to AcpClient.loadSession */
  loadSession(opts: {
    cwd: string
    sessionId: string
    _meta?: Record<string, unknown>
  }): Promise<{ sessionId: string }>

  /** Delegates to AcpClient.cancel */
  cancel(sessionId: string): Promise<void>

  /**
   * slice handoff-foundations C1: dispose — release all host-side resources.
   * Idempotent. After dispose:
   *   - the host is marked closed (all I/O rejected)
   *   - host.patches stream is terminated (done=true on next read)
   *   - transport crash subscriptions are removed (ExtendedSessionHost only)
   * Does NOT touch conn/child/connectionRegistry — the agent stays alive.
   */
  dispose(): Promise<void>
}

/**
 * createSessionHost — constructs a SessionHost.
 * Calls deps.createClient with the internal update callback (AcpClientCallbacks).
 * Returns after the client is ready (createClient has resolved).
 */
export async function createSessionHost(deps: SessionHostDeps): Promise<SessionHost> {
  // Internal mutable state (replaced on each update — immutable pattern)
  let currentState: SessionState = createInitialSessionState({ sessionId: null })

  // slice handoff-foundations C1: disposed flag — once set, all I/O is rejected.
  let disposed = false

  // Patches stream
  let patchController: ReadableStreamDefaultController<Patch> | null = null

  const patchStream = new ReadableStream<Patch>({
    start(controller) {
      patchController = controller
    },
    cancel() {
      patchController = null
    },
  })

  function emitPatches(patches: Patch[]): void {
    if (!patchController) return
    for (const p of patches) {
      try {
        patchController.enqueue(p)
      } catch {
        // controller closed — ignore
      }
    }
  }

  function handleUpdate(notification: SessionNotification): void {
    if (disposed) return // slice handoff-foundations C1: no updates after dispose
    const result = reduce(currentState, notification.update)
    currentState = result.state
    emitPatches(result.patches)
  }

  const callbacks: AcpClientCallbacks = {
    onUpdate: handleUpdate,
  }

  const client = await deps.createClient(callbacks)

  async function dispose(): Promise<void> {
    if (disposed) return // idempotent
    disposed = true
    // Terminate the patches stream — readers get done=true.
    if (patchController) {
      try {
        patchController.close()
      } catch {
        // already closed
      }
      patchController = null
    }
  }

  return {
    get state(): SessionState {
      return currentState
    },

    patches: patchStream,

    dispose,

    async prompt(
      sessionId: string,
      content: string,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      const msg = synthesizeUserMessage(currentState, content, meta)
      const result = applyUserMessage(currentState, msg)
      currentState = result.state
      emitPatches(result.patches)
      await client.prompt(sessionId, content)
    },

    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> }) {
      if (disposed) throw new Error("SessionHost disposed")
      return client.newSession(opts) as Promise<{ sessionId: string }>
    },

    async loadSession(opts: { cwd: string; sessionId: string; _meta?: Record<string, unknown> }) {
      if (disposed) throw new Error("SessionHost disposed")
      return client.loadSession(opts) as Promise<{ sessionId: string }>
    },
    async cancel(sessionId: string) {
      if (disposed) throw new Error("SessionHost disposed")
      await client.cancel(sessionId)
    },
  }
}

// ─── C4: createSessionHostFromConnection ─────────────────────────────────────

/** Default timeout for permission/elicitation requests (30 seconds) */
const DEFAULT_PERMISSION_TIMEOUT_MS = 30_000

/** Default timeout for elicitation requests */
const DEFAULT_ELICITATION_TIMEOUT_MS = 30_000

export type SessionHostFromConnOptions = {
  /** ACP initialize timeout (passed to createAcpClient). */
  initTimeoutMs?: number
  /** Timeout for requestPermission before auto-deny. Default: 30s */
  permissionTimeoutMs?: number
  /** Timeout for elicitation before auto-cancel. Default: 30s */
  elicitationTimeoutMs?: number
  /**
   * For testing: override createAcpClient.
   * In production: omit to use the real createAcpClient.
   */
  _createAcpClient?: (
    transport: AcpTransport,
    callbacks: AcpClientCallbacks,
    opts?: AcpClientOptions,
  ) => Promise<AcpClient>
}

/**
 * ExtendedSessionHost — SessionHost + methods for responding to pending agent requests
 * and for driving session configuration.
 * S4 exposes these via HTTP endpoints.
 */
export type ExtendedSessionHost = Omit<SessionHost, "loadSession"> & {
  /**
   * slice remote-session-mgmt C2: loadSession as a SWITCH (not a bare delegate).
   * Order: turnSeq++ → pending cleanup → full-state reset → sessionId flip
   * (BEFORE the await) → await client.loadSession. Success: one update-session
   * {configOptions?, turnState:"idle", lastTurnError:null}. Failure: rollback
   * sessionId ONLY + a second monotonic reset + idle + rethrow (❌ no snapshot
   * restore — versions never rewind; see C2 step 8).
   */
  loadSession(opts: {
    cwd: string
    sessionId: string
    _meta?: Record<string, unknown>
  }): Promise<{ sessionId: string; version: number }>
  /**
   * Respond to a pending permission request.
   * requestId is a sequential counter (0, 1, 2...) assigned internally.
   * UI reads host.state.pending.permission.requestId to know which id to respond to.
   */
  respondPermission(requestId: number, response: RequestPermissionResponse): void

  /**
   * Respond to a pending elicitation request.
   * requestId is a sequential counter assigned internally.
   */
  respondElicitation(requestId: number, response: CreateElicitationResponse): void

  /**
   * Set the session mode (e.g. "auto", "compact").
   * Requires an active session — throws if currentState.sessionId is null.
   * S4: exposed via POST /api/agents/:id/rpc {method:"setMode"}
   */
  setMode(modeId: string): Promise<void>

  /**
   * Set a session config option.
   * Requires an active session — throws if currentState.sessionId is null.
   * value: string | boolean (matches AcpClient.setSessionConfigOption)
   * S4: exposed via POST /api/agents/:id/rpc {method:"setConfigOption"}
   */
  setConfigOption(configId: string, value: string | boolean): Promise<void>

  /**
   * Call an extension method on the agent.
   * Does NOT require an active session (no sessionId guard).
   * params: Record<string, unknown> (matches AcpClient.extMethod)
   * S4: exposed via POST /api/agents/:id/rpc {method:"extMethod"}
   */
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>

  /**
   * Set the model for the active session.
   * Requires an active session — throws if currentState.sessionId is null.
   * Delegates to AcpClient.setSessionModel({sessionId, modelId}).
   * slice remote-session-view C4: exposed via POST /api/agents/:id/rpc {method:"setSessionModel"}
   */
  setSessionModel(model: string): Promise<void>

  // ─── slice remote-session-mgmt C1: session list/delete + capabilities ───

  /**
   * Passthrough to client.listSessions() — the raw ACP response ({sessions, nextCursor?}).
   * JSON-RPC errors propagate AS-IS (including code -32601) — the rpc route maps them.
   * S4: exposed via POST /api/agents/:id/rpc {method:"listSessions"}
   */
  listSessions(): Promise<Record<string, unknown>>

  /**
   * Passthrough to client.deleteSession(sessionId).
   * JSON-RPC errors propagate AS-IS (including code -32601) — the rpc route maps them.
   * S4: exposed via POST /api/agents/:id/rpc {method:"deleteSession"}
   */
  deleteSession(sessionId: string): Promise<void>

  /**
   * Raw agentCapabilities from initialize (client.capabilities) — includes
   * sessionCapabilities.delete/list (SDK types.gen.d.ts:1471/:1608). The rpc route
   * ships them in the listSessions response so the FE can gate the delete button.
   */
  readonly agentCapabilities: AcpClient["capabilities"]
}

/**
 * createSessionHostFromConnection — production factory.
 *
 * Wires:
 *   1. InProcessAcpTransport (conn.wire + conn.onCrash → AcpTransport byte-transport)
 *   2. createAcpClient with permission + elicitation callbacks backed by PendingRequests
 *   3. SessionHost (reduce + broadcast + user message synthesis)
 *
 * Returns ExtendedSessionHost with respondPermission / respondElicitation methods.
 */
export async function createSessionHostFromConnection(
  conn: ProviderConnection,
  opts: SessionHostFromConnOptions = {},
): Promise<ExtendedSessionHost> {
  const {
    initTimeoutMs,
    permissionTimeoutMs = DEFAULT_PERMISSION_TIMEOUT_MS,
    elicitationTimeoutMs = DEFAULT_ELICITATION_TIMEOUT_MS,
    _createAcpClient = createAcpClient,
  } = opts

  // Internal mutable state (same pattern as createSessionHost)
  let currentState: SessionState = createInitialSessionState({ sessionId: null })
  let patchController: ReadableStreamDefaultController<Patch> | null = null

  // slice handoff-foundations C1: disposed flag — once set, all I/O is rejected.
  let disposed = false

  const patchStream = new ReadableStream<Patch>({
    start(controller) {
      patchController = controller
    },
    cancel() {
      patchController = null
    },
  })

  function emitPatches(patches: Patch[]): void {
    if (!patchController) return
    for (const p of patches) {
      try {
        patchController.enqueue(p)
      } catch {
        // controller closed — ignore
      }
    }
  }

  function handleUpdate(notification: SessionNotification): void {
    // slice handoff-foundations C1: no updates after dispose
    if (disposed) return
    // ─── slice remote-session-mgmt C2 step 5: sessionId filter ───
    // During a switch (loadSession) the flip already points currentState at the
    // NEW session before the await, so the new session's replay passes (B===B)
    // while the outgoing session's tails are dropped (A≠B). Defensive fallbacks:
    // a notification lacking sessionId (required per SDK types.gen.d.ts:3409) or
    // a host with no session yet (currentState.sessionId===null) passes through.
    const sid = notification.sessionId as string | undefined
    if (sid !== undefined && currentState.sessionId !== null && sid !== currentState.sessionId) {
      return
    }
    const result = reduce(currentState, notification.update)
    currentState = result.state
    emitPatches(result.patches)
  }

  // ── C3: turn boundaries ─────────────────────────────────────────────────
  // turnSeq — מקודם רק ב-prompt (תור חדש). cancelledTurn — מסומן (❌ לא מקודם)
  // ע"י cancel, ומשפיע רק על מטען-השגיאה — לעולם לא על הפליטה עצמה.
  let turnSeq = 0
  let cancelledTurn = -1

  /** מיישם {state,patches} על currentState + פולט — עוזר-IO מקומי. */
  function emit(r: { state: SessionState; patches: Patch[] }): void {
    currentState = r.state
    emitPatches(r.patches)
  }

  /** אותה קדימות כמו formatAcpError ב-FE: data.details → data.message → message → String(e). */
  function msgOf(err: unknown): string {
    if (err && typeof err === "object") {
      const e = err as { message?: unknown; data?: unknown }
      if (e.data && typeof e.data === "object") {
        const data = e.data as { details?: unknown; message?: unknown }
        if (typeof data.details === "string" && data.details.length > 0) return data.details
        if (typeof data.message === "string" && data.message.length > 0) return data.message
      }
      if (typeof e.message === "string" && e.message.length > 0) return e.message
    }
    return String(err)
  }

  // ── PendingRequests for permission + elicitation ──────────────────────────
  // slice session-host-pending-surface C4: מונה requestId משותף יחיד — לא שני
  // מונים נפרדים שכל אחד מתחיל ב-0. שני ה-PendingRequests נשארים שתי מפות
  // נפרדות (kind עדיין נדרש ב-POST /reply), אבל ה-id עצמו ייחודי גלובלית
  // בתוך ה-host — זה מה שהופך את הניתוב בצד ה-FE לחד-משמעי (מלכודת ב').

  let nextRequestId = 0
  const permPending = createPendingRequests<RequestPermissionResponse>({
    timeoutMs: permissionTimeoutMs,
    defaultValue: { outcome: { outcome: "cancelled" } },
  })

  const elicitPending = createPendingRequests<CreateElicitationResponse>({
    timeoutMs: elicitationTimeoutMs,
    defaultValue: { action: "cancel" },
  })

  // ── Transport + AcpClient ─────────────────────────────────────────────────

  const transport = createInProcessAcpTransport({
    wire: conn.wire,
    onCrash: conn.onCrash.bind(conn),
  })

  const clientOpts: AcpClientOptions = {}
  if (initTimeoutMs !== undefined) {
    clientOpts.initTimeoutMs = initTimeoutMs
  }

  async function handleRequestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    // slice handoff-foundations C1: reject after dispose — resolving would make
    // the SDK write a response to the wire.
    if (disposed) return { outcome: { outcome: "cancelled" } }
    // slice remote-session-mgmt C2 step 5 (one-line guard): a permission from the
    // outgoing session during a switch is answered with the existing default
    // (cancelled) — skips nextRequestId++, never enters pending (consistent w/ step 2).
    if (currentState.sessionId !== null && params.sessionId !== currentState.sessionId) {
      return { outcome: { outcome: "cancelled" } }
    }
    const requestId = nextRequestId++
    const applied = applyPendingRequest(currentState, {
      kind: "permission",
      value: { requestId, params },
    })
    currentState = applied.state
    emitPatches(applied.patches)
    try {
      return await permPending.request(requestId)
    } finally {
      const cleared = clearPendingRequest(currentState, "permission", requestId)
      currentState = cleared.state
      emitPatches(cleared.patches) // [] אם כבר נדרס — no-op
    }
  }

  async function handleCreateElicitation(
    params: CreateElicitationRequest,
  ): Promise<CreateElicitationResponse> {
    // slice handoff-foundations C1: reject after dispose — resolving would make
    // the SDK write a response to the wire.
    if (disposed) return { action: "cancel" }
    // slice remote-session-mgmt C2 step 5 (guard) — mirrors handleRequestPermission.
    // CreateElicitationRequest is an SDK union: request-scoped elicitations carry
    // no sessionId → defensive fallback (pass through), same as handleUpdate.
    const elicitSessionId = (params as { sessionId?: string }).sessionId
    if (
      elicitSessionId !== undefined &&
      currentState.sessionId !== null &&
      elicitSessionId !== currentState.sessionId
    ) {
      return { action: "cancel" }
    }
    const requestId = nextRequestId++
    const applied = applyPendingRequest(currentState, {
      kind: "elicitation",
      value: { requestId, params },
    })
    currentState = applied.state
    emitPatches(applied.patches)
    try {
      return await elicitPending.request(requestId)
    } finally {
      const cleared = clearPendingRequest(currentState, "elicitation", requestId)
      currentState = cleared.state
      emitPatches(cleared.patches) // [] אם כבר נדרס — no-op
    }
  }

  const callbacks: AcpClientCallbacks = {
    onUpdate: handleUpdate,
    onRequestPermission: handleRequestPermission,
    onCreateElicitation: handleCreateElicitation,
  }

  const client = await _createAcpClient(transport, callbacks, clientOpts)

  // ── Register transport.onClose → session status disconnect ───────────────
  // When the underlying connection crashes, update state to "disconnected".
  // This ensures host.state.status reflects the connection lifecycle.
  transport.onClose((_code, _reason) => {
    if (disposed) return // slice handoff-foundations C1: no state changes after dispose
    const result = reduce(currentState, {
      sessionUpdate: "turn_end",
    })
    // Update status to disconnected regardless of reduce result
    currentState = {
      ...result.state,
      status: "disconnected" as const,
    }
  })

  // ── slice handoff-foundations C1 + ownership-handoff C1b: dispose ──────────
  // Idempotent. Resolves pending requests (cancelled) before closing transport,
  // with a tick so responses flush before close. Closes the transport (removes
  // crash subs + readable), terminates the patches stream.
  // Does NOT touch conn/child/connectionRegistry — the agent stays alive.
  async function dispose(): Promise<void> {
    if (disposed) return
    disposed = true
    // C1b: resolve all pending permission/elicitation as cancelled BEFORE closing
    // transport, so the SDK can write the cancellation response to the wire.
    permPending.respondAll({ outcome: { outcome: "cancelled" } })
    elicitPending.respondAll({ action: "cancel" })
    // Tick: let the resolved promises' .then() callbacks flush their wire writes
    // before transport.close() tears down the writable side.
    await new Promise<void>((r) => setTimeout(r, 0))
    transport.close()
    // Terminate the patches stream — readers get done=true.
    if (patchController) {
      try {
        patchController.close()
      } catch {
        // already closed
      }
      patchController = null
    }
  }

  // ── ExtendedSessionHost ───────────────────────────────────────────────────

  return {
    get state(): SessionState {
      return currentState
    },

    patches: patchStream,

    dispose,
    // ── C3: turn boundaries — mirrors LocalSessionView.prompt/cancel (waiting
    // לפני ה-await, idle בשני הענפים), עם סטייה אחת מוצהרת: שתי הפליטות (הצלחה
    // וגם cancel) מגודרות ב-`turn === turnSeq` — "התור שלי עדיין הנוכחי". ─────
    //
    // ⚠️ hotfix (אחרי C4, avigail): הסדר הוא waiting **לפני** add-message —
    // ההפך מהניסוח המקורי של "מלכודת ג'" ("הסדר הזה בטוח", לא "הכרחי"). הסיבה
    // לא הייתה מספר-ה-patches (שניהם עדיין שני emit נפרדים — ReadableStream לא
    // מאחד enqueue-ים סמוכים לקריאה אחת, אין "batch" אמיתי על ה-wire) אלא
    // **הערך שנצפה ביניהם**: ה-FE מסנכרן turnState פר-patch. בסדר הישן
    // (add-message ואז waiting) הסנכרון הראשון קורא turnState שעדיין `idle`,
    // ורק הסנכרון השני (אחרי ה-patch השני) מעלה אותו ל-`waiting` — הבהוב
    // `waiting → idle → waiting` שמצית flush מזויף של סוף-תור ב-Speaker
    // וצליל-חשיבה כפול. בסדר החדש שני הסנכרונים רואים `waiting`:
    // apply-patch.ts's add-message branch גוזר turnState מ-role, ול-role:"user"
    // (תמיד המקרה כאן) הוא **משמר** את הערך הקיים — כלומר add-message שמגיע
    // *אחרי* waiting לא דורס אותו. אותה עובדה בדיוק (role=user = no-op)
    // שהפכה את הסדר הישן ל"בטוח" הופכת את הסדר החדש ל"מתקן".
    async prompt(
      sessionId: string,
      content: string,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      const turn = ++turnSeq
      emit(applyTurnStart(currentState)) // 1. waiting — לפני ה-await, ולפני add-message (hotfix)
      const msg = synthesizeUserMessage(currentState, content, meta)
      const applied = applyUserMessage(currentState, msg)
      currentState = applied.state
      emitPatches(applied.patches) // 2. add-message — role="user" משמר waiting (מלכודת ג')
      try {
        await client.prompt(sessionId, content)
        if (turn === turnSeq) emit(applyTurnEnd(currentState)) // 3א. הצלחה
      } catch (err) {
        if (turn === turnSeq) {
          // cancelledTurn הוא סימון בלבד: משפיע רק על מטען-השגיאה, לעולם לא
          // על הפליטה (הגדר כבר לעיל היא turn === turnSeq, ובה בלבד).
          const error = turn === cancelledTurn ? undefined : { message: msgOf(err), at: Date.now() }
          emit(applyTurnEnd(currentState, error)) // 3ב.
        }
        throw err // rethrow — הקורא הישיר עדיין רואה את השגיאה
      }
    },

    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> }) {
      if (disposed) throw new Error("SessionHost disposed")
      const result = (await client.newSession(opts)) as { sessionId: string; configOptions?: unknown[] }
      // Update currentState.sessionId so setMode/setConfigOption can use it
      // Also capture configOptions from session/new response (capabilities.ts:17)
      const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
      currentState = { ...currentState, sessionId: result.sessionId, configOptions }
      if (configOptions.length > 0) {
        emitPatches([{
          version: currentState.version + 1,
          op: "update-session",
          changes: { configOptions },
        }])
        currentState = { ...currentState, version: currentState.version + 1 }
      }
      return result
    },

    // ─── slice remote-session-mgmt C2: loadSession as a SWITCH ───
    // Mandatory order (brief C2):
    //  1. turnSeq++ + cancelledTurn=-1 — cancels every open turn of the outgoing
    //     session: turnSeq advances only in prompt, so a stale turn ending AFTER
    //     the switch would otherwise land applyTurnEnd/lastTurnError on the new
    //     session (the `turn === turnSeq` guard alone does not protect).
    //  2. Pending cleanup — open permission/elicitation answered with their
    //     cancelled defaults (respond resolves the promise + clears the timer;
    //     clearPendingRequest inside the handler's finally clears the state and
    //     emits the clear patch, legitimately BEFORE the reset).
    //  3. Reset on the full state via pure core applyPatch + emit (❌ no manual
    //     version bump — applyPatch owns it).
    //  4. Flip sessionId BEFORE the await — otherwise the step-5 filter would
    //     drop the new session's replay (arriving during the await; streamHistory
    //     runs inside the CLI's loadSession handler) and let in old-session tails.
    //  5. (sessionId filter in handleUpdate + guards in the permission/elicitation
    //     handlers — see above.)
    //  6. await client.loadSession.
    //  7. Success: capture configOptions + ONE update-session
    //     {configOptions?, turnState:"idle", lastTurnError:null} — idle because
    //     the replay ends in an assistant message (derives "responding");
    //     lastTurnError:null because reset does not clear it and the outgoing
    //     session's "prompt failed" banner must not survive. ❌ sessionId is NOT
    //     re-written from the response — the flip (4) and the rollback (8) are
    //     the ONLY sessionId writes (overlapping switches could otherwise revert).
    //  8. Failure: rollback sessionId ONLY. ❌ NO snapshot restore — it would
    //     rewind the version counter and every future patch would be dropped at
    //     the FE watermark (remote-session-view.ts #applyIncoming). Instead: a
    //     SECOND reset at a continuing version (monotonic — passes the watermark
    //     and realigns the FE, which already got part of the replay, with the
    //     empty host) + turnState:"idle" + rethrow (route → 502 → VM error).
    //     Documented edge: the rendered history is gone — the user picks a session
    //     again; the CLI's data is untouched.
    async loadSession(opts: {
      cwd: string
      sessionId: string
      _meta?: Record<string, unknown>
    }): Promise<{ sessionId: string; version: number }> {
      if (disposed) throw new Error("SessionHost disposed")
      // 1. Invalidate turns of the outgoing session.
      turnSeq++
      cancelledTurn = -1

      // 2. Pending cleanup (cancelled defaults; the clear patches land before the
      //    reset — the one legitimate pre-reset emission).
      const openPermission = currentState.pending.permission
      const openElicitation = currentState.pending.elicitation
      if (openPermission) {
        permPending.respond(openPermission.requestId, { outcome: { outcome: "cancelled" } })
      }
      if (openElicitation) {
        elicitPending.respond(openElicitation.requestId, { action: "cancel" })
      }
      if (openPermission || openElicitation) {
        // One microtask: let the handlers' finally (clearPendingRequest + emit)
        // land before the reset so the patch order stays deterministic.
        await Promise.resolve()
      }

      // 3. Reset the full state.
      const oldSessionId = currentState.sessionId
      const resetPatch: Patch = {
        op: "reset",
        version: currentState.version + 1,
        messages: [],
        nextMessageSeq: 0,
        nextSegmentSeq: 0,
      }
      currentState = applyPatch(currentState, resetPatch)
      emitPatches([resetPatch])

      // 4. Flip sessionId BEFORE the await (see the long comment above).
      currentState = { ...currentState, sessionId: opts.sessionId }

      // 6.
      try {
        const result = (await client.loadSession(opts)) as {
          sessionId: string
          configOptions?: unknown[]
        }

        // 7. Success — one update-session patch.
        const configOptions = (
          Array.isArray(result.configOptions) ? result.configOptions : []
        ) as SessionConfigOption[]
        const updatePatch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: {
            turnState: "idle",
            lastTurnError: null,
            ...(configOptions.length > 0 ? { configOptions } : {}),
          },
        }
        currentState = applyPatch(currentState, updatePatch)
        emitPatches([updatePatch])
        return { sessionId: opts.sessionId, version: currentState.version }
      } catch (err) {
        // 8. Failure — rollback sessionId only + second monotonic reset + idle.
        currentState = { ...currentState, sessionId: oldSessionId }
        const resetPatch2: Patch = {
          op: "reset",
          version: currentState.version + 1,
          messages: [],
          nextMessageSeq: 0,
          nextSegmentSeq: 0,
        }
        currentState = applyPatch(currentState, resetPatch2)
        emitPatches([resetPatch2])
        const idlePatch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: { turnState: "idle" },
        }
        currentState = applyPatch(currentState, idlePatch)
        emitPatches([idlePatch])
        throw err
      }
    },

    async cancel(sessionId: string) {
      if (disposed) throw new Error("SessionHost disposed")
      const turn = turnSeq // מסמן, ❌ לא מקדם
      cancelledTurn = turn
      try {
        await client.cancel(sessionId)
      } catch {
        // best-effort — תואם ל-local
      }
      if (turn === turnSeq) emit(applyTurnEnd(currentState)) // אותה גדר בדיוק כמו ב-prompt
    },

    respondPermission(requestId: number, response: RequestPermissionResponse): void {
      if (disposed) return // slice handoff-foundations C1: no-op after dispose
      permPending.respond(requestId, response)
    },

    respondElicitation(requestId: number, response: CreateElicitationResponse): void {
      if (disposed) return // slice handoff-foundations C1: no-op after dispose
      elicitPending.respond(requestId, response)
    },

    async setMode(modeId: string): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionMode({ sessionId: currentState.sessionId, modeId })
    },

    async setConfigOption(configId: string, value: string | boolean): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionConfigOption({ sessionId: currentState.sessionId, configId, value })
    },

    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      if (disposed) throw new Error("SessionHost disposed")
      return client.extMethod(method, params)
    },

    async setSessionModel(model: string): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionModel({ sessionId: currentState.sessionId, modelId: model })
    },
    // ─── slice remote-session-mgmt C1: session list/delete + capabilities ───
    // Passthroughs — JSON-RPC errors (incl. code -32601) propagate AS-IS; the rpc
    // route maps them. No wrapping/absorbing here.

    async listSessions(): Promise<Record<string, unknown>> {
      if (disposed) throw new Error("SessionHost disposed")
      return (await client.listSessions()) as Record<string, unknown>
    },

    async deleteSession(sessionId: string): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      await client.deleteSession(sessionId)
    },

    get agentCapabilities(): AcpClient["capabilities"] {
      return client.capabilities
    },
  }
}

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
  NewSessionRequest,
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
import type { PermissionPolicyKind } from "@drive-coding/core/types/permission"
import { resolvePermissionPolicy } from "@drive-coding/core/types/permission"
import type {
  AcpClient,
  AcpClientCallbacks,
  AcpClientOptions,
  PromptBlocks,
} from "@drive-coding/provider/client"
import { createAcpClient, createAttachedAcpClient } from "@drive-coding/provider/client"
import type { ProviderConnection } from "@drive-coding/provider/connection"
import { parseExtResult } from "@drive-coding/provider/extensions"
import type { AcpTransport } from "@drive-coding/provider/transport"
import { createInProcessAcpTransport } from "./in-process-acp-transport.js"

type SessionMcpOpts = { mcpServers?: NewSessionRequest["mcpServers"] }
import { createTurnLifecycleHandlers, type TurnTimingHost } from "./turn-lifecycle.js"
import { msgOf } from "./error-message.js"
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
  prompt(
    sessionId: string,
    content: string | PromptBlocks,
    meta?: Record<string, unknown>,
  ): Promise<void>

  /** Delegates to AcpClient.newSession */
  newSession(opts: { cwd: string; _meta?: Record<string, unknown> } & SessionMcpOpts): Promise<{
    sessionId: string
  }>

  /** Delegates to AcpClient.loadSession */
  loadSession(opts: {
    cwd: string
    sessionId: string
    _meta?: Record<string, unknown>
  } & SessionMcpOpts): Promise<{ sessionId: string }>

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

  function handleExtNotification(method: string, params: Record<string, unknown>): void {
    if (disposed) return
    const result = reduce(currentState, {
      sessionUpdate: "_drive/ext_notification",
      method,
      params,
    })
    currentState = result.state
    emitPatches(result.patches)
  }

  const callbacks: AcpClientCallbacks = {
    onUpdate: handleUpdate,
    onExtNotification: handleExtNotification,
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
      content: string | PromptBlocks,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      const msg = synthesizeUserMessage(currentState, content, meta)
      const result = applyUserMessage(currentState, msg)
      currentState = result.state
      emitPatches(result.patches)
      await client.prompt(sessionId, content)
    },

    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> } & SessionMcpOpts) {
      if (disposed) throw new Error("SessionHost disposed")
      return client.newSession({
        ...opts,
        mcpServers: opts.mcpServers ?? [],
      }) as Promise<{ sessionId: string }>
    },

    async loadSession(
      opts: { cwd: string; sessionId: string; _meta?: Record<string, unknown> } & SessionMcpOpts,
    ) {
      if (disposed) throw new Error("SessionHost disposed")
      return client.loadSession({
        ...opts,
        mcpServers: opts.mcpServers ?? [],
      }) as Promise<{ sessionId: string }>
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
   * slice session-create-contract: auto-resolve permission by ACP option kind
   * before entering pending. "ask" / absent = today's behavior (pending).
   */
  permissionPolicy?: PermissionPolicyKind
  /**
   * slice session-lifecycle-fields C1: when true, first clean turn end schedules
   * onScheduleCloseOnTurnEnd (after emit, via grace timer in server.ts).
   */
  closeOnTurnEnd?: boolean
  /** Called once after the first eligible turn end — server wires deleteAndKill. */
  onScheduleCloseOnTurnEnd?: () => void
  /**
   * slice be-events-subscribe C1: called after applyTurnEnd when patches.length > 0.
   * Always wired for every host — independent of closeOnTurnEnd / notifyOnDone.
   */
  onTurnEnded?: (info: import("./agent-events-turn.js").TurnEndedInfo) => void
  /**
   * slice ownership-handoff C4: warm reattach — agent already initialized.
   * Uses createAttachedAcpClient (skips initialize) + loadSession (restores state).
   * Omit for cold start (normal path: createAcpClient + newSession).
   */
  warmReattach?: { acpSessionId: string; cwd: string }
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
export type ExtendedSessionHost = Omit<SessionHost, "loadSession"> &
  TurnTimingHost & {
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
  } & SessionMcpOpts): Promise<{ sessionId: string; version: number }>
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
   * S4: exposed via POST /api/agents/:id/rpc {method:"session/set_mode"}
   */
  setMode(modeId: string): Promise<void>

  /**
   * Set a session config option.
   * Requires an active session — throws if currentState.sessionId is null.
   * value: string | boolean (matches AcpClient.setSessionConfigOption)
   * S4: exposed via POST /api/agents/:id/rpc {method:"session/set_config_option"}
   */
  setConfigOption(configId: string, value: string | boolean): Promise<void>

  /**
   * Call an extension method on the agent.
   * Does NOT require an active session (no sessionId guard).
   * params: Record<string, unknown> (matches AcpClient.extMethod)
   * S4: exposed via POST /api/agents/:id/rpc {method:"_drive/ext"}
   */
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>

  /**
   * Set the model for the active session.
   * Requires an active session — throws if currentState.sessionId is null.
   * Delegates to AcpClient.setSessionModel({sessionId, modelId}).
   * slice remote-session-view C4: exposed via POST /api/agents/:id/rpc {method:"_drive/set_session_model"}
   */
  setSessionModel(model: string): Promise<void>

  // ─── slice remote-session-mgmt C1: session list/delete + capabilities ───

  /**
   * Passthrough to client.listSessions() — the raw ACP response ({sessions, nextCursor?}).
   * JSON-RPC errors propagate AS-IS (including code -32601) — the rpc route maps them.
   * S4: exposed via POST /api/agents/:id/rpc {method:"session/list"}
   */
  listSessions(): Promise<Record<string, unknown>>

  /**
   * Passthrough to client.deleteSession(sessionId).
   * JSON-RPC errors propagate AS-IS (including code -32601) — the rpc route maps them.
   * S4: exposed via POST /api/agents/:id/rpc {method:"session/delete"}
   */
  deleteSession(sessionId: string): Promise<void>

  /**
   * Raw agentCapabilities from initialize (client.capabilities) — includes
   * sessionCapabilities.delete/list (SDK types.gen.d.ts:1471/:1608). The rpc route
   * ships them in the listSessions response so the FE can gate the delete button.
   */
  readonly agentCapabilities: AcpClient["capabilities"]
  emitExtNotification(method: string, params: Record<string, unknown>): void
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
    permissionPolicy,
    closeOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
    warmReattach,
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

  function handleExtNotification(method: string, params: Record<string, unknown>): void {
    if (disposed) return
    const result = reduce(currentState, {
      sessionUpdate: "_drive/ext_notification",
      method,
      params,
    })
    currentState = result.state
    emitPatches(result.patches)
  }

  /** מיישם {state,patches} על currentState + פולט — עוזר-IO מקומי. */
  function emit(r: { state: SessionState; patches: Patch[] }): void {
    currentState = r.state
    emitPatches(r.patches)
  }

  // ── C3: turn boundaries ─────────────────────────────────────────────────
  const { turn: turnLifecycle, emitTurnEnd, maybeScheduleCloseOnTurnEnd, stampTurnStart, turnHostMethods } =
    createTurnLifecycleHandlers({
      getState: () => currentState,
      emit,
      closeOnTurnEnd,
      onScheduleCloseOnTurnEnd,
      onTurnEnded,
      disposed: () => disposed,
    })

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

  // ── slice http-state-gaps C3: quota via state channel ───────────────────────
  // generation counter: incremented on every session start; used to discard
  // quota responses that arrive after a session switch or dispose.
  let quotaGeneration = 0
  // dedupe: the generation of the fetch currently IN FLIGHT. -1 = none in flight.
  // ⚠️ Cleared when the call settles — otherwise this degrades into "once per
  // generation" and suppresses every later refresh of the same session
  // (calev finding 8).
  let quotaFetchGeneration = -1
  // timeout: abort getQuota if the CLI does not respond within this window.
  const QUOTA_FETCH_TIMEOUT_MS = 5_000

  /** Non-blocking quota fetch after session start/load (slice http-state-gaps C3). */
  function startQuotaFetch(sessionId: string): void {
    // condition 4: dedupe — one in-flight call per generation.
    // ⚠️ Must be scoped to the CURRENT generation. A plain boolean starves the
    // next session: switch A→B while A's fetch hangs, and B's fetch is skipped
    // entirely — B never gets quota, because A's late answer is then discarded
    // by the guard-generation. Dedupe suppresses duplicates WITHIN a session;
    // it must never suppress a different session.
    if (quotaFetchGeneration === quotaGeneration) return
    quotaFetchGeneration = quotaGeneration
    // condition: only when capabilities.usage === true.
    // conn.capabilities is NormalizedCapabilities (has `usage`); client.capabilities
    // is the raw ACP AgentCapabilities and has no such field — reading it there is
    // a type error and would always be undefined.
    if (!conn.capabilities?.usage) return
    const gen = quotaGeneration
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("getQuota timeout")), QUOTA_FETCH_TIMEOUT_MS),
    )
    const fetchPromise = client.extMethod("_drive/getQuota", { sessionId })
    Promise.race([fetchPromise, timeoutPromise])
      .then((raw) => {
        // condition 5: validate { snapshot } shape
        const validated = parseExtResult("_drive/getQuota", raw)
        // condition 3: guard-gen — discard if session changed or disposed
        if (disposed || quotaGeneration !== gen) return
        const patch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: { quota: validated.snapshot },
        }
        currentState = applyPatch(currentState, patch)
        emitPatches([patch])
      })
      .catch(() => {
        // error or timeout — session survives, quota unchanged (condition 1)
      })
      .finally(() => {
        // release the in-flight slot only if no newer generation claimed it
        if (quotaFetchGeneration === gen) quotaFetchGeneration = -1
      })
  }

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
    // slice session-create-contract C1: third guard — policy auto-resolve before pending.
    const autoResponse = resolvePermissionPolicy(permissionPolicy, params)
    if (autoResponse !== null) {
      return autoResponse
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
    onExtNotification: handleExtNotification,
  }

  // slice ownership-handoff C4: warm reattach skips initialize (agent already running)
  const client: AcpClient = warmReattach
    ? createAttachedAcpClient(transport, callbacks)
    : await _createAcpClient(transport, callbacks, clientOpts)

  // ── slice http-usable C1: capabilities → SessionState ────────────────────
  // 🔴 חייב להיות **אחרי** יצירת ה-client: תגובת ה-initialize מחליפה את אובייקט
  // היכולות (provider/connection/spawn.ts). העתקה מוקדמת שומרת ערך שקרי.
  // למה בכלל: ב-remote אין #client ב-FE, ו-_drive/capabilities נשלח רק מ-ws-agent,
  // ולכן supportsImageInput היה false תמיד ב-HTTP. ה-snapshot נושא את זה.
  if (conn.capabilities) {
    currentState = { ...currentState, capabilities: conn.capabilities }
  }

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

  // ─── session switch preamble (shared by newSession + loadSession) ───
  //  1. turnSeq++ + cancelledTurn=-1 — invalidate outgoing turns.
  //  2. Pending cleanup — cancelled defaults before reset.
  //  3. Reset via applyPatch + emit (❌ no manual version bump).
  // ⚠️ Steps 1+3 MUST stay synchronous with the caller's sessionId flip when
  // there is no pending — `await` of a helper always yields one microtask and
  // would let old-session tails / permissions land before the flip (C2 tests).
  // Failure path (rollbackSessionSwitch): sessionId only + second monotonic
  // reset + idle — ❌ no snapshot restore (versions never rewind).
  function beginSessionSwitchInvalidate(): void {
    turnLifecycle.turnSeq++
    turnLifecycle.cancelledTurn = -1
    quotaGeneration++
  }

  /** Returns true if a microtask flush is required before reset. */
  function cancelOpenPendingSync(): boolean {
    const openPermission = currentState.pending.permission
    const openElicitation = currentState.pending.elicitation
    if (openPermission) {
      permPending.respond(openPermission.requestId, { outcome: { outcome: "cancelled" } })
    }
    if (openElicitation) {
      elicitPending.respond(openElicitation.requestId, { action: "cancel" })
    }
    return Boolean(openPermission || openElicitation)
  }

  function emitSessionSwitchReset(): {
    oldSessionId: string | null
    preResetConfigOptions: SessionConfigOption[]
  } {
    const oldSessionId = currentState.sessionId
    const preResetConfigOptions = currentState.configOptions
    const resetPatch: Patch = {
      op: "reset",
      version: currentState.version + 1,
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    }
    currentState = applyPatch(currentState, resetPatch)
    emitPatches([resetPatch])
    return { oldSessionId, preResetConfigOptions }
  }

  function rollbackSessionSwitch(oldSessionId: string | null): void {
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
  }

  // ── ExtendedSessionHost ───────────────────────────────────────────────────

  return {
    get state(): SessionState {
      return currentState
    },

    patches: patchStream,

    dispose,
    // C3 turn boundaries — waiting before add-message (hotfix: avoids idle flash in FE).
    async prompt(
      sessionId: string,
      content: string | PromptBlocks,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      if (disposed) throw new Error("SessionHost disposed")
      const turn = ++turnLifecycle.turnSeq
      stampTurnStart()
      emit(applyTurnStart(currentState)) // 1. waiting — לפני ה-await, ולפני add-message (hotfix)
      const msg = synthesizeUserMessage(currentState, content, meta)
      const applied = applyUserMessage(currentState, msg)
      currentState = applied.state
      emitPatches(applied.patches) // 2. add-message — role="user" משמר waiting (מלכודת ג')
      try {
        await client.prompt(sessionId, content)
        if (turn === turnLifecycle.turnSeq) {
          emitTurnEnd(applyTurnEnd(currentState), { stopReason: "end_turn" }) // 3א. הצלחה
          maybeScheduleCloseOnTurnEnd()
          // slice http-state-gaps C3: refresh quota at turn end — the brief asked for
          // it and it was missing (calev finding 7). A turn is exactly when usage
          // changes. Non-blocking, and guarded by the same generation/in-flight rules.
          if (currentState.sessionId) startQuotaFetch(currentState.sessionId)
        }
      } catch (err) {
        if (turn === turnLifecycle.turnSeq) {
          const error =
            turn === turnLifecycle.cancelledTurn
              ? undefined
              : { message: msgOf(err), at: Date.now() }
          emitTurnEnd(applyTurnEnd(currentState, error), {
            stopReason: error?.message,
            lastTurnError: error ?? null,
          }) // 3ב. שגיאה — אין closeOnTurnEnd (הסוכן נשאר כראיה)
        }
        throw err // rethrow — הקורא הישיר עדיין רואה את השגיאה
      }
    },

    /**
     * Cold create (no prior sessionId): thin path — ACP session/new + optional
     * configOptions patch (registry getOrCreateHost). Warm (already had a
     * session): switch preamble like loadSession so HTTP "new session" clears
     * transcript; sessionId parked on a sentinel until the CLI returns the id.
     */
    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> } & SessionMcpOpts) {
      if (disposed) throw new Error("SessionHost disposed")
      const hadSession = currentState.sessionId !== null
      const sessionOpts = { ...opts, mcpServers: opts.mcpServers ?? [] }

      if (!hadSession) {
        const result = (await client.newSession(sessionOpts)) as {
          sessionId: string
          configOptions?: SessionConfigOption[]
        }
        const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
        currentState = { ...currentState, sessionId: result.sessionId, configOptions }
        if (configOptions.length > 0) {
          const updatePatch: Patch = {
            op: "update-session",
            version: currentState.version + 1,
            changes: { configOptions },
          }
          currentState = applyPatch(currentState, updatePatch)
          emitPatches([updatePatch])
        }
        quotaGeneration++
        startQuotaFetch(result.sessionId)
        return result
      }

      beginSessionSwitchInvalidate()
      if (cancelOpenPendingSync()) {
        // One microtask: let handlers' finally (clearPendingRequest + emit) land
        // before the reset. ❌ Do not await when there is no pending — that would
        // yield and let old-session tails land before the sessionId flip.
        await Promise.resolve()
      }
      const { oldSessionId } = emitSessionSwitchReset()
      // Sentinel ≠ any real ACP sessionId → handleUpdate drops outgoing tails.
      // null would pass the filter (host-with-no-session pass-through) and re-fill.
      currentState = { ...currentState, sessionId: "__drive_switching__" }

      try {
        const result = (await client.newSession(sessionOpts)) as {
          sessionId: string
          configOptions?: SessionConfigOption[]
        }
        const configOptions = Array.isArray(result.configOptions) ? result.configOptions : []
        currentState = { ...currentState, sessionId: result.sessionId, configOptions }
        const updatePatch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: {
            turnState: "idle",
            lastTurnError: null,
            quota: null,
            title: "",
            ...(configOptions.length > 0 ? { configOptions } : {}),
          },
        }
        currentState = applyPatch(currentState, updatePatch)
        emitPatches([updatePatch])
        startQuotaFetch(result.sessionId)
        return result
      } catch (err) {
        rollbackSessionSwitch(oldSessionId)
        throw err
      }
    },

    // ─── slice remote-session-mgmt C2: loadSession as a SWITCH ───
    // Mandatory order (brief C2): prepareSessionSwitch (1–3) → flip sessionId
    // BEFORE await (4) → await client.loadSession (6) → success update-session
    // (7) / rollbackSessionSwitch (8). See prepareSessionSwitch comment above.
    async loadSession(opts: {
      cwd: string
      sessionId: string
      _meta?: Record<string, unknown>
    } & SessionMcpOpts): Promise<{ sessionId: string; version: number }> {
      if (disposed) throw new Error("SessionHost disposed")
      beginSessionSwitchInvalidate()
      if (cancelOpenPendingSync()) {
        await Promise.resolve()
      }
      const { oldSessionId, preResetConfigOptions } = emitSessionSwitchReset()

      // 4. Flip sessionId BEFORE the await — otherwise the step-5 filter would
      //    drop the new session's replay (arriving during the await; streamHistory
      //    runs inside the CLI's loadSession handler) and let in old-session tails.
      currentState = { ...currentState, sessionId: opts.sessionId }

      // 6.
      try {
        const result = (await client.loadSession({
          ...opts,
          mcpServers: opts.mcpServers ?? [],
        })) as {
          sessionId: string
          configOptions?: unknown[]
        }

        // 7. Success — one update-session patch.
        // slice http-state-gaps C2: same session → existing wins (last C1-recorded value
        // is more recent than stale load response); different session → load wins + quota reset.
        const loadedConfigOptions = (
          Array.isArray(result.configOptions) ? result.configOptions : []
        ) as SessionConfigOption[]
        const isSameSession = opts.sessionId === oldSessionId
        const mergedConfigOptions = isSameSession
          ? loadedConfigOptions.map((opt) => {
              const existing = preResetConfigOptions.find((e) => e.id === opt.id)
              return existing !== undefined ? existing : opt
            })
          : loadedConfigOptions
        const baseChanges = {
          turnState: "idle" as const,
          lastTurnError: null,
          ...(mergedConfigOptions.length > 0 ? { configOptions: mergedConfigOptions } : {}),
        }
        const updatePatch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: isSameSession ? baseChanges : { ...baseChanges, quota: null },
        }
        currentState = applyPatch(currentState, updatePatch)
        emitPatches([updatePatch])
        // slice http-state-gaps C3: the generation already advanced at entry (above).
        startQuotaFetch(opts.sessionId)
        return { sessionId: opts.sessionId, version: currentState.version }
      } catch (err) {
        // 8. Failure — rollback sessionId only + second monotonic reset + idle.
        rollbackSessionSwitch(oldSessionId)
        throw err
      }
    },

    async cancel(sessionId: string) {
      if (disposed) throw new Error("SessionHost disposed")
      const turn = turnLifecycle.turnSeq // מסמן, ❌ לא מקדם
      turnLifecycle.cancelledTurn = turn
      try {
        await client.cancel(sessionId)
      } catch {
        // best-effort — תואם ל-local
      }
      if (turn === turnLifecycle.turnSeq) {
        emitTurnEnd(applyTurnEnd(currentState), { stopReason: "cancelled" }) // אותה גדר בדיוק כמו ב-prompt
        maybeScheduleCloseOnTurnEnd()
      }
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
      // slice http-state-gaps C1: capture configOptions from CLI response (last-write-wins)
      const result = await client.setSessionConfigOption({
        sessionId: currentState.sessionId,
        configId,
        value,
      })
      const configOptions = Array.isArray(result?.configOptions)
        ? (result.configOptions as SessionConfigOption[])
        : null
      if (configOptions !== null) {
        const patch: Patch = {
          op: "update-session",
          version: currentState.version + 1,
          changes: { configOptions },
        }
        currentState = applyPatch(currentState, patch)
        emitPatches([patch])
      }
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

    ...{ emitExtNotification: handleExtNotification },
    ...turnHostMethods,
  }
}

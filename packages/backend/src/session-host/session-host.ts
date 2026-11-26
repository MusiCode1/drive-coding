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
import { type AcpTransport, createFromLineWire } from "@drive-coding/acp-wire"
import type {
  Patch,
  SessionListQuery,
  SessionState,
  ToolOutputRules,
} from "@drive-coding/core/session"
import {
  applyPatch,
  applyPendingRequest,
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
import { createPendingRequests } from "./pending-requests.js"
import { createPromptTurn } from "./prompt-turn.js"
import { defaultRequestTimeouts } from "./request-timeout.js"
import { createSessionHostClientActions } from "./session-host-client-actions.js"
import {
  createPatchChannel,
  createUpdateIngest,
  publishResponseModes,
} from "./session-host-ingest.js"
import { attachScopePermission, type ScopePermissionHost } from "./session-host-scope.js"
import {
  createSessionHostSwitchActions,
  type LoadSessionOptions,
  type SessionMcpOpts,
} from "./session-host-switch-actions.js"
import { createSessionSwitch } from "./session-switch.js"
import { createTurnLifecycleHandlers, type TurnTimingHost } from "./turn-lifecycle.js"

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
  loadSession(opts: LoadSessionOptions): Promise<{ sessionId: string }>

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
      return client.newSession({ ...opts, mcpServers: opts.mcpServers ?? [] }).then((result) => {
        publishResponseModes(handleUpdate, result.sessionId, result.modes)
        return result
      })
    },

    async loadSession(
      opts: { cwd: string; sessionId: string; _meta?: Record<string, unknown> } & SessionMcpOpts,
    ) {
      if (disposed) throw new Error("SessionHost disposed")
      return client.loadSession({ ...opts, mcpServers: opts.mcpServers ?? [] }).then((result) => {
        publishResponseModes(handleUpdate, opts.sessionId, result?.modes)
        return result as { sessionId: string }
      })
    },
    async cancel(sessionId: string) {
      if (disposed) throw new Error("SessionHost disposed")
      await client.cancel(sessionId)
    },
  }
}

// ─── C4: createSessionHostFromConnection ─────────────────────────────────────

export type SessionHostFromConnOptions = {
  toolOutputRules?: ToolOutputRules
  /** ACP initialize timeout (passed to createAcpClient). */
  initTimeoutMs?: number
  /** requestPermission timeout; null = none. Default: PERMISSION_TIMEOUT_MS env. */
  permissionTimeoutMs?: number | null
  /** elicitation timeout; null = none. Default: ELICITATION_TIMEOUT_MS env. */
  elicitationTimeoutMs?: number | null
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
  /** slice agent-charter C2: transform ACP prompt content (not the user bubble). */
  transformPromptForAcp?: (content: string | PromptBlocks) => string | PromptBlocks
}

/**
 * ExtendedSessionHost — SessionHost + methods for responding to pending agent requests
 * and for driving session configuration.
 * S4 exposes these via HTTP endpoints.
 */
export type ExtendedSessionHost = Omit<SessionHost, "loadSession" | "prompt"> & {
  /** True while a session switch is preparing to assign its new ID. */
  readonly isSessionSwitchPreFlip?: boolean
  prompt: ReturnType<typeof createPromptTurn>["prompt"]

  /**
   * Switch sessions, resetting and flipping the session ID before CLI replay.
   * Failure restores the previous transcript with a fresh reset and rethrows.
   * Reload of the current session requires an idle turn.
   */
  loadSession(opts: LoadSessionOptions): Promise<{ sessionId: string; version: number }>
  cancelActiveTurn: ReturnType<typeof createPromptTurn>["cancelActiveTurn"]
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
  listSessions(options?: SessionListQuery): ReturnType<AcpClient["listSessions"]>

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
  readonly sessionCapabilitiesSource?: "warm-legacy"
  emitExtNotification(method: string, params: Record<string, unknown>): void
} & TurnTimingHost &
  ScopePermissionHost

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
    permissionTimeoutMs = defaultRequestTimeouts().permission,
    elicitationTimeoutMs = defaultRequestTimeouts().elicitation,
    permissionPolicy,
    closeOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
    warmReattach,
    _createAcpClient = createAcpClient,
    transformPromptForAcp,
    toolOutputRules,
  } = opts

  // Internal mutable state (same pattern as createSessionHost)
  let currentState: SessionState = createInitialSessionState({ sessionId: null })
  const { stream: patchStream, emit: emitPatches, close: closePatches } = createPatchChannel()

  // slice handoff-foundations C1: disposed flag — once set, all I/O is rejected.
  let disposed = false

  /** מיישם {state,patches} על currentState + פולט — עוזר-IO מקומי. */
  function emit(r: { state: SessionState; patches: Patch[] }): void {
    currentState = r.state
    emitPatches(r.patches)
  }

  const { applySessionChanges, handleUpdate, handleExtNotification } = createUpdateIngest({
    isDisposed: () => disposed,
    getState: () => currentState,
    emit,
    toolOutputRules,
  })

  // ── C3: turn boundaries ─────────────────────────────────────────────────
  const turnHandlers = createTurnLifecycleHandlers({
    getState: () => currentState,
    emit,
    closeOnTurnEnd,
    onScheduleCloseOnTurnEnd,
    onTurnEnded,
    disposed: () => disposed,
  })
  const {
    turn: turnLifecycle,
    turnHostMethods,
    stampTurnStart,
    emitTurnEnd,
    maybeScheduleCloseOnTurnEnd,
  } = turnHandlers

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

  // Expiry declines, not cancels: decline keeps the turn alive. See request-timeout.ts.
  const elicitPending = createPendingRequests<CreateElicitationResponse>({
    timeoutMs: elicitationTimeoutMs,
    defaultValue: { action: "decline" },
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

  const transport = createFromLineWire({
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
  const { getAgentCapabilities, ...clientActions } = createSessionHostClientActions({
    client,
    isDisposed: () => disposed,
    getSessionId: () => currentState.sessionId,
    setConfigOptions: (configOptions) => applySessionChanges({ configOptions }),
  })

  // ── slice http-usable C1: capabilities → SessionState ────────────────────
  // 🔴 חייב להיות **אחרי** יצירת ה-client: תגובת ה-initialize מחליפה את אובייקט
  // היכולות (provider/connection/spawn.ts). העתקה מוקדמת שומרת ערך שקרי.
  // The initial snapshot carries provider capabilities, including image input,
  // to both SSE and WS viewers.
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
    closePatches()
  }

  function bumpQuotaGeneration(): void {
    quotaGeneration++
  }

  const sessionSwitch = createSessionSwitch({
    get state() {
      return currentState
    },
    set state(state) {
      currentState = state
    },
    bumpQuotaGeneration,
    turnLifecycle,
    permPending,
    elicitPending,
    emitPatches,
  })

  const turnOperations = createPromptTurn({
    client,
    isDisposed: () => disposed,
    getState: () => currentState,
    isSwitching: sessionSwitch.isSwitching,
    emit,
    lifecycle: turnLifecycle,
    stampTurnStart,
    emitTurnEnd,
    maybeScheduleCloseOnTurnEnd,
    transformPromptForAcp,
    startQuotaFetch,
  })
  const switchActions = createSessionHostSwitchActions({
    client,
    sessionSwitch,
    applySessionChanges,
    handleUpdate,
    bumpQuotaGeneration,
    startQuotaFetch,
    isDisposed: () => disposed,
    getState: () => currentState,
    updateState: (changes) => {
      currentState = { ...currentState, ...changes }
    },
  })

  // ── ExtendedSessionHost ───────────────────────────────────────────────────

  return {
    get state(): SessionState {
      return currentState
    },

    get isSessionSwitchPreFlip() {
      return sessionSwitch.isPreFlip
    },

    patches: patchStream,

    dispose,
    ...turnOperations,

    ...switchActions,

    respondPermission(requestId: number, response: RequestPermissionResponse): void {
      if (disposed) return // slice handoff-foundations C1: no-op after dispose
      permPending.respond(requestId, response)
    },

    ...attachScopePermission({
      isDisposed: () => disposed,
      getState: () => currentState,
      setState: (s) => {
        currentState = s
      },
      emitPatches,
      nextRequestId: () => nextRequestId++,
      permPending,
    }),
    respondElicitation(requestId: number, response: CreateElicitationResponse): void {
      if (disposed) return // slice handoff-foundations C1: no-op after dispose
      elicitPending.respond(requestId, response)
    },

    ...clientActions,
    get agentCapabilities() {
      return getAgentCapabilities()
    },
    ...(warmReattach && { sessionCapabilitiesSource: "warm-legacy" as const }),
    ...{ emitExtNotification: handleExtNotification },
    ...turnHostMethods,
  }
}

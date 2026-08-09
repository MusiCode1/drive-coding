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
 */

import type {
  CreateElicitationRequest,
  CreateElicitationResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import type { Patch, SessionState } from "@drive-coding/core/session"
import {
  applyUserMessage,
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
}

/**
 * createSessionHost — constructs a SessionHost.
 * Calls deps.createClient with the internal update callback (AcpClientCallbacks).
 * Returns after the client is ready (createClient has resolved).
 */
export async function createSessionHost(deps: SessionHostDeps): Promise<SessionHost> {
  // Internal mutable state (replaced on each update — immutable pattern)
  let currentState: SessionState = createInitialSessionState({ sessionId: null })

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
    const result = reduce(currentState, notification.update)
    currentState = result.state
    emitPatches(result.patches)
  }

  const callbacks: AcpClientCallbacks = {
    onUpdate: handleUpdate,
  }

  const client = await deps.createClient(callbacks)

  return {
    get state(): SessionState {
      return currentState
    },

    patches: patchStream,

    async prompt(
      sessionId: string,
      content: string,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      const msg = synthesizeUserMessage(currentState, content, meta)
      const result = applyUserMessage(currentState, msg)
      currentState = result.state
      emitPatches(result.patches)
      await client.prompt(sessionId, content)
    },

    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> }) {
      return client.newSession(opts) as Promise<{ sessionId: string }>
    },

    async loadSession(opts: { cwd: string; sessionId: string; _meta?: Record<string, unknown> }) {
      return client.loadSession(opts) as Promise<{ sessionId: string }>
    },

    async cancel(sessionId: string) {
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
export type ExtendedSessionHost = SessionHost & {
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
    const result = reduce(currentState, notification.update)
    currentState = result.state
    emitPatches(result.patches)
  }

  // ── PendingRequests for permission + elicitation ──────────────────────────

  let permissionSeq = 0
  const permPending = createPendingRequests<RequestPermissionResponse>({
    timeoutMs: permissionTimeoutMs,
    defaultValue: { outcome: { outcome: "cancelled" } },
  })

  let elicitationSeq = 0
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
    const requestId = permissionSeq++
    return permPending.request(requestId)
  }

  async function handleCreateElicitation(
    params: CreateElicitationRequest,
  ): Promise<CreateElicitationResponse> {
    const requestId = elicitationSeq++
    return elicitPending.request(requestId)
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
    const result = reduce(currentState, {
      sessionUpdate: "turn_end",
    })
    // Update status to disconnected regardless of reduce result
    currentState = {
      ...result.state,
      status: "disconnected" as const,
    }
  })

  // ── ExtendedSessionHost ───────────────────────────────────────────────────

  return {
    get state(): SessionState {
      return currentState
    },

    patches: patchStream,

    async prompt(
      sessionId: string,
      content: string,
      meta?: Record<string, unknown>,
    ): Promise<void> {
      const msg = synthesizeUserMessage(currentState, content, meta)
      const result = applyUserMessage(currentState, msg)
      currentState = result.state
      emitPatches(result.patches)
      await client.prompt(sessionId, content)
    },

    async newSession(opts: { cwd: string; _meta?: Record<string, unknown> }) {
      const result = (await client.newSession(opts)) as { sessionId: string }
      // Update currentState.sessionId so setMode/setConfigOption can use it
      currentState = { ...currentState, sessionId: result.sessionId }
      return result
    },

    async loadSession(opts: { cwd: string; sessionId: string; _meta?: Record<string, unknown> }) {
      const result = (await client.loadSession(opts)) as { sessionId: string }
      // Update currentState.sessionId so setMode/setConfigOption can use it
      currentState = { ...currentState, sessionId: result.sessionId }
      return result
    },

    async cancel(sessionId: string) {
      await client.cancel(sessionId)
    },

    respondPermission(requestId: number, response: RequestPermissionResponse): void {
      permPending.respond(requestId, response)
    },

    respondElicitation(requestId: number, response: CreateElicitationResponse): void {
      elicitPending.respond(requestId, response)
    },

    async setMode(modeId: string): Promise<void> {
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionMode({ sessionId: currentState.sessionId, modeId })
    },

    async setConfigOption(configId: string, value: string | boolean): Promise<void> {
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionConfigOption({ sessionId: currentState.sessionId, configId, value })
    },

    async extMethod(
      method: string,
      params: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      return client.extMethod(method, params)
    },

    async setSessionModel(model: string): Promise<void> {
      if (!currentState.sessionId) throw new Error("No session")
      await client.setSessionModel({ sessionId: currentState.sessionId, modelId: model })
    },
  }
}

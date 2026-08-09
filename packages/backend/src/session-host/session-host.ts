/**
 * session-host.ts — SessionHost (C2).
 *
 * ACP client wrapper that holds SessionState and runs reduce on every
 * session/update notification. Exposes:
 *   - state: SessionState  (readonly, replaced on each update — immutable)
 *   - patches: ReadableStream<Patch>  (broadcast channel — S4 will consume)
 *   - prompt(sessionId, content, meta?)  — synthesizes user message before client.prompt
 *   - newSession / loadSession / cancel  — delegate to AcpClient
 *
 * createSessionHost accepts a `createClient` factory (dependency injection):
 *   - In production: wraps createAcpClient + InProcessAcpTransport
 *   - In tests: returns a mock AcpClient, captures callbacks
 *
 * ─── slice session-host-core C2 (TDD) ───
 */

import type { SessionNotification } from "@agentclientprotocol/sdk"
import type { AcpClient, AcpClientCallbacks } from "@drive-coding/provider/client"
import type { SessionState, Patch } from "@drive-coding/core/session"
import {
  createInitialSessionState,
  reduce,
  synthesizeUserMessage,
  applyUserMessage,
} from "@drive-coding/core/session"

// ─── Public API ─────────────────────────────────────────────────────────────

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
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<void>

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

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * createSessionHost — constructs a SessionHost.
 * Calls deps.createClient with the internal update callback (AcpClientCallbacks).
 * Returns after the client is ready (createClient has resolved).
 */
export async function createSessionHost(deps: SessionHostDeps): Promise<SessionHost> {
  // Internal mutable state (replaced on each update — immutable pattern)
  let currentState: SessionState = createInitialSessionState({ sessionId: null })

  // Patches stream: we use a BYOB-style controller to push patches
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

  // Build callbacks — will be passed to createClient
  const callbacks: AcpClientCallbacks = {
    onUpdate: handleUpdate,
  }

  // Create the AcpClient (may be real or mocked)
  const client = await deps.createClient(callbacks)

  // ─── SessionHost implementation ───────────────────────────────────────────

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
      // 1. Synthesize user message with meta (opaque passthrough)
      const msg = synthesizeUserMessage(currentState, content, meta)

      // 2. Apply to state + emit patch
      const result = applyUserMessage(currentState, msg)
      currentState = result.state
      emitPatches(result.patches)

      // 3. Forward prompt to ACP client
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

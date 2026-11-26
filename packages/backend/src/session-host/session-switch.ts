import type { CreateElicitationResponse, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import { applyPatch, type Patch, type SessionState } from "@drive-coding/core/session"

export const SWITCHING_SESSION_ID = "__drive_switching__"

type Transcript = Pick<SessionState, "messages" | "nextMessageSeq" | "nextSegmentSeq" | "carried">

interface SessionSwitchDeps {
  state: SessionState
  turnLifecycle: { turnSeq: number; cancelledTurn: number }
  bumpQuotaGeneration(): void
  permPending: { respond(id: number, response: RequestPermissionResponse): void }
  elicitPending: { respond(id: number, response: CreateElicitationResponse): void }
  emitPatches(patches: Patch[]): void
}

export class SessionBusyError extends Error {
  override name = "SessionBusyError"
}

export function createSessionSwitch(deps: SessionSwitchDeps) {
  function assertCanLoad(_sessionId: string): void {
    if (deps.state.turnState !== "idle") {
      throw new SessionBusyError("Cannot load a session while a turn is active")
    }
  }

  // Invalidation and reset must stay synchronous with the sessionId flip
  // when nothing is pending. Yielding would admit tails from the previous turn.
  function beginSessionSwitchInvalidate(): void {
    deps.turnLifecycle.turnSeq++
    deps.turnLifecycle.cancelledTurn = -1
    deps.bumpQuotaGeneration()
  }

  /** Returns true if a microtask flush is required before reset. */
  function cancelOpenPendingSync(): boolean {
    const { permission, elicitation } = deps.state.pending
    if (permission) {
      deps.permPending.respond(permission.requestId, { outcome: { outcome: "cancelled" } })
    }
    if (elicitation) {
      deps.elicitPending.respond(elicitation.requestId, { action: "cancel" })
    }
    return Boolean(permission || elicitation)
  }

  function applyAndEmit(patch: Patch): void {
    deps.state = applyPatch(deps.state, patch)
    deps.emitPatches([patch])
  }

  function emitSessionSwitchReset() {
    const {
      sessionId: oldSessionId,
      configOptions: preResetConfigOptions,
      messages,
      nextMessageSeq,
      nextSegmentSeq,
      carried,
    } = deps.state
    const snapshot: Transcript = {
      messages,
      nextMessageSeq,
      nextSegmentSeq,
      carried: carried ?? [],
    }
    applyAndEmit({
      op: "reset",
      version: deps.state.version + 1,
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    })
    return { oldSessionId, preResetConfigOptions, snapshot }
  }

  function rollbackSessionSwitch(oldSessionId: string | null, snapshot: Transcript): void {
    deps.state = { ...deps.state, sessionId: oldSessionId }
    applyAndEmit({ op: "reset", version: deps.state.version + 1, ...snapshot })
    applyAndEmit({
      op: "update-session",
      version: deps.state.version + 1,
      changes: { turnState: "idle" },
    })
  }

  return {
    assertCanLoad,
    beginSessionSwitchInvalidate,
    cancelOpenPendingSync,
    emitSessionSwitchReset,
    rollbackSessionSwitch,
  }
}

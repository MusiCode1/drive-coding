/**
 * session-host-scope.ts — scope escalation on ExtendedSessionHost (C2).
 */

import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk"
import {
  applyPendingRequest,
  clearPendingRequest,
  type PendingPermission,
  type Patch,
  type SessionState,
} from "@drive-coding/core/session"
import type { createPendingRequests } from "./pending-requests.js"

type PermPending = ReturnType<typeof createPendingRequests<RequestPermissionResponse>>

export type ScopePermissionHost = {
  requestScopePermission(opts: {
    callerId: string
    targetId: string
    verb: string
  }): Promise<"allow" | "deny" | "allow_always">
}

declare module "./session-host.js" {
  interface ExtendedSessionHost {
    requestScopePermission?: ScopePermissionHost["requestScopePermission"]
  }
}

export function createRequestScopePermission(deps: {
  isDisposed: () => boolean
  getState: () => SessionState
  setState: (state: SessionState) => void
  emitPatches: (patches: Patch[]) => void
  nextRequestId: () => number
  permPending: PermPending
}): ScopePermissionHost["requestScopePermission"] {
  return (opts) => {
    if (deps.isDisposed()) return Promise.resolve("deny" as const)
    if (deps.getState().pending.permission !== null) return Promise.resolve("deny" as const)

    const title = `Agent ${opts.callerId} requests ${opts.verb} on ${opts.targetId}`
    const options = [
      { optionId: "scope-allow-once", name: "Allow once", kind: "allow_once" as const },
      { optionId: "scope-allow-always", name: "Allow always", kind: "allow_always" as const },
      { optionId: "scope-reject-once", name: "Reject", kind: "reject_once" as const },
    ]
    const params: RequestPermissionRequest = {
      sessionId: deps.getState().sessionId ?? "",
      toolCall: { title },
      options,
    }

    const requestId = deps.nextRequestId()
    const applied = applyPendingRequest(deps.getState(), {
      kind: "permission",
      value: { requestId, params } satisfies PendingPermission,
    })
    deps.setState(applied.state)
    deps.emitPatches(applied.patches)

    return deps.permPending
      .request(requestId)
      .then((response) => {
        const outcome = response.outcome
        if (outcome.outcome === "cancelled") return "deny" as const
        if (outcome.outcome !== "selected") return "deny" as const
        const selected = options.find((o) => o.optionId === outcome.optionId)
        if (!selected || selected.kind === "reject_once") return "deny" as const
        if (selected.kind === "allow_always") return "allow_always" as const
        return "allow" as const
      })
      .finally(() => {
        const cleared = clearPendingRequest(deps.getState(), "permission", requestId)
        deps.setState(cleared.state)
        deps.emitPatches(cleared.patches)
      })
  }
}

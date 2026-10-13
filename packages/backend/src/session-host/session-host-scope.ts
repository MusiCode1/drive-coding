/**
 * session-host-scope.ts — scope escalation on ExtendedSessionHost (C2).
 */
// Guard rail, not a lock - see NOT_A_SECURITY_BOUNDARY in ../agent-scope.ts

import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk"
import {
  applyPendingRequest,
  applyToolMessage,
  clearPendingRequest,
  type Patch,
  type PendingPermission,
  type SessionState,
} from "@drive-coding/core/session"
import {
  formatScopePromptTitle,
  SCOPE_PROMPT_META_KEY,
  type ScopePromptDetail,
} from "@drive-coding/core/types/scope-prompt"
import type { createPendingRequests } from "./pending-requests.js"
import { defaultRequestTimeouts } from "./request-timeout.js"

type PermPending = ReturnType<typeof createPendingRequests<RequestPermissionResponse>>

export type ScopePermissionHost = {
  requestScopePermission(opts: {
    callerId: string
    targetId: string
    verb: string
    detail?: ScopePromptDetail
  }): Promise<"allow" | "deny" | "allow_always">
  isScopeRequest(requestId: number): boolean
}

export function createScopeRequestTracker(): Pick<ScopePermissionHost, "isScopeRequest"> & {
  markScopeRequest: (requestId: number) => void
} {
  const scopeRequestIds = new Set<number>()
  return {
    markScopeRequest: (id) => {
      scopeRequestIds.add(id)
    },
    isScopeRequest: (id) => scopeRequestIds.has(id),
  }
}

type ScopePermissionDeps = {
  isDisposed: () => boolean
  getState: () => SessionState
  setState: (state: SessionState) => void
  emitPatches: (patches: Patch[]) => void
  nextRequestId: () => number
  permPending: PermPending
  /** ms until auto-deny. `null` = no timeout. `undefined` = defaultRequestTimeouts().scopePermission */
  scopeTimeoutMs?: number | null
}

export function attachScopePermission(
  deps: ScopePermissionDeps,
): Pick<ScopePermissionHost, "requestScopePermission" | "isScopeRequest"> {
  const scopeTimeoutMs =
    deps.scopeTimeoutMs === undefined
      ? defaultRequestTimeouts().scopePermission
      : deps.scopeTimeoutMs
  const tracker = createScopeRequestTracker()
  return {
    requestScopePermission: createRequestScopePermission({
      ...deps,
      scopeTimeoutMs,
      markScopeRequest: tracker.markScopeRequest,
    }),
    isScopeRequest: tracker.isScopeRequest,
  }
}

export function createRequestScopePermission(deps: {
  isDisposed: () => boolean
  getState: () => SessionState
  setState: (state: SessionState) => void
  emitPatches: (patches: Patch[]) => void
  nextRequestId: () => number
  permPending: PermPending
  markScopeRequest: (requestId: number) => void
  /** Normalized from attachScopePermission. null/undefined = no scope timer. */
  scopeTimeoutMs?: number | null
}): ScopePermissionHost["requestScopePermission"] {
  return (opts) => {
    if (deps.isDisposed()) return Promise.resolve("deny" as const)
    if (deps.getState().pending.permission !== null) return Promise.resolve("deny" as const)

    const timeoutMs = deps.scopeTimeoutMs
    const detailBase = opts.detail
    const detail =
      detailBase && typeof timeoutMs === "number" && timeoutMs > 0
        ? { ...detailBase, expiresAtMs: Date.now() + timeoutMs }
        : detailBase
    const title = detail
      ? formatScopePromptTitle(detail)
      : `Agent ${opts.callerId} requests ${opts.verb} on ${opts.targetId}`
    const options = [
      { optionId: "scope-allow-once", name: "Allow once", kind: "allow_once" as const },
      { optionId: "scope-allow-always", name: "Allow always", kind: "allow_always" as const },
      { optionId: "scope-reject-once", name: "Reject", kind: "reject_once" as const },
    ]
    const requestId = deps.nextRequestId()
    deps.markScopeRequest(requestId)
    const params: RequestPermissionRequest = {
      sessionId: deps.getState().sessionId ?? "",
      toolCall: {
        toolCallId: `scope-${requestId}`,
        title,
        ...(detail ? { _meta: { [SCOPE_PROMPT_META_KEY]: detail } } : {}),
      },
      options,
    }
    const applied = applyPendingRequest(deps.getState(), {
      kind: "permission",
      value: { requestId, params } satisfies PendingPermission,
    })
    deps.setState(applied.state)
    deps.emitPatches(applied.patches)

    let scopeTimer: ReturnType<typeof setTimeout> | null = null
    let expiredByTimer = false
    const pendingPromise = deps.permPending.request(requestId)
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
      scopeTimer = setTimeout(() => {
        expiredByTimer = true
        deps.permPending.respond(requestId, { outcome: { outcome: "cancelled" } })
      }, timeoutMs)
    }

    return pendingPromise
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
        if (scopeTimer !== null) clearTimeout(scopeTimer)
        const cleared = clearPendingRequest(deps.getState(), "permission", requestId)
        deps.setState(cleared.state)
        deps.emitPatches(cleared.patches)
        if (expiredByTimer && detail) {
          const expired = applyToolMessage(deps.getState(), {
            toolCallId: `scope-${requestId}`,
            name: "scope-expired",
            kind: "scope-expired",
            args: detail,
            status: "failed",
            title: formatScopePromptTitle(detail),
          })
          deps.setState(expired.state)
          deps.emitPatches(expired.patches)
        }
      })
  }
}

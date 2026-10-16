import type { SessionState } from "@drive-coding/core/session"
import type { SessionView } from "$lib/session/session-view"
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"

type PendingPermission = {
  requestId?: number
  params: PermissionParams
  resolve: (r: PermissionResponse) => void
}
type PendingElicitation = {
  requestId?: number
  params: ElicitationParams
  resolve: (r: ElicitationResponse) => void
}

export interface PendingRequestState {
  pendingPermission: PendingPermission | null
  pendingElicitation: PendingElicitation | null
  error: string | null
  readonly bypassActive: boolean
}

export interface PendingRequestDeps {
  state: PendingRequestState
  answered: { permissionId: number | null; elicitationId: number | null }
  view(): SessionView | null
  tearingDown(): boolean
}

export function syncPendingPermission(
  deps: PendingRequestDeps,
  incoming: SessionState["pending"]["permission"],
  view: SessionView,
): void {
  if (incoming === null) {
    deps.state.pendingPermission = null
    return
  }
  if (
    incoming.requestId === deps.answered.permissionId ||
    incoming.requestId === deps.state.pendingPermission?.requestId
  )
    return
  const id = incoming.requestId
  deps.state.pendingPermission = {
    requestId: id,
    params: incoming.params as unknown as PermissionParams,
    resolve: (response) => {
      try {
        deps.answered.permissionId = id
        void view.respond(id, response).catch(() => {
          if (deps.tearingDown() || deps.view() !== view || deps.answered.permissionId !== id)
            return
          deps.answered.permissionId = null
          deps.state.error = "reply failed"
        })
      } catch {
        /* teardown must continue */
      }
    },
  }
}

export function syncPendingElicitation(
  deps: PendingRequestDeps,
  incoming: SessionState["pending"]["elicitation"],
  view: SessionView,
): void {
  if (incoming === null) {
    deps.state.pendingElicitation = null
    return
  }
  if (
    incoming.requestId === deps.answered.elicitationId ||
    incoming.requestId === deps.state.pendingElicitation?.requestId
  )
    return
  const id = incoming.requestId
  deps.state.pendingElicitation = {
    requestId: id,
    params: incoming.params as unknown as ElicitationParams,
    resolve: (response) => {
      try {
        deps.answered.elicitationId = id
        void view.respond(id, response).catch(() => {
          if (deps.tearingDown() || deps.view() !== view || deps.answered.elicitationId !== id)
            return
          deps.answered.elicitationId = null
          deps.state.error = "reply failed"
        })
      } catch {
        /* teardown must continue */
      }
    },
  }
}

export function resolvePendingPermission(
  deps: PendingRequestDeps,
  response: PermissionResponse,
): void {
  const pending = deps.state.pendingPermission
  if (!pending) return
  pending.resolve(response)
  deps.state.pendingPermission = null
}

export function resolvePendingElicitation(
  deps: PendingRequestDeps,
  response: ElicitationResponse,
): void {
  const pending = deps.state.pendingElicitation
  if (!pending) return
  pending.resolve(response)
  deps.state.pendingElicitation = null
}

export function cancelPendingDialogs(deps: PendingRequestDeps): void {
  resolvePendingPermission(deps, { outcome: { outcome: "cancelled" } })
  resolvePendingElicitation(deps, { action: "cancel" })
}

export function onRequestPermission(
  deps: PendingRequestDeps,
  params: PermissionParams,
): Promise<PermissionResponse> {
  return new Promise<PermissionResponse>((resolve) => {
    if (deps.state.pendingPermission) {
      resolvePendingPermission(deps, { outcome: { outcome: "cancelled" } })
    }
    if (deps.state.bypassActive) {
      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen = byKind("allow_once") ?? byKind("allow_always") ?? params.options[0]
      resolve(
        chosen
          ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
          : { outcome: { outcome: "cancelled" } },
      )
      return
    }
    deps.state.pendingPermission = { params, resolve }
  })
}

export function onCreateElicitation(
  deps: PendingRequestDeps,
  params: ElicitationParams,
): Promise<ElicitationResponse> {
  return new Promise((resolve) => {
    if (deps.state.pendingElicitation) resolvePendingElicitation(deps, { action: "cancel" })
    deps.state.pendingElicitation = { params, resolve }
  })
}

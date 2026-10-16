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

export interface PendingRequestDeps {
  permission(): PendingPermission | null
  setPermission(value: PendingPermission | null): void
  elicitation(): PendingElicitation | null
  setElicitation(value: PendingElicitation | null): void
  answeredPermissionId(): number | null
  setAnsweredPermissionId(value: number | null): void
  answeredElicitationId(): number | null
  setAnsweredElicitationId(value: number | null): void
  view(): SessionView | null
  tearingDown(): boolean
  setError(value: string): void
  bypassActive(): boolean
}

export function syncPendingPermission(
  deps: PendingRequestDeps,
  incoming: SessionState["pending"]["permission"],
  view: SessionView,
): void {
  if (incoming === null) {
    deps.setPermission(null)
    return
  }
  if (
    incoming.requestId === deps.answeredPermissionId() ||
    incoming.requestId === deps.permission()?.requestId
  )
    return
  const id = incoming.requestId
  deps.setPermission({
    requestId: id,
    params: incoming.params as unknown as PermissionParams,
    resolve: (response) => {
      try {
        deps.setAnsweredPermissionId(id)
        void view.respond(id, response).catch(() => {
          if (deps.tearingDown() || deps.view() !== view || deps.answeredPermissionId() !== id)
            return
          deps.setAnsweredPermissionId(null)
          deps.setError("reply failed")
        })
      } catch {
        /* teardown must continue */
      }
    },
  })
}

export function syncPendingElicitation(
  deps: PendingRequestDeps,
  incoming: SessionState["pending"]["elicitation"],
  view: SessionView,
): void {
  if (incoming === null) {
    deps.setElicitation(null)
    return
  }
  if (
    incoming.requestId === deps.answeredElicitationId() ||
    incoming.requestId === deps.elicitation()?.requestId
  )
    return
  const id = incoming.requestId
  deps.setElicitation({
    requestId: id,
    params: incoming.params as unknown as ElicitationParams,
    resolve: (response) => {
      try {
        deps.setAnsweredElicitationId(id)
        void view.respond(id, response).catch(() => {
          if (deps.tearingDown() || deps.view() !== view || deps.answeredElicitationId() !== id)
            return
          deps.setAnsweredElicitationId(null)
          deps.setError("reply failed")
        })
      } catch {
        /* teardown must continue */
      }
    },
  })
}

export function resolvePendingPermission(
  deps: PendingRequestDeps,
  response: PermissionResponse,
): void {
  const pending = deps.permission()
  if (!pending) return
  pending.resolve(response)
  deps.setPermission(null)
}

export function resolvePendingElicitation(
  deps: PendingRequestDeps,
  response: ElicitationResponse,
): void {
  const pending = deps.elicitation()
  if (!pending) return
  pending.resolve(response)
  deps.setElicitation(null)
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
    if (deps.permission()) {
      resolvePendingPermission(deps, { outcome: { outcome: "cancelled" } })
    }
    if (deps.bypassActive()) {
      const byKind = (k: string) => params.options.find((o) => o.kind === k)
      const chosen = byKind("allow_once") ?? byKind("allow_always") ?? params.options[0]
      resolve(
        chosen
          ? { outcome: { outcome: "selected", optionId: chosen.optionId } }
          : { outcome: { outcome: "cancelled" } },
      )
      return
    }
    deps.setPermission({ params, resolve })
  })
}

export function onCreateElicitation(
  deps: PendingRequestDeps,
  params: ElicitationParams,
): Promise<ElicitationResponse> {
  return new Promise((resolve) => {
    if (deps.elicitation()) resolvePendingElicitation(deps, { action: "cancel" })
    deps.setElicitation({ params, resolve })
  })
}

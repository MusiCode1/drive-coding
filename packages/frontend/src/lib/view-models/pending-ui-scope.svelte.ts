import type { SessionState } from "@drive-coding/core/session"
import type { SessionView } from "$lib/session/session-view"
import type { ElicitationParams, ElicitationResponse } from "$lib/types/elicitation"
import type { PermissionParams, PermissionResponse } from "$lib/types/permission"
import {
  cancelPendingDialogs,
  onCreateElicitation as onCreateElicitationExtracted,
  onRequestPermission as onRequestPermissionExtracted,
  type PendingRequestDeps,
  resolvePendingElicitation as resolvePendingElicitationExtracted,
  resolvePendingPermission as resolvePendingPermissionExtracted,
  syncPendingElicitation as syncPendingElicitationExtracted,
  syncPendingPermission as syncPendingPermissionExtracted,
} from "./agent-session-pending"

export type PendingPermission = {
  requestId?: number
  params: PermissionParams
  resolve: (r: PermissionResponse) => void
}
export type PendingElicitation = {
  requestId?: number
  params: ElicitationParams
  resolve: (r: ElicitationResponse) => void
}

export type PendingUiScopeHost = {
  get error(): string | null
  set error(v: string | null)
  get bypassActive(): boolean
  view(): SessionView | null
  tearingDown(): boolean
}

/** Single owner of pending permission/elicitation UI state (slice state-http-viewer-detach-1a). */
export class PendingUiScope {
  pendingPermission = $state<PendingPermission | null>(null)
  pendingElicitation = $state<PendingElicitation | null>(null)
  readonly answered: PendingRequestDeps["answered"] = {
    permissionId: null,
    elicitationId: null,
  }

  readonly #host: PendingUiScopeHost

  constructor(host: PendingUiScopeHost) {
    this.#host = host
  }

  deps(): PendingRequestDeps {
    const host = this.#host
    const self = this
    return {
      state: {
        get pendingPermission() {
          return self.pendingPermission
        },
        set pendingPermission(v) {
          self.pendingPermission = v
        },
        get pendingElicitation() {
          return self.pendingElicitation
        },
        set pendingElicitation(v) {
          self.pendingElicitation = v
        },
        get error() {
          return host.error
        },
        set error(v: string | null) {
          host.error = v
        },
        get bypassActive() {
          return host.bypassActive
        },
      },
      answered: this.answered,
      view: () => host.view(),
      tearingDown: () => host.tearingDown(),
    }
  }

  clearLocalUi(): void {
    this.pendingPermission = null
    this.pendingElicitation = null
    this.answered.permissionId = null
    this.answered.elicitationId = null
  }

  cancelDialogs(): void {
    cancelPendingDialogs(this.deps())
  }

  syncPermission(incoming: SessionState["pending"]["permission"], view: SessionView): void {
    syncPendingPermissionExtracted(this.deps(), incoming, view)
  }

  syncElicitation(incoming: SessionState["pending"]["elicitation"], view: SessionView): void {
    syncPendingElicitationExtracted(this.deps(), incoming, view)
  }

  resolvePermission = (optionId: string): void => {
    resolvePendingPermissionExtracted(this.deps(), {
      outcome: { outcome: "selected", optionId },
    })
  }

  cancelPermission = (): void => {
    resolvePendingPermissionExtracted(this.deps(), { outcome: { outcome: "cancelled" } })
  }

  resolveElicitation = (content: Record<string, string | number | boolean | string[]>): void => {
    resolvePendingElicitationExtracted(this.deps(), { action: "accept", content })
  }

  cancelElicitation = (action: "decline" | "cancel"): void => {
    resolvePendingElicitationExtracted(this.deps(), { action })
  }

  onRequestPermission(params: PermissionParams): Promise<PermissionResponse> {
    return onRequestPermissionExtracted(this.deps(), params)
  }

  onCreateElicitation(params: ElicitationParams): Promise<ElicitationResponse> {
    return onCreateElicitationExtracted(this.deps(), params)
  }

  /** HTTP viewer detach: clear local pending only; WS leaveRunning still resolves via transport. */
  async detachForLeaveBeforeCleanup(isRemote: boolean): Promise<void> {
    if (!this.pendingPermission && !this.pendingElicitation) return
    if (isRemote) {
      this.clearLocalUi()
      return
    }
    this.cancelDialogs()
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0)
    })
  }

  /** Before closing transport on cleanup — HTTP keepAgent clears local UI only. */
  detachOnCleanup(keepAgent: boolean, isRemote: boolean): void {
    if (keepAgent && isRemote) this.clearLocalUi()
    else this.cancelDialogs()
  }

  syncFromView(pending: SessionState["pending"], view: SessionView): void {
    this.syncPermission(pending.permission, view)
    this.syncElicitation(pending.elicitation, view)
  }

  resetAnsweredIds(): void {
    this.answered.permissionId = null
    this.answered.elicitationId = null
  }

  acpClientCallbacks(): {
    onRequestPermission: (params: PermissionParams) => Promise<PermissionResponse>
    onCreateElicitation: (params: ElicitationParams) => Promise<ElicitationResponse>
  } {
    return {
      onRequestPermission: (params) => this.onRequestPermission(params),
      onCreateElicitation: (params) => this.onCreateElicitation(params),
    }
  }
}

export type PendingUiInstallSession = {
  pendingPermission: PendingPermission | null
  pendingElicitation: PendingElicitation | null
  resolvePermission: (optionId: string) => void
  cancelPermission: () => void
  resolveElicitation: (content: Record<string, string | number | boolean | string[]>) => void
  cancelElicitation: (action: "decline" | "cancel") => void
}

/** Wires pending UI onto AgentSession (fields + resolve methods) without a separate product module. */
export function installPendingUiOnAgentSession(
  session: PendingUiInstallSession,
  host: PendingUiScopeHost,
): PendingUiScope {
  const scope = new PendingUiScope(host)
  Object.defineProperty(session, "pendingPermission", {
    get: () => scope.pendingPermission,
    set: (v: PendingPermission | null) => {
      scope.pendingPermission = v
    },
    enumerable: true,
    configurable: true,
  })
  Object.defineProperty(session, "pendingElicitation", {
    get: () => scope.pendingElicitation,
    set: (v: PendingElicitation | null) => {
      scope.pendingElicitation = v
    },
    enumerable: true,
    configurable: true,
  })
  session.resolvePermission = (optionId) => scope.resolvePermission(optionId)
  session.cancelPermission = () => scope.cancelPermission()
  session.resolveElicitation = (content) => scope.resolveElicitation(content)
  session.cancelElicitation = (action) => scope.cancelElicitation(action)
  return scope
}

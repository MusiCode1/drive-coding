import type { SessionConfigOption } from "@agentclientprotocol/sdk"

export type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

export type SessionModeState = {
  currentModeId: string
  availableModes: Array<{ id: string; name: string; description?: string | null }>
}

/** Reactive owner for session config UI snapshot (slice state-agent-session-config-owner). */
export class SessionConfigOwner {
  configOptions = $state<SessionConfigOption[]>([])
  models = $state<SessionModelState | null>(null)
  modes = $state<SessionModeState | null>(null)

  /** Full replace from session/new, session/load, reconnect, load-mock — no merge. */
  capture(result: {
    configOptions?: SessionConfigOption[] | null
    models?: SessionModelState | null
    modes?: SessionModeState | null
  }): void {
    this.configOptions = result.configOptions ?? []
    this.models = result.models ?? null
    this.modes = result.modes ?? null
  }

  /** HTTP batch end — replaces modes + configOptions only (not models). */
  syncFromHttpView(viewState: {
    modes: SessionModeState | null
    configOptions: SessionConfigOption[]
  }): void {
    this.modes = viewState.modes
    this.configOptions = viewState.configOptions
  }

  /** Local apply / bindConfigDeps read-write surface. */
  applyClientTargets(): {
    configOptions: () => SessionConfigOption[]
    setConfigOptions: (v: SessionConfigOption[]) => void
    models: () => SessionModelState | null
    setModels: (v: SessionModelState | null) => void
    modes: () => SessionModeState | null
    setModes: (v: SessionModeState | null) => void
  } {
    return {
      configOptions: () => this.configOptions,
      setConfigOptions: (v) => {
        this.configOptions = v
      },
      models: () => this.models,
      setModels: (v) => {
        this.models = v
      },
      modes: () => this.modes,
      setModes: (v) => {
        this.modes = v
      },
    }
  }
}

import type {
  SessionConfigOption,
  SessionModeState,
  SessionNotification,
} from "@agentclientprotocol/sdk"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { NormalizedCapabilities } from "@drive-coding/provider/types"
import { tick } from "svelte"
import type { AgentSessionStatus, TurnState } from "$lib/view-models/agent-session.svelte"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

export type LoadMockSessionDeps = {
  setCwd: (cwd: string) => void
  setSessionTitle: (title: string) => void
  setError: (error: string | null) => void
  setIsLoadingHistory: (v: boolean) => void
  enterSession: (sessionKey: string) => void
  captureSessionConfig: (result: {
    configOptions?: SessionConfigOption[] | null
    models?: SessionModelState | null
    modes?: SessionModeState | null
  }) => void
  setMockQuota: (v: QuotaSnapshot | null | undefined) => void
  setCapabilities: (v: NormalizedCapabilities | null) => void
  resetTurnTracking: () => void
  setTurnState: (state: TurnState) => void
  onSessionUpdate: (notification: SessionNotification) => void
  setStatus: (status: AgentSessionStatus) => void
}

/** DEV-only: stream fixture updates through the same path as live ACP. */
export async function loadMockSession(
  d: LoadMockSessionDeps,
  name: string,
  cwd: string,
): Promise<void> {
  try {
    const res = await fetch(`/fixtures/${name}.json`)
    if (!res.ok) throw new Error(`fixture "${name}" not found (${res.status})`)
    const data = (await res.json()) as {
      updates: unknown[]
      loadResult?: {
        configOptions?: SessionConfigOption[] | null
        models?: SessionModelState | null
        modes?: SessionModeState | null
      }
      mockState?: {
        capabilities?: Partial<NormalizedCapabilities>
        quota?: QuotaSnapshot | null
      }
    }
    d.setCwd(cwd)
    d.enterSession(`mock:${name}`)
    d.setSessionTitle(`🧪 ${name}`)
    if (data.loadResult) d.captureSessionConfig(data.loadResult)

    d.setMockQuota(undefined)
    if (data.mockState) {
      if (data.mockState.capabilities) {
        d.setCapabilities({
          mcp: false,
          compact: false,
          commands: false,
          usage: false,
          configOptions: false,
          rename: false,
          thinkingTokens: false,
          image: false,
          systemPrompt: "unsupported",
          ...data.mockState.capabilities,
        })
      }
      if ("quota" in data.mockState) {
        d.setMockQuota(data.mockState.quota)
      }
    }

    const params = new URLSearchParams(typeof location !== "undefined" ? location.search : "")
    const delayMs = Number(params.get("stream") ?? "0") || 0

    d.resetTurnTracking()
    d.setIsLoadingHistory(true)
    try {
      for (const update of data.updates) {
        d.onSessionUpdate({ update } as unknown as SessionNotification)
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
      }
      await tick()
    } finally {
      d.setIsLoadingHistory(false)
      d.setTurnState("idle")
    }
    d.setStatus("connected")
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    d.setError(`mock loadSession failed: ${msg}`)
    d.setTurnState("idle")
    d.setStatus("error")
  }
}

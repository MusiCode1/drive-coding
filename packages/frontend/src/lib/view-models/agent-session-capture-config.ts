import type { SessionConfigOption, SessionModeState, UsageUpdate } from "@agentclientprotocol/sdk"
import { EMPTY_PLAN_STORE, type PlanStore } from "@drive-coding/core/acp/plan"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { SessionScope } from "$lib/view-models/session-scoped-state.svelte"

type SessionModelState = {
  currentModelId: string
  availableModels: Array<{ modelId: string; name: string; description?: string | null }>
}

export type CaptureSessionConfigDeps = {
  setConfigOptions: (v: SessionConfigOption[]) => void
  setModels: (v: SessionModelState | null) => void
  setModes: (v: SessionModeState | null) => void
  setAvailableCommands: (v: import("@agentclientprotocol/sdk").AvailableCommand[]) => void
  setContextUsage: (v: UsageUpdate | null) => void
  setQuota: (v: QuotaSnapshot | null) => void
  setQuotaLoading: (v: boolean) => void
  setMockQuota: (v: QuotaSnapshot | null | undefined) => void
  session: () => SessionScope
  setPlanStore: (v: PlanStore) => void
}

/** לוכד configOptions/models/modes מתגובת session/new או session/load */
export function captureSessionConfig(
  d: CaptureSessionConfigDeps,
  result: {
    configOptions?: SessionConfigOption[] | null
    models?: SessionModelState | null
    modes?: SessionModeState | null
  },
): void {
  d.setConfigOptions(result.configOptions ?? [])
  d.setModels(result.models ?? null)
  d.setModes(result.modes ?? null)
  // slice-slash-commands: ניקוי בהחלפת/פתיחת סשן; ה-update הטרי יאכלס
  d.setAvailableCommands([])
  // slice session-budget-meter: איפוס context-usage/quota בהחלפת/פתיחת סשן (#captureSessionConfig
  // אינו מאפס capabilities — ר' brief §0 — אבל contextUsage/quota הם שדות תוספתיים חדשים
  // ללא reset קודם, ולכן מתווספים כאן וב-#cleanup במפורש).
  d.setContextUsage(null)
  d.setQuota(null)
  d.setQuotaLoading(false)
  d.setMockQuota(undefined)
  // slice subagent-tool-nesting: נקה מיפוי-קינון (החלפת/פתיחת סשן = מיפוי חדש)
  d.session().clearSubagentParents()
  // slice plan-todo-list: איפוס הצ'קליסט בהחלפת/פתיחת סשן (סשן חדש = אין תוכנית ישנה)
  d.setPlanStore(EMPTY_PLAN_STORE)
}

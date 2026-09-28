import type { AvailableCommand } from "@agentclientprotocol/sdk"
import type { UsageUpdate } from "@agentclientprotocol/sdk"
import { EMPTY_PLAN_STORE, type PlanStore } from "@drive-coding/core/acp/plan"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"

/** Per-session state. A new instance is born on each **identity change**, not on every method call. */
export class SessionScope {
  /** Identity this instance was born for. Source of truth for the boundary. */
  readonly sessionId: string | null

  title = $state("")
  titleManual = $state(false)
  userNotes = $state("")
  sessionFields = $state<Record<string, string>>({})
  availableCommands = $state<AvailableCommand[]>([])
  planStore = $state<PlanStore>(EMPTY_PLAN_STORE)
  contextUsage = $state<UsageUpdate | null>(null)
  quota = $state<QuotaSnapshot | null>(null)
  quotaLoading = $state(false)

  /** Private on VM today; not $state, no bridge getter. */
  subagentToolCallParents: Map<string, string> = new Map()

  constructor(sessionId: string | null) {
    this.sessionId = sessionId
  }
}

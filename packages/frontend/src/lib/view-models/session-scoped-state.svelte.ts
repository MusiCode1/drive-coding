import type { AvailableCommand, UsageUpdate } from "@agentclientprotocol/sdk"
import { EMPTY_PLAN_STORE, type PlanStore } from "@drive-coding/core/acp/plan"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { PatchOwner, SessionPatch } from "./scopes/apply-patch"

/** Per-session state. A new instance is born on each **identity change**, not on every method call. */
export class SessionScope implements PatchOwner<SessionPatch> {
  /** Identity this instance was born for. Source of truth for the boundary. */
  readonly sessionId: string | null

  #title = $state("")
  #titleManual = $state(false)
  #userNotes = $state("")
  #sessionFields = $state<Record<string, string>>({})
  #availableCommands = $state<AvailableCommand[]>([])
  #planStore = $state<PlanStore>(EMPTY_PLAN_STORE)
  #contextUsage = $state<UsageUpdate | null>(null)
  #quota = $state<QuotaSnapshot | null>(null)
  #quotaLoading = $state(false)

  /** Private on VM today; not $state, no bridge getter. */
  #subagentToolCallParents: Map<string, string> = new Map()

  get title(): string {
    return this.#title
  }
  get titleManual(): boolean {
    return this.#titleManual
  }
  get userNotes(): string {
    return this.#userNotes
  }
  get sessionFields(): Record<string, string> {
    return this.#sessionFields
  }
  get availableCommands(): AvailableCommand[] {
    return this.#availableCommands
  }
  get planStore(): PlanStore {
    return this.#planStore
  }
  get contextUsage(): UsageUpdate | null {
    return this.#contextUsage
  }
  get quota(): QuotaSnapshot | null {
    return this.#quota
  }
  get quotaLoading(): boolean {
    return this.#quotaLoading
  }

  applyPatch(patch: SessionPatch): void {
    switch (patch.kind) {
      case "commands":
        this.#availableCommands = patch.commands
        break
      case "plan":
        this.#planStore = patch.plan
        break
      case "usage":
        this.#contextUsage = patch.usage
        break
      case "title":
        if (!this.#titleManual) this.#title = patch.title
        break
      case "quota":
        this.#quota = patch.quota
        break
      case "quota-loading":
        this.#quotaLoading = patch.loading
        break
    }
  }

  setManualTitle(title: string, manual: boolean): void {
    this.#title = title
    this.#titleManual = manual
  }
  setTitleManual(manual: boolean): void {
    this.#titleManual = manual
  }
  setUserNotes(notes: string): void {
    this.#userNotes = notes
  }
  setSessionFields(fields: Record<string, string>): void {
    this.#sessionFields = fields
  }
  hasSubagentParent(id: string): boolean {
    return this.#subagentToolCallParents.has(id)
  }
  getSubagentParent(id: string): string | undefined {
    return this.#subagentToolCallParents.get(id)
  }
  registerSubagentParent(id: string, parentId: string): void {
    this.#subagentToolCallParents.set(id, parentId)
  }
  clearSubagentParents(): void {
    this.#subagentToolCallParents = new Map()
  }

  constructor(sessionId: string | null) {
    this.sessionId = sessionId
  }
}

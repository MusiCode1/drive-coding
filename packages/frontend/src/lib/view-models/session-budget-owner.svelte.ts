import type { UsageUpdate } from "@agentclientprotocol/sdk"
import type { QuotaSnapshot } from "@drive-coding/provider/extensions"
import type { ExtClient } from "$lib/adapters/ext"
import { doRefreshQuota, type QuotaRefreshDeps } from "$lib/view-models/agent-session-quota-refresh"

export type SessionBudgetOwnerDeps = {
  sessionId: () => string | null
  supportsUsage: () => boolean
  isRemote: () => boolean
  ext: () => ExtClient | null
}

/** Reactive owner for context usage + quota UI snapshot (slice state-agent-session-budget-owner). */
export class SessionBudgetOwner {
  contextUsage = $state<UsageUpdate | null>(null)
  quota = $state<QuotaSnapshot | null>(null)
  quotaLoading = $state(false)

  #mockQuota: QuotaSnapshot | null | undefined = undefined
  #quotaFetchInFlight: Promise<void> | null = null
  #generation = 0

  readonly #deps: SessionBudgetOwnerDeps

  constructor(deps: SessionBudgetOwnerDeps) {
    this.#deps = deps
  }

  /** Full replace from SessionView / HTTP batch — no merge. */
  updateFromView(state: { contextUsage: UsageUpdate | null; quota: QuotaSnapshot | null }): void {
    this.contextUsage = state.contextUsage
    this.quota = state.quota
  }

  /** Projection `usage` event — preserve prior cost when update omits it. */
  mergeUsage(update: UsageUpdate): void {
    this.contextUsage = {
      used: update.used,
      size: update.size,
      cost: update.cost ?? this.contextUsage?.cost,
    }
  }

  setMockQuota(value: QuotaSnapshot | null | undefined): void {
    this.#mockQuota = value
  }

  resetMockQuota(): void {
    this.#mockQuota = undefined
  }

  /** Identity/cleanup/capture boundary — invalidates in-flight refresh via generation. */
  reset(): void {
    this.#generation += 1
    this.contextUsage = null
    this.quota = null
    this.quotaLoading = false
    this.#mockQuota = undefined
    this.#quotaFetchInFlight = null
  }

  /** @internal Tests — generation after reset(). */
  _generationForTest(): number {
    return this.#generation
  }

  refreshQuota = async (): Promise<void> => {
    const sessionId = this.#deps.sessionId()
    if (sessionId === null) return

    const isMockWithSnapshot =
      import.meta.env.MODE !== "production" &&
      sessionId.startsWith("mock:") &&
      this.#mockQuota !== undefined

    if (!isMockWithSnapshot && !this.#deps.supportsUsage()) return

    if (this.#deps.isRemote() && !isMockWithSnapshot) {
      this.quotaLoading = false
      return
    }

    if (this.#quotaFetchInFlight) {
      await this.#quotaFetchInFlight
      return
    }

    const capturedSessionId = sessionId
    const capturedGeneration = this.#generation

    this.quotaLoading = true
    const fetchPromise = this.#runRefresh(capturedSessionId, capturedGeneration).finally(() => {
      if (this.#deps.sessionId() === capturedSessionId && this.#generation === capturedGeneration) {
        this.#quotaFetchInFlight = null
      }
    })
    this.#quotaFetchInFlight = fetchPromise
    await fetchPromise
  }

  async #runRefresh(capturedSessionId: string, capturedGeneration: number): Promise<void> {
    const valid = (): boolean =>
      this.#deps.sessionId() === capturedSessionId && this.#generation === capturedGeneration

    const deps: QuotaRefreshDeps = {
      sessionId: () => (valid() ? capturedSessionId : null),
      mockQuota: () => this.#mockQuota,
      ext: () => this.#deps.ext(),
      setQuota: (v) => {
        if (valid()) this.quota = v
      },
      setQuotaLoading: (v) => {
        if (valid()) this.quotaLoading = v
      },
    }
    await doRefreshQuota(deps, capturedSessionId)
  }
}

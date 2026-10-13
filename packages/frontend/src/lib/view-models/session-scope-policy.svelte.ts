/**
 * session-scope-policy.svelte.ts — per-session caller scope policy card (scope-policy-per-caller).
 */

import type {
  ScopeAction,
  ScopePolicy,
  ScopePolicySnapshot,
  ScopePolicySource,
} from "@drive-coding/core/schemas/scope-policy"
import {
  fetchScopePolicyForAgent,
  patchScopePolicyForAgent,
} from "../adapters/scope-policy-api"

export const SCOPE_POLICY_INHERIT = "__inherit__" as const
export type ScopePolicySelectValue = ScopePolicy | typeof SCOPE_POLICY_INHERIT

export class SessionScopePolicy {
  confirmed = $state<ScopePolicySnapshot | null>(null)
  loading = $state(false)
  saving = $state(false)
  error = $state<string | null>(null)
  readbackEpoch = $state(0)

  #agentId: string | null = null
  #beUrlGeneration = 0
  #readGeneration = 0
  #saveGeneration = 0

  constructor(
    private readonly getAgentId: () => string | null,
    private readonly getBeUrl: () => string,
  ) {}

  syncAgent(agentId: string | null): void {
    if (agentId === this.#agentId) return
    this.#agentId = agentId
    this.#invalidateInFlightReads()
    this.confirmed = null
    this.error = null
    if (agentId) void this.refresh()
  }

  noteBeUrlChanged(): void {
    this.#beUrlGeneration += 1
    this.#invalidateInFlightReads()
    this.#saveGeneration += 1
    this.saving = false
    this.loading = false
    this.confirmed = null
    this.error = null
    this.readbackEpoch += 1
  }

  selectValue(action: ScopeAction): ScopePolicySelectValue {
    const snap = this.confirmed
    if (!snap) return SCOPE_POLICY_INHERIT
    return snap.sources[action] === "agent" ? snap.policies[action] : SCOPE_POLICY_INHERIT
  }

  effectiveSource(action: ScopeAction): ScopePolicySource | null {
    return this.confirmed?.sources[action] ?? null
  }

  refresh = async (): Promise<void> => {
    const agentId = this.#agentId
    if (!agentId) return
    const beGen = this.#beUrlGeneration
    const urlAtStart = this.getBeUrl()
    const readGen = ++this.#readGeneration
    this.loading = true
    this.error = null
    try {
      const snap = await fetchScopePolicyForAgent(agentId)
      if (!this.#readStillValid(readGen, beGen, urlAtStart, agentId)) return
      this.confirmed = snap
      this.readbackEpoch += 1
    } catch (e) {
      if (!this.#readStillValid(readGen, beGen, urlAtStart, agentId)) return
      this.confirmed = null
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      if (this.#readStillValid(readGen, beGen, urlAtStart, agentId)) {
        this.loading = false
      }
    }
  }

  setPolicy = async (action: ScopeAction, value: ScopePolicySelectValue): Promise<void> => {
    const agentId = this.#agentId
    if (!agentId || this.saving) return
    const beGen = this.#beUrlGeneration
    const saveGen = ++this.#saveGeneration
    const previous = this.confirmed
    this.saving = true
    this.error = null
    try {
      const policies =
        value === SCOPE_POLICY_INHERIT
          ? { [action]: null }
          : { [action]: value as ScopePolicy }
      const snap = await patchScopePolicyForAgent({ agent: agentId, policies })
      if (beGen !== this.#beUrlGeneration || saveGen !== this.#saveGeneration) return
      this.confirmed = snap
      this.readbackEpoch += 1
      this.#invalidateInFlightReads()
    } catch (e) {
      if (beGen !== this.#beUrlGeneration || saveGen !== this.#saveGeneration) return
      this.confirmed = previous
      this.readbackEpoch += 1
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      if (beGen === this.#beUrlGeneration && saveGen === this.#saveGeneration) {
        this.saving = false
      }
    }
  }

  #invalidateInFlightReads(): void {
    this.#readGeneration += 1
    this.loading = false
  }

  #readStillValid(
    readGen: number,
    beGen: number,
    urlAtStart: string,
    agentId: string,
  ): boolean {
    return (
      readGen === this.#readGeneration &&
      beGen === this.#beUrlGeneration &&
      urlAtStart === this.getBeUrl() &&
      agentId === this.#agentId
    )
  }
}

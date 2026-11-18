/**
 * settings-scope-policy.svelte.ts — server scope policy card state (C3).
 */

import type {
  ScopeAction,
  ScopePolicy,
  ScopePolicySnapshot,
} from "@drive-coding/core/schemas/scope-policy"
import { fetchScopePolicy, patchScopePolicy } from "../adapters/scope-policy-api"

export class SettingsScopePolicy {
  confirmed = $state<ScopePolicySnapshot | null>(null)
  loading = $state(false)
  saving = $state(false)
  error = $state<string | null>(null)
  /** Bumps on readback rollback / BE URL change — remounts Selects to match confirmed. */
  readbackEpoch = $state(0)

  #beUrlGeneration = 0
  /** Monotonic read token: each refresh claims ++; PATCH success / URL change bump invalidates in-flight GETs. */
  #readGeneration = 0
  #saveGeneration = 0

  constructor(private readonly getBeUrl: () => string) {}

  /** Bump when BE URL changes so stale responses and in-flight PATCH are ignored. */
  noteBeUrlChanged(): void {
    this.#beUrlGeneration += 1
    this.#invalidateInFlightReads()
    this.#saveGeneration += 1
    this.saving = false
    this.loading = false
    this.confirmed = null
    this.error = null
    // Safe: noteBeUrlChanged runs from Settings event handlers, not from $effect.
    this.readbackEpoch += 1
  }

  refresh = async (): Promise<void> => {
    const beGen = this.#beUrlGeneration
    const urlAtStart = this.getBeUrl()
    const readGen = ++this.#readGeneration
    this.loading = true
    this.error = null
    try {
      const snap = await fetchScopePolicy()
      if (!this.#readStillValid(readGen, beGen, urlAtStart)) return
      this.confirmed = snap
      this.readbackEpoch += 1
    } catch (e) {
      if (!this.#readStillValid(readGen, beGen, urlAtStart)) return
      this.confirmed = null
      this.error = e instanceof Error ? e.message : String(e)
    } finally {
      if (this.#readStillValid(readGen, beGen, urlAtStart)) {
        this.loading = false
      }
    }
  }

  setPolicy = async (action: ScopeAction, value: ScopePolicy): Promise<void> => {
    if (this.saving) return
    const beGen = this.#beUrlGeneration
    const saveGen = ++this.#saveGeneration
    const previous = this.confirmed
    this.saving = true
    this.error = null
    try {
      const snap = await patchScopePolicy({ policies: { [action]: value } })
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

  /** Invalidate stale GETs; drop loading owned by a read superseded by PATCH / URL change. */
  #invalidateInFlightReads(): void {
    this.#readGeneration += 1
    this.loading = false
  }

  #readStillValid(readGen: number, beGen: number, urlAtStart: string): boolean {
    return (
      readGen === this.#readGeneration &&
      beGen === this.#beUrlGeneration &&
      urlAtStart === this.getBeUrl()
    )
  }
}

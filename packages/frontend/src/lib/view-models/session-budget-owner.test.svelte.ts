import { describe, expect, it, vi } from "vitest"
import { SessionBudgetOwner, type SessionBudgetOwnerDeps } from "./session-budget-owner.svelte"

function makeOwner(overrides?: Partial<SessionBudgetOwnerDeps>) {
  const base: SessionBudgetOwnerDeps = {
    sessionId: () => "s1",
    supportsUsage: () => true,
    isRemote: () => false,
    ext: () => null,
  }
  return new SessionBudgetOwner({ ...base, ...overrides })
}

describe("SessionBudgetOwner", () => {
  it("updateFromView replaces snapshot including null", () => {
    const owner = makeOwner()
    owner.contextUsage = { used: 1, size: 10, cost: { amount: 1, currency: "USD" } }
    owner.quota = { provider: "p", windows: [] }
    owner.updateFromView({ contextUsage: null, quota: null })
    expect(owner.contextUsage).toBeNull()
    expect(owner.quota).toBeNull()
  })

  it("updateFromView full replace drops prior cost when snapshot omits it", () => {
    const owner = makeOwner()
    owner.contextUsage = { used: 1, size: 10, cost: { amount: 0.05, currency: "USD" } }
    owner.updateFromView({
      contextUsage: { used: 20, size: 100, cost: undefined },
      quota: null,
    })
    expect(owner.contextUsage).toEqual({ used: 20, size: 100, cost: undefined })
  })

  it("mergeUsage preserves cost when update omits it", () => {
    const owner = makeOwner()
    owner.contextUsage = { used: 0, size: 100, cost: { amount: 0.05, currency: "USD" } }
    owner.mergeUsage({ used: 50, size: 100, cost: undefined })
    expect(owner.contextUsage).toEqual({
      used: 50,
      size: 100,
      cost: { amount: 0.05, currency: "USD" },
    })
  })

  it("reset clears state, in-flight slot, and bumps generation", async () => {
    const deferred = (() => {
      let resolve!: (v: { provider: string; windows: [] }) => void
      const promise = new Promise<{ provider: string; windows: [] }>((r) => {
        resolve = r
      })
      return { promise, resolve }
    })()
    const getQuota = vi.fn().mockReturnValue(deferred.promise)
    const owner = makeOwner({
      ext: () => ({ getQuota }) as never,
    })
    void owner.refreshQuota()
    expect(owner.quotaLoading).toBe(true)

    owner.contextUsage = { used: 1, size: 2, cost: undefined }
    owner.quota = { provider: "p", windows: [] }
    owner.setMockQuota({ provider: "m", windows: [] })
    const gen0 = owner._generationForTest()
    owner.reset()

    expect(owner.contextUsage).toBeNull()
    expect(owner.quota).toBeNull()
    expect(owner.quotaLoading).toBe(false)
    expect(owner._generationForTest()).toBe(gen0 + 1)

    const p2 = owner.refreshQuota()
    expect(getQuota).toHaveBeenCalledTimes(2)
    deferred.resolve({ provider: "done", windows: [] })
    await p2
    expect(owner.quotaLoading).toBe(false)
  })

  it("stale refresh does not write state or clear new in-flight after reset with same sessionId", async () => {
    const staleSnapshot = { provider: "stale-provider", windows: [{ used: 9, limit: 10 }] }
    const freshSnapshot = { provider: "fresh-provider", windows: [{ used: 1, limit: 10 }] }

    let resolveStale!: (v: typeof staleSnapshot) => void
    const stalePromise = new Promise<typeof staleSnapshot>((r) => {
      resolveStale = r
    })
    let resolveFresh!: (v: typeof freshSnapshot) => void
    const freshPromise = new Promise<typeof freshSnapshot>((r) => {
      resolveFresh = r
    })

    let getQuotaCalls = 0
    const getQuota = vi.fn().mockImplementation(() => {
      getQuotaCalls += 1
      if (getQuotaCalls === 1) return stalePromise
      return freshPromise
    })

    const owner = new SessionBudgetOwner({
      sessionId: () => "s-same",
      supportsUsage: () => true,
      isRemote: () => false,
      ext: () => ({ getQuota }) as never,
    })

    const pStale = owner.refreshQuota()
    expect(getQuota).toHaveBeenCalledTimes(1)
    expect(owner.quotaLoading).toBe(true)

    owner.reset()

    const pFresh = owner.refreshQuota()
    expect(getQuota).toHaveBeenCalledTimes(2)
    expect(owner.quotaLoading).toBe(true)

    resolveStale(staleSnapshot)
    await pStale

    expect(owner.quota).toBeNull()
    expect(owner.quota).not.toEqual(staleSnapshot)
    expect(owner.quotaLoading).toBe(true)
    expect(getQuota).toHaveBeenCalledTimes(2)

    void owner.refreshQuota()
    await Promise.resolve()
    expect(getQuota).toHaveBeenCalledTimes(2)

    resolveFresh(freshSnapshot)
    await pFresh
    expect(owner.quota).toEqual(freshSnapshot)
    expect(getQuota).toHaveBeenCalledTimes(2)
    expect(owner.quotaLoading).toBe(false)
  })
})

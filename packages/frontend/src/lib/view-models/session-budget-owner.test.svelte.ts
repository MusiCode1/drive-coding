import { describe, expect, it, vi } from "vitest"
import {
  SessionBudgetOwner,
  type SessionBudgetOwnerDeps,
} from "./session-budget-owner.svelte"

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

  it("reset clears state and bumps generation", () => {
    const owner = makeOwner()
    owner.contextUsage = { used: 1, size: 2, cost: undefined }
    owner.quota = { provider: "p", windows: [] }
    owner.quotaLoading = true
    owner.setMockQuota({ provider: "m", windows: [] })
    const gen0 = owner._generationForTest()
    owner.reset()
    expect(owner.contextUsage).toBeNull()
    expect(owner.quota).toBeNull()
    expect(owner.quotaLoading).toBe(false)
    expect(owner._generationForTest()).toBe(gen0 + 1)
  })

  it("stale refresh does not write after reset with same sessionId", async () => {
    let sessionId = "s-same"
    const deferred = (() => {
      let resolve!: (v: null) => void
      const promise = new Promise<null>((r) => {
        resolve = r
      })
      return { promise, resolve }
    })()
    const getQuota = vi.fn().mockReturnValue(deferred.promise)
    const owner = new SessionBudgetOwner({
      sessionId: () => sessionId,
      supportsUsage: () => true,
      isRemote: () => false,
      ext: () => ({ getQuota }) as never,
    })
    const p = owner.refreshQuota()
    expect(owner.quotaLoading).toBe(true)
    owner.reset()
    deferred.resolve(null)
    await p
    expect(owner.quota).toBeNull()
    expect(owner.quotaLoading).toBe(false)
  })
})

import { EMPTY_PLAN_STORE } from "@drive-coding/core/acp/plan"
import { describe, expect, it, vi } from "vitest"
import { captureSessionConfig } from "./agent-session-capture-config"
import { SessionBudgetOwner } from "./session-budget-owner.svelte"
import { SessionScope } from "./session-scoped-state.svelte"

function makeCaptureDeps(owner: SessionBudgetOwner, session: SessionScope) {
  return {
    setConfigOptions: vi.fn(),
    setModels: vi.fn(),
    setModes: vi.fn(),
    setAvailableCommands: vi.fn(),
    resetBudget: () => owner.reset(),
    session: () => session,
    setPlanStore: vi.fn(),
  }
}

describe("captureSessionConfig — budget boundary", () => {
  it("resetBudget clears contextUsage, quota, quotaLoading, mockQuota, and bumps generation", async () => {
    const owner = new SessionBudgetOwner({
      sessionId: () => "mock:quota-test",
      supportsUsage: () => true,
      isRemote: () => false,
      ext: () => null,
    })
    owner.contextUsage = { used: 5, size: 100, cost: { amount: 0.1, currency: "USD" } }
    owner.quota = { provider: "p", windows: [] }
    owner.quotaLoading = true
    owner.setMockQuota({
      provider: "mock-p",
      windows: [
        {
          id: "requests",
          period: { kind: "rolling", durationSeconds: 3600 },
          consumption: { kind: "absolute", used: 1, limit: 10, unit: "requests" },
          resetsAtMs: null,
        },
      ],
    })
    const gen0 = owner._generationForTest()

    captureSessionConfig(makeCaptureDeps(owner, new SessionScope("mock:quota-test")), {})

    expect(owner.contextUsage).toBeNull()
    expect(owner.quota).toBeNull()
    expect(owner.quotaLoading).toBe(false)
    expect(owner._generationForTest()).toBe(gen0 + 1)

    await owner.refreshQuota()
    expect(owner.quota).toBeNull()
  })

  it("invokes setPlanStore with empty plan per session boundary", () => {
    const owner = new SessionBudgetOwner({
      sessionId: () => "s1",
      supportsUsage: () => true,
      isRemote: () => false,
      ext: () => null,
    })
    const setPlanStore = vi.fn()
    captureSessionConfig(
      {
        ...makeCaptureDeps(owner, new SessionScope("s1")),
        setPlanStore,
      },
      {},
    )
    expect(setPlanStore).toHaveBeenCalledWith(EMPTY_PLAN_STORE)
  })
})

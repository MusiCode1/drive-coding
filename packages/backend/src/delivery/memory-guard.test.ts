import { describe, expect, it } from "vitest"
import { createMemoryGuard } from "./memory-guard.js"

describe("createMemoryGuard", () => {
  it("rssBudgetMB reflects thresholdBytes", () => {
    const guard = createMemoryGuard({ thresholdBytes: 1500 * 1024 * 1024 })
    expect(guard.rssBudgetMB()).toBe(1500)
    guard.stop()
  })

  it("overBudget starts false for typical process RSS", () => {
    const guard = createMemoryGuard({ thresholdBytes: 16 * 1024 * 1024 * 1024 })
    expect(guard.overBudget()).toBe(false)
    guard.stop()
  })
})

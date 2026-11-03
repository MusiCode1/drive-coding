/**
 * token-usage-store.test.ts — TDD for cycle tracking + disk round-trip (brief §4).
 */

import { describe, expect, it } from "vitest"
import { createInitialTokenUsageRecord, MAX_CYCLES, trackUsage } from "./token-usage-store.js"

function meta(over: Partial<Parameters<typeof createInitialTokenUsageRecord>[0]> = {}) {
  return {
    acpSessionId: "sess-a",
    agentId: "agent-1",
    cliKind: "claude",
    cwd: "/proj",
    now: 1_000,
    used: 50_000,
    size: 1_000_000,
    ...over,
  }
}

describe("trackUsage", () => {
  it("raises peak within same cycle", () => {
    const rec = createInitialTokenUsageRecord(meta({ used: 50_000 }))
    trackUsage(rec, { used: 239_279, size: 1_000_000 }, 2_000)
    expect(rec.cycles).toEqual([{ startedAt: 1_000, peakUsed: 239_279, closedAt: null }])
  })

  it("opens new cycle on compaction (used drop vs peak)", () => {
    const rec = createInitialTokenUsageRecord(meta({ used: 239_279 }))
    trackUsage(rec, { used: 35_985, size: 1_000_000 }, 3_000)
    expect(rec.cycles).toEqual([
      { startedAt: 1_000, peakUsed: 239_279, closedAt: 3_000 },
      { startedAt: 3_000, peakUsed: 35_985, closedAt: null },
    ])
  })

  it("same-cycle rise updates peakUsed (not a new cycle)", () => {
    const rec = createInitialTokenUsageRecord(meta({ used: 50_000 }))
    trackUsage(rec, { used: 91_044, size: 1_000_000 }, 2_000)
    expect(rec.cycles).toHaveLength(1)
    expect(rec.cycles[0]!.peakUsed).toBe(91_044)
  })

  it("stores cost when present; omits currency when absent", () => {
    const rec = createInitialTokenUsageRecord(meta())
    trackUsage(rec, { used: 60_000, size: 1_000_000, cost: { amount: 0.5 } }, 2_000)
    expect(rec.costAmount).toBe(0.5)
    expect(rec.costCurrency).toBeUndefined()
  })

  it("sets cyclesTruncated at MAX_CYCLES without folding tail", () => {
    const rec = createInitialTokenUsageRecord(meta({ used: 1 }))
    rec.cycles = Array.from({ length: MAX_CYCLES }, (_, i) => ({
      startedAt: i,
      peakUsed: i + 1,
      closedAt: i + 1,
    }))
    rec.cycles[MAX_CYCLES - 1]!.closedAt = null
    trackUsage(rec, { used: 0, size: 100 }, 9_999)
    expect(rec.cycles).toHaveLength(MAX_CYCLES)
    expect(rec.cyclesTruncated).toBe(true)
  })
})

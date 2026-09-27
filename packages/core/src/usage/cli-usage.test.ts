import { describe, expect, it } from "vitest"
import { compactionsFromCycles, peakOfCycles, sumOfCyclePeaks } from "./cli-usage.js"

describe("compactionsFromCycles", () => {
  it("returns 0 for empty or single cycle", () => {
    expect(compactionsFromCycles([])).toBe(0)
    expect(compactionsFromCycles([{ peakUsed: 1 }])).toBe(0)
  })

  it("returns length - 1 for multiple cycles", () => {
    expect(compactionsFromCycles([{ peakUsed: 1 }, { peakUsed: 2 }])).toBe(1)
    expect(compactionsFromCycles([{ peakUsed: 1 }, { peakUsed: 2 }, { peakUsed: 3 }])).toBe(2)
  })
})

describe("sumOfCyclePeaks", () => {
  it("sums peakUsed across cycles", () => {
    expect(sumOfCyclePeaks([{ peakUsed: 10 }, { peakUsed: 20 }])).toBe(30)
  })
})

describe("peakOfCycles", () => {
  it("returns max peakUsed", () => {
    expect(peakOfCycles([{ peakUsed: 10 }, { peakUsed: 25 }, { peakUsed: 15 }])).toBe(25)
  })

  it("returns 0 for empty", () => {
    expect(peakOfCycles([])).toBe(0)
  })
})

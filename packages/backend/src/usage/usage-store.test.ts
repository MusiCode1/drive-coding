/**
 * usage-store.test.ts — TDD for in-memory aggregation (record/summary).
 * IO (flush/load) is tested manually per the brief.
 */

import { describe, expect, it } from "vitest"
import { createUsageStore } from "./usage-store.js"

// Helper: create a store backed by an in-memory no-op dir (no IO in tests)
// We pass a tempdir-like path — the store constructs it, but in these unit tests
// we test record()+summary() only (no real flush/load).
function makeStore() {
  // In-process test: we don't need real IO; pass a dummy path.
  // The store loads totals.json on construct (file won't exist → zeros, caught).
  return createUsageStore(`/tmp/test-usage-store-nonexistent-${Date.now()}`)
}

describe("UsageStore — initial state", () => {
  it("starts with zero totals for both providers", () => {
    const store = makeStore()
    const summary = store.summary()
    expect(summary.elevenlabs.requests).toBe(0)
    expect(summary.elevenlabs.cacheHits).toBe(0)
    expect(summary.elevenlabs.chars).toBe(0)
    expect(summary.elevenlabs.costUsd).toBe(0)
    expect(summary.google.requests).toBe(0)
    expect(summary.google.costUsd).toBe(0)
  })
})

describe("UsageStore — record elevenlabs cache miss", () => {
  it("increments requests, chars, costUsd; cacheHits stays 0", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 100,
      costUsd: 0.018,
    })
    const s = store.summary()
    expect(s.elevenlabs.requests).toBe(1)
    expect(s.elevenlabs.cacheHits).toBe(0)
    expect(s.elevenlabs.chars).toBe(100)
    expect(s.elevenlabs.costUsd).toBeCloseTo(0.018, 6)
  })
})

describe("UsageStore — record elevenlabs cache hit", () => {
  it("increments requests and cacheHits; cost stays 0", () => {
    const store = makeStore()
    store.record({ ts: Date.now(), provider: "elevenlabs", cached: true, costUsd: 0 })
    const s = store.summary()
    expect(s.elevenlabs.requests).toBe(1)
    expect(s.elevenlabs.cacheHits).toBe(1)
    expect(s.elevenlabs.costUsd).toBe(0)
  })
})

describe("UsageStore — record google (always miss)", () => {
  it("increments google requests, inputTokens, audioTokens, cost", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "google",
      cached: false,
      inputTokens: 100,
      audioTokens: 500,
      costUsd: 0.0101,
    })
    const s = store.summary()
    expect(s.google.requests).toBe(1)
    expect(s.google.cacheHits).toBe(0)
    expect(s.google.inputTokens).toBe(100)
    expect(s.google.audioTokens).toBe(500)
    expect(s.google.costUsd).toBeCloseTo(0.0101, 6)
  })
})

describe("UsageStore — accumulation across multiple records", () => {
  it("sums all fields correctly", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 100,
      costUsd: 0.018,
    })
    store.record({ ts: Date.now(), provider: "elevenlabs", cached: true, costUsd: 0 })
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 200,
      costUsd: 0.036,
    })
    const s = store.summary()
    expect(s.elevenlabs.requests).toBe(3)
    expect(s.elevenlabs.cacheHits).toBe(1)
    expect(s.elevenlabs.chars).toBe(300)
    expect(s.elevenlabs.costUsd).toBeCloseTo(0.054, 6)
  })

  it("accumulates google tokens independently", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "google",
      cached: false,
      inputTokens: 100,
      audioTokens: 400,
      costUsd: 0.0081,
    })
    store.record({
      ts: Date.now(),
      provider: "google",
      cached: false,
      inputTokens: 50,
      audioTokens: 200,
      costUsd: 0.004,
    })
    const s = store.summary()
    expect(s.google.requests).toBe(2)
    expect(s.google.inputTokens).toBe(150)
    expect(s.google.audioTokens).toBe(600)
    expect(s.google.costUsd).toBeCloseTo(0.0121, 6)
  })

  it("google and elevenlabs counters are independent", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 50,
      costUsd: 0.009,
    })
    store.record({
      ts: Date.now(),
      provider: "google",
      cached: false,
      inputTokens: 10,
      audioTokens: 100,
      costUsd: 0.002,
    })
    const s = store.summary()
    expect(s.elevenlabs.requests).toBe(1)
    expect(s.google.requests).toBe(1)
    expect(s.elevenlabs.chars).toBe(50)
    expect(s.google.inputTokens).toBe(10)
  })
})

describe("UsageStore — summary() is immutable snapshot", () => {
  it("does not change after further records", () => {
    const store = makeStore()
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 100,
      costUsd: 0.018,
    })
    const snap1 = store.summary()
    store.record({
      ts: Date.now(),
      provider: "elevenlabs",
      cached: false,
      chars: 200,
      costUsd: 0.036,
    })
    const snap2 = store.summary()
    // snap1 should not be affected by the second record
    expect(snap1.elevenlabs.chars).toBe(100)
    expect(snap2.elevenlabs.chars).toBe(300)
  })
})

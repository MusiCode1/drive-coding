/**
 * pricing.test.ts — TDD for TTS_PRICING, elevenLabsCostUsd, geminiCostUsd
 * Commit 0: RED first, then GREEN
 */

import { describe, expect, it } from "vitest"
import { elevenLabsCostUsd, geminiCostUsd, TTS_PRICING } from "./pricing.js"

describe("TTS_PRICING snapshot", () => {
  it("has elevenlabs price", () => {
    expect(TTS_PRICING.elevenlabs.usdPer1kChars).toBeGreaterThan(0)
  })

  it("has google input and audio prices", () => {
    expect(TTS_PRICING.google.usdPer1mInputTokens).toBeGreaterThan(0)
    expect(TTS_PRICING.google.usdPer1mAudioTokens).toBeGreaterThan(0)
  })
})

describe("elevenLabsCostUsd", () => {
  it("returns 0 for 0 chars", () => {
    expect(elevenLabsCostUsd(0)).toBe(0)
  })

  it("returns correct cost for 1000 chars", () => {
    // 1000 chars * (0.18 / 1000) = 0.18
    const cost = elevenLabsCostUsd(1000)
    expect(cost).toBeCloseTo(0.18, 6)
  })

  it("returns correct cost for 500 chars", () => {
    // 500 chars * (0.18 / 1000) = 0.09
    expect(elevenLabsCostUsd(500)).toBeCloseTo(0.09, 6)
  })

  it("scales linearly", () => {
    const half = elevenLabsCostUsd(500)
    const full = elevenLabsCostUsd(1000)
    expect(full).toBeCloseTo(half * 2, 10)
  })
})

describe("geminiCostUsd", () => {
  it("returns 0 for 0 tokens", () => {
    expect(geminiCostUsd(0, 0)).toBe(0)
  })

  it("calculates input token cost correctly", () => {
    // 1_000_000 input tokens at $1/million = $1
    expect(geminiCostUsd(1_000_000, 0)).toBeCloseTo(1.0, 6)
  })

  it("calculates audio token cost correctly", () => {
    // 1_000_000 audio tokens at $20/million = $20
    expect(geminiCostUsd(0, 1_000_000)).toBeCloseTo(20.0, 6)
  })

  it("combines input and audio tokens", () => {
    // 1M input ($1) + 100k audio ($2) = $3
    expect(geminiCostUsd(1_000_000, 100_000)).toBeCloseTo(3.0, 6)
  })

  it("scales correctly for small counts", () => {
    // 100 input tokens: 100 / 1_000_000 * 1.0 = 0.0001
    expect(geminiCostUsd(100, 0)).toBeCloseTo(0.0001, 8)
  })
})

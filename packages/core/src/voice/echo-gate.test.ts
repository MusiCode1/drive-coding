/**
 * echo-gate.test.ts — TDD for shouldForwardFrame (manual echo gate, no AEC).
 *
 * Slice: live-ears, Commit 2.
 */

import { describe, expect, it } from "vitest"
import {
  MIN_BARGE_IN_LEVEL,
  OUTPUT_ACTIVE_LEVEL,
  OUTPUT_ECHO_RATIO,
  shouldForwardFrame,
} from "./echo-gate"

describe("shouldForwardFrame", () => {
  it("forwards when output is silent", () => {
    expect(shouldForwardFrame(0.01, 0)).toBe(true)
    expect(shouldForwardFrame(0.01, OUTPUT_ACTIVE_LEVEL)).toBe(true)
  })

  it("blocks quiet input while output is active (echo suppression)", () => {
    const outputLevel = 0.1
    const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, outputLevel * OUTPUT_ECHO_RATIO)
    expect(shouldForwardFrame(echoThreshold - 0.001, outputLevel)).toBe(false)
  })

  it("forwards barge-in when input exceeds echo threshold", () => {
    const outputLevel = 0.2
    const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, outputLevel * OUTPUT_ECHO_RATIO)
    expect(shouldForwardFrame(echoThreshold + 0.001, outputLevel)).toBe(true)

    const loudOutput = 0.5
    const loudThreshold = Math.max(MIN_BARGE_IN_LEVEL, loudOutput * OUTPUT_ECHO_RATIO)
    expect(shouldForwardFrame(loudThreshold + 0.001, loudOutput)).toBe(true)
  })

  it("forwards when input exceeds output-scaled echo threshold", () => {
    const outputLevel = 0.03
    const echoThreshold = Math.max(MIN_BARGE_IN_LEVEL, outputLevel * OUTPUT_ECHO_RATIO)
    expect(shouldForwardFrame(echoThreshold + 0.001, outputLevel)).toBe(true)
  })

  it("does not block barge-in at MIN_BARGE_IN_LEVEL boundary", () => {
    expect(shouldForwardFrame(MIN_BARGE_IN_LEVEL, OUTPUT_ACTIVE_LEVEL + 0.01)).toBe(true)
  })
})

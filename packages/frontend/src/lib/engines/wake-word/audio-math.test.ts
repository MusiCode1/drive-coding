/**
 * Tests for audio-math.ts — computeRms + transformMel.
 * Pure functions, no DOM, no ort dependency.
 */

import { describe, expect, test } from "vitest"
import { computeRms, transformMel } from "./audio-math.js"

describe("computeRms", () => {
  test("all zeros → 0", () => {
    const chunk = new Float32Array(10).fill(0)
    expect(computeRms(chunk)).toBe(0)
  })

  test("sine wave RMS ≈ 1/√2 ≈ 0.707 for amplitude 1", () => {
    // one full period of sin wave, 128 samples
    const chunk = new Float32Array(128)
    for (let i = 0; i < 128; i++) {
      chunk[i] = Math.sin((2 * Math.PI * i) / 128)
    }
    expect(computeRms(chunk)).toBeCloseTo(1 / Math.SQRT2, 3)
  })

  test("constant 1.0 → RMS = 1", () => {
    const chunk = new Float32Array(64).fill(1)
    expect(computeRms(chunk)).toBeCloseTo(1.0, 6)
  })

  test("constant -0.5 → RMS = 0.5 (absolute)", () => {
    const chunk = new Float32Array(64).fill(-0.5)
    expect(computeRms(chunk)).toBeCloseTo(0.5, 6)
  })
})

describe("transformMel", () => {
  test("0.0 → 0/10 + 2 = 2.0", () => {
    const data = new Float32Array([0.0])
    transformMel(data)
    expect(data[0]).toBeCloseTo(2.0, 6)
  })

  test("10.0 → 10/10 + 2 = 3.0", () => {
    const data = new Float32Array([10.0])
    transformMel(data)
    expect(data[0]).toBeCloseTo(3.0, 6)
  })

  test("-20.0 → -20/10 + 2 = 0.0", () => {
    const data = new Float32Array([-20.0])
    transformMel(data)
    expect(data[0]).toBeCloseTo(0.0, 6)
  })

  test("transforms all elements in-place", () => {
    const data = new Float32Array([0.0, 10.0, -10.0, 20.0])
    transformMel(data)
    expect(data[0]).toBeCloseTo(2.0, 6)
    expect(data[1]).toBeCloseTo(3.0, 6)
    expect(data[2]).toBeCloseTo(1.0, 6)
    expect(data[3]).toBeCloseTo(4.0, 6)
  })
})

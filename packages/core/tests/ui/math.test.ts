/**
 * Tests for `lerp` — linear interpolation utility.
 * Pure function — no mocks needed.
 */

import { describe, expect, test } from "vitest"
import { lerp } from "../../src/ui/math.js"

describe("lerp — linear interpolation", () => {
  test("midpoint: lerp(0, 10, 0.5) === 5", () => {
    expect(lerp(0, 10, 0.5)).toBe(5)
  })

  test("same value: lerp(5, 5, x) === 5 (any factor)", () => {
    expect(lerp(5, 5, 0)).toBe(5)
    expect(lerp(5, 5, 0.5)).toBe(5)
    expect(lerp(5, 5, 1)).toBe(5)
  })

  test("factor=0 → returns current", () => {
    expect(lerp(7, 42, 0)).toBe(7)
  })

  test("factor=1 → returns target", () => {
    expect(lerp(7, 42, 1)).toBe(42)
  })

  test("fractional result", () => {
    expect(lerp(0, 1, 0.25)).toBeCloseTo(0.25)
  })
})

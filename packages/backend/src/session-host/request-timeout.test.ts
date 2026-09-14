/**
 * request-timeout.test.ts — the PERMISSION_TIMEOUT_MS / ELICITATION_TIMEOUT_MS parser.
 */

import { describe, expect, it } from "vitest"
import { MAX_TIMEOUT_MS, resolveRequestTimeoutMs } from "./request-timeout.js"

describe("resolveRequestTimeoutMs", () => {
  const cases: Array<[string | undefined, number | null]> = [
    // No timeout is the default: an unanswered question must not answer itself.
    [undefined, null],
    ["", null],
    ["   ", null],
    ["abc", null],
    ["0", null],
    ["-5", null],
    ["never", null],
    ["off", null],
    ["NEVER", null],
    // ⚠️ The regression this table exists for. Node coerces these to 1ms, so
    // passing them through would cancel the request almost instantly — far
    // worse than the finite timeout the caller was trying to disable.
    ["Infinity", null],
    ["2147483648", null],
    // Valid values, including the exact ceiling.
    ["5000", 5000],
    ["1.5e4", 15000],
    ["2147483647", MAX_TIMEOUT_MS],
  ]

  for (const [raw, expected] of cases) {
    it(`resolveRequestTimeoutMs(${JSON.stringify(raw)}) → ${expected}`, () => {
      expect(resolveRequestTimeoutMs(raw)).toBe(expected)
    })
  }

  // 🔴 Guards the reason the ceiling exists at all: every accepted value must
  // survive setTimeout without Node clamping it to 1ms.
  it("every accepted value is a delay setTimeout takes literally", () => {
    for (const [, expected] of cases) {
      if (expected === null) continue
      expect(expected).toBeLessThanOrEqual(2_147_483_647)
      expect(expected).toBeGreaterThan(0)
    }
  })
})

/**
 * unprompted-guard.test.ts — TDD for unprompted send guard.
 *
 * Slice: live-unprompted-guard, Commit 0.
 * DoD 8 (no marker coupling) — verified via rg on this file + unprompted-guard.ts.
 */

import { describe, expect, it } from "vitest"
import { isUnpromptedSend } from "./unprompted-guard"

describe("isUnpromptedSend", () => {
  it("true when deliveredSinceUserSpoke flag is on", () => {
    expect(isUnpromptedSend({ deliveredSinceUserSpoke: true })).toBe(true)
  })

  it("false when deliveredSinceUserSpoke flag is off", () => {
    expect(isUnpromptedSend({ deliveredSinceUserSpoke: false })).toBe(false)
  })
})

/**
 * capabilities.test.ts — unit tests for mapClaudeCapabilities (slice session-fork-ui, Commit 0).
 *
 * fork: true is claude-only (dynamic caps, derived from the live initialize response by
 * this mapper — not from capabilities-static.ts, which stays conservative/undefined for fork).
 */

import { describe, expect, it } from "vitest"
import { mapClaudeCapabilities } from "./capabilities.js"

describe("mapClaudeCapabilities", () => {
  it("fork: true (unstable_forkSession available for claude)", () => {
    const caps = mapClaudeCapabilities({ agentCapabilities: {} })
    expect(caps.fork).toBe(true)
  })

  it("rename: true alongside fork: true (existing dynamic caps unaffected)", () => {
    const caps = mapClaudeCapabilities({ agentCapabilities: {} })
    expect(caps.rename).toBe(true)
    expect(caps.fork).toBe(true)
  })
})

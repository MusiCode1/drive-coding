/**
 * permission-mode.test.ts — TDD
 * approach: TDD (commit 0, slice leave-running-background)
 *
 * 4 cases:
 *   claude + "bypassPermissions" → true
 *   claude + "default"           → false
 *   opencode + any value         → false
 *   null / undefined             → false
 */
import { describe, it, expect } from "vitest"
import { isBypassMode } from "./permission-mode.js"

describe("isBypassMode", () => {
  it("claude + bypassPermissions → true", () => {
    expect(isBypassMode("claude", "bypassPermissions")).toBe(true)
  })

  it("claude + default → false", () => {
    expect(isBypassMode("claude", "default")).toBe(false)
  })

  it("opencode + bypassPermissions → false", () => {
    // opencode has no known bypass mode yet
    expect(isBypassMode("opencode", "bypassPermissions")).toBe(false)
  })

  it("opencode + any value → false", () => {
    expect(isBypassMode("opencode", "someMode")).toBe(false)
  })

  it("null cliKind → false", () => {
    expect(isBypassMode(null, "bypassPermissions")).toBe(false)
  })

  it("null currentModeId → false", () => {
    expect(isBypassMode("claude", null)).toBe(false)
  })

  it("undefined currentModeId → false", () => {
    expect(isBypassMode("claude", undefined)).toBe(false)
  })
})

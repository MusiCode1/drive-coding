/**
 * should-warn-on-leave.test.ts — TDD for HTTP skip of leave warnings (slice connection-set C3).
 */
import { describe, expect, it } from "vitest"
import { shouldWarnOnLeave } from "./should-warn-on-leave.js"

describe("shouldWarnOnLeave", () => {
  it("returns false for remote HTTP viewer with active turn", () => {
    expect(
      shouldWarnOnLeave({
        isRemote: true,
        bypassActive: false,
        turnIdle: false,
        suppress: false,
      }),
    ).toBe(false)
  })

  it("returns true for local WS session with active turn", () => {
    expect(
      shouldWarnOnLeave({
        isRemote: false,
        bypassActive: false,
        turnIdle: false,
        suppress: false,
      }),
    ).toBe(true)
  })

  it("returns false when bypassActive", () => {
    expect(
      shouldWarnOnLeave({
        isRemote: false,
        bypassActive: true,
        turnIdle: false,
        suppress: false,
      }),
    ).toBe(false)
  })

  it("returns false when turn is idle", () => {
    expect(
      shouldWarnOnLeave({
        isRemote: false,
        bypassActive: false,
        turnIdle: true,
        suppress: false,
      }),
    ).toBe(false)
  })

  it("returns false when suppress is set (modal only)", () => {
    expect(
      shouldWarnOnLeave({
        isRemote: false,
        bypassActive: false,
        turnIdle: false,
        suppress: true,
      }),
    ).toBe(false)
  })
})

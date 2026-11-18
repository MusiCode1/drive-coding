import { describe, expect, it } from "vitest"
import { createInitialSessionState } from "@drive-coding/core/session"
import {
  DEFAULT_CLOSE_ON_TURN_END_GRACE_MS,
  isCleanTurnEndForClose,
  resolveCloseOnTurnEndGraceMs,
} from "./close-on-turn-end.js"

describe("resolveCloseOnTurnEndGraceMs", () => {
  it("defaults when unset", () => {
    expect(resolveCloseOnTurnEndGraceMs(undefined)).toBe(DEFAULT_CLOSE_ON_TURN_END_GRACE_MS)
  })

  it("accepts 0 (next tick)", () => {
    expect(resolveCloseOnTurnEndGraceMs("0")).toBe(0)
  })

  it("rejects negative and NaN", () => {
    expect(resolveCloseOnTurnEndGraceMs("-1")).toBe(DEFAULT_CLOSE_ON_TURN_END_GRACE_MS)
    expect(resolveCloseOnTurnEndGraceMs("nope")).toBe(DEFAULT_CLOSE_ON_TURN_END_GRACE_MS)
  })
})

describe("isCleanTurnEndForClose", () => {
  it("allows idle with no error and no pending permission", () => {
    const state = createInitialSessionState({ sessionId: "s1" })
    expect(isCleanTurnEndForClose(state)).toBe(true)
  })

  it("blocks when lastTurnError is set (non-clean stopReason landed via reduce)", () => {
    const state = {
      ...createInitialSessionState({ sessionId: "s1" }),
      lastTurnError: { message: "max_tokens", at: 1 },
    }
    expect(isCleanTurnEndForClose(state)).toBe(false)
  })

  it("blocks when permission is pending", () => {
    const base = createInitialSessionState({ sessionId: "s1" })
    const state = {
      ...base,
      pending: {
        ...base.pending,
        permission: { requestId: 0, params: {} as never },
      },
    }
    expect(isCleanTurnEndForClose(state)).toBe(false)
  })
})

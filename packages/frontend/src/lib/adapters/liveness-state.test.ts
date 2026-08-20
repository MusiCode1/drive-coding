/**
 * liveness-state.test.ts — ממדי liveness (slice liveness C4, DoD #19).
 */
import { describe, expect, it } from "vitest"
import {
  isAgentConnected,
  isAgentResumable,
  isAgentRunning,
  LIVENESS_FRESH_MS,
} from "./liveness-state"

const NOW = 1_700_000_000_000

describe("isAgentRunning", () => {
  it("ready/busy/starting → true", () => {
    expect(isAgentRunning({ status: "ready" })).toBe(true)
    expect(isAgentRunning({ status: "busy" })).toBe(true)
    expect(isAgentRunning({ status: "starting" })).toBe(true)
  })

  it("crashed/closed → false", () => {
    expect(isAgentRunning({ status: "crashed" })).toBe(false)
    expect(isAgentRunning({ status: "closed" })).toBe(false)
  })
})

describe("isAgentConnected", () => {
  it("attached + fresh lastSeenAt → true", () => {
    expect(
      isAgentConnected({ attached: true, lastSeenAt: NOW - 1000 }, NOW),
    ).toBe(true)
  })

  it("attached בלבד (בלי lastSeenAt) → false", () => {
    expect(isAgentConnected({ attached: true, lastSeenAt: null }, NOW)).toBe(false)
  })

  it("attached + stale lastSeenAt → false", () => {
    expect(
      isAgentConnected(
        { attached: true, lastSeenAt: NOW - LIVENESS_FRESH_MS - 1 },
        NOW,
      ),
    ).toBe(false)
  })

  it("לא attached → false גם עם lastSeenAt", () => {
    expect(isAgentConnected({ attached: false, lastSeenAt: NOW }, NOW)).toBe(false)
  })
})

describe("isAgentResumable", () => {
  it("רץ + לא מחובר + acpSessionId → true", () => {
    expect(
      isAgentResumable(
        {
          status: "ready",
          attached: false,
          lastSeenAt: null,
          acpSessionId: "sess-1",
        },
        NOW,
      ),
    ).toBe(true)
  })

  it("מחובר → לא resumable", () => {
    expect(
      isAgentResumable(
        {
          status: "ready",
          attached: true,
          lastSeenAt: NOW,
          acpSessionId: "sess-1",
        },
        NOW,
      ),
    ).toBe(false)
  })

  it("בלי acpSessionId → לא resumable", () => {
    expect(
      isAgentResumable(
        { status: "ready", attached: false, lastSeenAt: null, acpSessionId: undefined },
        NOW,
      ),
    ).toBe(false)
  })
})

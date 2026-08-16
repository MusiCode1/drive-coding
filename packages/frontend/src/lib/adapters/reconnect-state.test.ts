/**
 * reconnect-state.test.ts — סלייס reconnect-ws-takeover Commit 2 + liveness C4.
 */
import { describe, expect, it } from "vitest"
import {
  hasConnectionRing,
  isAgentConnected,
  isAgentResumable,
  isAgentRunning,
  reconnectState,
} from "./reconnect-state"
import { LIVENESS_FRESH_MS } from "./liveness-state"

const NOW = 1_700_000_000_000

describe("reconnectState", () => {
  it('אין acpSessionId → "disabled"', () => {
    expect(reconnectState({ acpSessionId: undefined, attached: undefined })).toBe("disabled")
    expect(reconnectState({ acpSessionId: undefined, attached: true })).toBe("disabled")
  })

  it('acpSessionId + attached===true → "takeover"', () => {
    expect(reconnectState({ acpSessionId: "sess-1", attached: true })).toBe("takeover")
  })

  it('acpSessionId + לא attached → "reconnect"', () => {
    expect(reconnectState({ acpSessionId: "sess-1", attached: false })).toBe("reconnect")
    expect(reconnectState({ acpSessionId: "sess-1", attached: undefined })).toBe("reconnect")
  })
})

describe("hasConnectionRing", () => {
  it("attached + lastSeenAt טרי → true", () => {
    expect(
      hasConnectionRing({ attached: true, lastSeenAt: NOW - 1000, status: "ready" }, NOW),
    ).toBe(true)
  })

  it("attached בלבד (בלי lastSeenAt) → false — attached ≠ מחובר", () => {
    expect(hasConnectionRing({ attached: true, lastSeenAt: null, status: "ready" }, NOW)).toBe(
      false,
    )
  })

  it("attached + stale → false", () => {
    expect(
      hasConnectionRing(
        {
          attached: true,
          lastSeenAt: NOW - LIVENESS_FRESH_MS - 1,
          status: "ready",
        },
        NOW,
      ),
    ).toBe(false)
  })

  it("לא attached → false", () => {
    expect(hasConnectionRing({ attached: false, lastSeenAt: NOW, status: "ready" }, NOW)).toBe(
      false,
    )
  })
})

describe("three dimensions (DoD #19)", () => {
  it("attached בלבד ≠ connected", () => {
    const agent = {
      status: "ready" as const,
      attached: true,
      lastSeenAt: null,
      acpSessionId: "sess-1",
    }
    expect(isAgentRunning(agent)).toBe(true)
    expect(isAgentConnected(agent, NOW)).toBe(false)
    expect(hasConnectionRing(agent, NOW)).toBe(false)
    expect(isAgentResumable(agent, NOW)).toBe(true)
  })
})

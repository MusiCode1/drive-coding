/**
 * reconnect-state.test.ts — סלייס reconnect-ws-takeover Commit 2.
 * 3 המצבים של reconnectState לפי §4 Commit 2 של הבריף.
 */
import { describe, expect, it } from "vitest"
import { reconnectState } from "./reconnect-state"

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

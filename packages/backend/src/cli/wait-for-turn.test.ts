import { describe, expect, it } from "vitest"
import { sessionUpdateOf, turnStateOf, updatesFromSseData } from "./wait-for-turn.js"

describe("updatesFromSseData", () => {
  it("reads snapshot {updates:[...]}", () => {
    const items = updatesFromSseData({
      sessionId: "s",
      updates: [{ sessionUpdate: "state_update", state: "idle" }],
    })
    expect(items).toHaveLength(1)
  })

  it("reads event:update as a bare array", () => {
    const items = updatesFromSseData([
      {
        jsonrpc: "2.0",
        method: "session/update",
        params: { update: { sessionUpdate: "state_update", state: "running" } },
      },
    ])
    expect(items).toHaveLength(1)
    const u = sessionUpdateOf(items[0])
    expect(u?.state).toBe("running")
  })
})

describe("turnStateOf", () => {
  it("prefers _meta[_drive/turnState] over coarse state", () => {
    const ts = turnStateOf({
      sessionUpdate: "state_update",
      state: "running",
      _meta: { "_drive/turnState": "thinking" },
    })
    expect(ts).toBe("thinking")
  })
})

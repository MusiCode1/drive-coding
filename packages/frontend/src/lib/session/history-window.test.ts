import { createInitialSessionState, snapshotPayload } from "@drive-coding/core/session"
import { describe, expect, it } from "vitest"
import { foldPage, isOutsideWindow, windowFromPayload } from "./history-window"

describe("history-window", () => {
  it("foldPage merges tail updates into meta state", () => {
    const meta = createInitialSessionState({ sessionId: "s1" })
    const full = createInitialSessionState({ sessionId: "s1" })
    full.messages.push({
      id: "m_1",
      role: "user",
      messageId: null,
      segments: [{ id: "s_0", text: "hi" }],
    })
    const payload = snapshotPayload(full, undefined, { range: { tail: true, maxBytes: 262_144 } })
    const merged = foldPage(meta, payload)
    expect(merged.messages).toHaveLength(1)
    expect(merged.version).toBe(payload.version)
  })

  it("isOutsideWindow drops seq below firstSeq", () => {
    const window = windowFromPayload(3, { firstSeq: 5, lastSeq: 10, hasMore: true })
    expect(isOutsideWindow(4, window)).toBe(true)
    expect(isOutsideWindow(5, window)).toBe(false)
  })
})

import { createInitialSessionState, reduce, snapshotPayload } from "@drive-coding/core/session"
import { describe, expect, it } from "vitest"
import { foldPage, isOutsideWindow, mergeOlder, windowFromPayload } from "./history-window"

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

  it("prepends only the earlier messages, leaving the live cursor and metadata intact", () => {
    const seed = createInitialSessionState({ sessionId: "s1" })
    const full = ["first", "last"].reduce(
      (state, text) =>
        reduce(state, {
          sessionUpdate: "user_message",
          messageId: text,
          content: { type: "text", text },
        }).state,
      seed,
    )
    const tail = snapshotPayload(full, undefined, { range: { tail: true, maxBytes: 1 } })
    const state = { ...foldPage(seed, tail), version: 8, turnState: "responding" as const }
    const window = windowFromPayload(2, tail.page)
    const page = snapshotPayload(full, undefined, { range: { before: 1, maxBytes: 1 } })
    const merged = mergeOlder(state, window, page)

    expect(merged).toEqual({
      state: { ...state, messages: [expect.objectContaining({ id: "m_0" }), state.messages[0]] },
      window: { ...window, firstSeq: 0, hasMore: false },
    })
  })

  it.each([0, 2])("rejects a page with a nonadjacent lastSeq (%s)", (lastSeq) => {
    const state = createInitialSessionState({ sessionId: "s1" })
    const window = windowFromPayload(2, { firstSeq: 2, lastSeq: 4, hasMore: true })
    const page = {
      version: 3,
      sessionId: "s1",
      updates: [],
      page: { firstSeq: 0, lastSeq, hasMore: false },
    }
    expect(mergeOlder(state, window, page)).toEqual({ conflict: true })
  })
})

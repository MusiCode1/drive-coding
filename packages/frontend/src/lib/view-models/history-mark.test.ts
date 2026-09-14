import { describe, expect, it } from "vitest"
import { historyMarkFromReset } from "./history-mark.js"

describe("historyMarkFromReset", () => {
  it("assistant messages → segmentCounts by bubble id", () => {
    const mark = historyMarkFromReset([
      {
        id: "m_0",
        role: "assistant",
        messageId: "p1",
        segments: [
          { id: "s_0", text: "a" },
          { id: "s_1", text: "b" },
        ],
      },
    ])
    expect(mark.segmentCounts.get("m_0")).toBe(2)
    expect(mark.toolCallIds).toEqual([])
  })

  it("thought messages → segmentCounts", () => {
    const mark = historyMarkFromReset([
      {
        id: "t_0",
        role: "thought",
        messageId: "p1",
        segments: [{ id: "s_0", text: "hmm" }],
      },
    ])
    expect(mark.segmentCounts.get("t_0")).toBe(1)
  })

  it("tool messages → toolCallIds", () => {
    const mark = historyMarkFromReset([
      {
        id: "tc_bubble",
        role: "tool",
        messageId: null,
        toolCall: {
          toolCallId: "tc_1",
          name: "bash",
          status: "completed",
          args: {},
        },
      },
    ])
    expect(mark.toolCallIds).toEqual(["tc_1"])
    expect(mark.segmentCounts.size).toBe(0)
  })

  it("mixed messages", () => {
    const mark = historyMarkFromReset([
      {
        id: "m_0",
        role: "assistant",
        messageId: "p1",
        segments: [{ id: "s_0", text: "hi" }],
      },
      {
        id: "tc_bubble",
        role: "tool",
        messageId: null,
        toolCall: {
          toolCallId: "tc_1",
          name: "bash",
          status: "completed",
          args: {},
        },
      },
    ])
    expect(mark.segmentCounts.get("m_0")).toBe(1)
    expect(mark.toolCallIds).toEqual(["tc_1"])
  })

  it("empty messages → empty mark", () => {
    const mark = historyMarkFromReset([])
    expect(mark.segmentCounts.size).toBe(0)
    expect(mark.toolCallIds).toEqual([])
  })

  it("message with zero segments → count 0", () => {
    const mark = historyMarkFromReset([
      {
        id: "m_0",
        role: "assistant",
        messageId: "p1",
        segments: [],
      },
    ])
    expect(mark.segmentCounts.get("m_0")).toBe(0)
  })

  it("user messages are skipped", () => {
    const mark = historyMarkFromReset([
      {
        id: "u_0",
        role: "user",
        messageId: "p1",
        segments: [{ id: "s_0", text: "hello" }],
      },
      {
        id: "m_0",
        role: "assistant",
        messageId: "p2",
        segments: [{ id: "s_1", text: "hi" }],
      },
    ])
    expect(mark.segmentCounts.has("u_0")).toBe(false)
    expect(mark.segmentCounts.get("m_0")).toBe(1)
  })
})

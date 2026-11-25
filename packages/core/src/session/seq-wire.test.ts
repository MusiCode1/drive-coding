/**
 * slice fast-session-open-1 — Commit 1: `_drive/seq` on the wire and in reduce.
 */
import { describe, expect, it } from "vitest"
import { applyPatch } from "./apply-patch.js"
import { reduce } from "./reduce.js"
import { patchToSessionUpdates, SEQ_META_KEY, stateToSessionUpdates } from "./to-session-update.js"
import type { SessionState } from "./types.js"
import { createInitialSessionState } from "./types.js"

const mk = (overrides?: Partial<SessionState>): SessionState => ({
  ...createInitialSessionState({ sessionId: "s-1" }),
  nextMessageSeq: 500,
  ...overrides,
})

function meaningful(s: SessionState) {
  const { version: _v, nextMessageSeq: _m, nextSegmentSeq: _g, ...rest } = s
  return {
    ...rest,
    messages: rest.messages.map((m) =>
      m.role === "tool" ? m : { ...m, segments: m.segments.map((x) => x.text).join("") },
    ),
  }
}

function play(updates: unknown[], from: SessionState): SessionState {
  let s = from
  for (const u of updates) s = reduce(s, u).state
  return s
}

describe("_drive/seq wire round-trip", () => {
  it("state starting at m_500 preserves ids through stateToSessionUpdates → reduce", () => {
    const s0 = mk({
      messages: [
        {
          id: "m_500",
          role: "user",
          messageId: "u1",
          segments: [{ id: "s_1", text: "hello" }],
        },
        {
          id: "m_501",
          role: "assistant",
          messageId: "a1",
          segments: [{ id: "s_2", text: "hi" }],
        },
      ],
      nextMessageSeq: 502,
    })
    const updates = stateToSessionUpdates(s0)
    expect(updates.some((u) => u._meta?.[SEQ_META_KEY] === 500)).toBe(true)
    const s1 = play(updates, mk())
    expect(meaningful(s1)).toEqual(meaningful(s0))
  })

  it("content chunk with seq opens message with id m_<seq>", () => {
    const s = mk()
    const { state, patches } = reduce(s, {
      sessionUpdate: "user_message_chunk",
      messageId: null,
      content: { type: "image", mimeType: "image/png", data: "abc" },
      _meta: { [SEQ_META_KEY]: 500 },
    })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.id).toBe("m_500")
    expect(patches[0]?.op).toBe("add-message")
    const wire = patchToSessionUpdates(state, patches[0] as never)
    expect(wire[0]?._meta?.[SEQ_META_KEY]).toBe(500)
  })

  it("text chunk with seq and messageId null attaches to m_<seq>", () => {
    let s = mk()
    ;({ state: s } = reduce(s, {
      sessionUpdate: "agent_message_chunk",
      messageId: null,
      content: { type: "text", text: "part1" },
      _meta: { [SEQ_META_KEY]: 502 },
    }))
    const { state } = reduce(s, {
      sessionUpdate: "agent_message_chunk",
      messageId: "other",
      content: { type: "text", text: " part2" },
      _meta: { [SEQ_META_KEY]: 502 },
    })
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.id).toBe("m_502")
    expect(state.messages[0]?.segments.map((x) => x.text).join("")).toBe("part1 part2")
  })

  it("tool_call_update for unknown tool uses seq for new message id", () => {
    const s = mk()
    const { state } = reduce(s, {
      sessionUpdate: "tool_call_update",
      toolCallId: "t-new",
      status: "pending",
      _meta: { [SEQ_META_KEY]: 503 },
    })
    const tool = state.messages.find((m) => m.role === "tool")
    expect(tool?.id).toBe("m_503")
  })

  it("stored message meta omits _drive/seq after append-segment", () => {
    const s0 = mk({
      messages: [
        {
          id: "m_500",
          role: "user",
          messageId: "u",
          segments: [{ id: "s_1", text: "a" }],
          meta: { vendor: 1 },
        },
      ],
    })
    const { state, patches } = reduce(s0, {
      sessionUpdate: "user_message_chunk",
      messageId: "u",
      content: { type: "text", text: "b" },
      _meta: { [SEQ_META_KEY]: 500, vendor: 1 },
    })
    const patch = patches.find((p) => p.op === "append-segment")
    expect(patch).toBeDefined()
    const applied = applyPatch(state, patch as never)
    const msg = applied.messages.find((m) => m.id === "m_500")
    expect(msg?.meta?.[SEQ_META_KEY]).toBeUndefined()
  })

  it("whitespace-only chunk with only seq meta does not emit opaque", () => {
    const s = mk()
    const { patches } = reduce(s, {
      sessionUpdate: "user_message_chunk",
      messageId: null,
      content: { type: "text", text: "   " },
      _meta: { [SEQ_META_KEY]: 500 },
    })
    expect(patches).toEqual([])
  })

  it("seq-found chunk joins even when canGroupWith would reject messageId", () => {
    const s = mk({
      messages: [
        {
          id: "m_500",
          role: "assistant",
          messageId: "a-old",
          segments: [{ id: "s_1", text: "start" }],
        },
      ],
      nextMessageSeq: 501,
    })
    const { state, patches } = reduce(s, {
      sessionUpdate: "agent_message_chunk",
      messageId: "different",
      content: { type: "text", text: " end" },
      _meta: { [SEQ_META_KEY]: 500 },
    })
    expect(patches[0]?.op).toBe("append-segment")
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.id).toBe("m_500")
  })

  it("without seq behaves as before", () => {
    const s = mk({ nextMessageSeq: 0 })
    const { state } = reduce(s, {
      sessionUpdate: "user_message_chunk",
      messageId: "m1",
      content: { type: "text", text: "x" },
    })
    expect(state.messages[0]?.id).toBe("m_0")
    expect(state.messages[0]?.meta?.[SEQ_META_KEY]).toBeUndefined()
  })
})

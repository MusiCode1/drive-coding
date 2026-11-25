import { describe, expect, it } from "vitest"
import {
  assertHistoryPageByteBudget,
  clampPageBytes,
  HISTORY_PAGE_BYTES_DEFAULT,
  HISTORY_PAGE_BYTES_MAX,
  selectRange,
  utf8Length,
} from "./history-range"
import { reduce } from "./reduce"
import { messageWireByteSize } from "./to-session-update"
import { createInitialSessionState, type SessionMessage, type SessionState } from "./types"
import { snapshotPayload } from "./wire-frames"

function msg(seq: number, text: string): SessionMessage {
  return {
    id: `m_${seq}`,
    role: "user",
    messageId: `u-${seq}`,
    segments: [{ id: `s_${seq}`, text }],
  }
}

function mk(messages: SessionMessage[]): SessionState {
  return {
    ...createInitialSessionState({ sessionId: "s" }),
    messages,
    nextMessageSeq: messages.length,
  }
}

describe("history-range", () => {
  it("utf8Length counts Hebrew in bytes", () => {
    expect(utf8Length("שלום")).toBeGreaterThan(4)
  })

  it("clampPageBytes enforces defaults and ceiling", () => {
    expect(clampPageBytes(0)).toBe(HISTORY_PAGE_BYTES_DEFAULT)
    expect(clampPageBytes(9_999_999)).toBe(HISTORY_PAGE_BYTES_MAX)
  })

  it("tail page always includes at least one message even when huge", () => {
    const huge = "x".repeat(500_000)
    const state = mk([msg(0, huge), msg(1, "small")])
    const sel = selectRange(state, { tail: true, maxBytes: 1000 }, messageWireByteSize)
    expect(sel.ok).toBe(true)
    if (sel.ok) {
      expect(sel.end - sel.start).toBe(1)
      expect(sel.page.lastSeq).toBe(1)
    }
  })

  it("before unknown seq returns unknown-before", () => {
    const state = mk([msg(0, "a")])
    expect(selectRange(state, { before: 99, maxBytes: 10_000 }, messageWireByteSize)).toEqual({
      ok: false,
      reason: "unknown-before",
    })
  })

  it("before=0 yields an empty page", () => {
    const state = mk([msg(0, "a"), msg(1, "b")])
    const sel = selectRange(state, { before: 0, maxBytes: 10_000 }, messageWireByteSize)
    expect(sel.ok).toBe(true)
    if (sel.ok) {
      expect(sel.start).toBe(0)
      expect(sel.end).toBe(0)
      expect(sel.page).toEqual({ firstSeq: null, lastSeq: null, hasMore: false })
    }
  })

  it("before excludes the anchor and page.lastSeq is within the page", () => {
    const state = mk([msg(0, "a"), msg(1, "b"), msg(2, "c")])
    const sel = selectRange(state, { before: 2, maxBytes: 10_000 }, messageWireByteSize)
    expect(sel.ok).toBe(true)
    if (sel.ok) {
      const pageMsgs = state.messages.slice(sel.start, sel.end)
      expect(pageMsgs.map((m) => m.id)).toEqual(["m_0", "m_1"])
      expect(sel.page.firstSeq).toBe(0)
      expect(sel.page.lastSeq).toBe(1)
      expect(sel.page.hasMore).toBe(false)
    }
  })

  it("meta + tail page covering all messages is meaningful-equal to full snapshot", () => {
    const state = mk([msg(0, "a"), msg(1, "b")])
    const full = snapshotPayload(state)
    const tail = snapshotPayload(state, undefined, {
      range: { tail: true, maxBytes: HISTORY_PAGE_BYTES_MAX },
    })
    const fold = (updates: typeof full.updates) => {
      let s = createInitialSessionState({ sessionId: "s" })
      for (const u of updates) s = reduce(s, u).state
      return s
    }
    expect(fold(tail.updates).messages.map((m) => m.id)).toEqual(
      fold(full.updates).messages.map((m) => m.id),
    )
  })
})

describe("F1 history page bytes", () => {
  it("every generated tail page respects maxBytes or is a single message", () => {
    let state = mk([])
    for (let i = 0; i < 40; i++) {
      const text = `${i}:${"word ".repeat((i * 17) % 200)}`
      state = {
        ...state,
        messages: [...state.messages, msg(i, text)],
        nextMessageSeq: i + 1,
      }
    }
    const maxBytes = 4096
    for (let end = 1; end <= state.messages.length; end++) {
      const slice = { ...state, messages: state.messages.slice(0, end) }
      const sel = selectRange(slice, { tail: true, maxBytes }, messageWireByteSize)
      expect(sel.ok).toBe(true)
      if (!sel.ok) continue
      const pageMsgs = slice.messages.slice(sel.start, sel.end)
      const bytes = pageMsgs.reduce((acc, m) => acc + messageWireByteSize(m), 0)
      expect(pageMsgs.length === 1 || bytes <= maxBytes).toBe(true)
    }
  })

  it("F1 negative control: a greedy page fails assertHistoryPageByteBudget", () => {
    const state = mk([msg(0, "a"), msg(1, "b".repeat(5000))])
    const maxBytes = 50
    const sel = selectRange(state, { tail: true, maxBytes }, messageWireByteSize)
    expect(sel.ok).toBe(true)
    if (!sel.ok) return
    const pageMsgs = state.messages.slice(sel.start, sel.end)
    expect(assertHistoryPageByteBudget(pageMsgs, maxBytes, messageWireByteSize)).toBe(true)
    const greedy = state.messages.slice(0, state.messages.length)
    expect(assertHistoryPageByteBudget(greedy, maxBytes, messageWireByteSize)).toBe(false)
  })
})

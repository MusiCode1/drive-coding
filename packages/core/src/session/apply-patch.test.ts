/**
 * apply-patch.test.ts — TDD for applyPatch(state, patch) → SessionState (pure, immutable).
 * ─── slice session-state-reducer C2 (TDD) ───
 */
import { describe, it, expect } from "vitest"
import { applyPatch } from "./apply-patch"
import { createInitialSessionState } from "./types"
import type { SessionState, SessionMessage, Patch } from "./types"

function mkState(overrides?: Partial<SessionState>): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), ...overrides }
}

function mkMsg(id: string, text: string): SessionMessage {
  return {
    id,
    role: "assistant",
    messageId: null,
    segments: [{ id: "s_0", text }],
  }
}

function mkToolMsg(id: string, toolCallId: string): SessionMessage {
  return {
    id,
    role: "tool",
    messageId: null,
    toolCall: {
      toolCallId,
      name: "bash",
      args: {},
      status: "pending",
    },
  }
}

describe("applyPatch — add-message", () => {
  it("adds a message to empty state", () => {
    const s = mkState()
    const msg = mkMsg("m_0", "Hello")
    const patch: Patch = { version: 1, op: "add-message", message: msg }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(1)
    expect(s2.messages[0]).toEqual(msg)
    expect(s2.version).toBe(1)
  })

  it("appends to existing messages", () => {
    const msg1 = mkMsg("m_0", "First")
    const s = mkState({ messages: [msg1], version: 1 })
    const msg2 = mkMsg("m_1", "Second")
    const patch: Patch = { version: 2, op: "add-message", message: msg2 }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(2)
    expect(s2.messages[1]).toEqual(msg2)
    expect(s2.version).toBe(2)
  })

  it("does not mutate original state", () => {
    const s = mkState()
    const msg = mkMsg("m_0", "Hi")
    const patch: Patch = { version: 1, op: "add-message", message: msg }
    applyPatch(s, patch)
    expect(s.messages).toHaveLength(0) // original unchanged
  })
})

describe("applyPatch — append-segment", () => {
  it("appends segment to target message", () => {
    const msg = mkMsg("m_0", "Hello")
    const s = mkState({ messages: [msg], version: 1, nextSegmentSeq: 1 })
    const patch: Patch = {
      version: 2,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_1", text: " World" },
    }
    const s2 = applyPatch(s, patch)
    const m = s2.messages[0]!
    if (m.role !== "tool") {
      expect(m.segments).toHaveLength(2)
      expect(m.segments[1]!.text).toBe(" World")
    }
    expect(s2.version).toBe(2)
  })

  it("no-op if targetId not found", () => {
    const s = mkState()
    const patch: Patch = {
      version: 1,
      op: "append-segment",
      targetId: "m_missing",
      segment: { id: "s_0", text: "x" },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(0)
  })

  it("does not mutate original segments", () => {
    const msg = mkMsg("m_0", "Hello")
    const s = mkState({ messages: [msg] })
    // msg is role=assistant so it has segments — narrow for TS discriminated union
    if (msg.role === "tool") throw new Error("unexpected")
    const originalSegLen = msg.segments.length
    const patch: Patch = {
      version: 1,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_1", text: " World" },
    }
    applyPatch(s, patch)
    expect(msg.segments).toHaveLength(originalSegLen) // original unchanged
  })
})

describe("applyPatch — update-tool", () => {
  it("updates tool call fields", () => {
    const tool = mkToolMsg("m_0", "tc-1")
    const s = mkState({ messages: [tool], version: 1 })
    const patch: Patch = {
      version: 2,
      op: "update-tool",
      targetId: "m_0",
      toolCall: { status: "completed", result: "done" },
    }
    const s2 = applyPatch(s, patch)
    const msg = s2.messages[0]!
    if (msg.role === "tool") {
      expect(msg.toolCall.status).toBe("completed")
      expect(msg.toolCall.result).toBe("done")
      expect(msg.toolCall.args).toEqual({}) // unchanged
    }
    expect(s2.version).toBe(2)
  })

  it("no-op if targetId not found", () => {
    const s = mkState()
    const patch: Patch = {
      version: 1,
      op: "update-tool",
      targetId: "m_missing",
      toolCall: { status: "completed" },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(0)
  })

  it("replaces tool call object (immutable — for Svelte reactivity)", () => {
    const tool = mkToolMsg("m_0", "tc-1")
    const s = mkState({ messages: [tool] })
    const patch: Patch = {
      version: 1,
      op: "update-tool",
      targetId: "m_0",
      toolCall: { status: "in_progress" },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.messages[0]).not.toBe(s.messages[0]) // new object
  })
})

describe("applyPatch — reset", () => {
  it("resets state to given messages + seqs", () => {
    const msg = mkMsg("m_0", "Prior")
    const s = mkState({ messages: [msg], version: 5, nextMessageSeq: 10, nextSegmentSeq: 20 })
    const patch: Patch = {
      version: 0,
      op: "reset",
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(0)
    expect(s2.nextMessageSeq).toBe(0)
    expect(s2.nextSegmentSeq).toBe(0)
    expect(s2.version).toBe(0)
  })

  it("reset with pre-populated messages", () => {
    const s = mkState()
    const msg = mkMsg("m_0", "Restored")
    const patch: Patch = {
      version: 1,
      op: "reset",
      messages: [msg],
      nextMessageSeq: 1,
      nextSegmentSeq: 1,
    }
    const s2 = applyPatch(s, patch)
    expect(s2.messages).toHaveLength(1)
    expect(s2.messages[0]).toEqual(msg)
  })
})

// ─── C1: update-session patches ───

describe("applyPatch — update-session (C1)", () => {
  it("updates title", () => {
    const s = mkState()
    const patch: Patch = { version: 1, op: "update-session", changes: { title: "New Title" } }
    const s2 = applyPatch(s, patch)
    expect(s2.title).toBe("New Title")
    expect(s2.version).toBe(1)
  })

  it("updates contextUsage", () => {
    const s = mkState()
    const patch: Patch = {
      version: 1,
      op: "update-session",
      changes: { contextUsage: { used: 100, size: 1000 } },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.contextUsage?.used).toBe(100)
    expect(s2.contextUsage?.size).toBe(1000)
  })

  it("updates commands", () => {
    const s = mkState()
    const cmds = [{ name: "run", description: "Run" }]
    const patch: Patch = {
      version: 1,
      op: "update-session",
      changes: { commands: cmds },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.commands).toEqual(cmds)
  })

  it("partial update only changes specified fields", () => {
    const s = mkState({ title: "Old" } as Partial<SessionState>)
    const patch: Patch = {
      version: 1,
      op: "update-session",
      changes: { contextUsage: { used: 50, size: 500 } },
    }
    const s2 = applyPatch(s, patch)
    expect(s2.title).toBe("Old") // unchanged
    expect(s2.contextUsage?.used).toBe(50)
  })

  it("does not mutate original state", () => {
    const s = mkState()
    const patch: Patch = { version: 1, op: "update-session", changes: { title: "New" } }
    applyPatch(s, patch)
    expect(s.title).toBe("") // original unchanged
  })
})

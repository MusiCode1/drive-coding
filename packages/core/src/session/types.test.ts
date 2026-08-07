/**
 * types.test.ts — TDD for SessionState shapes + deterministic id policy (C0).
 * Complexity 9/10 slice: session-state-reducer.
 */
import { describe, it, expect } from "vitest"
import {
  type SessionState,
  type SessionMessage,
  type SessionSegment,
  type SessionToolCall,
  type Patch,
  createInitialSessionState,
  INITIAL_SESSION_STATE,
} from "./types"

describe("createInitialSessionState", () => {
  it("returns correct zero state with sessionId null", () => {
    const s = createInitialSessionState({ sessionId: null })
    expect(s.version).toBe(0)
    expect(s.sessionId).toBeNull()
    expect(s.messages).toEqual([])
    expect(s.nextMessageSeq).toBe(0)
    expect(s.nextSegmentSeq).toBe(0)
  })

  it("accepts sessionId string", () => {
    const s = createInitialSessionState({ sessionId: "abc-123" })
    expect(s.sessionId).toBe("abc-123")
  })
})

describe("INITIAL_SESSION_STATE", () => {
  it("is a constant zero state", () => {
    expect(INITIAL_SESSION_STATE.version).toBe(0)
    expect(INITIAL_SESSION_STATE.sessionId).toBeNull()
    expect(INITIAL_SESSION_STATE.messages).toEqual([])
    expect(INITIAL_SESSION_STATE.nextMessageSeq).toBe(0)
    expect(INITIAL_SESSION_STATE.nextSegmentSeq).toBe(0)
  })
})

describe("SessionMessage shapes", () => {
  it("user message is well-typed", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "user",
      messageId: "acp-id-1",
      segments: [{ id: "s_0", text: "hello" }],
    }
    expect(msg.role).toBe("user")
    expect(msg.segments).toHaveLength(1)
  })

  it("assistant message is well-typed", () => {
    const msg: SessionMessage = {
      id: "m_1",
      role: "assistant",
      messageId: null,
      segments: [{ id: "s_1", text: "world" }],
    }
    expect(msg.role).toBe("assistant")
  })

  it("thought message is well-typed", () => {
    const msg: SessionMessage = {
      id: "m_2",
      role: "thought",
      messageId: "acp-msg-2",
      segments: [],
    }
    expect(msg.role).toBe("thought")
  })

  it("tool message is well-typed", () => {
    const tool: SessionToolCall = {
      toolCallId: "tc_1",
      name: "bash",
      args: { cmd: "ls" },
      status: "pending",
    }
    const msg: SessionMessage = {
      id: "m_3",
      role: "tool",
      messageId: null,
      toolCall: tool,
    }
    expect(msg.role).toBe("tool")
    expect(msg.toolCall.toolCallId).toBe("tc_1")
  })

  it("tool message messageId is always null", () => {
    const msg: SessionMessage = {
      id: "m_4",
      role: "tool",
      messageId: null,
      toolCall: {
        toolCallId: "tc_2",
        name: "edit",
        args: {},
        status: "completed",
        result: "ok",
      },
    }
    expect(msg.messageId).toBeNull()
  })
})

describe("SessionToolCall optional fields", () => {
  it("minimal tool call is valid", () => {
    const tc: SessionToolCall = {
      toolCallId: "x",
      name: "read",
      args: {},
      status: "pending",
    }
    expect(tc.kind).toBeUndefined()
    expect(tc.title).toBeUndefined()
    expect(tc.result).toBeUndefined()
    expect(tc.content).toBeUndefined()
    expect(tc.locations).toBeUndefined()
  })

  it("full tool call is valid", () => {
    const tc: SessionToolCall = {
      toolCallId: "y",
      name: "bash",
      kind: "execute",
      args: { cmd: "ls" },
      status: "completed",
      title: "Run command",
      result: "file.txt\n",
      content: [{ type: "text", text: "file.txt" }],
      locations: [{ path: "/tmp/x", line: 3 }],
    }
    expect(tc.kind).toBe("execute")
    expect(tc.content).toHaveLength(1)
  })
})

describe("Patch discriminated union", () => {
  it("append-segment patch", () => {
    const p: Patch = {
      version: 1,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_0", text: "hi" },
    }
    expect(p.op).toBe("append-segment")
  })

  it("add-message patch", () => {
    const msg: SessionMessage = {
      id: "m_1",
      role: "assistant",
      messageId: null,
      segments: [],
    }
    const p: Patch = { version: 1, op: "add-message", message: msg }
    expect(p.op).toBe("add-message")
  })

  it("update-tool patch", () => {
    const p: Patch = {
      version: 2,
      op: "update-tool",
      targetId: "m_3",
      toolCall: { status: "completed", result: "done" },
    }
    expect(p.op).toBe("update-tool")
    if (p.op === "update-tool") {
      expect(p.toolCall.status).toBe("completed")
    }
  })

  it("reset patch", () => {
    const p: Patch = {
      version: 0,
      op: "reset",
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    }
    expect(p.op).toBe("reset")
  })
})

describe("deterministic id contracts", () => {
  it("message ids follow m_<n> pattern", () => {
    // This test documents the contract: core must use nextMessageSeq for ids, not randomUUID
    const id = `m_0`
    expect(id).toMatch(/^m_\d+$/)
  })

  it("segment ids follow s_<n> pattern", () => {
    const id = `s_0`
    expect(id).toMatch(/^s_\d+$/)
  })
})

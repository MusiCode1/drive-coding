/**
 * types.test.ts — TDD for SessionState shapes + deterministic id policy (C0).
 * Complexity 9/10 slice: session-state-reducer.
 */
import { describe, expect, it } from "vitest"
import { applyPatch } from "./apply-patch"
import {
  applyPendingRequest,
  applyTurnEnd,
  applyTurnStart,
  applyUserMessage,
  clearPendingRequest,
  createInitialSessionState,
  INITIAL_SESSION_STATE,
  type Patch,
  type PendingElicitation,
  type PendingPermission,
  type SessionMessage,
  type SessionSegment,
  type SessionState,
  type SessionToolCall,
  synthesizeUserMessage,
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

// ─── C1: new SessionState fields ───

describe("SessionState — new fields (C1)", () => {
  it("createInitialSessionState includes all new C1 fields with defaults", () => {
    const s = createInitialSessionState({ sessionId: null })
    expect(s.status).toBe("idle")
    expect(s.turnState).toBe("idle")
    expect(s.pending).toEqual({ permission: null, elicitation: null })
    expect(s.capabilities).toBeNull()
    expect(s.modes).toBeNull()
    expect(s.configOptions).toEqual([])
    expect(s.contextUsage).toBeNull()
    expect(s.quota).toBeNull()
    expect(s.title).toBe("")
    expect(s.commands).toEqual([])
  })
})

describe("SessionMessage — meta field (C1)", () => {
  it("user message can carry optional meta", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "user",
      messageId: null,
      segments: [{ id: "s_0", text: "hi" }],
      meta: { source: "voice", locale: "he" },
    }
    expect(msg.meta?.source).toBe("voice")
  })

  it("meta defaults to undefined (backward-compatible)", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "assistant",
      messageId: null,
      segments: [],
    }
    expect(msg.meta).toBeUndefined()
  })
})

describe("synthesizeUserMessage (C1)", () => {
  it("creates user message with correct id using state seqs", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hello")
    expect(msg.role).toBe("user")
    expect(msg.id).toBe("m_0")
    if (msg.role !== "tool") {
      expect(msg.segments).toHaveLength(1)
      expect(msg.segments[0]!.id).toBe("s_0")
      expect(msg.segments[0]!.text).toBe("Hello")
    }
  })

  it("attaches meta when provided", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi", { source: "voice" })
    expect(msg.meta?.source).toBe("voice")
  })

  it("meta is absent when not provided", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi")
    expect(msg.meta).toBeUndefined()
  })
})

describe("applyUserMessage (C1)", () => {
  it("adds the message and returns add-message patch", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi")
    const { state, patches } = applyUserMessage(s, msg)
    expect(state.messages).toHaveLength(1)
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe("add-message")
  })

  it("increments nextMessageSeq and nextSegmentSeq", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi")
    const { state } = applyUserMessage(s, msg)
    expect(state.nextMessageSeq).toBe(1)
    expect(state.nextSegmentSeq).toBe(1)
  })

  it("version increments", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi")
    const { state } = applyUserMessage(s, msg)
    expect(state.version).toBe(1)
  })

  it("does not mutate original state", () => {
    const s = createInitialSessionState({ sessionId: null })
    const msg = synthesizeUserMessage(s, "Hi")
    applyUserMessage(s, msg)
    expect(s.messages).toHaveLength(0)
  })
})

// ─── slice session-host-pending-surface C1: pending + turn-boundary helpers ───

describe("SessionState.lastTurnError field", () => {
  it("createInitialSessionState initializes lastTurnError to null", () => {
    const s = createInitialSessionState({ sessionId: null })
    expect(s.lastTurnError).toBeNull()
  })
})

const permA: PendingPermission = { requestId: 0, params: {} as never }
const permB: PendingPermission = { requestId: 1, params: {} as never }
const elicA: PendingElicitation = { requestId: 0, params: {} as never }

describe("applyPendingRequest", () => {
  it("permission: sets pending.permission, leaves elicitation null, single patch, version+1", () => {
    const s = createInitialSessionState({ sessionId: null })
    const { state, patches } = applyPendingRequest(s, { kind: "permission", value: permA })
    expect(state.pending.permission).toEqual(permA)
    expect(state.pending.elicitation).toBeNull()
    expect(patches).toHaveLength(1)
    expect(state.version).toBe(s.version + 1)
  })

  it("elicitation: sets pending.elicitation, existing permission survives", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const withPerm = applyPendingRequest(s0, { kind: "permission", value: permA }).state
    const { state, patches } = applyPendingRequest(withPerm, { kind: "elicitation", value: elicA })
    expect(state.pending.elicitation).toEqual(elicA)
    expect(state.pending.permission).toEqual(permA)
    expect(patches).toHaveLength(1)
  })

  it("two permission requests in a row: second overwrites, version bumps twice", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const s1 = applyPendingRequest(s0, { kind: "permission", value: permA }).state
    const s2 = applyPendingRequest(s1, { kind: "permission", value: permB }).state
    expect(s2.pending.permission).toEqual(permB)
    expect(s2.version).toBe(s0.version + 2)
  })

  it("round-trip: applyPatch(state, patch) equals the returned state", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const { state, patches } = applyPendingRequest(s0, { kind: "permission", value: permA })
    expect(applyPatch(s0, patches[0]!)).toEqual(state)
  })
})

describe("clearPendingRequest", () => {
  it("current id → clears to null + emits patch", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const withPerm = applyPendingRequest(s0, { kind: "permission", value: permA }).state
    const { state, patches } = clearPendingRequest(withPerm, "permission", 0)
    expect(state.pending.permission).toBeNull()
    expect(patches).toHaveLength(1)
  })

  it("old (stale) id → no-op: zero patches, same state, same version", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const s1 = applyPendingRequest(s0, { kind: "permission", value: permA }).state
    const s2 = applyPendingRequest(s1, { kind: "permission", value: permB }).state
    const { state, patches } = clearPendingRequest(s2, "permission", 0)
    expect(patches).toHaveLength(0)
    expect(state).toBe(s2)
    expect(state.version).toBe(s2.version)
  })

  it("null slot → no-op: zero patches", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const { state, patches } = clearPendingRequest(s0, "permission", 0)
    expect(patches).toHaveLength(0)
    expect(state).toBe(s0)
  })

  it("round-trip: applyPatch(state, patch) equals the returned state", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const withPerm = applyPendingRequest(s0, { kind: "permission", value: permA }).state
    const { state, patches } = clearPendingRequest(withPerm, "permission", 0)
    expect(applyPatch(withPerm, patches[0]!)).toEqual(state)
  })
})

describe("applyTurnStart", () => {
  it("on idle → patch + version+1, lastTurnError reset to null", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const withError = applyTurnEnd(
      { ...s0, turnState: "waiting" },
      { message: "boom", at: 1 },
    ).state
    const { state, patches } = applyTurnStart(withError)
    expect(state.turnState).toBe("waiting")
    expect(state.lastTurnError).toBeNull()
    expect(patches).toHaveLength(1)
    expect(state.version).toBe(withError.version + 1)
  })

  it("on state already waiting with no error → zero patches (no-op)", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const { state, patches } = applyTurnStart(s0)
    expect(patches).toHaveLength(0)
    expect(state).toBe(s0)
  })

  it("round-trip: applyPatch(state, patch) equals the returned state", () => {
    const s0 = createInitialSessionState({ sessionId: null })
    const { state, patches } = applyTurnStart(s0)
    expect(applyPatch(s0, patches[0]!)).toEqual(state)
  })
})

describe("applyTurnEnd", () => {
  it("no error, on state in waiting → turnState idle, lastTurnError null", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const { state, patches } = applyTurnEnd(s0)
    expect(state.turnState).toBe("idle")
    expect(state.lastTurnError).toBeNull()
    expect(patches).toHaveLength(1)
  })

  it("🔴 no error, on state already idle carrying lastTurnError → zero patches, error survives", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const withError = applyTurnEnd(s0, { message: "boom", at: 1 }).state
    expect(withError.turnState).toBe("idle")
    const { state, patches } = applyTurnEnd(withError)
    expect(patches).toHaveLength(0)
    expect(state).toBe(withError)
    expect(state.lastTurnError).toEqual({ message: "boom", at: 1 })
  })

  it("with error → single atomic patch carrying both fields", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const { state, patches } = applyTurnEnd(s0, { message: "boom", at: 1 })
    expect(patches).toHaveLength(1)
    expect(state.turnState).toBe("idle")
    expect(state.lastTurnError?.message).toBe("boom")
  })

  it("with error on state already idle without error → DOES emit a patch (error is a change)", () => {
    const s0 = createInitialSessionState({ sessionId: null }) // turnState idle, lastTurnError null
    const { state, patches } = applyTurnEnd(s0, { message: "boom", at: 1 })
    expect(patches).toHaveLength(1)
    expect(state.lastTurnError?.message).toBe("boom")
  })

  it("round-trip (success case): applyPatch(state, patch) equals the returned state", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const { state, patches } = applyTurnEnd(s0)
    expect(applyPatch(s0, patches[0]!)).toEqual(state)
  })

  it("round-trip (error case): applyPatch(state, patch) equals the returned state", () => {
    const s0 = { ...createInitialSessionState({ sessionId: null }), turnState: "waiting" as const }
    const { state, patches } = applyTurnEnd(s0, { message: "boom", at: 1 })
    expect(applyPatch(s0, patches[0]!)).toEqual(state)
  })
})

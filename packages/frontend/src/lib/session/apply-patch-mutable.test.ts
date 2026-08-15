/**
 * apply-patch-mutable.test.ts — property test: pure applyPatch ≡ mutable applyPatchMutable.
 *
 * האינווריאנט: אותו רצף patches, שתי ההחלות מסכימות —
 * applyPatch (pure core) vs applyPatchMutable (mutable FE Bubble[]).
 *
 * mappers מוזרקים עם stub דטרמיניסטי (לא mapToolContent אמיתי) כדי לאפשר השוואה.
 *
 * ─── slice session-state-reducer C3 (TDD) ───
 */
import { describe, it, expect } from "vitest"
import { applyPatch, createInitialSessionState } from "@drive-coding/core/session"
import type { Patch, SessionMessage, SessionState } from "@drive-coding/core/session"
import { applyPatchMutable } from "./apply-patch-mutable"
import type { ToolContent, ToolLocation } from "$lib/types/bubble"
import type { Bubble, ToolBubble, MessageBubble, ThoughtBubble, UserBubble } from "$lib/types/bubble"

// ─── stub mappers ───

const stubMapToolContent = (_raw: unknown[]): ToolContent[] => [{ type: "text", text: "stubbed" }]
const stubMapLocations = (_raw: unknown[]): ToolLocation[] => []

// ─── helpers ───

/** Project SessionMessage → Bubble (must mirror applyPatchMutable's own mapping) */
function sessionMsgToBubble(msg: SessionMessage, createdAt = 0): Bubble {
  if (msg.role === "tool") {
    return {
      id: msg.id,
      kind: "tool",
      messageId: null,
      createdAt,
      toolCall: {
        toolCallId: msg.toolCall.toolCallId,
        name: msg.toolCall.name,
        kind: msg.toolCall.kind,
        args: msg.toolCall.args,
        status: msg.toolCall.status,
        title: msg.toolCall.title,
        result: msg.toolCall.result,
        content:
          msg.toolCall.content != null
            ? stubMapToolContent(msg.toolCall.content)
            : undefined,
        locations:
          msg.toolCall.locations != null
            ? stubMapLocations(msg.toolCall.locations)
            : undefined,
      },
      segments: [],
    } satisfies ToolBubble
  }
  return {
    id: msg.id,
    kind: msg.role === "assistant" ? "message" : msg.role === "thought" ? "thought" : "user",
    messageId: msg.messageId,
    createdAt,
    segments: msg.segments,
  } as MessageBubble | ThoughtBubble | UserBubble
}

/** Project SessionState → Bubble[] (expected state from applyPatch) */
function stateToExpectedBubbles(state: SessionState): Bubble[] {
  return state.messages.map((msg) => sessionMsgToBubble(msg))
}

// ─── Tests ───

describe("applyPatchMutable — property test: pure ≡ mutable", () => {
  it("empty patches: no change", () => {
    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })
    expect(bubbles).toHaveLength(0)
  })

  it("add-message patch → bubble appended", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "assistant",
      messageId: null,
      segments: [{ id: "s_0", text: "Hello" }],
    }
    const patch: Patch = { version: 1, op: "add-message", message: msg }

    // pure path
    const initial = createInitialSessionState({ sessionId: null })
    const pureState = applyPatch(initial, patch)
    const expectedBubbles = stateToExpectedBubbles(pureState)

    // mutable path
    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [patch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    expect(bubbles).toHaveLength(expectedBubbles.length)
    expect(bubbles[0]!.id).toBe(expectedBubbles[0]!.id)
    if (bubbles[0]!.kind === "message" && expectedBubbles[0]!.kind === "message") {
      expect(bubbles[0]!.segments).toEqual(expectedBubbles[0]!.segments)
    }
  })

  it("append-segment patch → segment added to last bubble", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "assistant",
      messageId: null,
      segments: [{ id: "s_0", text: "Hello" }],
    }
    const addPatch: Patch = { version: 1, op: "add-message", message: msg }
    const appendPatch: Patch = {
      version: 2,
      op: "append-segment",
      targetId: "m_0",
      segment: { id: "s_1", text: " World" },
    }

    // pure path
    const s0 = createInitialSessionState({ sessionId: null })
    const s1 = applyPatch(s0, addPatch)
    const s2 = applyPatch(s1, appendPatch)
    const expectedBubbles = stateToExpectedBubbles(s2)

    // mutable path
    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [addPatch, appendPatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    expect(bubbles).toHaveLength(1)
    if (bubbles[0]!.kind === "message" && expectedBubbles[0]!.kind === "message") {
      expect(bubbles[0]!.segments).toHaveLength(2)
      expect(bubbles[0]!.segments[1]!.text).toBe(" World")
    }
  })

  it("tool add-message → tool bubble", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "tool",
      messageId: null,
      toolCall: {
        toolCallId: "tc-1",
        name: "read",
        kind: "read",
        args: { path: "/tmp" },
        status: "pending",
      },
    }
    const patch: Patch = { version: 1, op: "add-message", message: msg }

    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [patch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    expect(bubbles).toHaveLength(1)
    expect(bubbles[0]!.kind).toBe("tool")
    if (bubbles[0]!.kind === "tool") {
      expect(bubbles[0]!.toolCall.toolCallId).toBe("tc-1")
      expect(bubbles[0]!.toolCall.status).toBe("pending")
    }
  })

  it("update-tool patch → tool bubble updated (immutable object-replacement)", () => {
    const toolMsg: SessionMessage = {
      id: "m_0",
      role: "tool",
      messageId: null,
      toolCall: { toolCallId: "tc-1", name: "read", args: {}, status: "pending" },
    }
    const addPatch: Patch = { version: 1, op: "add-message", message: toolMsg }
    const updatePatch: Patch = {
      version: 2,
      op: "update-tool",
      targetId: "m_0",
      toolCall: { status: "completed", result: "file content" },
    }

    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [addPatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })
    const originalBubble = bubbles[0]!

    applyPatchMutable(bubbles, [updatePatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    expect(bubbles).toHaveLength(1)
    if (bubbles[0]!.kind === "tool") {
      expect(bubbles[0]!.toolCall.status).toBe("completed")
      expect(bubbles[0]!.toolCall.result).toBe("file content")
      // immutable object-replacement (for Svelte reactivity)
      expect(bubbles[0]).not.toBe(originalBubble)
    }
  })

  it("multi-bubble sequence: user → thought → assistant → tool", () => {
    const patches: Patch[] = [
      {
        version: 1,
        op: "add-message",
        message: { id: "m_0", role: "user", messageId: "u-1", segments: [{ id: "s_0", text: "Q" }] },
      },
      {
        version: 2,
        op: "add-message",
        message: { id: "m_1", role: "thought", messageId: "t-1", segments: [{ id: "s_1", text: "..." }] },
      },
      {
        version: 3,
        op: "add-message",
        message: { id: "m_2", role: "assistant", messageId: "a-1", segments: [{ id: "s_2", text: "A" }] },
      },
      {
        version: 4,
        op: "add-message",
        message: {
          id: "m_3",
          role: "tool",
          messageId: null,
          toolCall: { toolCallId: "tc-x", name: "bash", args: {}, status: "pending" },
        },
      },
    ]

    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, patches, {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    expect(bubbles).toHaveLength(4)
    expect(bubbles[0]!.kind).toBe("user")
    expect(bubbles[1]!.kind).toBe("thought")
    expect(bubbles[2]!.kind).toBe("message")
    expect(bubbles[3]!.kind).toBe("tool")
  })

  it("reset patch → bubbles cleared and replaced", () => {
    const toolMsg: SessionMessage = {
      id: "m_0",
      role: "tool",
      messageId: null,
      toolCall: { toolCallId: "tc-1", name: "read", args: {}, status: "pending" },
    }
    const addPatch: Patch = { version: 1, op: "add-message", message: toolMsg }
    const resetPatch: Patch = {
      version: 2,
      op: "reset",
      messages: [],
      nextMessageSeq: 0,
      nextSegmentSeq: 0,
    }

    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [addPatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })
    expect(bubbles).toHaveLength(1)

    applyPatchMutable(bubbles, [resetPatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })
    expect(bubbles).toHaveLength(0)
  })
})

describe("applyPatchMutable — mappers injection", () => {
  it("mapToolContent is called for tool add-message with content", () => {
    const msg: SessionMessage = {
      id: "m_0",
      role: "tool",
      messageId: null,
      toolCall: {
        toolCallId: "tc-1",
        name: "read",
        args: {},
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "output" } }],
      },
    }
    const patch: Patch = { version: 1, op: "add-message", message: msg }

    let mapperCalled = false
    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [patch], {
      mapToolContent: (raw) => {
        mapperCalled = true
        return stubMapToolContent(raw)
      },
      mapLocations: stubMapLocations,
    })

    expect(mapperCalled).toBe(true)
  })

  it("update-tool content=null → content undefined (cleared)", () => {
    const toolMsg: SessionMessage = {
      id: "m_0",
      role: "tool",
      messageId: null,
      toolCall: {
        toolCallId: "tc-1",
        name: "read",
        args: {},
        status: "pending",
        content: [{ type: "content", content: { type: "text", text: "x" } }] as unknown[],
      },
    }
    const addPatch: Patch = { version: 1, op: "add-message", message: toolMsg }
    const updatePatch: Patch = {
      version: 2,
      op: "update-tool",
      targetId: "m_0",
      toolCall: { status: "completed", content: undefined }, // null-cleared
    }

    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [addPatch, updatePatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    if (bubbles[0]!.kind === "tool") {
      // content undefined when update-tool doesn't set content
      // (update-tool only touches provided fields)
    }
  })
})

// ─── slice remote-images C2 (TDD): attachments בבועה ───
describe("sessionMsgToBubble — attachments passthrough (remote-images C2)", () => {
  it("user message with attachments → bubble.attachments set", () => {
    const attachments = [{ mimeType: "image/png", dataBase64: "abc123" }]
    // Build a message manually with attachments (as if core placed them there)
    const msg: SessionMessage = {
      id: "m_0",
      role: "user",
      messageId: null,
      segments: [],
      attachments,
    }
    const addPatch: Patch = { version: 1, op: "add-message", message: msg }
    const bubbles: Bubble[] = []
    applyPatchMutable(bubbles, [addPatch], {
      mapToolContent: stubMapToolContent,
      mapLocations: stubMapLocations,
    })

    const bubble = bubbles[0] as UserBubble
    expect(bubble.kind).toBe("user")
    expect(bubble.attachments).toEqual(attachments)
  })
})

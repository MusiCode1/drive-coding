/**
 * reduce.test.ts — TDD for reduce(state, ev) → {state, patches}.
 *
 * מכסה את כל סוגי session/update שה-VM מטפל בהם:
 * agent_message_chunk / agent_thought_chunk / user_message_chunk / tool_call / tool_call_update
 * + edge cases (grouping, Gemini messageId=null, no-op, unknown events).
 *
 * ─── slice session-state-reducer C1 (TDD) ───
 */
import { describe, expect, it } from "vitest"
import { reduce } from "./reduce"
import type { Patch, SessionState } from "./types"
import { createInitialSessionState } from "./types"

// ─── helpers ───

function mkState(overrides?: Partial<SessionState>): SessionState {
  return { ...createInitialSessionState({ sessionId: null }), ...overrides }
}

/** ACP notification wrapper: notification.update = update */
function notification(update: unknown): { update: unknown } {
  return { update }
}

function makeChunk(sessionUpdate: string, text: string, messageId: string | null = null): object {
  return { sessionUpdate, content: { type: "text", text }, messageId }
}

// ─── reduce — unknown/invalid events ───

describe("reduce — unknown events", () => {
  it("null update → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, null)
    expect(state).toBe(s) // same reference
    expect(patches).toEqual([])
  })

  it("empty object update → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {})
    expect(state).toBe(s)
    expect(patches).toEqual([])
  })

  /**
   * ⚠️ ההבחנה שנשמרת כאן: **זבל אינו "עדכון לא-מוכר".**
   * `null`/`{}`/מספר/מחרוזת — אין להם `sessionUpdate` כמחרוזת, ולכן הם יוצאים
   * מוקדם ואינם נישאים. רק עדכון **תקין-בצורתו** שאיננו מזהים הופך ל-`opaque`.
   * לשאת זבל היה הופך את דלת-המילוט לצינור-רעש.
   */
  it("sessionUpdate לא-מוכר **נישא** כ-opaque (ולא נזרק)", () => {
    const s = mkState()
    const update = { sessionUpdate: "unknown_type", content: {} }
    const { state, patches } = reduce(s, update)
    expect(patches).toEqual([{ version: s.version + 1, op: "opaque", update }])
    expect(state.version).toBe(s.version + 1)
  })

  it("non-object update → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, "not an object")
    expect(state).toBe(s)
    expect(patches).toEqual([])
  })

  it("non-object update (number) → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, 42)
    expect(state).toBe(s)
    expect(patches).toEqual([])
  })
})

// ─── agent_message_chunk ───

describe("reduce — agent_message_chunk", () => {
  it("first chunk → add-message patch + state with message", () => {
    const s = mkState()
    const { state, patches } = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe("add-message")
    expect(state.messages).toHaveLength(1)
    const msg = state.messages[0]!
    expect(msg.role).toBe("assistant")
    expect(msg.id).toBe("m_0")
    expect(msg.messageId).toBe("msg-1")
    if (msg.role !== "tool") {
      expect(msg.segments).toHaveLength(1)
      expect(msg.segments[0]!.id).toBe("s_0")
      expect(msg.segments[0]!.text).toBe("Hello")
    }
    expect(state.nextMessageSeq).toBe(1)
    expect(state.nextSegmentSeq).toBe(1)
  })

  it("second chunk same messageId → append-segment patch", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_message_chunk", " World", "msg-1"))
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe("append-segment")
    if (patches[0]!.op === "append-segment") {
      expect(patches[0]!.targetId).toBe("m_0")
      expect(patches[0]!.segment.text).toBe(" World")
      expect(patches[0]!.segment.id).toBe("s_1")
    }
    expect(s2.messages).toHaveLength(1)
    const msg = s2.messages[0]!
    if (msg.role !== "tool") {
      expect(msg.segments).toHaveLength(2)
    }
    // only nextSegmentSeq bumped, not nextMessageSeq
    expect(s2.nextMessageSeq).toBe(1)
    expect(s2.nextSegmentSeq).toBe(2)
  })

  it("new messageId → add-message (new bubble)", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_message_chunk", "World", "msg-2"))
    expect(patches[0]!.op).toBe("add-message")
    expect(s2.messages).toHaveLength(2)
    expect(s2.messages[1]!.id).toBe("m_1")
  })

  it("thought_chunk after message_chunk → new bubble (kind change)", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "Hi", "msg-1"))
    const { state: s2, patches } = reduce(
      s1,
      makeChunk("agent_thought_chunk", "Thinking...", "msg-1"),
    )
    expect(patches[0]!.op).toBe("add-message")
    expect(s2.messages).toHaveLength(2)
    expect(s2.messages[1]!.role).toBe("thought")
  })

  it("Gemini (messageId=null) → group by kind", () => {
    const s = mkState()
    // Both have messageId=null and same kind → group
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "A", null))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_message_chunk", "B", null))
    expect(patches[0]!.op).toBe("append-segment")
    expect(s2.messages).toHaveLength(1)
  })

  it("Gemini (messageId=null) different kinds → new bubble", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "A", null))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_thought_chunk", "B", null))
    expect(patches[0]!.op).toBe("add-message")
    expect(s2.messages).toHaveLength(2)
  })

  it("empty text chunk → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, makeChunk("agent_message_chunk", "", "msg-1"))
    expect(patches).toEqual([])
    expect(state).toBe(s)
  })

  it("version increments on each reduce that produces patches", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_message_chunk", "A", "msg-1"))
    expect(s1.version).toBe(1)
    const { state: s2 } = reduce(s1, makeChunk("agent_message_chunk", "B", "msg-1"))
    expect(s2.version).toBe(2)
  })

  it("patch version matches state version after reduce", () => {
    const s = mkState()
    const { state: s1, patches } = reduce(s, makeChunk("agent_message_chunk", "A", "msg-1"))
    expect(patches[0]!.version).toBe(s1.version)
  })
})

// ─── agent_thought_chunk ───

describe("reduce — agent_thought_chunk", () => {
  it("first thought → add-message role=thought", () => {
    const s = mkState()
    const { state, patches } = reduce(s, makeChunk("agent_thought_chunk", "Thinking...", "t-1"))
    expect(patches[0]!.op).toBe("add-message")
    const msg = state.messages[0]!
    expect(msg.role).toBe("thought")
    expect(msg.id).toBe("m_0")
  })

  it("consecutive thoughts same messageId → append", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("agent_thought_chunk", "A", "t-1"))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_thought_chunk", "B", "t-1"))
    expect(patches[0]!.op).toBe("append-segment")
    if (patches[0]!.op === "append-segment") {
      expect(patches[0]!.targetId).toBe("m_0")
    }
    expect(s2.messages).toHaveLength(1)
  })
})

// ─── user_message_chunk ───

describe("reduce — user_message_chunk", () => {
  it("first user chunk → add-message role=user", () => {
    const s = mkState()
    const { state, patches } = reduce(s, makeChunk("user_message_chunk", "Hello", "u-1"))
    expect(patches[0]!.op).toBe("add-message")
    const msg = state.messages[0]!
    expect(msg.role).toBe("user")
  })

  it("consecutive user chunks same messageId → append", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("user_message_chunk", "A", "u-1"))
    const { state: s2, patches } = reduce(s1, makeChunk("user_message_chunk", "B", "u-1"))
    expect(patches[0]!.op).toBe("append-segment")
    expect(s2.messages).toHaveLength(1)
  })

  it("user followed by message → new bubble", () => {
    const s = mkState()
    const { state: s1 } = reduce(s, makeChunk("user_message_chunk", "Q", "u-1"))
    const { state: s2, patches } = reduce(s1, makeChunk("agent_message_chunk", "A", "msg-1"))
    expect(patches[0]!.op).toBe("add-message")
    expect(s2.messages).toHaveLength(2)
    expect(s2.messages[1]!.role).toBe("assistant")
  })
})

// ─── tool_call ───

describe("reduce — tool_call", () => {
  const toolCallUpdate = {
    sessionUpdate: "tool_call",
    toolCallId: "tc-1",
    title: "Read file",
    kind: "read",
    rawInput: { path: "/tmp/x" },
    rawOutput: "content",
    status: "pending" as const,
    content: null,
    locations: null,
  }

  it("tool_call → add-message role=tool", () => {
    const s = mkState()
    const { state, patches } = reduce(s, toolCallUpdate)
    expect(patches[0]!.op).toBe("add-message")
    const msg = state.messages[0]!
    expect(msg.role).toBe("tool")
    expect(msg.id).toBe("m_0")
    expect(msg.messageId).toBeNull()
    if (msg.role === "tool") {
      expect(msg.toolCall.toolCallId).toBe("tc-1")
      expect(msg.toolCall.name).toBe("read") // kind ?? title ?? "tool"
      expect(msg.toolCall.kind).toBe("read")
      expect(msg.toolCall.args).toEqual({ path: "/tmp/x" })
      expect(msg.toolCall.status).toBe("pending")
    }
  })

  it("name = kind ?? title ?? 'tool'", () => {
    const s = mkState()
    // Only title, no kind
    const { state: s1 } = reduce(s, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-2",
      title: "My Tool",
      rawInput: {},
    })
    const msg = s1.messages[0]!
    if (msg.role === "tool") {
      expect(msg.toolCall.name).toBe("My Tool")
    }
    // Neither kind nor title
    const { state: s2 } = reduce(s, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-3",
      rawInput: {},
    })
    const msg2 = s2.messages[0]!
    if (msg2.role === "tool") {
      expect(msg2.toolCall.name).toBe("tool")
    }
  })

  it("tool_call with missing toolCallId → no-op", () => {
    const s = mkState()
    const { state, patches } = reduce(s, { sessionUpdate: "tool_call" })
    expect(patches).toEqual([])
    expect(state).toBe(s)
  })

  it("status defaults to pending when not provided", () => {
    const s = mkState()
    const { state } = reduce(s, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-4",
      rawInput: {},
    })
    const msg = state.messages[0]!
    if (msg.role === "tool") {
      expect(msg.toolCall.status).toBe("pending")
    }
  })
})

// ─── tool_call_update ───

describe("reduce — tool_call_update", () => {
  function stateWithTool(): SessionState {
    const s = mkState()
    const { state } = reduce(s, {
      sessionUpdate: "tool_call",
      toolCallId: "tc-1",
      kind: "read",
      title: "Read file",
      rawInput: { path: "/tmp" },
      status: "pending",
    })
    return state
  }

  it("update-tool patch with merged fields", () => {
    const s = stateWithTool()
    const { state, patches } = reduce(s, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "completed",
      rawOutput: "file content",
    })
    expect(patches[0]!.op).toBe("update-tool")
    if (patches[0]!.op === "update-tool") {
      expect(patches[0]!.targetId).toBe("m_0")
      expect(patches[0]!.toolCall.status).toBe("completed")
      expect(patches[0]!.toolCall.result).toBe("file content")
    }
    const msg = state.messages[0]!
    if (msg.role === "tool") {
      expect(msg.toolCall.status).toBe("completed")
      expect(msg.toolCall.result).toBe("file content")
    }
  })

  it("update-tool: missing toolCallId → no-op", () => {
    const s = stateWithTool()
    const { state, patches } = reduce(s, {
      sessionUpdate: "tool_call_update",
      status: "completed",
    })
    expect(patches).toEqual([])
    expect(state).toBe(s)
  })

  // ⚠️ **הטסט הזה הפוך ממה שהיה, וזה מכוון** (slice acp-v2-reduce).
  // עד כה הוא קיבע `patches: []` — כלומר עדכון לכלי שטרם נוצר נזרק בשקט.
  // ב-ACP v2 אין `tool_call` כלל: ה-update הראשון הוא שיוצר. שינוי-הסמנטיקה
  // מתועד ב-`reduce.ts#handleToolCallUpdate`, והכיסוי המלא יושב ב-
  // `reduce-v2.test.ts`. כאן נשמרת רק העובדה שהוא **אינו** מפיל את הזרם.
  it("update-tool: an unknown toolCallId now CREATES the tool call (v2 semantics)", () => {
    const s = stateWithTool()
    const { state, patches } = reduce(s, {
      sessionUpdate: "tool_call_update",
      toolCallId: "no-such-tool",
      status: "completed",
    })
    expect(patches[0]!.op).toBe("add-message")
    expect(state.messages).toHaveLength(2)
    const created = state.messages[1]!
    if (created.role !== "tool") throw new Error("expected a tool message")
    expect(created.toolCall.toolCallId).toBe("no-such-tool")
  })

  it("partial update — only provided fields change", () => {
    const s = stateWithTool()
    const { state } = reduce(s, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-1",
      status: "in_progress",
    })
    const msg = state.messages[0]!
    if (msg.role === "tool") {
      expect(msg.toolCall.status).toBe("in_progress")
      expect(msg.toolCall.args).toEqual({ path: "/tmp" }) // unchanged
    }
  })
})

// ─── עדכונים לא-מוכרים → נישאים כ-opaque, לא נזרקים ───

/**
 * 🔴 הטסטים כאן **קיבעו את הבאג**: הם דרשו `patches: []` לכל עדכון לא-מוכר,
 * כלומר "מה שאיננו מבינים — נזרק". הקורבן שנתפס בשדה: `plan`/`plan_update`/
 * `plan_removed` (רשימת-המשימות של הסוכן) מטופלים ב-VM דרך `reducePlan`, אבל
 * **רק בנתיב ה-updates הגולמיים = WS**. ב-HTTP ה-FE מקבל Patches ⇒
 * רשימת-המשימות **לא הייתה קיימת שם כלל** (משימה #34).
 *
 * ⚠️ אותה מחלקת-כשל של `if (!text) return` שזרק 4 מ-5 ContentBlocks והעלים
 * תמונה בטעינה-מחדש.
 *
 * העיקרון שהוחלף: **להבין מעט, לשאת הכל.**
 */
describe("reduce — עדכונים לא-מוכרים", () => {
  it("🔴 plan נישא כ-opaque במקום להיזרק", () => {
    const s = mkState()
    const update = { sessionUpdate: "plan", entries: [] }
    const { state, patches } = reduce(s, update)

    expect(patches).toEqual([{ version: s.version + 1, op: "opaque", update }])
    // ה-state עצמו לא משתנה — הליבה אינה מבינה את התוכן — אבל ה-version
    // מתקדם כדי שהסדר והדדופ ימשיכו לעבוד.
    expect(state.version).toBe(s.version + 1)
    expect(state.messages).toEqual(s.messages)
  })

  it("גם סוג-עדכון שלא נראה מעולם נישא", () => {
    const s = mkState()
    const update = { sessionUpdate: "some_future_thing_from_2027", payload: { a: 1 } }
    const { patches } = reduce(s, update)

    expect(patches).toHaveLength(1)
    expect(patches[0]).toMatchObject({ op: "opaque", update })
  })

  it("התוכן נישא **כמות שהוא** — בלי פירוש ובלי חיתוך", () => {
    const s = mkState()
    const update = {
      sessionUpdate: "plan_update",
      planId: "p1",
      entries: [{ content: "שלב", status: "pending" }],
      _meta: { vendor: "x" },
    }
    const { patches } = reduce(s, update)
    // ⚠️ הטענה: זהות מלאה. כל נרמול כאן הוא בדיוק מה שהעיקרון אוסר.
    expect((patches[0] as { update: unknown }).update).toEqual(update)
  })
})

// ─── C1: new metadata handlers ───

describe("reduce — session_info_update (C1)", () => {
  it("sets title on session_info_update", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {
      sessionUpdate: "session_info_update",
      title: "My Session",
    })
    expect(state.title).toBe("My Session")
    expect(patches).toHaveLength(1)
    if (patches[0]!.op === "update-session") {
      expect(patches[0]!.changes.title).toBe("My Session")
    }
  })

  it("clears title when null", () => {
    const s: SessionState = { ...mkState(), title: "Old Title" }
    const { state } = reduce(s, { sessionUpdate: "session_info_update", title: null })
    expect(state.title).toBe("")
  })

  it("keeps title unchanged when title is undefined", () => {
    const s: SessionState = { ...mkState(), title: "Kept" }
    const { state } = reduce(s, { sessionUpdate: "session_info_update" })
    expect(state.title).toBe("Kept")
  })
})

describe("reduce — available_commands_update (C1)", () => {
  it("sets commands", () => {
    const s = mkState()
    const cmds = [{ name: "create_plan", description: "Creates a plan", input: null }]
    const { state, patches } = reduce(s, {
      sessionUpdate: "available_commands_update",
      availableCommands: cmds,
    })
    expect(state.commands).toEqual(cmds)
    expect(patches[0]!.op).toBe("update-session")
  })

  it("sets empty commands when not array", () => {
    const s: SessionState = { ...mkState(), commands: [{ name: "run", description: "run" }] }
    const { state } = reduce(s, {
      sessionUpdate: "available_commands_update",
      availableCommands: "invalid",
    })
    expect(state.commands).toEqual([])
  })
})

describe("reduce — current_mode_update (C1)", () => {
  it("sets modes.currentModeId", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {
      sessionUpdate: "current_mode_update",
      currentModeId: "fast",
    })
    expect(state.modes?.currentModeId).toBe("fast")
    expect(state.modes?.availableModes).toEqual([])
    expect(patches[0]!.op).toBe("update-session")
  })

  it("preserves availableModes when updating currentModeId", () => {
    const s: SessionState = {
      ...mkState(),
      modes: { availableModes: [{ id: "fast", name: "Fast" }], currentModeId: "slow" },
    }
    const { state } = reduce(s, { sessionUpdate: "current_mode_update", currentModeId: "fast" })
    expect(state.modes?.currentModeId).toBe("fast")
    expect(state.modes?.availableModes).toHaveLength(1)
  })

  it("no-op if currentModeId is not a string", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {
      sessionUpdate: "current_mode_update",
      currentModeId: 123,
    })
    expect(state).toBe(s)
    expect(patches).toEqual([])
  })
})

describe("reduce — config_option_update (C1)", () => {
  it("sets configOptions", () => {
    const s = mkState()
    const opts = [{ id: "model", type: "select", name: "Model", currentValue: "gpt4" }]
    const { state, patches } = reduce(s, {
      sessionUpdate: "config_option_update",
      configOptions: opts,
    })
    expect(state.configOptions).toEqual(opts)
    expect(patches[0]!.op).toBe("update-session")
  })

  it("sets empty configOptions when not array", () => {
    const s = mkState()
    const { state } = reduce(s, { sessionUpdate: "config_option_update", configOptions: "invalid" })
    expect(state.configOptions).toEqual([])
  })
})

describe("reduce — usage_update (C1)", () => {
  it("sets contextUsage from usage_update", () => {
    const s = mkState()
    const { state, patches } = reduce(s, { sessionUpdate: "usage_update", used: 100, size: 1000 })
    expect(state.contextUsage?.used).toBe(100)
    expect(state.contextUsage?.size).toBe(1000)
    expect(patches[0]!.op).toBe("update-session")
  })

  it("preserves previous cost when new update omits it (anti-flicker)", () => {
    const s: SessionState = { ...mkState(), contextUsage: { used: 50, size: 1000, cost: 0.05 } }
    const { state } = reduce(s, { sessionUpdate: "usage_update", used: 100, size: 1000 })
    expect(state.contextUsage?.cost).toBe(0.05)
  })

  it("accepts cost when provided", () => {
    const s = mkState()
    const { state } = reduce(s, { sessionUpdate: "usage_update", used: 100, size: 1000, cost: 0.1 })
    expect(state.contextUsage?.cost).toBe(0.1)
  })
})

describe("reduce — turnState derived from content type (C1)", () => {
  it("agent_thought_chunk → turnState 'thinking'", () => {
    const s = mkState()
    const { state } = reduce(s, makeChunk("agent_thought_chunk", "Thinking...", "t-1"))
    expect(state.turnState).toBe("thinking")
  })

  it("agent_message_chunk → turnState 'responding'", () => {
    const s = mkState()
    const { state } = reduce(s, makeChunk("agent_message_chunk", "Hello", "m-1"))
    expect(state.turnState).toBe("responding")
  })

  it("tool_call → turnState 'calling-tool'", () => {
    const s = mkState()
    const { state } = reduce(s, { sessionUpdate: "tool_call", toolCallId: "tc-1", rawInput: {} })
    expect(state.turnState).toBe("calling-tool")
  })

  it("user_message_chunk → no turnState change (replay, not live turn)", () => {
    const s: SessionState = { ...mkState(), turnState: "idle" }
    const { state } = reduce(s, makeChunk("user_message_chunk", "Hi", "u-1"))
    expect(state.turnState).toBe("idle")
  })
})

// ─── deterministic ids ───

describe("reduce — deterministic ids", () => {
  it("multiple reduces produce sequential m_ / s_ ids", () => {
    let s = mkState()
    ;({ state: s } = reduce(s, makeChunk("agent_message_chunk", "A", "msg-1")))
    ;({ state: s } = reduce(s, makeChunk("agent_thought_chunk", "B", "t-1")))
    ;({ state: s } = reduce(s, makeChunk("user_message_chunk", "C", "u-1")))

    expect(s.messages[0]!.id).toBe("m_0")
    expect(s.messages[1]!.id).toBe("m_1")
    expect(s.messages[2]!.id).toBe("m_2")

    if (s.messages[0]!.role !== "tool") {
      expect(s.messages[0]!.segments[0]!.id).toBe("s_0")
    }
    if (s.messages[1]!.role !== "tool") {
      expect(s.messages[1]!.segments[0]!.id).toBe("s_1")
    }
  })

  it("reduce is deterministic — same input same output", () => {
    const s = mkState()
    const r1 = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    const r2 = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    expect(r1.state).toEqual(r2.state)
    expect(r1.patches).toEqual(r2.patches)
  })
})

// ─── immutability ───

describe("reduce — immutability", () => {
  it("original state is not mutated", () => {
    const s = mkState()
    const originalMessages = s.messages
    reduce(s, makeChunk("agent_message_chunk", "Hi", "msg-1"))
    expect(s.messages).toBe(originalMessages) // still the same empty array reference
    expect(s.messages).toHaveLength(0)
  })
})

// ─── מיזוג dev → שרשרת ה-HTTP: סינון מקטעי-רווח ───
// dev תיקן זאת ב-4506229 בתוך AgentSession.#appendChunk — מתודה שהשרשרת הסירה,
// ולכן התיקון היה נופל בשקט במיזוג. הבאג עצמו נשאר בשרשרת: `!text` מסנן מחרוזת
// ריקה בלבד, ומחרוזת של רווחים היא truthy.

describe("reduce — מקטע רווחים בלבד אינו פותח בועה חדשה", () => {
  it("whitespace-only chunk that cannot group → no patch, no message", () => {
    const s = mkState()
    const { state, patches } = reduce(s, makeChunk("agent_message_chunk", "   \n  ", "msg-1"))
    expect(patches).toHaveLength(0)
    expect(state.messages).toHaveLength(0)
    expect(state.nextMessageSeq).toBe(0) // לא בוזבז מזהה
  })

  it("whitespace-only chunk that CAN group is still appended (רווח בין מילים)", () => {
    const s = mkState()
    const first = reduce(s, makeChunk("agent_message_chunk", "Hello", "msg-1"))
    const second = reduce(first.state, makeChunk("agent_message_chunk", " ", "msg-1"))
    expect(second.patches).toHaveLength(1) // מקובץ — לא נפגע
    const msg = second.state.messages[0]!
    if (msg.role !== "tool") expect(msg.segments).toHaveLength(2)
  })
})

/**
 * reduce-v2.test.ts — הווריאנטים של ACP v2 ב-`reduce`.
 *
 * ─── slice acp-v2-reduce (צעד 2 ב-`pre-brief-plan-acp-alignment`) ───
 *
 * ⚠️ **הקובץ הזה אינו מחליף את `reduce.test.ts` — הוא מוסיף לו.** ה-CLI-ים
 * בשטח מדברים v1, וימשיכו לדבר v1 עוד הרבה אחרי ש-v2 יתייצב. ⇒ הווריאנטים
 * של v1 **חייבים** להמשיך לעבוד, ו-`reduce.test.ts` הוא מה שמקבע זאת.
 *
 * למה בכלל ללמד את הליבה v2 לפני שמישהו מדבר אותו: אחרי צעד 3 **אנחנו**
 * נדבר אותו — ה-BE יפלוט `session/update` בצורת-v2 אל ה-FE, וה-FE יקפל אותו
 * ב-`reduce` הזה בדיוק. כלומר v2 אינו "הכנה לעתיד" אלא הצורה של החוט הפנימי.
 */

import { describe, expect, it } from "vitest"
import { reduce } from "./reduce.js"
import type { SessionMessage, SessionState } from "./types.js"

function mkState(): SessionState {
  return {
    version: 0,
    sessionId: "s-1",
    messages: [],
    nextMessageSeq: 0,
    nextSegmentSeq: 0,
    status: "idle",
    turnState: "idle",
    pending: { permission: null, elicitation: null },
    capabilities: null,
    modes: null,
    configOptions: [],
    contextUsage: null,
    quota: null,
    title: "",
    commands: [],
    lastTurnError: null,
  }
}

const textOf = (m: SessionMessage | undefined): string =>
  m && m.role !== "tool" ? m.segments.map((s) => s.text).join("") : ""

// ─────────────────────────────────────────────────────────────────────────────
// upsert של הודעה שלמה
//
// זה מה ש-v1 **לא** נותן, וזה הסיבה שהיעד הוא v2 ולא v1: בלי upsert של הודעה
// שלמה, snapshot מכווץ אינו ניתן לביטוי בפרוטוקול והיה דורש פריים משלנו
// מחוץ לו. עם `agent_message`, ה-snapshot הוא פשוט רצף updates רגילים.
// ─────────────────────────────────────────────────────────────────────────────

describe("reduce v2 — whole-message upsert", () => {
  it("agent_message with a new messageId inserts a message", () => {
    const { state, patches } = reduce(mkState(), {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [
        { type: "text", text: "hello " },
        { type: "text", text: "world" },
      ],
    })
    expect(patches).toHaveLength(1)
    expect(patches[0]!.op).toBe("add-message")
    expect(state.messages).toHaveLength(1)
    expect(textOf(state.messages[0])).toBe("hello world")
    expect(state.messages[0]!.messageId).toBe("M1")
  })

  it("agent_message with a known messageId REPLACES it — it does not append", () => {
    const first = reduce(mkState(), {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [{ type: "text", text: "draft" }],
    }).state
    const { state, patches } = reduce(first, {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [{ type: "text", text: "final answer" }],
    })
    expect(patches[0]!.op).toBe("set-message")
    expect(state.messages).toHaveLength(1)
    expect(textOf(state.messages[0])).toBe("final answer")
  })

  it("a whole message replaces the chunks that built the same messageId", () => {
    // 🔴 המקרה שמייצר את הכיווץ. ה-CLI הזרים 3 chunks; ה-BE משחזר הודעה אחת.
    let s = mkState()
    for (const t of ["a", "b", "c"]) {
      s = reduce(s, {
        sessionUpdate: "agent_message_chunk",
        messageId: "M1",
        content: { type: "text", text: t },
      }).state
    }
    expect(textOf(s.messages[0])).toBe("abc")

    const { state } = reduce(s, {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [{ type: "text", text: "abc" }],
    })
    expect(state.messages).toHaveLength(1)
    expect(textOf(state.messages[0])).toBe("abc")
  })

  it("user_message and agent_thought carry their own roles", () => {
    let s = reduce(mkState(), {
      sessionUpdate: "user_message",
      messageId: "U1",
      content: [{ type: "text", text: "q" }],
    }).state
    s = reduce(s, {
      sessionUpdate: "agent_thought",
      messageId: "T1",
      content: [{ type: "text", text: "hmm" }],
    }).state
    expect(s.messages.map((m) => m.role)).toEqual(["user", "thought"])
  })

  it("non-text content blocks do not vanish — they are carried, not dropped", () => {
    // ⚠️ אותה מחלקת-כשל של `if (!text) return` שזרק 4 מ-5 ContentBlocks
    // והעלים תמונה בטעינה-מחדש. העיקרון: אפס-זריקה.
    const { state } = reduce(mkState(), {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [
        { type: "text", text: "look:" },
        { type: "image", mimeType: "image/png", data: "AAA" },
      ],
    })
    const m = state.messages[0]!
    if (m.role === "tool") throw new Error("expected a content message")
    expect(textOf(m)).toBe("look:")
    expect(m.attachments).toEqual([{ mimeType: "image/png", dataBase64: "AAA" }])
  })

  it("a message with no usable content is still a no-op, not an empty bubble", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {
      sessionUpdate: "agent_message",
      messageId: "M1",
      content: [],
    })
    expect(patches).toEqual([])
    expect(state).toBe(s)
  })

  it("a missing messageId is not a message", () => {
    const s = mkState()
    const { state, patches } = reduce(s, {
      sessionUpdate: "agent_message",
      content: [{ type: "text", text: "x" }],
    })
    expect(patches).toEqual([])
    expect(state).toBe(s)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// state_update
//
// ב-v1 מצב-התור **אינו נתון שעובר בחוט כלל** — הוא החיוּת של `session/prompt`
// תלוי, אובייקט שחי בתוך ה-BE. v2 נתן לו שם. ה-turnState שלנו עדין יותר
// משלושת המצבים של v2, ולכן המיפוי אינו סימטרי: v2 נושא את האמת הגסה,
// וה-chunks מחדדים אותה.
// ─────────────────────────────────────────────────────────────────────────────

describe("reduce v2 — state_update", () => {
  it("running lifts idle to waiting", () => {
    const { state, patches } = reduce(mkState(), {
      sessionUpdate: "state_update",
      state: "running",
    })
    expect(state.turnState).toBe("waiting")
    expect(patches[0]!.op).toBe("update-session")
  })

  it("running NEVER regresses a finer running state", () => {
    // 🔴 הבאג שהמיפוי הנאיבי היה מייצר: באמצע תשובה מגיע `running` נוסף,
    // וה-UI קופץ מ"עונה" חזרה ל"ממתין". שלושת המצבים של v2 גסים משלנו —
    // ⇒ `running` הוא רצפה, לא השמה.
    let s = mkState()
    s = reduce(s, {
      sessionUpdate: "agent_message_chunk",
      messageId: "M1",
      content: { type: "text", text: "hi" },
    }).state
    expect(s.turnState).toBe("responding")

    const { state, patches } = reduce(s, { sessionUpdate: "state_update", state: "running" })
    expect(state.turnState).toBe("responding")
    expect(patches).toEqual([])
  })

  it("idle settles the turn", () => {
    const s = reduce(mkState(), { sessionUpdate: "state_update", state: "running" }).state
    const { state } = reduce(s, {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "end_turn",
    })
    expect(state.turnState).toBe("idle")
    expect(state.lastTurnError).toBeNull()
  })

  it("idle with a failure stopReason records lastTurnError", () => {
    const s = reduce(mkState(), { sessionUpdate: "state_update", state: "running" }).state
    const { state } = reduce(s, {
      sessionUpdate: "state_update",
      state: "idle",
      stopReason: "refusal",
    })
    expect(state.turnState).toBe("idle")
    expect(state.lastTurnError?.message).toBe("refusal")
  })

  it("requires_action maps to waiting and leaves pending alone", () => {
    const s = mkState()
    const { state } = reduce(s, { sessionUpdate: "state_update", state: "requires_action" })
    expect(state.turnState).toBe("waiting")
    expect(state.pending).toEqual(s.pending)
  })

  it("an unknown state is carried as opaque, not dropped", () => {
    // v2 מצהיר מפורשות שערכי-state לא-מוכרים שמורים לווריאנטים עתידיים.
    const { patches } = reduce(mkState(), {
      sessionUpdate: "state_update",
      state: "_drive/hibernating",
    })
    expect(patches[0]!.op).toBe("opaque")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// כלים
// ─────────────────────────────────────────────────────────────────────────────

describe("reduce v2 — tool calls", () => {
  it("the FIRST tool_call_update creates the tool call", () => {
    // ⚠️ שינוי-סמנטיקה מכוון מול v1. ב-v2 אין `tool_call` — ה-update הראשון
    // הוא שיוצר. ב-v1 עדכון ל-id לא-מוכר היה no-op **שקט**, כלומר כלי שהספק
    // דיווח עליו פשוט לא הופיע. זו אותה מחלקת-כשל של "לא מבין ⇒ זורק".
    const { state, patches } = reduce(mkState(), {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-9",
      title: "Read file",
      kind: "read",
      status: "in_progress",
    })
    expect(patches[0]!.op).toBe("add-message")
    const m = state.messages[0]!
    if (m.role !== "tool") throw new Error("expected a tool message")
    expect(m.toolCall.toolCallId).toBe("tc-9")
    expect(m.toolCall.status).toBe("in_progress")
  })

  it("a later tool_call_update still updates in place", () => {
    const s = reduce(mkState(), {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-9",
      title: "Read file",
      status: "in_progress",
    }).state
    const { state, patches } = reduce(s, {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-9",
      status: "completed",
    })
    expect(patches[0]!.op).toBe("update-tool")
    expect(state.messages).toHaveLength(1)
  })

  it("tool_call_content_chunk appends one content item", () => {
    const s = reduce(mkState(), {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-9",
      title: "Run",
    }).state
    let next = reduce(s, {
      sessionUpdate: "tool_call_content_chunk",
      toolCallId: "tc-9",
      content: { type: "content", content: { type: "text", text: "line 1" } },
    }).state
    next = reduce(next, {
      sessionUpdate: "tool_call_content_chunk",
      toolCallId: "tc-9",
      content: { type: "content", content: { type: "text", text: "line 2" } },
    }).state
    const m = next.messages[0]!
    if (m.role !== "tool") throw new Error("expected a tool message")
    expect(m.toolCall.content).toHaveLength(2)
  })

  it("a content chunk for an unknown tool is carried as opaque, not dropped", () => {
    const { patches } = reduce(mkState(), {
      sessionUpdate: "tool_call_content_chunk",
      toolCallId: "ghost",
      content: { type: "content", content: { type: "text", text: "x" } },
    })
    expect(patches[0]!.op).toBe("opaque")
  })
})

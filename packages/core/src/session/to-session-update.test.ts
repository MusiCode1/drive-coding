/**
 * to-session-update.test.ts — ‏slice acp-wire-session-update.
 *
 * 🔴 **הטסט המרכזי כאן הוא ה-round-trip**, ולא טבלת-המיפוי. מיפוי אפשר
 * לקרוא; מה שאי-אפשר לקרוא הוא האם משהו **נפל בדרך**. הזרימה האמיתית היא
 *
 *     CLI update → reduce (BE) → SessionState → updates → reduce (FE) → SessionState
 *
 * ואם שני ה-SessionState אינם שווים, משהו נעלם בשקט — בדיוק מחלקת-הכשל של
 * באג #41 ושל ה-gate שהעלים תמונה. ⇒ הבדיקה היא **שוויון**, לא דגימה.
 */

import { describe, expect, it } from "vitest"
import { reduce } from "./reduce.js"
import { patchToSessionUpdates, stateToSessionUpdates } from "./to-session-update.js"
import type { SessionState } from "./types.js"
import { createInitialSessionState } from "./types.js"

const mk = (): SessionState => createInitialSessionState({ sessionId: "s-1" })

/** מריץ רצף updates של ה-CLI דרך reduce, כמו שה-BE עושה. */
function play(updates: unknown[], from: SessionState = mk()): SessionState {
  let s = from
  for (const u of updates) s = reduce(s, u).state
  return s
}

/** משחזר state מ-snapshot, כמו שה-FE יעשה. */
function replay(snapshot: unknown[]): SessionState {
  return play(snapshot)
}

/**
 * משווה את מה שהוא **חוזה**, ומשמיט את מה שאינו.
 *
 * שני דברים מושמטים בכוונה, ולא כדי "שיעבור":
 *
 * 1. **מונים** (`version`, `next*Seq`) — הם מונים דטרמיניסטיים של הצד
 *    שמקפל, לא מידע-סשן.
 * 2. 🔴 **גבולות-הסגמנטים.** ה-CLI הזרים "part one " ו-"part two" כשני
 *    chunks, וה-snapshot מחזיר הודעה אחת — **וזה בדיוק הכיווץ.** ‏§2
 *    בתוכנית-העל קובע שכיווץ אינו חלק מהפרוטוקול ושהלקוח **אינו יכול
 *    להבחין** אם הטקסט הגיע ב-chunk אחד או ב-71. ⇒ לקבע את הגבולות
 *    פירושו לקבע פרט-מימוש של הספק כאילו הוא חוזה.
 *
 * מה שכן נבדק הוא הטקסט המלא, סדר ההודעות, וכל שדות-המטא.
 */
function meaningful(s: SessionState) {
  const { version: _v, nextMessageSeq: _m, nextSegmentSeq: _g, ...rest } = s
  return {
    ...rest,
    messages: rest.messages.map((m) =>
      m.role === "tool" ? m : { ...m, segments: m.segments.map((x) => x.text).join("") },
    ),
  }
}

const CONVERSATION = [
  { sessionUpdate: "session_info_update", title: "A real session" },
  {
    sessionUpdate: "user_message_chunk",
    messageId: "U1",
    content: { type: "text", text: "hello" },
  },
  {
    sessionUpdate: "agent_thought_chunk",
    messageId: "T1",
    content: { type: "text", text: "thinking…" },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "A1",
    content: { type: "text", text: "part one " },
  },
  {
    sessionUpdate: "agent_message_chunk",
    messageId: "A1",
    content: { type: "text", text: "part two" },
  },
  {
    sessionUpdate: "tool_call",
    toolCallId: "tc-1",
    kind: "read",
    title: "Read",
    rawInput: { path: "/x" },
  },
  {
    sessionUpdate: "tool_call_update",
    toolCallId: "tc-1",
    status: "completed",
    rawOutput: "contents",
  },
  {
    sessionUpdate: "available_commands_update",
    availableCommands: [{ name: "c", description: "d" }],
  },
  { sessionUpdate: "config_option_update", configOptions: [{ id: "mode", category: "mode" }] },
  { sessionUpdate: "current_mode_update", currentModeId: "auto" },
  { sessionUpdate: "usage_update", used: 10, size: 100, cost: 0.5 },
]

describe("snapshot round-trip — nothing may vanish", () => {
  it("state → updates → state reproduces every meaningful field", () => {
    const original = play(CONVERSATION)
    const restored = replay(stateToSessionUpdates(original))
    expect(meaningful(restored)).toEqual(meaningful(original))
  })

  it("the snapshot is COALESCED — two chunks come back as one message, not two", () => {
    // 🟢 זה הכיווץ, והוא יוצא טבעית מכך שה-state מחזיק הודעות ולא chunks.
    // הלקוח אינו יכול להבחין אם הטקסט הגיע ב-chunk אחד או בשניים.
    const original = play(CONVERSATION)
    const snapshot = stateToSessionUpdates(original)
    const messageFrames = snapshot.filter((u) => u.sessionUpdate === "agent_message")
    expect(messageFrames).toHaveLength(1)
    expect(messageFrames[0]!.content).toEqual([{ type: "text", text: "part one part two" }])
  })

  it("a session with pending permission survives — it has no canonical home in ACP", () => {
    // ⚠️ ב-ACP הרשאה היא **בקשה**, לא שדה-מצב. אצלנו היא הפכה למצב מפני
    // שבקשה-ותשובה אינה חוצה SSE. אם היא לא הייתה נוסעת, דיאלוג-ההרשאה
    // פשוט לא היה מופיע אחרי reconnect — כשל שקט מלא.
    const withPending: SessionState = {
      ...play(CONVERSATION),
      pending: {
        permission: { requestId: 7, params: { sessionId: "s-1" } as never },
        elicitation: null,
      },
    }
    const restored = replay(stateToSessionUpdates(withPending))
    expect(restored.pending.permission?.requestId).toBe(7)
  })

  it("counters are NOT restored from the snapshot — and that is correct", () => {
    // הם מונים דטרמיניסטיים של הצד שמקפל, לא מידע-סשן. אחרי שחזור הם
    // משקפים את מה שהצד המשחזר בנה. ה-ids עצמם נבנים מחדש ולכן עקביים.
    const original = play(CONVERSATION)
    const restored = replay(stateToSessionUpdates(original))
    expect(restored.messages.map((m) => m.id)).toEqual(original.messages.map((m) => m.id))
  })
})

describe("patch → session/update", () => {
  it("update-session splits into one canonical frame per field", () => {
    const s = mk()
    const updates = patchToSessionUpdates(s, {
      version: 1,
      op: "update-session",
      changes: {
        title: "T",
        commands: [],
        configOptions: [],
        contextUsage: { used: 1, size: 2 },
      },
    })
    expect(updates.map((u) => u.sessionUpdate)).toEqual([
      "session_info_update",
      "available_commands_update",
      "config_option_update",
      "usage_update",
    ])
  })

  it("turnState travels as ONE state_update — coarse in the field, fine in _meta", () => {
    const s = mk()
    const updates = patchToSessionUpdates(s, {
      version: 1,
      op: "update-session",
      changes: { turnState: "calling-tool" },
    })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({
      sessionUpdate: "state_update",
      state: "running",
      _meta: { "_drive/turnState": "calling-tool" },
    })
    // ...וה-fold מחזיר את הרזולוציה העדינה, לא את הגסה.
    expect(reduce(s, updates[0]).state.turnState).toBe("calling-tool")
  })

  it("idle carries its reason — an idle without the failure is the loss we are avoiding", () => {
    const s = mk()
    const [u] = patchToSessionUpdates(s, {
      version: 1,
      op: "update-session",
      changes: { turnState: "idle", lastTurnError: { message: "refusal", at: 1234 } },
    })
    expect(u).toMatchObject({ sessionUpdate: "state_update", state: "idle", stopReason: "refusal" })
    const back = reduce(s, u).state
    expect(back.turnState).toBe("idle")
    expect(back.lastTurnError).toEqual({ message: "refusal", at: 1234 })
  })

  it("opaque unwraps to the update itself — no wrapper on an update-shaped wire", () => {
    // 🟢 השורה היפה: `opaque` נשא update שהליבה לא הבינה. על חוט שהוא ממילא
    // session/update, הוא פשוט הוא עצמו — ולכן `plan` מגיע ל-FE בלי שה-BE
    // ידע מה זה, וגם בלי מעטפת שמישהו יצטרך לפרק.
    const planUpdate = { sessionUpdate: "plan", entries: [{ content: "step", status: "pending" }] }
    const s = mk()
    const out = patchToSessionUpdates(s, { version: 1, op: "opaque", update: planUpdate })
    expect(out).toEqual([planUpdate])
  })

  it("append-segment picks the chunk variant from the target's role", () => {
    // ה-patch נושא targetId בלבד; הסוג נגזר מה-state. זו הסיבה שהפונקציה
    // מקבלת state ואינה טהורה ב-patch לבדו.
    const s = play([
      {
        sessionUpdate: "agent_thought_chunk",
        messageId: "T1",
        content: { type: "text", text: "x" },
      },
    ])
    const [u] = patchToSessionUpdates(s, {
      version: 9,
      op: "append-segment",
      targetId: s.messages[0]!.id,
      segment: { id: "s_9", text: "more" },
    })
    expect(u).toMatchObject({
      sessionUpdate: "agent_thought_chunk",
      messageId: "T1",
      content: { type: "text", text: "more" },
    })
  })

  it("a null messageId falls back to the synthetic id — v2 requires one", () => {
    // Gemini אינו שולח messageId. v2 דורש אותו על כל chunk והודעה.
    const s = play([{ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "x" } }])
    expect(s.messages[0]!.messageId).toBeNull()
    const [u] = patchToSessionUpdates(s, { version: 9, op: "add-message", message: s.messages[0]! })
    expect(u!.messageId).toBe(s.messages[0]!.id)
  })

  it("a live conversation replayed patch-by-patch equals the same conversation", () => {
    // ⚠️ זה המסלול החי, לא ה-snapshot: כל patch שה-BE מייצר הופך ל-update
    // ונשלח מיד. שני הצדדים חייבים להגיע לאותו מקום.
    let be = mk()
    let fe = mk()
    for (const cliUpdate of CONVERSATION) {
      const { state: next, patches } = reduce(be, cliUpdate)
      be = next
      for (const p of patches) {
        for (const wire of patchToSessionUpdates(be, p)) fe = reduce(fe, wire).state
      }
    }
    expect(meaningful(fe)).toEqual(meaningful(be))
  })
})

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
import { A1_TS, CONVERSATION } from "./__testing__/conversation.js"
import { reduce } from "./reduce.js"
import {
  findMessageIndex,
  patchToSessionUpdates,
  stateToSessionUpdates,
  type WireSessionUpdate,
} from "./to-session-update.js"
import type {
  PendingElicitation,
  PendingPermission,
  QuotaSnapshot,
  SessionCapabilities,
  SessionState,
} from "./types.js"
import { applyPendingRequest, createInitialSessionState } from "./types.js"

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

  // ─── slice carried-snapshot C0: ה-timestamp כשדה-מטא על פריים ההודעה ───

  it("a message timestamp survives the snapshot — the FE derives createdAt from it", () => {
    // 🔴 זה הפער שנמדד על הבסיס (§2): ה-snapshot פלט `agent_message` **בלי**
    // timestamp, וההודעה המשוחזרת חזרה בלי חותמת ⇒ ה-FE גזר `createdAt: 0`
    // והתווית הוסתרה. כאן הוא חייב לשרוד.
    const original = play(CONVERSATION)
    const restored = replay(stateToSessionUpdates(original))
    const tsOf = (s: SessionState) =>
      s.messages.map((m) => (m.role === "tool" ? undefined : m.timestamp))
    expect(tsOf(restored)).toEqual(tsOf(original))
    // ...ולא "שווה כי שניהם ריקים": ההודעה של A1 **כן** נושאת את החותמת.
    expect(restored.messages.find((m) => m.messageId === "A1")?.role).toBe("assistant")
    const a1 = restored.messages.find((m) => m.messageId === "A1")
    expect(a1 && a1.role !== "tool" ? a1.timestamp : undefined).toBe(A1_TS)
  })

  it("messageTimestamps is restored too — meaningful() compares it", () => {
    // ‏`meaningful()` מפילה רק `version` ו-`next*Seq`; המפה **כן** בהשוואה,
    // ולכן בלי שחזורה ה-round-trip מאדים. המפה נגזרת מההודעות עצמן —
    // אין פריים חדש ואין שדה-חוט נוסף.
    const original = play(CONVERSATION)
    const restored = replay(stateToSessionUpdates(original))
    expect(restored.messageTimestamps).toEqual({ A1: A1_TS })
    expect(restored.messageTimestamps).toEqual(original.messageTimestamps)
  })

  it("a message WITHOUT a timestamp carries no _drive/timestamp payload", () => {
    // הודעה בלי חותמת לא נושאת מטען מיותר — אותו כלל כמו `midMeta`.
    const snapshot = stateToSessionUpdates(play(CONVERSATION))
    const u1 = snapshot.find((u) => u.sessionUpdate === "user_message")
    expect(u1).toBeDefined()
    const meta = u1?._meta as Record<string, unknown> | undefined
    expect(meta?.["_drive/timestamp"]).toBeUndefined()
  })

  it("the restored message does NOT keep _drive/timestamp inside msg.meta", () => {
    // 🔴 ‏`metaOf(u)` מחזיר את כל `_meta`, וההודעה שומרת אותו ב-`msg.meta`.
    // בלי מחיקה ההודעה המשוחזרת נושאת מפתח שלא היה במקור — ‏`meaningful()`
    // מאדים בצדק. המפתח הוא **חוט**, לא מטא-של-הודעה.
    const snapshot = stateToSessionUpdates(play(CONVERSATION))
    const frame = snapshot.find((u) => u.sessionUpdate === "agent_message")
    // בחוט הוא כן נוסע...
    expect((frame?._meta as Record<string, unknown>)?.["_drive/timestamp"]).toBe(A1_TS)
    // ...ובמצב המשוחזר הוא נמחק, ואם לא נותר כלום — אין `meta` בכלל.
    const restored = replay(snapshot)
    const a1 = restored.messages.find((m) => m.messageId === "A1")
    expect(a1?.meta?.["_drive/timestamp"]).toBeUndefined()
    expect(a1?.meta).toBeUndefined()
  })

  // ─── slice carried-snapshot C3: שחזור `carried` במיקומו ───

  it("a plan frame comes back BETWEEN the message frames, not at the end", () => {
    // 🔴 המיקום אינו קוסמטי: ‏`plan` ששייך לאמצע השיחה ונפלט בסוף היה
    // משנה את סדר-ההגעה שהצרכן רואה. ‏§4.5 שוזר לפי ה-`after`.
    const withPlan = play([
      ...CONVERSATION,
      { sessionUpdate: "plan", entries: [{ content: "step", status: "pending" }] },
      {
        sessionUpdate: "agent_message",
        messageId: "A2",
        content: [{ type: "text", text: "after the plan" }],
      },
    ])
    const kinds = stateToSessionUpdates(withPlan).map((u) => u.sessionUpdate)
    const planAt = kinds.indexOf("plan")
    expect(planAt).toBeGreaterThan(-1)
    // ...אחרי פריים-הודעה כלשהו, ולפני פריים-ההודעה האחרון.
    expect(kinds.lastIndexOf("agent_message")).toBeGreaterThan(planAt)
    expect(kinds.indexOf("agent_message")).toBeLessThan(planAt)
  })

  it("the full round-trip restores carried identically — same keys, order, after", () => {
    // הבדיקה שהמיקום נכון אינה עין אנושית: ה-round-trip חייב להחזיר
    // `carried` **זהה**. אם המיקום יוצא שונה, `meaningful()` מאדים.
    const original = play([
      ...CONVERSATION,
      { sessionUpdate: "plan", entries: [{ content: "step", status: "pending" }] },
      {
        sessionUpdate: "agent_message",
        messageId: "A2",
        content: [{ type: "text", text: "after the plan" }],
      },
      { sessionUpdate: "some_future_thing", payload: { a: 1 } },
    ])
    const restored = replay(stateToSessionUpdates(original))
    expect(restored.carried).toEqual(original.carried)
    expect(original.carried?.map((e) => e.key)).toEqual(["plan:__default__", "some_future_thing"])
    expect(meaningful(restored)).toEqual(meaningful(original))
  })

  it("carried ריק ⇒ ה-snapshot זהה בתוכן לזה שלפני הסלייס", () => {
    // אין פריימים חדשים כשאין מה לשאת — הסלייס אינו מרחיב את החוט סתם.
    const s = play(CONVERSATION)
    expect(s.carried).toEqual([])
    const kinds = stateToSessionUpdates(s).map((u) => u.sessionUpdate)
    expect(kinds).toEqual([
      "user_message",
      "agent_thought",
      "agent_message",
      "tool_call_update",
      "session_info_update",
      "available_commands_update",
      "config_option_update",
      "current_mode_update",
      "usage_update",
      "state_update",
      "_drive/session_update",
    ])
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

// ─── slice history-cursor C0: `fromMessage` — חיתוך ההיסטוריה בליבה ──────────

describe("stateToSessionUpdates — fromMessage (slice history-cursor C0)", () => {
  /**
   * שיחה של שלוש הודעות + ארבעה `carried` שמכסים את כל ארבעת המסלולים:
   * עוגן `null`, עוגן לפני החיתוך, עוגן אחרי החיתוך, ועוגן שאינו קיים כלל.
   *
   * ‏`carried` נבנה כאן **ישירות על השדה** ולא דרך `recordCarried`, כי מה
   * שנבדק הוא ההתנהגות לפי ה-`after` — וקביעתו המפורשת היא בדיוק הנקודה.
   */
  function convo(): SessionState {
    return {
      ...mk(),
      title: "כותרת",
      messages: [
        { id: "m_0", role: "user", messageId: "u-0", segments: [{ id: "s_0", text: "אחת" }] },
        { id: "m_1", role: "assistant", messageId: "a-1", segments: [{ id: "s_1", text: "שתיים" }] },
        { id: "m_2", role: "user", messageId: "u-2", segments: [{ id: "s_2", text: "שלוש" }] },
      ],
      nextMessageSeq: 3,
      nextSegmentSeq: 3,
      carried: [
        { key: "plan", after: "m_0", update: { sessionUpdate: "plan", id: "at-m0" } },
        { key: "diff", after: "m_2", update: { sessionUpdate: "plan", id: "at-m2" } },
        { key: "early", after: null, update: { sessionUpdate: "plan", id: "at-null" } },
        { key: "orphan", after: "m_99", update: { sessionUpdate: "plan", id: "orphan" } },
      ],
    }
  }

  const kinds = (u: WireSessionUpdate[]): string[] => u.map((x) => x.sessionUpdate)
  const msgIds = (u: WireSessionUpdate[]): unknown[] =>
    u.filter((x) => x.sessionUpdate.endsWith("_message")).map((x) => x.messageId)
  const carriedIds = (u: WireSessionUpdate[]): unknown[] =>
    u.filter((x) => x.sessionUpdate === "plan").map((x) => (x as { id?: unknown }).id)

  it("‏בלי הארגומנט — הפלט זהה לחלוטין לקריאה ללא אופציות", () => {
    const s = convo()
    // 🔴 המלכודת של §7.1: כל קורא קיים חייב להתנהג בדיוק כמו קודם.
    expect(stateToSessionUpdates(s, {})).toEqual(stateToSessionUpdates(s))
    expect(stateToSessionUpdates(s, { fromMessage: undefined })).toEqual(stateToSessionUpdates(s))
  })

  it("‏`fromMessage: \"m_1\"` — רק ההודעות מ-m_1 ואילך", () => {
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    expect(msgIds(out)).toEqual(["a-1", "u-2"])
  })

  it("‏`fromMessage` לפי ה-messageId של ACP — אותה תוצאה כמו ה-`m_<seq>` שלה", () => {
    const bySeq = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    const byMid = stateToSessionUpdates(convo(), { fromMessage: "a-1" })
    expect(byMid).toEqual(bySeq)
  })

  it("‏`carried` שעוגן ב-m_0, חיתוך ב-m_1 — **אינו** בפלט", () => {
    // 🔴 שער-המוטציה §6: השוואה מול ההודעות ה**חתוכות** במקום המלאות מחזירה
    // אותו דרך לולאת-השיירים ("העוגן לא קיים") — והשורה הזאת מאדימה.
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    expect(carriedIds(out)).not.toContain("at-m0")
  })

  it("‏`carried` שעוגן ב-m_2, חיתוך ב-m_1 — **כן** בפלט", () => {
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    expect(carriedIds(out)).toContain("at-m2")
  })

  it("🔴 ‏`carried` עם `after: null`, חיתוך ב-m_1 — **אינו** בפלט", () => {
    // §4.1.2 ענף א: `null` לעולם אינו ברשימת-ההודעות, ולכן בדיקת-"קיים
    // ברשימה המלאה" לבדה הייתה מחזירה אותו כשייר — בניגוד לכלל.
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    expect(carriedIds(out)).not.toContain("at-null")
  })

  it("‏עוגן שאינו קיים ברשימה המלאה — **כן** בפלט כשייר (§4.1.2 ענף ג)", () => {
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_1" })
    expect(carriedIds(out)).toContain("orphan")
  })

  it("‏בכל חיתוך — בלוק המטא-מידע נשאר במלואו (§4.1.3)", () => {
    const out = stateToSessionUpdates(convo(), { fromMessage: "m_2" })
    expect(kinds(out)).toContain("session_info_update")
    expect(kinds(out)).toContain("config_option_update")
    expect(kinds(out)).toContain("_drive/session_update")
    const info = out.find((u) => u.sessionUpdate === "session_info_update")
    expect(info?.title).toBe("כותרת")
  })

  it("‏`fromMessage` שאינו נמצא — מחזיר `[]`, לא פלט-מלא ולא זריקה (§4.1.1)", () => {
    // ─── slice header-always-full C3: החריג, בשמו ───
    //
    // 🔴 **זהו החריג היחיד לכלל "כותרת תמיד"**, והוא הכרעה נעולה ולא פרצה.
    // ‏`stateToSessionUpdates` מתחייב שכל מסלול "מ-X" פולט את מצב-הכותרת
    // המלא — ובראשו שאלה ממתינה למשתמש, שאובדנה משאירה סשן תלוי. כאן,
    // ורק כאן, הכותרת **יורדת יחד עם ההודעות**: ‏`toEqual([])` מקבע את שתי
    // הפליטות גם יחד, ולכן אין טסט נפרד ל"הכותרת ירדה" — הוא היה כפילות.
    //
    // הסיבה שזה נכון: מזהה שאינו נמצא הוא **בקשה לעוגן שאינו קיים**, ולא
    // בקשה להיסטוריה. פלט-מלא בשקט הוא בדיוק מחלקת-הכשל ש-`history-cursor`
    // סגר. ‏ה-BE אינו נשען על הצורה הזאת כלל — `history.ts` קורא
    // ל-`findMessageIndex` **לפני** ה-`snapshotPayload` ומתרגם ל-400 (יש לזה
    // שער משלו: `400 על מזהה לא-מוכר` ב-`history.test.ts`).
    //
    // ⚠️ **אל "תתקן" את זה לטובת כלל-הכותרת.** הסתירה מודעת ומתועדת.
    expect(stateToSessionUpdates(convo(), { fromMessage: "m_999" })).toEqual([])
  })

  it("‏חיתוך על ההודעה הראשונה — פלט זהה לחיתוך-שאינו (כל ההודעות)", () => {
    const s = convo()
    expect(msgIds(stateToSessionUpdates(s, { fromMessage: "m_0" }))).toEqual(["u-0", "a-1", "u-2"])
  })
})

describe("findMessageIndex (slice history-cursor C0)", () => {
  function convo(): SessionState {
    return {
      ...mk(),
      messages: [
        { id: "m_0", role: "user", messageId: "u-0", segments: [{ id: "s_0", text: "אחת" }] },
        { id: "m_1", role: "assistant", messageId: "a-1", segments: [{ id: "s_1", text: "שתיים" }] },
      ],
      nextMessageSeq: 2,
      nextSegmentSeq: 2,
    }
  }

  it("‏מוצא לפי ה-id הסינתטי", () => {
    expect(findMessageIndex(convo(), "m_1")).toBe(1)
  })

  it("‏מוצא לפי messageId של ACP כשאין התאמת-id", () => {
    expect(findMessageIndex(convo(), "a-1")).toBe(1)
  })

  it("‏מזהה לא-מוכר ⇒ `-1` — סימן, לא זריקה (‏`throw` אסור בליבה)", () => {
    expect(findMessageIndex(convo(), "m_999")).toBe(-1)
  })

  it("‏התאמת-`id` גוברת על התאמת-`messageId` גם כשה-messageId מקדים ברשימה", () => {
    // הודעה ששדה ה-messageId שלה שווה ל-id של הודעה מאוחרת יותר.
    const s: SessionState = {
      ...mk(),
      messages: [
        { id: "m_0", role: "user", messageId: "m_1", segments: [{ id: "s_0", text: "א" }] },
        { id: "m_1", role: "assistant", messageId: "a-1", segments: [{ id: "s_1", text: "ב" }] },
      ],
      nextMessageSeq: 2,
      nextSegmentSeq: 2,
    }
    expect(findMessageIndex(s, "m_1")).toBe(1)
  })

  it("‏state בלי הודעות ⇒ `-1`", () => {
    expect(findMessageIndex(mk(), "m_0")).toBe(-1)
  })
})

// ─── slice header-always-full C0: כותרת מלאה שורדת כל חיתוך ─────────────────

describe("stateToSessionUpdates — כותרת מלאה תחת חיתוך (slice header-always-full)", () => {
  /**
   * 🔴 **ברירת-מחדל אינה עדות.** השער הקיים (`בכל חיתוך — בלוק המטא-מידע נשאר
   * במלואו`) מאשר `toContain` על סוגי-פריים, ולכן הוא עובר גם על state שכל
   * שדות-הכותרת שלו בברירת-המחדל — כלומר גם כש**אין** שאלה ממתינה, **אין**
   * מכסה, וה-status הוא `"idle"`. הוא מקבע את **קיום הפריים**, לא את
   * **הישרדות התוכן**.
   *
   * ⇒ כאן כל שדה-כותרת נושא ערך שאינו ברירת-המחדל, וכל אסרציה היא על
   * **ערך**. זו ההבחנה שהסלייס כולו קיים בשבילה: אובדן `pending.permission`
   * תחת חיתוך = סשן תלוי, והשער הקודם לא היה מאדים עליו.
   */

  const QUOTA: QuotaSnapshot = {
    provider: "claude",
    windows: [
      {
        id: "w1",
        period: { kind: "calendar" as const, unit: "month" as const },
        consumption: { kind: "percentage" as const, usedPct: 99 },
        resetsAtMs: null,
      },
    ],
  }

  const CAPS: SessionCapabilities = {
    mcp: true,
    compact: true,
    commands: true,
    usage: true,
    configOptions: true,
    rename: true,
    thinkingTokens: true,
    image: true,
  }

  const PERMISSION: PendingPermission = {
    requestId: 7,
    params: { sessionId: "s-1", toolCall: { toolCallId: "tc-1", title: "מחיקת קובץ" } } as never,
  }

  const ELICITATION: PendingElicitation = {
    requestId: 8,
    params: { sessionId: "s-1", message: "באיזו תיקייה?" } as never,
  }

  /**
   * מצב-כותרת **מאוכלס** — כל שדה בערך שאינו ברירת-המחדל.
   *
   * 🔴 **ה-pending נבנה דרך `applyPendingRequest` ולא בהשמה ישירה.** הפונקציה
   * מחזיקה את מלכודת-ה-spread ("pending חייב לשאת את שני השדות תמיד"),
   * ופיקסצ'ר שעוקף אותה יכול לקבע צורה שהמסלול האמיתי לעולם אינו מייצר.
   *
   * ⚠️ שלוש ההודעות הן `user`/`assistant` בלבד — בלי `thought` ובלי `tool`.
   * ר' הערת `headerTail` למטה.
   */
  function fullHeaderState(): SessionState {
    const base: SessionState = {
      ...mk(),
      title: "כותרת של סשן חי",
      status: "disconnected",
      turnState: "thinking",
      commands: [{ name: "compact", description: "כיווץ ההקשר" }],
      configOptions: [
        { id: "verbosity", name: "Verbosity", type: "boolean" as const, currentValue: false },
      ],
      modes: { availableModes: [{ id: "plan", name: "תכנון" }], currentModeId: "plan" },
      contextUsage: { used: 1200, size: 200000, cost: 0.42 },
      capabilities: CAPS,
      quota: QUOTA,
      messages: [
        { id: "m_0", role: "user", messageId: "u-0", segments: [{ id: "s_0", text: "אחת" }] },
        {
          id: "m_1",
          role: "assistant",
          messageId: "a-1",
          segments: [{ id: "s_1", text: "שתיים" }],
        },
        { id: "m_2", role: "user", messageId: "u-2", segments: [{ id: "s_2", text: "שלוש" }] },
      ],
      nextMessageSeq: 3,
      nextSegmentSeq: 3,
    }
    const withPermission = applyPendingRequest(base, {
      kind: "permission",
      value: PERMISSION,
    }).state
    return applyPendingRequest(withPermission, { kind: "elicitation", value: ELICITATION }).state
  }

  /**
   * זנב-הכותרת — כל פריים שאינו הודעה ואינו `carried`.
   *
   * ⚠️ **שלושת המסננים אינם קוסמטיים.** ‏`messageToUpdate` פולט הודעת-כלי
   * כ-`tool_call_update` ומחשבה כ-`agent_thought`; שניהם **אינם** מסתיימים
   * ב-`_message` והיו נכנסים לזנב בטעות — ואז הטסט היה מאדים על ההבדל
   * הצפוי (ההודעות נחתכו) במקום על זה שחשוב. הפיקסצ'ר שלמעלה אינו מונה
   * הודעות כאלה, ולכן זו הגנה מפני שינוי עתידי ולא תקלה היום.
   */
  const headerTail = (u: WireSessionUpdate[]): WireSessionUpdate[] =>
    u.filter(
      (x) =>
        !x.sessionUpdate.endsWith("_message") &&
        x.sessionUpdate !== "agent_thought" &&
        !x.sessionUpdate.startsWith("tool_call") &&
        !x.sessionUpdate.startsWith("plan"),
    )

  const msgIds = (u: WireSessionUpdate[]): unknown[] =>
    u.filter((x) => x.sessionUpdate.endsWith("_message")).map((x) => x.messageId)

  const driveBlock = (u: WireSessionUpdate[]): Record<string, unknown> | undefined =>
    u.find((x) => x.sessionUpdate === "_drive/session_update")?.changes as
      | Record<string, unknown>
      | undefined

  it("‏זנב-הכותרת תחת חיתוך **זהה** לזה של frame-zero — שוויון עמוק, לא נוכחות", () => {
    const s = fullHeaderState()

    const full = headerTail(stateToSessionUpdates(s))
    const cut = headerTail(stateToSessionUpdates(s, { fromMessage: "m_2" }))

    expect(cut).toEqual(full)
    // שער-ריק: זנב ריק משני הצדדים היה עובר את השורה שלמעלה בלי לומר דבר.
    expect(cut.length).toBeGreaterThan(0)
  })

  it("‏תוכן, לא נוכחות — ה-permission הפתוחה נושאת את ה-requestId שלה תחת חיתוך", () => {
    const cut = stateToSessionUpdates(fullHeaderState(), { fromMessage: "m_2" })

    const changes = driveBlock(cut)
    expect(changes?.pending).toEqual({ permission: PERMISSION, elicitation: ELICITATION })
    expect((changes?.pending as { permission: PendingPermission }).permission.requestId).toBe(7)
  })

  it("‏תוכן, לא נוכחות — ‏`status` ו-`quota` יוצאים בערכם שאינו ברירת-המחדל", () => {
    const cut = stateToSessionUpdates(fullHeaderState(), { fromMessage: "m_2" })

    const changes = driveBlock(cut)
    // 🔴 ‏`"idle"` ו-`null` הם ברירות-המחדל; אסרציה עליהם לא הייתה מבחינה
    // בין "שרד" ל"נולד ככה".
    expect(changes?.status).toBe("disconnected")
    expect(changes?.quota).toEqual(QUOTA)
    expect(changes?.capabilities).toEqual(CAPS)
  })

  it("‏ההודעות **כן** נחתכו — בלי זה שער-הכותרת היה עובר גם אם החיתוך לא קרה", () => {
    const s = fullHeaderState()

    expect(msgIds(stateToSessionUpdates(s))).toEqual(["u-0", "a-1", "u-2"])
    expect(msgIds(stateToSessionUpdates(s, { fromMessage: "m_2" }))).toEqual(["u-2"])
  })

  // ─── C1: זהות מצב-הצרכן ───

  /**
   * שדות-הכותרת של ה-state שהצרכן בונה.
   *
   * 🔴 **`version` ו-`messages` מוחרגים במפורש, ונבדקים בנפרד.** הם **אמורים**
   * להיות שונים בין האגפים — זהות עליהם הייתה מוכיחה שהחיתוך כלל לא קרה.
   * השוואת שני ה-state במלואם היא הדרך המהירה לשער שמאדים על ההבדל הנכון
   * ומסתיר את זה שחשוב.
   */
  const headerFields = (s: SessionState) => ({
    pending: s.pending,
    status: s.status,
    quota: s.quota,
    title: s.title,
    modes: s.modes,
    capabilities: s.capabilities,
    contextUsage: s.contextUsage,
    turnState: s.turnState,
  })

  it("‏מצב-הצרכן: שדות-הכותרת של שני האגפים שווים אחרי `reduce` ממצב התחלתי", () => {
    const s = fullHeaderState()

    // 🔴 **אגף-מול-אגף, לעולם לא צרכן-מול-פיקסצ'ר.** ‏`modes` lossy במסלול
    // הזה — `changesToUpdates` פולט ממנו רק `currentModeId`, ו-`reduce`
    // משחזר `availableModes` מה-state שלו (ריק בצרכן שמתחיל מאפס). שני
    // האגפים מאבדים אותו **במידה שווה**, וזו בדיוק השאלה שהשער שואל.
    const consumerFull = replay(stateToSessionUpdates(s))
    const consumerCut = replay(stateToSessionUpdates(s, { fromMessage: "m_2" }))

    expect(headerFields(consumerCut)).toEqual(headerFields(consumerFull))

    // שער-ריק: שני צרכנים בברירת-מחדל היו עוברים את השורה שלמעלה בשקט.
    expect(consumerCut.pending.permission?.requestId).toBe(7)
    expect(consumerCut.pending.elicitation?.requestId).toBe(8)
    expect(consumerCut.status).toBe("disconnected")
    expect(consumerCut.quota).toEqual(QUOTA)
    expect(consumerCut.turnState).toBe("thinking")
  })

  it("‏‏`messages` ו-`version` של הצרכן **כן** נבדלים — ההוכחה שהחיתוך קרה", () => {
    const s = fullHeaderState()

    const consumerFull = replay(stateToSessionUpdates(s))
    const consumerCut = replay(stateToSessionUpdates(s, { fromMessage: "m_2" }))

    expect(consumerFull.messages).toHaveLength(3)
    expect(consumerCut.messages).toHaveLength(1)
    expect(consumerCut.version).toBeLessThan(consumerFull.version)
  })
})

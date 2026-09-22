/**
 * carried.test.ts — ‏slice carried-snapshot C1.
 *
 * ‏`carried` הוא ה-buffer הכללי שנושא updates שהליבה **אינה מכירה** (`plan`,
 * ‏`plan_update`, וכל סוג עתידי) דרך ה-snapshot. הליבה אינה מפרשת את תוכנם —
 * היא רק בוחרת להם משבצת לפי טבלת-חוקים, ומגבילה את המטען.
 *
 * 🔴 **הכלל הראשון הוא ההגנה על כל השאר:** סוג שנמצא ב-`RECOGNIZED` אינו
 * נרשם. ‏`reduce` נושא כ-`opaque` גם update **מוכר** שלא ייצר patches אך יש
 * לו `_meta` (העטיפה `carry-when-nothing-mapped`), וה-snapshot עצמו פולט
 * `state_update` עם `_meta` בכל state שאינו `idle` ⇒ בלי הכלל, ה-snapshot
 * **מזין את עצמו** וה-round-trip מאדים בשיחה נקייה לגמרי.
 */

import { describe, expect, it } from "vitest"
import { CONVERSATION } from "./__testing__/conversation.js"
import { CARRIED_MAX_ENTRIES, CARRIED_MAX_UPDATE_CHARS, carryKeyOf, RECOGNIZED } from "./carried.js"
import { reduce } from "./reduce.js"
import { stateToSessionUpdates } from "./to-session-update.js"
import type { SessionState } from "./types.js"
import { createInitialSessionState } from "./types.js"

const mk = (): SessionState => createInitialSessionState({ sessionId: "s-1" })

function play(updates: unknown[], from: SessionState = mk()): SessionState {
  let s = from
  for (const u of updates) s = reduce(s, u).state
  return s
}

/** הודעה שלמה — כדי לקבוע עוגני-`after` בלי להיתלות ב-chunks. */
const msg = (mid: string, text: string) => ({
  sessionUpdate: "agent_message",
  messageId: mid,
  content: [{ type: "text", text }],
})

const planUpdate = (planId: string, content = "step") => ({
  sessionUpdate: "plan_update",
  plan: { type: "items", planId, entries: [{ content, status: "pending" }] },
})

describe("carryKeyOf — טבלת-חוקים, לא שיקול-דעת", () => {
  it("🔴 כל סוג ב-RECOGNIZED מחזיר null — הליבה מכירה אותו", () => {
    // המחגר של §7.4: סוג מוכר שנשמט מ-`RECOGNIZED` יתחיל להירשם ל-`carried`
    // ויאדים את ה-round-trip. הטבלה מפורשת כאן כדי שהנשירה תיתפס כאן.
    const every = [
      "agent_message_chunk",
      "agent_thought_chunk",
      "user_message_chunk",
      "agent_message",
      "agent_thought",
      "user_message",
      "state_update",
      "_drive/session_update",
      "_drive/reset",
      "tool_call",
      "tool_call_update",
      "tool_call_content_chunk",
      "session_info_update",
      "available_commands_update",
      "current_mode_update",
      "config_option_update",
      "usage_update",
      "_drive/ext_notification",
    ]
    expect([...RECOGNIZED].sort()).toEqual([...every].sort())
    for (const sessionUpdate of every) {
      expect(carryKeyOf({ sessionUpdate })).toBeNull()
    }
  })

  it("plan → משבצת __default__ · plan_update → משבצת לפי planId", () => {
    // ‏`reducePlan` הוא upsert ל-`__default__` עבור `plan`, ו-upsert **לפי
    // planId** עבור `plan_update`. משבצת אחת ל-"plan" הייתה מאבדת תוכן.
    expect(carryKeyOf({ sessionUpdate: "plan", entries: [] })).toBe("plan:__default__")
    expect(carryKeyOf(planUpdate("p1"))).toBe("plan:p1")
  })

  it("plan_removed מפנה ואינו נשמר בעצמו", () => {
    expect(carryKeyOf({ sessionUpdate: "plan_removed", planId: "p1" })).toEqual({
      evict: "plan:p1",
    })
    // התנאי זהה ל-`reducePlan`: ‏planId שאינו string הוא no-op.
    expect(carryKeyOf({ sessionUpdate: "plan_removed", planId: 7 })).toBeNull()
    expect(carryKeyOf({ sessionUpdate: "plan_removed" })).toBeNull()
  })

  it("plan_update בלי plan.planId אינו נשמר", () => {
    expect(carryKeyOf({ sessionUpdate: "plan_update", plan: { type: "items" } })).toBeNull()
    expect(carryKeyOf({ sessionUpdate: "plan_update" })).toBeNull()
    expect(carryKeyOf({ sessionUpdate: "plan_update", plan: null })).toBeNull()
  })

  it("כל סוג אחר — משבצת לפי ערך ה-sessionUpdate · לא-string ⇒ null", () => {
    expect(carryKeyOf({ sessionUpdate: "some_future_thing" })).toBe("some_future_thing")
    expect(carryKeyOf({ sessionUpdate: 7 })).toBeNull()
    expect(carryKeyOf({})).toBeNull()
  })
})

describe("carried — רישום דרך reduce", () => {
  it("🔴 ה-CONVERSATION הקיים → snapshot → replay ⇒ carried ריק בשני הצדדים", () => {
    // ממצא 1: בלי `RECOGNIZED`, פריים ה-`state_update` של ה-snapshot עצמו
    // חוזר כ-`opaque` (הוא נושא `_meta` ואינו משנה כלום בשחזור) — כלומר
    // ה-snapshot מזין את עצמו בשיחה שאין בה אף סוג לא-מוכר.
    const original = play(CONVERSATION)
    const restored = play(stateToSessionUpdates(original))
    expect(original.carried).toEqual([])
    expect(restored.carried).toEqual([])
  })

  it("_drive/ext_notification — carried ריק, ובכל זאת נפלט patch opaque", () => {
    // אילוץ 4: ה-passthrough ל-FE (transcripts של subagents) הוא הזרם החי
    // ואסור לפגוע בו. הוא פשוט אינו נכנס ל-buffer.
    const { state, patches } = reduce(mk(), {
      sessionUpdate: "_drive/ext_notification",
      method: "_claude/sdkMessage",
      params: { message: { type: "system" } },
    })
    expect(state.carried).toEqual([])
    expect(patches.map((p) => p.op)).toContain("opaque")
  })

  it("plan ואז plan_update עם planId אחר ⇒ שתי רשומות", () => {
    const s = play([{ sessionUpdate: "plan", entries: [] }, planUpdate("p1")])
    expect(s.carried?.map((e) => e.key)).toEqual(["plan:__default__", "plan:p1"])
  })

  it("plan_update פעמיים על אותו planId ⇒ רשומה אחת, ה-update האחרון", () => {
    const s = play([planUpdate("p1", "first"), planUpdate("p1", "second")])
    expect(s.carried).toHaveLength(1)
    expect(s.carried?.[0]?.key).toBe("plan:p1")
    expect(s.carried?.[0]?.update).toEqual(planUpdate("p1", "second"))
  })

  it("plan_update(p1) ואז plan_removed(p1) ⇒ carried בלי plan:p1, ולא רשומת-מחיקה", () => {
    // מחיקה היא חוק-המיזוג שלה: היא **מפנה** את המשבצת ואינה תופסת אחת.
    const s = play([planUpdate("p1"), { sessionUpdate: "plan_removed", planId: "p1" }])
    expect(s.carried).toEqual([])
  })

  it("שני סוגים לא-מוכרים שונים ⇒ שתי רשומות, שני מפתחות", () => {
    const s = play([{ sessionUpdate: "weird_a" }, { sessionUpdate: "weird_b" }])
    expect(s.carried?.map((e) => e.key)).toEqual(["weird_a", "weird_b"])
  })

  it("after — לפני כל ההודעות ⇒ null · אחרי השנייה ⇒ m_1", () => {
    const before = play([{ sessionUpdate: "weird_a" }])
    expect(before.carried?.[0]?.after).toBeNull()

    const after = play([msg("A", "one"), msg("B", "two"), { sessionUpdate: "weird_a" }])
    expect(after.messages.map((m) => m.id)).toEqual(["m_0", "m_1"])
    expect(after.carried?.[0]?.after).toBe("m_1")
  })

  it("🔴 רענון מפתח אחרי הודעה מאוחרת ⇒ הרשומה בסוף המערך, after מעודכן", () => {
    // ממצא 2: סדר-המערך חייב להתלכד עם סדר ה-`after`, כי §4.5 שוזר את
    // ה-carried לפי ה-`after` שלהם. החלפה-במקום הייתה משאירה את הרשומה
    // באינדקס ישן בעוד השזירה פולטת אותה מאוחר ⇒ `toEqual` רגיש-לסדר מאדים.
    const s = play([
      msg("A", "one"),
      planUpdate("p1", "early"),
      msg("B", "two"),
      { sessionUpdate: "weird_a" },
      planUpdate("p1", "late"),
    ])
    expect(s.carried?.map((e) => e.key)).toEqual(["weird_a", "plan:p1"])
    const p1 = s.carried?.find((e) => e.key === "plan:p1")
    expect(p1?.after).toBe("m_1")
    expect(p1?.update).toEqual(planUpdate("p1", "late"))
  })

  it("update מעל CARRIED_MAX_UPDATE_CHARS ⇒ לא נשמר; ה-patch opaque כן נפלט", () => {
    const huge = { sessionUpdate: "weird_big", blob: "x".repeat(CARRIED_MAX_UPDATE_CHARS + 1) }
    expect(JSON.stringify(huge).length).toBeGreaterThan(CARRIED_MAX_UPDATE_CHARS)
    const { state, patches } = reduce(mk(), huge)
    expect(state.carried).toEqual([])
    expect(patches.map((p) => p.op)).toEqual(["opaque"])
  })

  it("יותר מ-CARRIED_MAX_ENTRIES מפתחות ⇒ האורך נעצר בתקרה, הישן ביותר פונה", () => {
    const frames = Array.from({ length: CARRIED_MAX_ENTRIES + 5 }, (_, i) => ({
      sessionUpdate: `weird_${i}`,
    }))
    const s = play(frames)
    expect(s.carried).toHaveLength(CARRIED_MAX_ENTRIES)
    // חמשת הראשונים פונו; האחרון נשמר.
    expect(s.carried?.[0]?.key).toBe("weird_5")
    expect(s.carried?.at(-1)?.key).toBe(`weird_${CARRIED_MAX_ENTRIES + 4}`)
  })

  it("update מעגלי — לא זורק, לא נשמר", () => {
    // ‏`JSON.stringify` על מבנה מעגלי זורק. הליבה אינה זורקת ⇒ "לא נשמר".
    const circular: Record<string, unknown> = { sessionUpdate: "weird_circular" }
    circular.self = circular
    expect(() => reduce(mk(), circular)).not.toThrow()
    const { state, patches } = reduce(mk(), circular)
    expect(state.carried).toEqual([])
    expect(patches.map((p) => p.op)).toEqual(["opaque"])
  })

  it("reset מנקה את carried — כל after הופך לעוגן תלוי-באוויר", () => {
    const s = play([msg("A", "one"), planUpdate("p1"), { sessionUpdate: "_drive/reset" }])
    expect(s.messages).toEqual([])
    expect(s.carried).toEqual([])
  })
})

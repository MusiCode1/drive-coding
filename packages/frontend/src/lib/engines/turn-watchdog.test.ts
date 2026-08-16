/**
 * turn-watchdog.test.ts — TDD לליבה הטהורה של זיהוי תור ששקע.
 *
 * המקרה שהוליד את המנגנון (נמדד חי 2026-08-16): OMP קיבל session/prompt, שלח
 * פריים אחד (config_option_update), ואז שתק לנצח בגלל resource_exhausted שהוא
 * לא דיווח ב-ACP.
 */
import { describe, expect, it } from "vitest"
import {
  evaluateTurn,
  initialTurnActivity,
  onActivity,
  onTurnEnded,
  onTurnStarted,
  STALL_HARD_CAP_MS,
  STALL_NOTICE_MS,
} from "./turn-watchdog.js"

describe("turn-watchdog", () => {
  it("אין תור פעיל → תמיד ok, גם אחרי שעה", () => {
    expect(evaluateTurn(initialTurnActivity(), 3_600_000)).toEqual({ kind: "ok" })
  })

  it("תור פעיל ושותק פחות מהסף → ok", () => {
    const s = onTurnStarted(0)
    expect(evaluateTurn(s, STALL_NOTICE_MS - 1)).toEqual({ kind: "ok" })
  })

  it("תור פעיל ששותק מעבר לסף → stalled עם משך השקט", () => {
    const s = onTurnStarted(0)
    expect(evaluateTurn(s, STALL_NOTICE_MS)).toEqual({
      kind: "stalled",
      silentMs: STALL_NOTICE_MS,
    })
  })

  it("🔴 פריים בודד מאפס את השעון — התרחיש שהפיל את הקריטריון 'אפס פריימים'", () => {
    // OMP שלח config_option_update אחרי הפרומפט ורק אז השתתק. מנגנון שסופר
    // "אפס פריימים מאז ההתחלה" היה מפספס בדיוק כאן.
    let s = onTurnStarted(0)
    s = onActivity(s, 80_000) // פריים בודד, לפני הסף
    expect(evaluateTurn(s, 80_000 + STALL_NOTICE_MS - 1)).toEqual({ kind: "ok" })
    expect(evaluateTurn(s, 80_000 + STALL_NOTICE_MS)).toMatchObject({ kind: "stalled" })
  })

  it("תור מפטפט ברציפות → לעולם לא stalled (אין התרעות-שווא)", () => {
    let s = onTurnStarted(0)
    for (let t = 10_000; t <= 500_000; t += 10_000) {
      s = onActivity(s, t)
      expect(evaluateTurn(s, t + 1_000).kind).toBe("ok")
    }
  })

  it("🔴 החסם העליון נמדד מתחילת התור — תור מפטפט-בלי-סוף גם הוא נתפס", () => {
    // זה ההבדל מהסף הרגיל: אם היינו מודדים גם אותו מהפעילות האחרונה, תור
    // שמייצר רעש בלי להיגמר היה חומק מרשת-הביטחון לנצח.
    let s = onTurnStarted(0)
    s = onActivity(s, STALL_HARD_CAP_MS - 1_000)
    expect(evaluateTurn(s, STALL_HARD_CAP_MS)).toMatchObject({ kind: "give-up" })
  })

  it("סיום תור מנקה את המצב", () => {
    let s = onTurnStarted(0)
    s = onTurnEnded()
    expect(evaluateTurn(s, 10_000_000)).toEqual({ kind: "ok" })
  })

  it("פעילות בלי תור פעיל היא no-op — לא ממציאה תור", () => {
    const s = onActivity(initialTurnActivity(), 5_000)
    expect(s).toEqual(initialTurnActivity())
    expect(evaluateTurn(s, 10_000_000)).toEqual({ kind: "ok" })
  })

  it("ספים מותאמים דרך opts", () => {
    const s = onTurnStarted(0)
    expect(evaluateTurn(s, 50, { noticeMs: 40 })).toMatchObject({ kind: "stalled" })
    expect(evaluateTurn(s, 50, { noticeMs: 40, hardCapMs: 45 })).toMatchObject({
      kind: "give-up",
    })
  })
})

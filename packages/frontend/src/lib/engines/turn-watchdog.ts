/**
 * turn-watchdog.ts — מזהה תור ששקע: פעיל, אך לא מגיע ממנו דבר.
 *
 * ─── למה זה קיים ───
 * נמדד חי (2026-08-16): OMP קיבל `session/prompt`, נתקל ב-`resource_exhausted`
 * מול הספק, רשם את זה **ביומן שלו**, ולא שלח ל-ACP שום דבר — לא תשובה ל-id,
 * לא `error`, לא chunk. אצלנו התור נשאר `waiting` **לנצח**, והמשתמשת רואה
 * "כותב…" בלי סוף.
 *
 * ─── מה שהוא **לא** עושה, במכוון ───
 * 🔴 **אינו מבטל את התור.** תור לגיטימי עם effort גבוה יכול לרוץ דקות ארוכות
 * בשקט, וביטול-מדעתו-של-הקוד הוא בדיוק סוג ההתנהגות שנדחתה כאן בעבר (אותה
 * הכרעה כמו בבקשות-הרשאה: להציג למשתמשת, לא להכריע במקומה). הפלט היחיד הוא
 * **חיווי**; הפעולה נשארת בידי המשתמשת, דרך כפתור-הביטול הקיים.
 *
 * ⚠️ **הקריטריון הוא "אין פעילות", לא "אין טקסט".** גרסה מוקדמת של הרעיון
 * הציעה "אפס פריימים" — והיא נשללה בדיוק במקרה שהוליד אותה: OMP כן שלח פריים
 * אחד (`config_option_update`) אחרי הפרומפט ורק אז השתתק. לכן כל פעילות
 * מאפסת את השעון, וזה מכוון: זה מה שמונע התרעות-שווא על תור שחושב.
 *
 * טהור — שעון מוזרק, בלי טיימרים משלו. הקורא מזין `now` ומקבל החלטה.
 */

/** אחרי כמה זמן בלי פעילות בתור פעיל להציג חיווי. */
import { TURN_STALL_HARD_CAP_MS, TURN_STALL_NOTICE_MS } from "./liveness-thresholds"

export const STALL_NOTICE_MS = TURN_STALL_NOTICE_MS

/**
 * חסם עליון על תור שלא נענה — רשת-ביטחון בלבד, שלא ידלוף לנצח.
 * גם כאן: החסם משחרר את **ההמתנה שלנו**, ואינו שולח `session/cancel` לסוכן.
 */
export const STALL_HARD_CAP_MS = TURN_STALL_HARD_CAP_MS

export type TurnActivityState = {
  /** מתי התור הנוכחי התחיל. null = אין תור פעיל. */
  turnStartedAt: number | null
  /** מתי הגיעה פעילות אחרונה מהסוכן. null = אין תור פעיל. */
  lastActivityAt: number | null
}

export type TurnStallVerdict =
  /** תור לא פעיל, או פעיל ומדבר — אין מה להציג. */
  | { kind: "ok" }
  /** שקט ממושך — להציג חיווי ולהדגיש את כפתור-הביטול. אין פעולה אוטומטית. */
  | { kind: "stalled"; silentMs: number }
  /** חצה את החסם העליון — לשחרר את ההמתנה שלנו (עדיין בלי cancel לסוכן). */
  | { kind: "give-up"; silentMs: number }

export function initialTurnActivity(): TurnActivityState {
  return { turnStartedAt: null, lastActivityAt: null }
}

/** תור נפתח. מאפס את שני השעונים. */
export function onTurnStarted(now: number): TurnActivityState {
  return { turnStartedAt: now, lastActivityAt: now }
}

/** תור נסגר. */
export function onTurnEnded(): TurnActivityState {
  return initialTurnActivity()
}

/**
 * פעילות כלשהי מהסוכן — **כל** פריים נחשב, לא רק טקסט (ר' האזהרה בראש הקובץ).
 * no-op כשאין תור פעיל, כדי שפעילות מחוץ-לתור לא תמציא אחד.
 */
export function onActivity(state: TurnActivityState, now: number): TurnActivityState {
  if (state.turnStartedAt === null) return state
  return { ...state, lastActivityAt: now }
}

export function evaluateTurn(
  state: TurnActivityState,
  now: number,
  opts: { noticeMs?: number; hardCapMs?: number } = {},
): TurnStallVerdict {
  const noticeMs = opts.noticeMs ?? STALL_NOTICE_MS
  const hardCapMs = opts.hardCapMs ?? STALL_HARD_CAP_MS
  if (state.turnStartedAt === null || state.lastActivityAt === null) return { kind: "ok" }

  const silentMs = now - state.lastActivityAt
  // החסם העליון נמדד מ**תחילת התור**, לא מהפעילות האחרונה: תור שמפטפט
  // בלי סוף ולא נגמר הוא תקלה אחרת, ורשת-הביטחון צריכה לתפוס גם אותה.
  if (now - state.turnStartedAt >= hardCapMs) return { kind: "give-up", silentMs }
  if (silentMs >= noticeMs) return { kind: "stalled", silentMs }
  return { kind: "ok" }
}

/**
 * carried.ts — ה-buffer שנושא updates שהליבה **אינה מכירה** דרך ה-snapshot.
 *
 * ─── slice carried-snapshot C1 ───
 *
 * הבעיה: ‏`reduce` נושא update לא-מוכר הלאה כ-`opaque` — ‏`plan`,
 * ‏`plan_update`, וכל סוג שספק יוסיף מחר. זה עובד בזרם החי, אבל ה-`opaque`
 * **אינו נכנס ל-state**: ‏`applyPatch` מקדם `version` ולא נוגע בכלום. ⇒
 * ‏`stateToSessionUpdates` לא יכול לפלוט מה שאין לו, והפריים נעלם בשקט
 * ב-reload. נמדד: שיחה עם `plan` ⇒ ‏**אפס** פריימי-plan ב-snapshot.
 *
 * 🔴 **הליבה אינה מפרשת את התוכן.** היא בוחרת **משבצת** (`key`) וחוק-מיזוג
 * לפי `sessionUpdate`, ושומרת את ה-update כמות שהוא. קריאת `planId` אינה
 * חריגה מזה — מפתח-מיזוג פר-סוג הוא בדיוק מה שנדרש; האיסור הוא על גזירת
 * **מצב** מהתוכן.
 */

import { DEFAULT_PLAN_ID } from "../acp/plan"
import type { CarriedUpdate, SessionState } from "./types"

/**
 * 🔴 **הכלל הראשון, וההגנה על כל השאר.**
 *
 * ‏`reduce` מגיע ל-`opaquePatch` גם עבור update **מוכר** שלא ייצר patches אך
 * יש לו `_meta` (העטיפה `carry-when-nothing-mapped` ב-`reduce`). ה-snapshot
 * עצמו פולט `state_update` עם `_meta: {"_drive/turnState": …}` בכל state
 * שאינו `idle`, ובשחזור הוא חוזר כ-`opaque` ⇒ **ה-snapshot מזין את עצמו**,
 * וה-round-trip מאדים בשיחה נקייה לגמרי, בלי אף פריים לא-מוכר. נמדד.
 *
 * ⇒ הקריטריון אינו "עבר ב-`opaquePatch`" אלא **"הליבה לא מכירה את הסוג"**.
 *
 * ⚠️ **חייב להישאר מסונכרן עם ה-dispatch של `reduceRecognized`.** סוג מוכר
 * שנשמט מכאן יתחיל להירשם ל-`carried` ויאדים את ה-round-trip. המחגר הוא
 * הטסט "כל סוג ב-RECOGNIZED מחזיר null" ב-`carried.test.ts`.
 */
export const RECOGNIZED: ReadonlySet<string> = new Set([
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
])

/** תקרת-רשומות. בחריגה — פינוי הרשומה שבראש המערך. */
export const CARRIED_MAX_ENTRIES = 32

/**
 * תקרת-מטען לרשומה. מעליה ה-update **אינו נשמר** (ה-patch `opaque` כן נפלט).
 *
 * ‏**`CHARS` ולא `BYTES`, בכוונה:** ‏`.length` סופר יחידות UTF-16. מטען
 * בעברית או emoji היה נמדד עד פי-3 בחסר מול שם שמבטיח בתים.
 */
export const CARRIED_MAX_UPDATE_CHARS = 16384

/**
 * ‏`string` = המפתח שתחתיו נשמר · ‏`{evict}` = **מפנה** את המפתח ואינו נשמר
 * בעצמו · ‏`null` = לא נשמר ולא מפנה.
 */
export type CarryDecision = string | { evict: string } | null

/**
 * ‏`carryKeyOf` — **טהור ב-`u` בלבד**, ולכן זהה בשני מסלולי-הרישום.
 *
 * 🟢 זו הסיבה שהוא חייב להיות כזה: ‏`applyPatch` רואה את ה-update ותו לא —
 * אין לו גישה ל"באיזה מסלול ב-`reduce` זה עבר". כלל שמבוסס על מסלול לא היה
 * ניתן לשכפול שם; כלל שמבוסס על `RECOGNIZED` — כן.
 *
 * המפתחות של משפחת ה-`plan` נגזרים מ-`reducePlan`, שהוא הצרכן: ‏`plan` הוא
 * upsert ל-`__default__`, ‏`plan_update` upsert **לפי `planId`**, ו-
 * `plan_removed` remove לפי `planId`. שלושתם דלתות מעל חנות רב-תוכניות,
 * ולכן משבצת אחת ל-"plan" הייתה מאבדת תוכן-תוכנית.
 */
export function carryKeyOf(u: Record<string, unknown>): CarryDecision {
  const sessionUpdate = u.sessionUpdate
  if (typeof sessionUpdate !== "string") return null
  if (RECOGNIZED.has(sessionUpdate)) return null

  if (sessionUpdate === "plan") return `plan:${DEFAULT_PLAN_ID}`

  if (sessionUpdate === "plan_update") {
    if (typeof u.plan !== "object" || u.plan === null) return null
    const planId = (u.plan as Record<string, unknown>).planId
    return typeof planId === "string" ? `plan:${planId}` : null
  }

  if (sessionUpdate === "plan_removed") {
    // התנאי זהה ל-`reducePlan`: ‏planId שאינו string הוא no-op.
    return typeof u.planId === "string" ? { evict: `plan:${u.planId}` } : null
  }

  return sessionUpdate
}

/** ‏`JSON.stringify` על מבנה מעגלי זורק. הליבה אינה זורקת ⇒ "לא נשמר". */
function withinSizeCap(u: unknown): boolean {
  try {
    const json = JSON.stringify(u)
    return typeof json === "string" && json.length <= CARRIED_MAX_UPDATE_CHARS
  } catch {
    return false
  }
}

/**
 * ‏`recordCarried` — מבצע את ההכרעה של `carryKeyOf` על ה-state.
 *
 * 🔴 **רענון הוא מחיקה + דחיפה לסוף, ולא החלפה-במקום.**
 * ‏`stateToSessionUpdates` שוזר את ה-carried לפי ה-`after` שלהם, ולכן
 * סדר-המערך חייב להתלכד עם סדר ה-`after`: רשומה שרועננה זה עתה נושאת את
 * ה-`after` החדש ביותר, ולכן היא גם אחרונה בשזירה. החלפה-במקום הייתה
 * משאירה אותה באינדקס ישן בעוד השזירה פולטת אותה מאוחר ⇒ `toEqual` על
 * מערך רגיש-לסדר מאדים.
 *
 * זה גם מה שהופך את הפינוי לנכון: ‏FIFO לפי ראש-המערך מפנה את המפתח
 * ה**ישן-ביותר-שנגעו בו**, ולא מפתח חם שרוענן שוב ושוב.
 */
export function recordCarried(state: SessionState, update: unknown): SessionState {
  if (typeof update !== "object" || update === null) return state
  const decision = carryKeyOf(update as Record<string, unknown>)
  if (decision === null) return state

  const current = state.carried ?? []

  if (typeof decision === "object") {
    const next = current.filter((e) => e.key !== decision.evict)
    return next.length === current.length ? state : { ...state, carried: next }
  }

  if (!withinSizeCap(update)) return state

  // העוגן: ה-id של ההודעה האחרונה שהייתה ב-state בהגעה. null = לפני כולן.
  const last = state.messages.at(-1)
  const entry: CarriedUpdate = { key: decision, after: last?.id ?? null, update }

  const next = current.filter((e) => e.key !== decision)
  next.push(entry)
  // בחריגה — פינוי מראש המערך (הישן-ביותר-שנגעו בו).
  return { ...state, carried: next.slice(Math.max(0, next.length - CARRIED_MAX_ENTRIES)) }
}

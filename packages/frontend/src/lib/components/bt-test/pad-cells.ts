/**
 * pad-cells.ts — ‏מיפוי תאי ה-D-pad, ‏כפונקציה טהורה.
 *
 * ‏למה מודול ולא לוגיקה בתוך ה-`.svelte`: ‏vitest רץ ב-`environment: "node"`
 * (`packages/frontend/vitest.config.ts`) ⇒ ‏אי-אפשר לרנדר רכיב Svelte בטסט.
 * ‏המיפוי הוא **‏בדיוק** ‏מה שנשבר (‏ר' למטה), ‏ולכן הוא חייב להיות בר-בדיקה.
 *
 * ─── ‏הבאג שהמודול הזה סוגר ───
 * ‏הגרסה הראשונה של `BtPad.svelte` ‏מיפתה **‏ארבעה חצים על שלושה כפתורים**:
 * ‏`▲` ‏נשא את אותו `lit("prev")` ‏של `◀`, ‏ו-`▼` ‏את זה של `▶`. ‏לחיצה אחת
 * ‏הדליקה **‏שני** ‏תאים. ‏נתפס ע"י עיני המשתמש בהרצה על חומרה אמיתית
 * (`investigations/captures/2026-08-21-dpad-session-1.md`), ‏לא ע"י שער.
 *
 * ─── ‏למה ▲/▼ ‏נשארים על המסך ───
 * ‏הם כפתורי-הווליום של השלט. ‏§3.6 ‏של המחקר קובע שאנדרואיד בולע אותם ברמת
 * ‏המערכת — **‏אומת חי** ‏ע"י המשתמש. ‏תא אפור עם תווית הופך באג ל**‏תיעוד**:
 * ‏הוא אומר לנוהג שאין כאן אות, ‏**‏וזה תקין**. ‏מחיקה הייתה מוחקת את המידע הזה.
 */

import type { BtButton } from "$lib/engines/bt-remote.js"

export type PadCellId = "up" | "left" | "center" | "right" | "down"

export type PadCell = {
  id: PadCellId
  glyph: string
  /** ‏`null` = ‏תא אינרטי (‏ווליום). ‏**‏רק תא עם `button` ‏יכול להידלק.** */
  button: BtButton | null
  /** ‏למה התא אינרטי — ‏מוצג למשתמש. `undefined` ‏לתאים פעילים. */
  inertReason?: string
}

export type PadCellState = PadCell & { lit: boolean }

const VOLUME_REASON = "Volume — swallowed by Android, never reaches the browser"

/**
 * ‏חמשת התאים **‏בסדר לוגי** (‏up · left · center · right · down).
 * ‏🔴 ‏**‏זה אינו סדר-פריסה.** ‏המיקום ברשת נקבע ב-CSS לפי `cell.id`.
 */
export const PAD_CELLS: readonly PadCell[] = [
  { id: "up", glyph: "▲", button: null, inertReason: VOLUME_REASON },
  { id: "left", glyph: "◀", button: "prev" },
  { id: "center", glyph: "●", button: "center" },
  { id: "right", glyph: "▶", button: "next" },
  { id: "down", glyph: "▼", button: null, inertReason: VOLUME_REASON },
]

/**
 * ‏🔴 ‏האינווריאנטה היחידה של המודול:
 * ‏`lit === true` ‏**‏רק** ‏כאשר `cell.button !== null` ‏והוא שווה ל-`hot` ‏או ל-`flash`.
 * ‏תא אינרטי מחזיר `lit: false` ‏**‏תמיד**, ‏בלי תלות בקלט.
 */
export function padCellStates(
  hot: BtButton | null,
  flash: BtButton | null,
): PadCellState[] {
  return PAD_CELLS.map((cell) => ({
    ...cell,
    lit: cell.button !== null && (cell.button === hot || cell.button === flash),
  }))
}

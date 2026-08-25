/**
 * wire-fixtures.ts — תרגום תיאור-כוונה לצורת-החוט, לשימוש בטסטים.
 *
 * ─── slice acp-wire-session-update ───
 *
 * ⚠️ **למה זה קיים בכלל.** צורת-החוט הייתה מוטבעת כתבניות-מחרוזת ב-`events.ts`,
 * וכל טסט שרצה לדמות זרם בנה אותה מחדש ביד — בשישה קבצים. ⇒ הטסטים קיבעו
 * **העתק** של הפורמט במקום את התנהגות-הצרכן, ושינוי-מסגור אמיתי נראה כמו
 * ‏99 טסטים אדומים "שצריך לתקן". זה בדיוק המצב שבו מתקנים טסט לכיוון הלא-נכון.
 *
 * כאן הטסט אומר *"מגיע ה-patch הזה"* — הכוונה — והמסגור מיוצר ע"י
 * `wire-frames.ts`, **אותו קוד בדיוק** שה-BE מריץ.
 *
 * ⚠️ מיוצא בתת-נתיב `@drive-coding/core/session/testing` ולא מה-index, כדי
 * שיהיה גלוי שזו תשתית-בדיקה ולא חלק מה-API.
 */

import { applyPatch } from "../apply-patch"
import type { Patch, SessionState } from "../types"
import { createInitialSessionState } from "../types"
import { type SseFrame, serializeFrame, snapshotFrame, updateFrame } from "../wire-frames"

/** תיאור-כוונה: מה שהטסטים כתבו לפני שהמסגור השתנה. */
export type IntentFrame = { event: string; data: string }

/**
 * ‏IntentFrame[] → ‏SseFrame[], תוך קיפול המצב בדיוק כפי ש-`events.ts` עושה.
 *
 * ‏`data` שאינו JSON תקין עובר **כמות שהוא** — יש טסטים שזה בדיוק נושאם.
 */
export function toWireFrames(frames: IntentFrame[]): SseFrame[] {
  let state: SessionState = createInitialSessionState({ sessionId: "" })
  const out: SseFrame[] = []
  for (const f of frames) {
    if (f.event === "snapshot") {
      try {
        state = JSON.parse(f.data) as SessionState
        out.push(snapshotFrame(state))
      } catch {
        out.push({ event: "snapshot", data: f.data })
      }
      continue
    }
    if (f.event === "patch") {
      let patch: Patch
      try {
        patch = JSON.parse(f.data) as Patch
      } catch {
        out.push({ event: "update", id: "999", data: f.data })
        continue
      }
      state = applyPatch(state, patch) ?? state
      out.push(
        updateFrame(state, patch) ?? { event: "update", id: String(patch.version), data: "[]" },
      )
      continue
    }
    out.push(f)
  }
  return out
}

/** ‏IntentFrame[] → הבתים שעל החוט. */
export function toWireText(frames: IntentFrame[]): string {
  return toWireFrames(frames).map(serializeFrame).join("")
}

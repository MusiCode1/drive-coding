/**
 * flags-validate.ts — ולידציה טהורה של מערך flags לשורת פקודה.
 *
 * מחזיר Result<string[], FlagsValidationError> (neverthrow).
 * במקרה של Ok: המערך המקורי (ללא שינוי — flags עוברים כפי שהם ל-spawn).
 * במקרה של Err: איחוד מתויג עם index הפריט הפוגע.
 *
 * חוקים נאכפים (shape validation בלבד — לא policy):
 *   - כל flag: לא ריק
 *   - ללא בתי NUL U+0000 (יקצר C-string בקריאת מערכת spawn)
 *   - ללא תווי בקרה U+0001–U+001F (הזרקת לוג, שבירת shell output parsing)
 *   - אורך ≤ 256 (ערך סביר לפלאג בודד)
 *
 * בכוונה לא נאכף כאן:
 *   - deny-list של flags מסוכנים (e.g. --dangerously-skip-permissions) — policy נפרד (§7)
 *   - בדיקה שה-flag מתחיל ב-"-" — positional arguments תקפים
 *   - תקינות הערך שאחרי "=" (e.g. --model=<value>) — policy נפרד
 */

import { err, ok, type Result } from "neverthrow"

// ─── סוגי שגיאות ─────────────────────────────────────────────────────────────

export type FlagsValidationError =
  | { kind: "empty_flag"; index: number }
  | { kind: "contains_null"; index: number }
  | { kind: "contains_control_chars"; index: number; codepoint: number }
  | { kind: "too_long"; index: number; length: number }

// ─── קבועים ────────────────────────────────────────────────────────────────

/**
 * אורך מקסימלי לפלאג בודד.
 * 256 = ערך סביר לשם פלאג + ערך.
 */
const MAX_FLAG_LENGTH = 256

// ─── מאמת (Validator) ─────────────────────────────────────────────────────────

/**
 * אימות מערך flags לשורת פקודה.
 *
 * @param flags - מערך מחרוזות מקלט המשתמש (כל פריט = token נפרד)
 * @returns Ok(flags) — המערך המקורי כפי שהוא | Err(FlagsValidationError)
 */
export function validateFlags(flags: string[]): Result<string[], FlagsValidationError> {
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i] as string

    // 1. ריק
    if (flag.length === 0) {
      return err({ kind: "empty_flag", index: i })
    }

    // 2. ארוך מדי
    if (flag.length > MAX_FLAG_LENGTH) {
      return err({ kind: "too_long", index: i, length: flag.length })
    }

    // 3. סריקת תווים חשודים
    for (let j = 0; j < flag.length; j++) {
      const cp = flag.codePointAt(j) ?? 0

      // NUL byte (U+0000) — יקצר C-string בקריאת spawn
      if (cp === 0x0000) {
        return err({ kind: "contains_null", index: i })
      }

      // תווי בקרה U+0001–U+001F (כולל newline U+000A, CR U+000D, TAB U+0009)
      if (cp >= 0x0001 && cp <= 0x001f) {
        return err({ kind: "contains_control_chars", index: i, codepoint: cp })
      }
    }
  }

  return ok(flags)
}

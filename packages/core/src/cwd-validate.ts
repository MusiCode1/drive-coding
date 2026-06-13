/**
 * cwd-validate.ts — ולידציה טהורה של מחרוזת נתיב תיקיית-עבודה.
 *
 * מחזיר Result<string, CwdValidationError> (neverthrow).
 * במקרה של Ok: ה-cwd המנורמל (ללא אלכסון סופי, למעט שורש "/").
 * במקרה של Err: איחוד מתויג המתאר בדיוק מה שגוי.
 *
 * חוקים נאכפים:
 *   - לא ריק
 *   - מוחלט: Unix ("/…"), Windows drive ("C:\…" / "C:/…"), או UNC ("\\\\server\\…").
 *     הזיהוי מפורש וחוצה-פלטפורמה — לא תלוי ב-process.platform — כדי לשמור על
 *     טוהר ה-core (D5): אותו קלט → אותו פלט בכל מכונה ובכל CI. נתיב שאינו תקף
 *     ל-OS שעליו רץ ה-BE ייתפס ממילא ב-spawn (IO), לא כאן.
 *   - ללא בתי NUL (יקצר C-string בקריאת מערכת spawn)
 *   - ללא תווי בקרה U+0001–U+001F (הזרקת לוג, השחתת נתיב)
 *   - ללא רצפי קידוד אחוזים %XX (תוצר לוואי של קידוד URL כפול)
 *   - אורך ≤ 4096 (PATH_MAX בלינוקס)
 *
 * בכוונה לא נאכף:
 *   - קיום הנתיב (IO — שייך למעטפת, לא ל-core)
 *   - חציית נתיב (resolve/realpath — IO)
 *   - תווי % שאינם מלווים בשתי ספרות הקסדצימליות (חוקיים בשמות קבצים)
 */

import { err, ok, type Result } from "neverthrow"

// ─── סוגי שגיאות ─────────────────────────────────────────────────────────────

export type CwdValidationError =
  | { kind: "empty" }
  | { kind: "not_absolute"; got: string }
  | { kind: "contains_null" }
  | { kind: "contains_percent_encoding"; match: string }
  | { kind: "contains_control_chars"; codepoint: number }
  | { kind: "too_long"; length: number }

// ─── קבועים ────────────────────────────────────────────────────────────────

/** Linux PATH_MAX */
const MAX_LENGTH = 4096

/** תואם לרצפי קידוד אחוזים של URL: % מלווה בדיוק בשתי ספרות הקסדצימליות */
const PERCENT_ENCODED_RE = /%[0-9a-fA-F]{2}/

/** תואם לתווי בקרה של ASCII מ-U+0001 עד U+001F (מוציא את NUL שנבדק קודם) */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally matching control chars
const CONTROL_CHAR_RE = /[\u0001-\u001f]/

/** נתיב Windows מבוסס-כונן: אות, נקודתיים, ואז "\" או "/" (למשל C:\ או D:/).
 *  דורש separator אחרי הנקודתיים — "C:foo" הוא drive-relative, לא מוחלט. */
const WINDOWS_DRIVE_RE = /^[a-zA-Z]:[\\/]/

/** שורש כונן Windows בלבד (C:\ או C:/) — לדילוג על נרמול ה-separator הסופי. */
const WINDOWS_DRIVE_ROOT_RE = /^[a-zA-Z]:[\\/]$/

// ─── מאמת (Validator) ────────────────────────────────────────────────────────────────

/**
 * אימות ונרמול מחרוזת נתיב cwd.
 *
 * @param cwd - מחרוזת גולמית מקלט המשתמש או מפרמטר URL
 * @returns Ok(normalisedCwd) | Err(CwdValidationError)
 */
export function validateCwd(cwd: string): Result<string, CwdValidationError> {
  // 1. ריק
  if (cwd.length === 0) {
    return err({ kind: "empty" })
  }

  // 2. ארוך מדי (בדיקה לפני המשך עיבוד)
  if (cwd.length > MAX_LENGTH) {
    return err({ kind: "too_long", length: cwd.length })
  }

  // 3. נתיב מוחלט נדרש — Unix ("/…"), Windows drive ("C:\…"/"C:/…"), או UNC ("\\…")
  const isUnixAbsolute = cwd.startsWith("/")
  const isWindowsDrive = WINDOWS_DRIVE_RE.test(cwd)
  const isWindowsUnc = cwd.startsWith("\\\\")
  if (!isUnixAbsolute && !isWindowsDrive && !isWindowsUnc) {
    return err({ kind: "not_absolute", got: cwd })
  }

  // 4. בית NUL
  if (cwd.includes("\u0000")) {
    return err({ kind: "contains_null" })
  }

  // 5. רצפי קידוד אחוזים (%XX) — תוצר לוואי של קידוד URL כפול
  const percentMatch = cwd.match(PERCENT_ENCODED_RE)
  if (percentMatch) {
    return err({ kind: "contains_percent_encoding", match: percentMatch[0] })
  }

  // 6. תווי בקרה U+0001–U+001F
  const controlMatch = cwd.match(CONTROL_CHAR_RE)
  if (controlMatch) {
    return err({
      kind: "contains_control_chars",
      codepoint: controlMatch[0].codePointAt(0) ?? 0,
    })
  }

  // 7. נרמול: הסרת separator סופי ("/" או "\"), למעט שורשים:
  //    שורש Unix "/", או שורש כונן Windows ("C:\" / "C:/").
  const isRoot = cwd === "/" || WINDOWS_DRIVE_ROOT_RE.test(cwd)
  const hasTrailingSep = cwd.endsWith("/") || cwd.endsWith("\\")
  const normalised = !isRoot && hasTrailingSep ? cwd.slice(0, -1) : cwd

  return ok(normalised)
}

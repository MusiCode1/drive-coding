/**
 * file-path-links.ts — זיהוי נתיבי-קבצים בטקסט והפיכתם ל-URI שהפרוקסי מבין.
 *
 * טהור, בלי DOM — ה-action `enhance-file-links.ts` הוא שמחיל אותו על ה-DOM.
 *
 * 🔴 היקף: מוחל על פרוזת-**המשתמש** ועל פרוזת-**הסוכן** כאחד — אלא שבצד הסוכן
 * רק על נתיבים **אבסולוטיים** (`absoluteOnly` ב-`FileLinkParams`). ההבחנה אינה
 * שרירותית: בנתיב יחסי מרוכזים רוב ה-false-positives, וההדלקה שלו ממתינה
 * לסלייס `fs-stat` שיאמת קיום לפני יצירת קישור.
 *
 * ⚠️ הערה קודמת כאן אמרה "מוחל על טקסט שהמשתמש כתב בלבד… פרוזת-הסוכן היא סלייס
 * נפרד (`path-linkify`)" — והיא סתרה את עצמה, כי `path-linkify` הוא הסלייס שכתב
 * אותה. היא גם סתרה את §1 של פקודת-המשימה: "כשהסוכן מזכיר מסמך — לחיצה פותחת
 * אותו מרונדר, לא כנתיב מת". §11-ד מדדה 3,538 אזכורי `.md` בפרוזה מול 0 מופעי
 * `resource_link` ⇒ הצד של הסוכן הוא כמעט כל הערך. ר' decisions 2026-08-25.
 *
 * הסיומות זהות ל-allowlist של `packages/backend/src/delivery/http-fs-file.ts` —
 * אין טעם ללנקק מה שהפרוקסי יחזיר עליו 415.
 */

/** זהה ל-EXT_TO_CONTENT_TYPE ב-http-fs-file.ts. */
const EXT = "md|markdown|txt|png|jpe?g|svg|webp|gif|pdf"

/**
 * שלוש חלופות: `file:///…` מפורש · נתיב אבסולוטי · נתיב יחסי (עם `./` אופציונלי).
 *
 * ה-lookbehind חוסם התחלה באמצע token — כך `https://host/a.png` אינו נתפס
 * (`:` ו-`/` חוסמים), וכך גם `./x.md` אינו נקטע ל-`/x.md` (`.` חוסם).
 *
 * 🔴 **המקף אינו ברשימת-החסימה, בכוונה.** הוא היה שם בגרסה הראשונה, וטסט
 * תפס שזה מחסל את המקרה הנפוץ ביותר בעברית: `ראה ל-AGENTS.md` / `ו-/tmp/a.md`
 * — התו שלפני הנתיב הוא מקף מחבר, לא חלק ממנו. במקומו, **תו-הפתיחה מוגבל**
 * ל-`[\w~/]`, ולכן התאמה אינה יכולה להתחיל באמצע `brief-local-file-proxy.md`.
 *
 * ה-lookahead מונע בליעת סימן-פיסוק צמוד ("ראה AGENTS.md." → בלי הנקודה).
 */
const FILE_TOKEN = new RegExp(
  String.raw`(?<![\w/.~@+:])(file:\/\/\/[^\s<>"']+|\/[\w./~@+-]*\.(?:${EXT})|(?:\.{1,2}\/)?[\w~][\w./~@+-]*\.(?:${EXT}))(?![\w])`,
  "gi",
)

export type FilePathMatch = {
  /** אינדקס התחלה בטקסט המקורי */
  start: number
  /** אינדקס סיום (בלעדי) */
  end: number
  /** ה-token כפי שהופיע */
  raw: string
}

/** מאתר את כל מועמדי-הנתיב בטקסט. אינו מכריע אם הם ניתנים לפתרון. */
export function findFilePathMatches(text: string): FilePathMatch[] {
  const out: FilePathMatch[] = []
  FILE_TOKEN.lastIndex = 0
  let m: RegExpExecArray | null = FILE_TOKEN.exec(text)
  while (m !== null) {
    const raw = m[1]
    if (raw !== undefined) out.push({ start: m.index, end: m.index + raw.length, raw })
    m = FILE_TOKEN.exec(text)
  }
  return out
}

/**
 * הופך token ל-URI שהפרוקסי מקבל, או `null` כשאי אפשר לפתור אותו.
 *
 * - `file:///…`  → כמות שהוא
 * - `/abs/path`  → `file:///abs/path`
 * - יחסי         → נפתר מול ה-cwd של הסשן; בלי cwd → `null` (לא מלנקקים)
 * - `~/…`        → `null`. ל-FE אין את ה-home של השרת, ו-`~` אינו מורחב
 *                  בצד-השרת — לינק כזה היה מחזיר 404 ומטעה.
 */
export function resolveFileUri(raw: string, cwd: string | null): string | null {
  if (/^file:\/\//i.test(raw)) return raw
  if (raw.startsWith("~")) return null
  if (raw.startsWith("/")) return `file://${raw}`
  if (cwd === null || cwd === "") return null
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd
  const rel = raw.startsWith("./") ? raw.slice(2) : raw
  return `file://${base}/${rel}`
}

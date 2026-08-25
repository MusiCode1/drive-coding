/**
 * content-type.ts — קריאת כותרת Content-Type לפי **טיפוס-הבסיס**, בלי הפרמטרים.
 *
 * למה זה קיים: `/api/fs/file` מצהיר `; charset=utf-8` על טקסט (ר' מדרג-ה-charset
 * ב-`backend/src/delivery/http-fs-file.ts`). כל השוואה **מדויקת** למחרוזת
 * `"text/markdown"` נשברת ברגע שנוסף פרמטר — ומסמך שרונדר קודם הופך להורדה.
 *
 * ─── slice fs-file-proxy (תיקון-במקום, ממצא-משתמש חי 25/08) ───
 */

/**
 * `"text/markdown; charset=utf-8"` → `"text/markdown"`.
 * מפצל על `;`, גוזם רווחים, ומנרמל לאותיות קטנות (הכותרת אינה case-sensitive).
 */
export function baseContentType(header: string): string {
  return (header.split(";")[0] ?? "").trim().toLowerCase()
}

/**
 * האם התשובה היא טקסט שאנחנו מרנדרים (ולכן נקראת ב-`r.text()` ולא כ-blob).
 *
 * 🔴 ה-BE כבר מוריד ל-`application/octet-stream` כל קובץ-טקסט שאינו UTF-8 חוקי,
 * ולכן קובץ legacy לעולם לא יגיע לכאן כ-`text/*` — וזה מכוון: `Response.text()`
 * מפענח UTF-8 תמיד, כך שרינדור שלו היה מפיק ג'יבריש.
 */
export function isRenderableText(header: string): boolean {
  return baseContentType(header) === "text/markdown"
}

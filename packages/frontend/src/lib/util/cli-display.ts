/**
 * cli-display.ts — לוגיקה טהורה ל-<CliBadge> (slice cli-branding, Commit 2).
 *
 * אין תקדים בריפו למונוגרמה/ראשי-תיבות — רכיב חדש לגמרי (ר' Avatar.svelte לתקדים
 * המבני היחיד ל"עיגול צבעוני", לא לחישוב המונוגרמה עצמו).
 */

/** שם לתצוגה: displayName אם הוצהר, אחרת המזהה עצמו. */
export function cliDisplayName(id: string, displayName?: string): string {
  return displayName ? displayName : id
}

/**
 * מונוגרמה: 1-2 תווים מהשם לתצוגה, uppercase.
 * שם עם ≥2 מילים → ראשי-התיבות של שתי המילים הראשונות.
 * שם חד-מילתי (או תו-בודד) → שני התווים הראשונים (או אחד, אם קצר יותר).
 * Array.from (לא slice ישיר) — כדי לא לשבור surrogate pair של emoji.
 */
export function cliMonogram(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return ""

  const words = trimmed.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const firstWord = words[0] ?? ""
    const secondWord = words[1] ?? ""
    const first = Array.from(firstWord)[0] ?? ""
    const second = Array.from(secondWord)[0] ?? ""
    return (first + second).toUpperCase()
  }

  return Array.from(trimmed).slice(0, 2).join("").toUpperCase()
}

/** גוון HSL דטרמיניסטי מה-id (hash יציב) — אותו id תמיד אותו צבע. */
export function cliColorHue(id: string): number {
  let hash = 0
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

/**
 * מפתח יציב לזיהוי "איזה לוגו מוצג כרגע" (slice cli-logo-serving, Commit 1).
 *
 * <CliBadge> משתמש בזה כדי לאפס את `failed` (נפילה למונוגרמה) כש-id או logo
 * משתנים — אחרת, אחרי החלפת CLI שבור אחד, ה-fallback ל-monogram "דבק"
 * לצמיתות גם ל-CLI הבא (בג #4 שאביגיל תפסה — DoD #9 בודק מחיקה, לא החלפה).
 *
 * NUL (`\0`) כמפריד — לא תו-רגיל שיכול להופיע ב-id/logo — כדי למנוע התנגשות
 * שרשור מקרית: id="a"+logo="bc" לעולם לא יתנגש עם id="ab"+logo="c".
 */
export function cliLogoKey(id: string, logo: string | undefined): string {
  return `${id}\0${logo ?? ""}`
}

/**
 * split-streamable.ts — split raw streaming markdown into safe-to-process and held tails.
 *
 * Born in voice/TTS; neutral markdown home for catalog + Speaker consumers.
 */

/**
 * ⚠️ **גדר חוקית חייבת לפתוח שורה.** ``` בתוך מחרוזת באמצע שורה
 * (`text.indexOf("` + "```" + `")`) **אינה** גדר — וספירתה ככזו מפרקת את כל
 * הזיווג: הבלוק הראשון נסגר מוקדם, השני נפתח באמצע קוד, והתוצאה היא גם
 * דליפת-קוד להקראה וגם בליעת טקסט תמים שביניהם. נשמע בפועל.
 */
const FENCE_LINE = /^[ \t]{0,3}```/gm

/**
 * מפריד טקסט-**גולמי** זורם לחלק בטוח-לעיבוד ולחלק שיש להחזיק.
 *
 * ─── slice tts-speakable-text ───
 *
 * 🔴 **שני כללים, ושניהם נלמדו בדם.**
 *
 * 1. **גדר פתוחה מוחזקת.** בלוק-קוד מגיע פרוס על עשרות chunks; אם המפצל
 *    יראה את תוכנו לפני שהגדר נסגרה, נקודות ושורות שבתוך הקוד ייחתכו
 *    כמשפטים וייצאו להקראה. נשמע בפועל.
 *
 * 2. **שורה חלקית מוחזקת.** כל שאר תחביר-המרקדאון (קישור, תמונה,
 *    קוד-inline) **אינו חוצה שורות** — ולכן עיבוד של טקסט שנחתך באמצע
 *    שורה מפרק אותו לחצאים ומשאיר סוגריים חשופים בהקראה.
 *
 * ⚠️ **וזה מה שמאפשר לחוצץ להישאר גולמי.** הניסיון הקודם החזיר טקסט
 * *מעובד* לחוצץ ואז עיבד אותו שוב — וכל סיבוב שבר מבנה במקום אחר
 * (‏trim אכל רווחים, שרשור איבד את העיגון-לשורה של הגדר הבאה, וכן הלאה).
 * כאן כל קטע-גולמי מעובד **בדיוק פעם אחת**, והתוצאה לעולם לא חוזרת.
 */
export function splitStreamable(text: string): { ready: string; held: string } {
  const fences: number[] = []
  FENCE_LINE.lastIndex = 0
  for (;;) {
    const m = FENCE_LINE.exec(text)
    if (m === null) break
    fences.push(m.index + (m[0].length - 3))
  }

  // (1) גדר לא-מזווגת — מחזיקים ממנה והלאה.
  if (fences.length % 2 === 1) {
    const open = fences[fences.length - 1] as number
    return { ready: text.slice(0, open), held: text.slice(open) }
  }

  // (2) 🔴 **הגדר הסוגרת הגיעה אבל שורתה טרם נסגרה.**
  if (fences.length > 0) {
    const lastFence = fences[fences.length - 1] as number
    if (text.indexOf("\n", lastFence) === -1) {
      const open = fences[fences.length - 2] as number
      return { ready: text.slice(0, open), held: text.slice(open) }
    }
  }

  // (3) שורה חלקית — מחזיקים **רק אם יש בה תחביר פתוח**.
  const nl = text.lastIndexOf("\n")
  const tail = nl === -1 ? text : text.slice(nl + 1)
  const openEmphasis =
    (tail.match(/\*\*/g)?.length ?? 0) % 2 === 1 || (tail.match(/~~/g)?.length ?? 0) % 2 === 1
  const startsBacktick = /^[ \t]{0,3}`/.test(tail)
  const openInline = startsBacktick || (tail.match(/`/g)?.length ?? 0) % 2 === 1
  const lastBracket = tail.lastIndexOf("[")
  const unclosedBracket = lastBracket !== -1 && !tail.includes("]", lastBracket)
  const lastParen = tail.lastIndexOf("](")
  const unclosedParen = lastParen !== -1 && !tail.includes(")", lastParen)
  const openLink = unclosedBracket || unclosedParen
  if (!openInline && !openLink && !openEmphasis) return { ready: text, held: "" }
  if (nl === -1) return { ready: "", held: text }
  return { ready: text.slice(0, nl + 1), held: tail }
}

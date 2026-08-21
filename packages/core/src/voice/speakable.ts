/**
 * speakable.ts — טקסט-מרקדאון → טקסט **בר-הקראה**.
 *
 * ─── slice tts-speakable-text ───
 *
 * 🔴 **הבעיה שדווחה מהשדה:** ה-TTS מקריא בלוקי-קוד מילה במילה, ‏URL-ים תו
 * אחר תו, ותחביר-מרקדאון כסימנים. בשיחת-קוד זה רוב התוכן.
 *
 * ⚠️ **רץ לפני פיצול-המשפטים**, ולכן הוא גם **מקצר את התור**: בלוק-קוד בן
 * 40 שורות הופך למילתיים, ולא ל-15 מקטעי-TTS שממתינים בתור. נמדד באותו יום
 * פיגור של 23 מקטעים ממתינים — זה נוגס בו ישירות.
 *
 * טהור: אפס IO, אפס Date, אפס תלות בספק. ה-labels מוזרקים כדי שהשפה תישאר
 * באחריות שכבת-ה-i18n ולא תיקבע כאן.
 */

export type SpeakableLabels = {
  /** בלוק-קוד ללא שפה מוצהרת. */
  codeBlock: string
  /** בלוק-קוד עם שפה — מקבל את השם, למשל "בלוק קוד TypeScript". */
  codeBlockWithLang: (lang: string) => string
  /** ‏URL חשוף, או קישור שאין לו טקסט. */
  link: string
  /** תמונה. */
  image: string
}

/**
 * אורך מרבי לקוד-inline שעדיין נקרא כמות שהוא. מעליו — נאמר "קוד".
 * ‏24 תווים ≈ שם-משתנה או קריאת-פונקציה קצרה; מעבר לזה ההקראה תו-אחר-תו
 * ארוכה יותר מהתועלת.
 */
const INLINE_CODE_MAX = 24

/** ‏URL חשוף — לא בתוך תחביר-קישור. */
const BARE_URL = /https?:\/\/[^\s<>()[\]]+/g

export function toSpeakable(text: string, labels: SpeakableLabels): string {
  let out = text

  // ─── 1. בלוקי-קוד מגודרים ───
  // ⚠️ **ראשון, ולפני כל השאר.** בתוך בלוק-קוד יש URL-ים, כוכביות ותחביר
  // שנראה כמו מרקדאון; אם נעבד אותם קודם, נשנה טקסט שעומד להימחק ממילא,
  // ובמקרה הרע נשבור את גבול-הבלוק עצמו.
  out = out.replace(/```([^\n`]*)\n?([\s\S]*?)```/g, (_m, lang: string) => {
    const l = lang.trim().split(/\s+/)[0] ?? ""
    return l.length > 0 ? ` ${labels.codeBlockWithLang(l)} ` : ` ${labels.codeBlock} `
  })
  // בלוק שנפתח ולא נסגר (זרימה חיה — הסוגר עוד לא הגיע)
  out = out.replace(/```([^\n`]*)\n[\s\S]*$/g, (_m, lang: string) => {
    const l = lang.trim().split(/\s+/)[0] ?? ""
    return l.length > 0 ? ` ${labels.codeBlockWithLang(l)} ` : ` ${labels.codeBlock} `
  })

  // ─── 2. תמונות — לפני קישורים, כי התחביר שלהן מכיל תחביר-קישור ───
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) =>
    alt.trim().length > 0 ? ` ${labels.image}: ${alt.trim()} ` : ` ${labels.image} `,
  )

  // ─── 3. קישורים — הטקסט נקרא, ה-URL נזרק ───
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, label: string) =>
    label.trim().length > 0 ? label.trim() : ` ${labels.link} `,
  )

  // ─── 4. קוד-inline ───
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= INLINE_CODE_MAX ? code : ` ${labels.codeBlock} `,
  )

  // ─── 5. URL חשוף ───
  out = out.replace(BARE_URL, ` ${labels.link} `)

  // ─── 6. סימוני-הדגשה ותחביר-כותרת ───
  // ⚠️ רק הסימנים יורדים, **הטקסט נשאר** — זו הקראה, לא תקציר.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "")
  out = out.replace(/^\s{0,3}>\s?/gm, "")
  out = out.replace(/(\*\*|__)(.+?)\1/g, "$2")
  out = out.replace(/(\*|_)(?!\s)(.+?)(?<!\s)\1/g, "$2")
  out = out.replace(/~~(.+?)~~/g, "$1")

  // ─── 7. ניקוי רווחים שנוצרו מההחלפות ───
  out = out.replace(/[ \t]{2,}/g, " ")
  // התוויות מוזרקות עם רווחים משני צדדיהן (כדי לא להידבק למילה קודמת);
  // ליד שורה-חדשה הרווח הזה מיותר ונשמע כהיסוס.
  out = out.replace(/[ \t]+\n/g, "\n")
  out = out.replace(/\n[ \t]+/g, "\n")
  out = out.replace(/\n{3,}/g, "\n\n")
  return out.trim()
}

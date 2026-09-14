import type { DriveMediaRef } from "../fs/media-catalog.js"
import { IMAGE_LINK } from "../markdown/image-link.js"
import { resolveAudioEmbed, type SpeakablePart } from "./audio-embed.js"

export type { SpeakablePart } from "./audio-embed.js"
export { splitStreamable } from "../markdown/split-streamable.js"

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

/**
 * ⚠️ **גדר חוקית חייבת לפתוח שורה.** ``` בתוך מחרוזת באמצע שורה
 * (`text.indexOf("` + "```" + `")`) **אינה** גדר — וספירתה ככזו מפרקת את כל
 * הזיווג: הבלוק הראשון נסגר מוקדם, השני נפתח באמצע קוד, והתוצאה היא גם
 * דליפת-קוד להקראה וגם בליעת טקסט תמים שביניהם. נשמע בפועל.
 */
export type SpeakableOpts = {
  /**
   * ⚠️ **חובה בזרימה.** בלעדיו `toSpeakable` מסיים ב-`trim()`, ועל חוצץ
   * שגדל הוא אוכל את הרווח שלפני ה-chunk הבא — אחרי מספיק chunks המילים
   * נדבקות ("הנההסברקצר"). נמדד ב-`speakable-stream.test.ts`.
   */
  stream?: boolean
  /** Session cwd — required to resolve relative audio embed hrefs. */
  cwd?: string | null
  /** `_drive/media` catalog from session updates — checked before extension fallback. */
  catalog?: DriveMediaRef[]
}

/** תווית אחת, נקודה אחת — שני מסלולי-הגדר השתמשו בהעתק זהה. */
function labelFor(lang: string, labels: SpeakableLabels): string {
  // ⚠️ גרשיים מנוקים: גדר של ארבע גרשיים משאירה אחת ב-lang, והיא דלפה להקראה.
  const l = lang.replace(/`/g, "").trim().split(/\s+/)[0] ?? ""
  return l.length > 0 ? ` ${labels.codeBlockWithLang(l)} ` : ` ${labels.codeBlock} `
}

/** Markdown → speakable string, excluding image syntax (handled by caller). */
function processSpeakableText(text: string, labels: SpeakableLabels, opts?: SpeakableOpts): string {
  let out = text

  // ─── 1. בלוקי-קוד מגודרים ───
  // ⚠️ **ראשון, ולפני כל השאר.** בתוך בלוק-קוד יש URL-ים, כוכביות ותחביר
  // שנראה כמו מרקדאון; אם נעבד אותם קודם, נשנה טקסט שעומד להימחק ממילא,
  // ובמקרה הרע נשבור את גבול-הבלוק עצמו.
  // ⚠️ **השורות הריקות שמסביב נבלעות יחד עם הבלוק**, ולכן התווית נדבקת
  // לטקסט השכן במקום להיוותר פסקה לעצמה.
  //
  // 🔴 הסיבה **מדודה בשדה**: כשהתווית נשלחה כמקטע-TTS עצמאי ("בלוק קוד
  // typescript", בלי סימן-סיום), ‏Gemini פשוט **לא הקריא אותה**. אומת
  // בטלפון — המקטע נכנס לתור, סונתז ונוגן (`done`, אפס `skipped`) ובכל
  // זאת לא נשמע: המודל התייחס אליה כמטא-טקסט ולא כתוכן. אותה משפחה של
  // preamble-leak, בכיוון ההפוך. ⇒ כשהיא חלק ממשפט אמיתי, היא נאמרת.
  // 🔴 **הסוגרת מקבלת גם טקסט אחריה** (`[^\n]*` ולא `[ \t]*`).
  // הסיבה: `FENCE_LINE` — שלפיו `splitStreamable` **סופר** גדרות — מתאים
  // לכל שורה שפותחת ב-```, בלי קשר למה שאחריה. הרגקס כאן היה מחמיר יותר,
  // ולכן ``` (סוף) נספר כגדר אך **לא הותאם כסוגרת** — הזוג לא נסגר, ענף
  // הגדר-הפתוחה למטה בלע `[\s\S]*$`, וכל הטקסט שאחרי הבלוק **נמחק**.
  // אומת בריוויו. ⇒ הגדרה **אחת** ל"שורת-גדר", לשני המקומות.
  out = out.replace(
    /^[ \t]{0,3}```([^\n]*)\n([\s\S]*?)^[ \t]{0,3}```[^\n]*$/gm,
    (_m, lang: string) => labelFor(lang, labels),
  )
  // בלוק שנפתח ולא נסגר (זרימה חיה — הסוגר עוד לא הגיע)
  out = out.replace(/^[ \t]{0,3}```([^\n]*)\n[\s\S]*$/m, (_m, lang: string) =>
    labelFor(lang, labels),
  )

  // ─── 1ב. הדבקת התווית לשכן ───
  // ⚠️ **מעבר נפרד, אחרי שכל הגדרות זוהו.** בליעת השורות בתוך רגקס-הגדר
  // עצמו שברה את העיגון-לשורה של הגדר הבאה.
  //
  // 🔴 ולמה בכלל: תווית לבדה בפסקה הופכת למקטע-TTS עצמאי, ו-Gemini **אינו
  // מקריא** פרגמנט כזה — נמדד בטלפון: המקטע נכנס לתור, סונתז, נוגן
  // (`done`, אפס `skipped`), ובכל זאת לא נשמע. כשהיא חלק ממשפט — נאמרת.
  //
  // בטוח כאן דווקא מפני שהתוצאה **אינה חוזרת לחוצץ** (ר' `splitStreamable`).
  {
    const cb = labels.codeBlock.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    out = out.replace(new RegExp(`\\n+[ \\t]*(${cb}[^\\n]*?)[ \\t]*(\\n+|$)`, "g"), " $1 ")
  }

  // ─── 2. קישורים — הטקסט נקרא, ה-URL נזרק ───
  out = out.replace(/\[([^\]]*)\]\([^)]*\)/g, (_m, label: string) =>
    label.trim().length > 0 ? label.trim() : ` ${labels.link} `,
  )

  // ─── 3. קוד-inline ───
  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    code.length <= INLINE_CODE_MAX ? code : ` ${labels.codeBlock} `,
  )

  // ─── 4. URL חשוף ───
  out = out.replace(BARE_URL, ` ${labels.link} `)

  // ─── 5. סימוני-הדגשה ותחביר-כותרת ───
  // ⚠️ רק הסימנים יורדים, **הטקסט נשאר** — זו הקראה, לא תקציר.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "")
  out = out.replace(/^\s{0,3}>\s?/gm, "")
  out = out.replace(/(\*\*|__)(.+?)\1/g, "$2")
  // ⚠️ **`_` ירד מרשימת סימני-ההדגשה.** `foo_bar_baz` הפך ל-`foobarbaz`,
  // ובאופן **לא-עקבי**: זרימה חיה ושחזור-בועה חתכו במקומות שונים לפי גבולי
  // ה-chunk. קו-תחתון במזהי-קוד שכיח בהרבה מ-`_הדגשה_` בטקסט שלנו.
  out = out.replace(/\*(?!\s)(.+?)(?<!\s)\*/g, "$1")
  out = out.replace(/~~(.+?)~~/g, "$1")

  // ─── 6. ניקוי רווחים שנוצרו מההחלפות ───
  out = out.replace(/[ \t]{2,}/g, " ")
  // התוויות מוזרקות עם רווחים משני צדדיהן (כדי לא להידבק למילה קודמת);
  // ליד שורה-חדשה הרווח הזה מיותר ונשמע כהיסוס.
  out = out.replace(/[ \t]+\n/g, "\n")
  out = out.replace(/\n[ \t]+/g, "\n")
  out = out.replace(/\n{3,}/g, "\n\n")
  // ⚠️ בזרימה **אין** trim — ר' SpeakableOpts.stream.
  return opts?.stream === true ? out : out.trim()
}

function appendTextPart(parts: SpeakablePart[], chunk: string): void {
  if (chunk.length === 0) return
  const last = parts[parts.length - 1]
  if (last?.kind === "text") {
    last.text += chunk
  } else {
    parts.push({ kind: "text", text: chunk })
  }
}

function speakableImageText(alt: string, labels: SpeakableLabels): string {
  return alt.trim().length > 0 ? ` ${labels.image}: ${alt.trim()} ` : ` ${labels.image} `
}

/**
 * Markdown → ordered text + local-audio file parts.
 * Non-audio images stay inline text (same as `toSpeakable` image step).
 */
export function toSpeakableParts(
  text: string,
  labels: SpeakableLabels,
  opts?: SpeakableOpts,
): SpeakablePart[] {
  const cwd = opts?.cwd ?? null
  const parts: SpeakablePart[] = []
  let lastIndex = 0
  IMAGE_LINK.lastIndex = 0
  let m: RegExpExecArray | null = IMAGE_LINK.exec(text)
  while (m !== null) {
    const before = text.slice(lastIndex, m.index)
    if (before.length > 0) {
      appendTextPart(parts, processSpeakableText(before, labels, { ...opts, stream: true }))
    }
    const alt = m[1] ?? ""
    const href = m[2] ?? ""
    const embed = resolveAudioEmbed(href, { cwd, catalog: opts?.catalog })
    if (embed !== null) {
      parts.push({
        kind: "file",
        title: alt.trim().length > 0 ? alt.trim() : embed.title,
        href: embed.href,
        uri: embed.uri,
      })
    } else {
      appendTextPart(parts, speakableImageText(alt, labels))
    }
    lastIndex = m.index + m[0].length
    m = IMAGE_LINK.exec(text)
  }
  const tail = text.slice(lastIndex)
  if (tail.length > 0) {
    appendTextPart(parts, processSpeakableText(tail, labels, { ...opts, stream: true }))
  }
  return parts
}

export function toSpeakable(text: string, labels: SpeakableLabels, opts?: SpeakableOpts): string {
  const joined = toSpeakableParts(text, labels, opts)
    .map((p) =>
      p.kind === "file"
        ? p.title.length > 0
          ? ` ${p.title} `
          : " "
        : p.text,
    )
    .join("")
  return opts?.stream === true ? joined : joined.trim()
}

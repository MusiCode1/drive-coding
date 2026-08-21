/**
 * speakable-stream.test.ts — הצמצום **כפי שה-Speaker משתמש בו**, לא לבדו.
 *
 * 🔴 **הלקח שהוליד את הקובץ.** ‏19 טסטים על `toSpeakable` עברו ירוק בעוד
 * הקוד הוקרא מאויית בפועל — כי כולם הזינו טקסט **שלם**. נבדקה הפונקציה,
 * לא השימוש בה. כאן מדמים את הלולאה של ה-Speaker מילה-במילה, ומקבעים את
 * שתי התכונות שבאמת חשובות:
 *
 *   1. **אפס-אובדן** — כל טקסט שאינו קוד מגיע להקראה.
 *   2. **אפס-איות** — שום שורת-קוד אינה מגיעה להקראה.
 */
import { describe, expect, it } from "vitest"
import { splitIntoSentences } from "./sentence-boundary.js"
import { type SpeakableLabels, splitStreamable, toSpeakable } from "./speakable.js"

const L: SpeakableLabels = {
  codeBlock: "[code]",
  // ⚠️ **חייב לשקף את הפרודקשן**: שם התווית נבנית כ-`${codeBlock} ${lang}`,
  // כלומר `codeBlock` הוא **תחילית** שלה. פיקסטורה שבנתה מחרוזת אחרת
  // ("[code ts]") הסתירה באג אמיתי במעבר-ההדבקה, שמזהה לפי התחילית.
  codeBlockWithLang: (l) => `[code] ${l}`,
  link: "[link]",
  image: "[image]",
}

/** מדמה בדיוק את הלולאה ב-`speaker.svelte.ts#handleStreamingBubbles`. */
/** מדמה בדיוק את הלולאה ב-`speaker.svelte.ts#handleStreamingBubbles`. */
function streamThrough(text: string, chunkSize: number): string[] {
  let raw = ""
  let pending = ""
  const spoken: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    raw += text.slice(i, i + chunkSize)
    const { ready, held } = splitStreamable(raw)
    raw = held
    if (ready.length > 0) pending += toSpeakable(ready, L, { stream: true })
    const { sentences, remaining } = splitIntoSentences(pending, { minChars: 20, maxChars: 200 })
    // ⚠️ **בלי עיכוב-זנב.** גרסה קודמת החזיקה מקטע קצר לסיבוב הבא, וזה
    // עיכב בדיוק את הזנב — התסמין שנמדד: "שומעים את ההודעה, לא את סופה".
    spoken.push(...sentences)
    pending = remaining
  }
  const tail = (pending + toSpeakable(raw, L)).trim()
  if (tail.length > 0) spoken.push(tail)
  return spoken
}

const MSG = [
  "שלום. הנה הסבר קצר על המודול החדש, שאמור להישמע במלואו.",
  "",
  "```typescript",
  "export function splitStreamable(text: string) {",
  "  const at = text.indexOf('```')",
  "  return { ready: text.slice(0, at) }",
  "}",
  "```",
  "",
  "וכאן משפט שבא אחרי הבלוק וחייב להישמע. עוד משפט להמשך.",
  "",
  "```bash",
  "bun run test",
  "```",
  "",
  "ומשפט אחרון שסוגר את ההודעה כולה.",
].join("\n")

describe("הזרמה ב-chunks — כפי שזה קורה בפועל", () => {
  // ⚠️ גדלים שונים בכוונה: הבאג האמיתי תלוי **איפה** נופל גבול-ה-chunk
  // ביחס לגדר. גודל אחד היה מפספס אותו.
  for (const size of [1, 3, 7, 17, 64, 500]) {
    it(`chunk=${size}: כל הטקסט שאינו קוד נשמע`, () => {
      const spoken = streamThrough(MSG, size).join(" ")
      for (const must of [
        "הנה הסבר קצר על המודול החדש",
        "וכאן משפט שבא אחרי הבלוק וחייב להישמע",
        "עוד משפט להמשך",
        "ומשפט אחרון שסוגר את ההודעה כולה",
      ]) {
        expect(spoken).toContain(must)
      }
    })

    it(`chunk=${size}: שום שורת-קוד אינה נשמעת`, () => {
      const spoken = streamThrough(MSG, size).join(" ")
      for (const forbidden of [
        "export function splitStreamable",
        "text.indexOf",
        "text.slice",
        "bun run test",
      ]) {
        expect(spoken).not.toContain(forbidden)
      }
    })
  }
})

describe("התווית עצמה — נשמעת או נבלעת?", () => {
  // 🔴 **הקיבוע שנולד ממדידה בשדה.** כשהתווית נשלחה כמקטע-TTS **עצמאי**,
  // Gemini לא הקריא אותה — המקטע נכנס לתור, סונתז ונוגן (אומת בטלפון:
  // `done`, אפס `skipped`) ובכל זאת לא נשמע. ⇒ התווית חייבת להיות **חלק
  // ממשפט**, לא מקטע לעצמה.
  for (const size of [1, 7, 64, 500]) {
    it(`chunk=${size}: התווית לעולם אינה מקטע עצמאי`, () => {
      for (const seg of streamThrough(MSG, size)) {
        const bare = seg.trim()
        expect(bare).not.toMatch(/^\[code[^\]]*\]$/)
      }
    })
  }

  // דווח מהשדה: הקוד מדולג יפה, אבל **המילים "בלוק קוד" לא נשמעות בכלל**.
  // הצמצום עובד; השאלה היא מה קורה לתווית אחרי הפיצול למשפטים.
  for (const size of [1, 7, 64, 500]) {
    it(`chunk=${size}: התווית מגיעה להקראה`, () => {
      const spoken = streamThrough(MSG, size)
      console.log(`chunk=${size} SPOKEN:`, JSON.stringify(spoken))
      expect(spoken.join(" ")).toContain("[code")
    })
  }
})

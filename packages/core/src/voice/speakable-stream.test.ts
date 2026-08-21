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
import { type SpeakableLabels, splitAtOpenFence, toSpeakable } from "./speakable.js"

const L: SpeakableLabels = {
  codeBlock: "[code]",
  codeBlockWithLang: (l) => `[code ${l}]`,
  link: "[link]",
  image: "[image]",
}

/** מדמה בדיוק את הלולאה ב-`speaker.svelte.ts#handleStreamingBubbles`. */
function streamThrough(text: string, chunkSize: number): string[] {
  let buffer = ""
  const spoken: string[] = []
  for (let i = 0; i < text.length; i += chunkSize) {
    buffer += text.slice(i, i + chunkSize)
    const { ready, held } = splitAtOpenFence(buffer)
    const { sentences, remaining } = splitIntoSentences(toSpeakable(ready, L, { stream: true }), {
      minChars: 40,
      maxChars: 200,
    })
    spoken.push(...sentences)
    buffer = remaining + held
  }
  // flush סוף-תור
  const tail = toSpeakable(buffer, L).trim()
  if (tail.length > 0) spoken.push(tail)
  return spoken
}

const MSG = [
  "שלום. הנה הסבר קצר על המודול החדש, שאמור להישמע במלואו.",
  "",
  "```typescript",
  "export function splitAtOpenFence(text: string) {",
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
        "export function splitAtOpenFence",
        "text.indexOf",
        "text.slice",
        "bun run test",
      ]) {
        expect(spoken).not.toContain(forbidden)
      }
    })
  }
})

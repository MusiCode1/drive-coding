/**
 * speakable.test.ts — ‏slice tts-speakable-text.
 *
 * ⚠️ הקיבוע הוא על **מה שנשמע**, לא על תווים: הטקסט נשאר, הסימנים יורדים.
 */
import { describe, expect, it } from "vitest"
import { type SpeakableLabels, toSpeakable } from "./speakable.js"

const L: SpeakableLabels = {
  codeBlock: "[code]",
  codeBlockWithLang: (l) => `[code ${l}]`,
  link: "[link]",
  image: "[image]",
}
const s = (t: string) => toSpeakable(t, L)

describe("toSpeakable — קוד", () => {
  it("בלוק מגודר עם שפה → תווית עם שם השפה", () => {
    expect(s("לפני\n```ts\nconst a = 1\nconst b = 2\n```\nאחרי")).toBe("לפני\n[code ts]\nאחרי")
  })

  it("בלוק בלי שפה → תווית גנרית", () => {
    expect(s("```\nls -la\n```")).toBe("[code]")
  })

  // 🔴 המקרה של זרימה חיה: הסוגר עוד לא הגיע, ובלעדיו הבלוק כולו היה נקרא.
  it("בלוק שנפתח ולא נסגר — עדיין לא נקרא מילה במילה", () => {
    expect(s("הנה:\n```python\nimport os\nfor x in y:")).toBe("הנה:\n[code python]")
  })

  it("קוד-inline קצר נשאר; ארוך הופך לתווית", () => {
    expect(s("קרא ל-`useState` עכשיו")).toBe("קרא ל-useState עכשיו")
    expect(s("`const veryLongIdentifierNameHere = compute()`")).toBe("[code]")
  })
})

describe("toSpeakable — קישורים ותמונות", () => {
  it("קישור → הטקסט בלבד, בלי ה-URL", () => {
    expect(s("ראה [את התיעוד](https://example.com/a/b?c=1) כאן")).toBe("ראה את התיעוד כאן")
  })

  it("קישור בלי טקסט → תווית", () => {
    expect(s("[](https://example.com)")).toBe("[link]")
  })

  it("URL חשוף → תווית", () => {
    expect(s("היכנס ל-https://example.com/x עכשיו")).toBe("היכנס ל- [link] עכשיו")
  })

  it("תמונה → תווית + alt", () => {
    expect(s("![תרשים הזרימה](/a.png)")).toBe("[image]: תרשים הזרימה")
  })

  // ⚠️ תחביר-התמונה מכיל תחביר-קישור; סדר לא-נכון היה הופך אותה לקישור.
  it("תמונה אינה מטופלת כקישור", () => {
    expect(s("![alt](/a.png)")).not.toContain("[link]")
  })
})

describe("toSpeakable — מרקדאון", () => {
  it("סימני הדגשה יורדים, הטקסט נשאר", () => {
    expect(s("זה **חשוב** וגם *מודגש* ו-~~ישן~~")).toBe("זה חשוב וגם מודגש ו-ישן")
  })

  it("כותרות וציטוטים מאבדים את הסימן בלבד", () => {
    expect(s("## כותרת\n> ציטוט")).toBe("כותרת\nציטוט")
  })

  // 🔴 בתוך בלוק-קוד יש תחביר שנראה כמו מרקדאון. אם נעבד אותו קודם —
  // נשנה טקסט שעומד להימחק, ובמקרה הרע נשבור את גבול-הבלוק.
  it("תחביר בתוך בלוק-קוד אינו מתפרש", () => {
    expect(s("```js\nconst url = 'https://x.com'\n// **bold**\n```")).toBe("[code js]")
  })
})

describe("toSpeakable — שלמות", () => {
  it("טקסט רגיל אינו משתנה", () => {
    expect(s("שלום, מה שלומך? הכול טוב.")).toBe("שלום, מה שלומך? הכול טוב.")
  })

  it("מחרוזת ריקה אינה מפילה", () => {
    expect(s("")).toBe("")
  })
})

/**
 * speakable.test.ts — ‏slice tts-speakable-text.
 *
 * ⚠️ הקיבוע הוא על **מה שנשמע**, לא על תווים: הטקסט נשאר, הסימנים יורדים.
 */
import { describe, expect, it } from "vitest"
import { type SpeakableLabels, splitStreamable, toSpeakable } from "./speakable.js"

const L: SpeakableLabels = {
  codeBlock: "[code]",
  // ⚠️ **חייב לשקף את הפרודקשן**: שם התווית נבנית כ-`${codeBlock} ${lang}`,
  // כלומר `codeBlock` הוא **תחילית** שלה. פיקסטורה שבנתה מחרוזת אחרת
  // ("[code] ts") הסתירה באג אמיתי במעבר-ההדבקה, שמזהה לפי התחילית.
  codeBlockWithLang: (l) => `[code] ${l}`,
  link: "[link]",
  image: "[image]",
}
const s = (t: string) => toSpeakable(t, L)

describe("toSpeakable — קוד", () => {
  it("בלוק מגודר עם שפה → תווית עם שם השפה", () => {
    // ⚠️ **התווית נדבקת לשכן ואינה פסקה לעצמה** — זו הכוונה, לא תופעת-לוואי.
    // תווית לבדה הופכת למקטע-TTS עצמאי, ו-Gemini אינו מקריא פרגמנט כזה
    // (נמדד בטלפון: נכנס לתור, סונתז, נוגן, לא נשמע).
    expect(s("לפני\n```ts\nconst a = 1\nconst b = 2\n```\nאחרי")).toBe("לפני [code] ts אחרי")
  })

  it("בלוק בלי שפה → תווית גנרית", () => {
    expect(s("```\nls -la\n```")).toBe("[code]")
  })

  // 🔴 המקרה של זרימה חיה: הסוגר עוד לא הגיע, ובלעדיו הבלוק כולו היה נקרא.
  it("בלוק שנפתח ולא נסגר — עדיין לא נקרא מילה במילה", () => {
    expect(s("הנה:\n```python\nimport os\nfor x in y:")).toBe("הנה: [code] python")
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
    expect(s("```js\nconst url = 'https://x.com'\n// **bold**\n```")).toBe("[code] js")
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

describe("splitStreamable — זרימה חיה", () => {
  // 🔴 זה הבאג שנשמע בפועל: הקוד הוקרא מאויית, כי כל chunk בנפרד לא הכיל
  // גדר-סוגרת ולכן `toSpeakable` לא זיהה בלוק כלל.
  it("גדר פתוחה — התוכן מוחזק ולא יוצא להקראה", () => {
    const { ready, held } = splitStreamable("הנה קוד:\n```ts\nconst a = 1")
    expect(ready).toBe("הנה קוד:\n")
    expect(held).toBe("```ts\nconst a = 1")
  })

  // ⚠️ **מוחזק רק מה שיש בו תחביר פתוח.** גרסה קודמת החזיקה כל שורה
  // חלקית — והודעה חד-פסקתית (אין בה `\n` עד הסוף) לא הוקראה כלל עד
  // סוף-התור. נתפס ע"י `speaker.test.svelte.ts`.
  it("גדר סגורה וטקסט נקי אחריה — הכול מוכן", () => {
    const txt = "לפני\n```ts\nconst a = 1\n```\nאחרי"
    expect(splitStreamable(txt)).toEqual({ ready: txt, held: "" })
  })

  it("שורה אחת בלי סיום ובלי תחביר פתוח — מוכנה, לא מוחזקת", () => {
    expect(splitStreamable("סתם טקסט.")).toEqual({ ready: "סתם טקסט.", held: "" })
  })

  it("קוד-inline שטרם נסגר — מוחזק", () => {
    const { ready, held } = splitStreamable("קרא ל-`useSta")
    expect(ready).toBe("")
    expect(held).toBe("קרא ל-`useSta")
  })

  // 🔴 נמדד בשדה: המשפט האחרון נכנס לתור כ-`**המשפט… סיום.` — הפותח נשאר
  // והסוגר נעלם, כי ההדגשה נחתכה בין chunks ושני החצאים עובדו לחוד.
  it("הדגשה שטרם נסגרה — מוחזקת", () => {
    const { ready, held } = splitStreamable("זה **חשוב מא")
    expect(ready).toBe("")
    expect(held).toBe("זה **חשוב מא")
  })

  it("הדגשה סגורה — לא מוחזקת", () => {
    expect(splitStreamable("זה **חשוב** ותו לא.")).toEqual({
      ready: "זה **חשוב** ותו לא.",
      held: "",
    })
  })

  it("קישור שטרם נסגר — מוחזק", () => {
    const { held } = splitStreamable("ראה [את התיע")
    expect(held).toBe("ראה [את התיע")
  })

  it("בלוק סגור ואז אחד פתוח — מוחזק מהגדר הפתוחה", () => {
    const { ready, held } = splitStreamable("a\n```js\nx\n```\nb\n```py\ny")
    expect(ready).toBe("a\n```js\nx\n```\nb\n")
    expect(held).toBe("```py\ny")
  })

  // ⚠️ החזקה בלי שחרור היא דליפה: אם הבלוק לעולם לא ייסגר, `toSpeakable`
  // בסוף-התור הוא זה שמטפל בו (יש לו ענף לגדר שלא נסגרה).
  it("מה שמוחזק עדיין מצטמצם נכון כשמפלטים אותו", () => {
    const { held } = splitStreamable("```python\nimport os")
    expect(s(held)).toBe("[code] python")
  })
})

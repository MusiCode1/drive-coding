/**
 * speakable.test.ts — ‏slice tts-speakable-text.
 *
 * ⚠️ הקיבוע הוא על **מה שנשמע**, לא על תווים: הטקסט נשאר, הסימנים יורדים.
 */
import { describe, expect, it } from "vitest"
import { type SpeakableLabels, toSpeakable, toSpeakableParts } from "./speakable.js"

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
const s2 = s

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

describe("toSpeakable — הסוגרת עם טקסט אחריה", () => {
  // 🔴 `FENCE_LINE` ספר ``` (סוף) כגדר, אבל רגקס-הבלוק דרש `[ \t]*$`
  // ולכן לא התאים אותה כסוגרת — הזוג לא נסגר, ענף הגדר-הפתוחה בלע
  // `[\s\S]*$`, וכל הטקסט שאחרי הבלוק **נמחק**.
  it("טקסט אחרי בלוק שסוגרתו נושאת תוכן — שורד", () => {
    const out = s2("לפני\n```ts\nconst a=1\n``` (סוף)\nוזה טקסט שחייב לשרוד.")
    expect(out).toContain("וזה טקסט שחייב לשרוד")
    expect(out).not.toContain("const a=1")
  })

  it("גדר של ארבע גרשיים — לא מדליפה גרש להקראה", () => {
    expect(s2("````\ncode\n````")).not.toContain("`")
  })
})

describe("toSpeakable — קו-תחתון אינו הדגשה", () => {
  // 🔴 `foo_bar_baz` → `foobarbaz`, ובאופן **לא-עקבי**: זרימה ושחזור-בועה
  // חתכו במקומות שונים לפי גבולי ה-chunk.
  it("מזהה עם קווים-תחתונים נשמר", () => {
    expect(s("קרא ל-foo_bar_baz עכשיו.")).toBe("קרא ל-foo_bar_baz עכשיו.")
  })

  it("הדגשה בכוכביות עדיין עובדת", () => {
    expect(s("זה *מודגש* וזהו.")).toBe("זה מודגש וזהו.")
  })
})

describe("toSpeakableParts — audio embed", () => {
  it("splits text around local audio image syntax", () => {
    expect(toSpeakableParts("hello ![clip](/tmp/a.mp3) world", L)).toEqual([
      { kind: "text", text: "hello " },
      { kind: "file", title: "clip", href: "/tmp/a.mp3", uri: "file:///tmp/a.mp3" },
      { kind: "text", text: " world" },
    ])
  })

  it("toSpeakable reads alt for audio, not [image]", () => {
    const out = s("hello ![clip](/tmp/a.mp3) world")
    expect(out).toContain("clip")
    expect(out).not.toContain("[image]")
  })

  it("non-audio image keeps [image]: alt regression", () => {
    expect(s("![diagram](/a.png)")).toBe("[image]: diagram")
  })

  it("malformed incomplete image stays a single text part", () => {
    expect(toSpeakableParts("see ![clip](/tmp/a.mp", L)).toEqual([
      { kind: "text", text: "see ![clip](/tmp/a.mp" },
    ])
  })

  it("catalog hit audio/* without audio extension yields file part", () => {
    expect(
      toSpeakableParts("![clip](file:///tmp/noext)", L, {
        catalog: [{ uri: "file:///tmp/noext", mime: "audio/mpeg" }],
      }),
    ).toEqual([
      {
        kind: "file",
        title: "clip",
        href: "file:///tmp/noext",
        uri: "file:///tmp/noext",
      },
    ])
  })

  it("catalog miss keeps extension fallback behavior", () => {
    expect(toSpeakableParts("![clip](/tmp/a.mp3)", L, { catalog: [] })).toEqual([
      { kind: "file", title: "clip", href: "/tmp/a.mp3", uri: "file:///tmp/a.mp3" },
    ])
  })
})

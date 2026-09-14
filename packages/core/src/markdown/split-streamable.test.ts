/**
 * split-streamable.test.ts — streaming markdown split (moved from speakable.test.ts).
 */
import { describe, expect, it } from "vitest"
import { type SpeakableLabels, toSpeakable } from "../voice/speakable.js"
import { splitStreamable } from "./split-streamable.js"

const L: SpeakableLabels = {
  codeBlock: "[code]",
  codeBlockWithLang: (l) => `[code] ${l}`,
  link: "[link]",
  image: "[image]",
}
const s = (t: string) => toSpeakable(t, L)

describe("splitStreamable — זרימה חיה", () => {
  it("גדר פתוחה — התוכן מוחזק ולא יוצא להקראה", () => {
    const { ready, held } = splitStreamable("הנה קוד:\n```ts\nconst a = 1")
    expect(ready).toBe("הנה קוד:\n")
    expect(held).toBe("```ts\nconst a = 1")
  })

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

  it("מה שמוחזק עדיין מצטמצם נכון כשמפלטים אותו", () => {
    const { held } = splitStreamable("```python\nimport os")
    expect(s(held)).toBe("[code] python")
  })
})

describe("splitStreamable — סוגריים שאינם קישור", () => {
  for (const txt of ["סעיף [3] בתקנון.", "מערך[0] ריק.", "[א] ראשית.", "הפאנל מציג [code]."]) {
    it(`"${txt}" — זורם, לא מוחזק`, () => {
      expect(splitStreamable(txt)).toEqual({ ready: txt, held: "" })
    })
  }

  it("קישור שבאמת נחתך — עדיין מוחזק", () => {
    expect(splitStreamable("ראה [את התיע").held).toBe("ראה [את התיע")
  })

  it("URL שנחתך אחרי ]( — מוחזק", () => {
    expect(splitStreamable("ראה [כאן](https://exa").held).toBe("ראה [כאן](https://exa")
  })
})

describe("splitStreamable — כוכבית היא כפל, לא הדגשה", () => {
  for (const txt of ["The result of 2 * 3 is six.", "מכפילים 4 * 5 ומקבלים.", "a * b * c."]) {
    it(`"${txt}" — זורם`, () => {
      expect(splitStreamable(txt)).toEqual({ ready: txt, held: "" })
    })
  }

  it("הדגשה כפולה שטרם נסגרה — עדיין מוחזקת", () => {
    expect(splitStreamable("זה **חשוב מא").held).toBe("זה **חשוב מא")
  })
})

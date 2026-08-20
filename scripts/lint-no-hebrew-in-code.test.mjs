// @ts-check
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { HEBREW_RE, stripAllComments } from "./lint-no-hebrew-in-code.mjs"

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, "..")

/** A line "has Hebrew in code" iff stripping comments leaves Hebrew on it. */
function hebrewInCode(src) {
  return stripAllComments(src)
    .split("\n")
    .some((line) => HEBREW_RE.test(line))
}

describe("stripAllComments — strings vs comments", () => {
  it("Hebrew in a double-quoted string → flagged", () => {
    expect(hebrewInCode('const x = "שלום"')).toBe(true)
  })
  it("Hebrew in a single-quoted string → flagged", () => {
    expect(hebrewInCode("const x = 'שלום'")).toBe(true)
  })
  it("Hebrew in a backtick template → flagged", () => {
    expect(hebrewInCode("const x = `שלום`")).toBe(true)
  })
  it("Hebrew in a line comment → allowed", () => {
    expect(hebrewInCode("const x = 1 // שלום")).toBe(false)
  })
  it("Hebrew in a block comment → allowed", () => {
    expect(hebrewInCode("/* שלום */\nconst x = 1")).toBe(false)
  })
  it("Hebrew in a JSDoc block → allowed", () => {
    expect(hebrewInCode("/**\n * שלום\n */\nconst x = 1")).toBe(false)
  })
  it("Hebrew in an HTML comment (Svelte) → allowed", () => {
    expect(hebrewInCode("<!-- שלום -->\n<div></div>")).toBe(false)
  })
  it("Hebrew in Svelte template text → flagged", () => {
    expect(hebrewInCode("<div>שלום</div>")).toBe(true)
  })
})

describe("regex literals (slice 19 fix)", () => {
  it("regex with quotes does NOT swallow the following Hebrew comment", () => {
    // Before the fix, the odd double-quote inside /.../ opened a phantom
    // string state that ate the Hebrew comment below → false 'clean'.
    const src = 'const re = /"message":"x"/\nconst y = 1 // הערה בעברית'
    expect(hebrewInCode(src)).toBe(false)
  })
  it("regex with quotes still flags Hebrew in a real string after it", () => {
    const src = 'const re = /"a"/\nconst y = "עברית"'
    expect(hebrewInCode(src)).toBe(true)
  })
  it("division is not mistaken for a regex", () => {
    const src = "const x = a / b // הערה"
    expect(hebrewInCode(src)).toBe(false)
  })
})

describe("escapes", () => {
  it("escaped quote inside a string does not end it early", () => {
    const src = 'const x = "a\\"b" // הערה'
    expect(hebrewInCode(src)).toBe(false)
  })
  it("Hebrew after an escaped quote inside the string is still flagged", () => {
    const src = 'const x = "a\\"שלום"'
    expect(hebrewInCode(src)).toBe(true)
  })
})

describe("behaviour parity with the Python implementation", () => {
  const py = resolve(SCRIPT_DIR, "lint-no-hebrew-in-code.py")
  const mjs = resolve(SCRIPT_DIR, "lint-no-hebrew-in-code.mjs")

  function run(cmd, args) {
    try {
      const out = execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: "utf-8" })
      return { code: 0, out }
    } catch (/** @type {any} */ e) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }
    }
  }

  it.skipIf(!existsSync(py))("JS and Python agree on the real repo (exit code)", () => {
    const jsRes = run("node", [mjs])
    const pyRes = run("python3", [py])
    expect(jsRes.code).toBe(pyRes.code)
  })
})

describe("באג #19 — תו מחוץ ל-BMP הזיז את כל האינדקסים", () => {
  /**
   * 🔴 `stripJsdocBlocks` בנה `out` ב-spread (**נקודות-קוד**) והשתמש ב-
   * `text[i]`/`text.length` (**יחידות UTF-16**). מכל אמוג\u05f3י והלאה השניים
   * מוזזים באיבר, והריקון פוגע במקומות הלא-נכונים.
   *
   * ⚠️ **ההיסט חייב להצטבר כדי לפגוע** — אמוג\u05f3י בודד אינו מספיק. בשניים
   * ומעלה הריקון חורג ומוחק את ה-`/` הראשון של `//` שאחריו; מכונת-המצבים
   * רואה `/` בודד, לא מזהה הערת-שורה, והעברית דולפת כאילו הייתה קוד.
   *
   * במקרה האמיתי שהוליד את זה (`sse-reader.ts`): **24 שורות תמימות הואשמו**.
   */
  function withEmojiBlocks(n) {
    const blocks = Array.from({ length: n }, (_, i) => `/**\n * \u{1F534} הערה ${i}\n */`).join(
      "\n",
    )
    return [
      blocks,
      "/**",
      " * בלוק אחרון",
      " */",
      "// הערה בשורה עם עברית",
      "const a = 1",
      "export default a",
    ].join("\n")
  }

  it("🔴 שני אמוג\u05f3ים ומעלה — הערת-השורה שאחריהם אינה מואשמת", () => {
    expect(hebrewInCode(withEmojiBlocks(2))).toBe(false)
  })

  it("וההיסט מצטבר — גם בשמונה", () => {
    expect(hebrewInCode(withEmojiBlocks(8))).toBe(false)
  })

  it("ועדיין תופס עברית אמיתית במחרוזת שאחרי אמוג\u05f3ים", () => {
    const src = [withEmojiBlocks(3), 'const msg = "שלום"'].join("\n")
    expect(hebrewInCode(src)).toBe(true)
  })
})

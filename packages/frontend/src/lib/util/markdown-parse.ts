/**
 * markdown-parse.ts — שכבת parse טהורה (ללא DOMPurify), בר-בדיקה ב-environment:node.
 *
 * מייצא:
 *  - normalizeLineLeadingBidi(text) — מנרמל bidi-control בתחילת שורה
 *  - parseToHtml(text) — מנרמל bidi, מריץ marked.parse עם 4 extensions, מחזיר { html, katexFragments }
 *  - BLOCK_SENTINEL, INLINE_SENTINEL — sentinels משותפים (מיובאים ע"י markdown.ts)
 *
 * ⚠️ @internal — parseToHtml לא מסנן (DOMPurify). אסור לחשוף HTML שמוחזר מכאן ישירות ל-{@html}.
 * ה-sanitize מבוצע ב-markdown.ts על ידי renderMarkdown.
 */

import katex from "katex"
import { marked, type Tokens } from "marked"

// ─── Sentinel (Private-Use Area) ─────────────────────────────────────────────
// U+E000 = block math placeholder prefix, U+E001 = inline math placeholder prefix.
// שורדים marked.parse ו-DOMPurify.sanitize כטקסט. Collision-resistant ולא מתפרשים כ-markdown.
// מוגדר כאן (ב-parse layer) ומיובא ע"י markdown.ts — הסכם משותף שלא מחייב circular import.
export const BLOCK_SENTINEL = ""
export const INLINE_SENTINEL = ""

// ─── Module-level KaTeX map ───────────────────────────────────────────────────
// נרשם ברמת מודול, מתאפס בכל קריאה ל-parseToHtml.
// אסור להזיז את marked.use לתוך parseToHtml (יירשום extension מצטבר per-call).
let currentMap: string[] = []

function renderKatex(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    output: "htmlAndMathml",
    maxSize: 50,
    maxExpand: 1000,
    trust: false,
  })
}

function storePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

function storeInlinePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  return `${INLINE_SENTINEL}${idx}${INLINE_SENTINEL}`
}

// ─── marked extension (נרשם פעם אחת ברמת מודול) ──────────────────────────────
// ⚠️ block לפני inline — $$...$$ ו-\[..\] חייבים להיות ראשונים ברשימה,
// אחרת $$ עלול להיתפס כ-2× $..$ (finding #3, אמות ע"י אביגיל).
marked.use({
  extensions: [
    // ── Block: $$...$$ ────────────────────────────────────────────────────
    {
      name: "mathBlock",
      level: "block",
      start(src: string) {
        return src.indexOf("$$")
      },
      tokenizer(src: string) {
        const match = /^\$\$([\s\S]+?)\$\$/.exec(src)
        if (match) {
          return {
            type: "mathBlock",
            raw: match[0],
            text: (match[1] ?? "").trim(),
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return storePlaceholder(renderKatex(String(token.text ?? ""), true))
      },
    },
    // ── Block: \[...\] ────────────────────────────────────────────────────
    // ⚠️ הבחנה מ-\( — prefix משותף \. ה-tokenizer מחפש \[ ספציפית.
    {
      name: "mathBlockBracket",
      level: "block",
      start(src: string) {
        return src.indexOf("\\[")
      },
      tokenizer(src: string) {
        const match = /^\\\[([\s\S]+?)\\\]/.exec(src)
        if (match) {
          return {
            type: "mathBlockBracket",
            raw: match[0],
            text: (match[1] ?? "").trim(),
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return storePlaceholder(renderKatex(String(token.text ?? ""), true))
      },
    },
    // ── Inline: $...$ ─────────────────────────────────────────────────────
    {
      name: "mathInline",
      level: "inline",
      start(src: string) {
        return src.indexOf("$")
      },
      tokenizer(src: string) {
        // ה-tokenizer של marked מכבד code spans — אם $ נמצא בתוך `code`, marked לא יקרא לנו
        const match = /^\$([^$\n]+?)\$/.exec(src)
        if (match) {
          return {
            type: "mathInline",
            raw: match[0],
            text: (match[1] ?? "").trim(),
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return storeInlinePlaceholder(renderKatex(String(token.text ?? ""), false))
      },
    },
    // ── Inline: \(...\) ───────────────────────────────────────────────────
    // ⚠️ הבחנה מ-\[ — ה-tokenizer מחפש \( ספציפית.
    {
      name: "mathInlineParen",
      level: "inline",
      start(src: string) {
        return src.indexOf("\\(")
      },
      tokenizer(src: string) {
        const match = /^\\\(([\s\S]+?)\\\)/.exec(src)
        if (match) {
          return {
            type: "mathInlineParen",
            raw: match[0],
            text: (match[1] ?? "").trim(),
          }
        }
        return undefined
      },
      renderer(token: Tokens.Generic) {
        return storeInlinePlaceholder(renderKatex(String(token.text ?? ""), false))
      },
    },
  ],
})

// ─── Bidi normalization ──────────────────────────────────────────────────────
// תווי bidi-control: U+200E (LRM), U+200F (RLM), U+202A-U+202E, U+2066-U+2069
const BIDI = "‎‏‪-‮⁦-⁩"

/**
 * מנרמל תווי bidi-control בתחילת שורה (heuristic היברידי — אושר ע"י המשתמשת).
 *
 * לכל שורה שמתחילה ברצף bidi-control:
 * - לפני math marker ($$ או \[): מוחק את ה-bidi-marks (RLM בנוסחה → unknownSymbol ב-KaTeX).
 * - לפני block marker (# > - * + | ספרה.): דוחף אחרי ה-marker (marked מזהה, RLM נוחת בתוכן).
 * - לפני טקסט רגיל: משאיר — RLM שם ניטרלי/מועיל.
 *
 * לא נוגע ב-bidi באמצע שורה.
 */
export function normalizeLineLeadingBidi(text: string): string {
  // סדר חשוב: math-delete לפני push
  // שלב 1: מחק bidi-marks לפני math markers ($$, \[)
  let result = text.replace(
    new RegExp(`^[${BIDI}]+(?=\\$\\$|\\\\\\[)`, "gmu"),
    "",
  )
  // שלב 2: דחוף bidi-marks אחרי block marker (כולל הרווח שאחרי)
  // \\| = table marker (pipe בתחילת שורת טבלה)
  result = result.replace(
    new RegExp(`^([${BIDI}]+)(#{1,6} |>+ |[-*+] |\\d+[.)] |\\| ?)`, "gmu"),
    "$2$1",
  )
  return result
}

/**
 * @internal — טהור (ללא DOMPurify). בר-בדיקה ב-environment:node.
 *
 * מאפס currentMap, מנרמל bidi, מריץ marked.parse עם 4 extensions,
 * ומחזיר snapshot של currentMap כ-katexFragments.
 *
 * ⚠️ אסור להשתמש ב-html שמוחזר ישירות ב-{@html} — חייב לעבור sanitize ב-renderMarkdown.
 */
export function parseToHtml(text: string): { html: string; katexFragments: string[] } {
  currentMap = []
  const normalized = normalizeLineLeadingBidi(text)
  const html = marked.parse(normalized, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string
  return { html, katexFragments: [...currentMap] }
}

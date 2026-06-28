/**
 * markdown-parse.ts — שכבת parse טהורה (ללא DOMPurify), בר-בדיקה ב-environment:node.
 *
 * מייצא:
 *  - normalizeInvisibles(text) — מנרמל תווי bidi-control + zero-width + soft-hyphen בכל המיקומים
 *  - parseToHtml(text) — מנרמל invisibles, מריץ marked.parse עם 4 extensions + renderer.code,
 *    מחזיר { html, katexFragments, codeFragments }
 *  - BLOCK_SENTINEL, INLINE_SENTINEL — sentinels משותפים (מיובאים ע"י markdown.ts)
 *
 * ── code fragment storage ─────────────────────────────────────────────────────
 * Code fragments משתמשים ב-BLOCK_SENTINEL (כמו KaTeX blocks) — U+E000 שורד DOMPurify.
 * הם נשמרים ב-currentMap **אחרי** ה-KaTeX fragments:
 *   currentMap[0..katexCount-1] = KaTeX fragments
 *   currentMap[katexCount..] = code fragments
 * parseToHtml מחזיר katexFragments ו-codeFragments כ-snapshots נפרדים.
 * renderMarkdown (markdown.ts) מחיל KATEX_ALLOW על katexFragments ו-CODE_ALLOW על codeFragments.
 *
 * ── למה לא CODE_SENTINEL נפרד ──────────────────────────────────────────────
 * U+E002 נמחק ע"י DOMPurify (אמות אמפירית בסביבת jsdom). BLOCK_SENTINEL (U+E000) שורד.
 * לכן code fragments מאוחסנים ב-currentMap עם BLOCK_SENTINEL ו-index גלובלי.
 *
 * ⚠️ @internal — parseToHtml לא מסנן (DOMPurify). אסור לחשוף HTML שמוחזר מכאן ישירות ל-{@html}.
 * ה-sanitize מבוצע ב-markdown.ts על ידי renderMarkdown.
 */

import katex from "katex"
import { marked, type Tokens } from "marked"
import { highlightCode } from "./code-highlight"

// ─── Sentinel (Private-Use Area) ─────────────────────────────────────────────
// U+E000 = block placeholder (KaTeX block + code blocks). שורד DOMPurify.
// U+E001 = inline placeholder (KaTeX inline). שורד DOMPurify.
// ⚠️ U+E002 נמחק ע"י DOMPurify בסביבת jsdom — לא בשימוש.
// מוגדר כאן (ב-parse layer) ומיובא ע"י markdown.ts — הסכם משותף שלא מחייב circular import.
export const BLOCK_SENTINEL = ""
export const INLINE_SENTINEL = ""

// ─── Module-level maps ───────────────────────────────────────────────────────
// currentMap — storage של כל ה-fragments (KaTeX + code) ברמת מודול.
// נרשם ברמת מודול, מתאפס בכל קריאה ל-parseToHtml.
// אסור להזיז את marked.use לתוך parseToHtml (יירשום extension מצטבר per-call).
let currentMap: string[] = []
// מספר KaTeX fragments שנשמרו עד כה — קובע את ה-offset לcode fragments.
let katexCount = 0

// ─── allowlist לשמות שפות ב-class (אבטחה: injection ל-class="language-X") ───
// רק תווים בטוחים: אותיות, מספרים, מקף, פלוס, hash
const SAFE_LANG_RE = /^[a-z0-9+#-]+$/i

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
  katexCount = currentMap.length // KaTeX index הגבוה ביותר + 1
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

function storeInlinePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  katexCount = currentMap.length // עדכן offset
  return `${INLINE_SENTINEL}${idx}${INLINE_SENTINEL}`
}

/**
 * מאחסן code block ב-currentMap אחרי ה-KaTeX fragments.
 * משתמש ב-BLOCK_SENTINEL (שורד DOMPurify), לא ב-sentinel נפרד.
 */
function storeCodePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

// ─── marked extension (נרשם פעם אחת ברמת מודול) ──────────────────────────────
// ⚠️ block לפני inline — $$...$$ ו-\[..\] חייבים להיות ראשונים ברשימה,
// אחרת $$ עלול להיתפס כ-2× $..$ (finding #3, אמות ע"י אביגיל).
marked.use({
  renderer: {
    // ── Code block renderer — pass-שלישי-מבודד ────────────────────────────
    // כל הבלוק (pre+code+spans) נשמר ב-currentMap (אחרי KaTeX) ועובר CODE_ALLOW נפרד.
    // הסיבה: MARKDOWN_ALLOW לא כולל class → pass-2 היה מוחק class="hljs language-*".
    // ⚠️ token.lang חייב escape/allowlist לפני שילובו ב-class (injection vector).
    code(token: Tokens.Code): string {
      const code = token.text
      const rawLang = token.lang ?? ""
      // אבטחה: רק תווים בטוחים ב-lang class
      const safeLang = SAFE_LANG_RE.test(rawLang) ? rawLang.toLowerCase() : ""
      const langClass = safeLang ? ` language-${safeLang}` : ""

      const highlighted = highlightCode(code, safeLang || undefined)
      const fullBlock = `<pre><code class="hljs${langClass}">${highlighted}</code></pre>`

      // ה-sentinel עצמאי (block-level) — pre+code+spans כולם בתוך ה-fragment
      return storeCodePlaceholder(fullBlock)
    },
  },
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

// ─── Invisibles normalization ────────────────────────────────────────────────
// char-class: INVIS = bidi-control + zero-width + soft-hyphen + BOM + arabic-letter-mark
// NBSP = non-breaking space variants (ממופה לרווח, לא נמחק)
const INVIS = "\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF\\u00AD\\u061C"
const NBSP = "\\u00A0\\u202F"
const reInvis = new RegExp(`[${INVIS}]`, "gu")

/**
 * מנרמל תווי bidi-control, zero-width, soft-hyphen ו-BOM בכל המיקומים.
 *
 * עקרון: "הצמד את התו הבלתי-נראה לטקסט אמיתי; מחק רק באזורי-תחביר-טהור (separator, math)."
 *
 * 1. NBSP-like → רווח רגיל (משמר semantics אחרי #, מתקן bold)
 * 2. שורת separator → strip INVIS (שורה שכולה [|:\-\s+INVIS] ובה מקף ויש בה |)
 * 3. math spans → strip INVIS ($$..$$, \[..\], \(..\) — NOT $..$ inline, finding #2: מחיר $5..$10)
 * 4a. INVIS לפני math-marker בתחילת שורה → מחק
 * 4b. INVIS לפני block-marker בתחילת שורה → הזז אחרי ה-marker
 * 5. השאר (INVIS צמוד לטקסט) → נשמר
 *
 * ⚠️ finding #2: inline $..$ אינו מנורמל — "costs $5 ‏x $10" שומר invis. נדיר להיות math שם.
 */
export function normalizeInvisibles(text: string): string {
  // 1. NBSP-like → space
  let t = text.replace(new RegExp(`[${NBSP}]`, "gu"), " ")
  // 2. separator rows: strip INVIS
  t = t.replace(/^.*$/gm, (line) => {
    const s = line.replace(reInvis, "")
    return /\|/.test(s) && /^[\s|:-]*-[\s|:-]*$/.test(s) ? s : line
  })
  // 3. math spans: strip — block+paren only.
  // NOT inline $..$ (finding #2): "$5 ... $10" (מחיר) ייתפס כ-span ויאבד invis = content-mutation.
  // invis בתוך $x$ inline math (נדיר) → נשאר → רעש unknownSymbol קל ב-KaTeX, לא שבירה.
  t = t.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g, (m) =>
    m.replace(reInvis, ""),
  )
  // 4a. line-start before math-marker: delete
  t = t.replace(new RegExp(`^[${INVIS}]+(?=\\$\\$|\\\\\\[)`, "gmu"), "")
  // 4b. line-start before block-marker: relocate after marker
  t = t.replace(new RegExp(`^([${INVIS}]+)(#{1,6} |>+ |[-*+] |\\d+[.)] |\\| ?)`, "gmu"), "$2$1")
  return t
}

/**
 * @internal — טהור (ללא DOMPurify). בר-בדיקה ב-environment:node.
 *
 * מאפס currentMap + katexCount, מנרמל bidi, מריץ marked.parse עם 4 extensions + renderer.code,
 * ומחזיר snapshots נפרדים: katexFragments (indexes 0..n-1) ו-codeFragments (indexes n..).
 *
 * ⚠️ אסור להשתמש ב-html שמוחזר ישירות ב-{@html} — חייב לעבור sanitize ב-renderMarkdown.
 */
export function parseToHtml(text: string): {
  html: string
  katexFragments: string[]
  codeFragments: string[]
} {
  currentMap = []
  katexCount = 0
  const normalized = normalizeInvisibles(text)
  const html = marked.parse(normalized, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string
  // katexFragments = currentMap[0..katexCount-1]
  // codeFragments = currentMap[katexCount..]
  const katexFragments = currentMap.slice(0, katexCount)
  const codeFragments = currentMap.slice(katexCount)
  return { html, katexFragments, codeFragments }
}

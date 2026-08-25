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
 * הם נשמרים ב-currentMap עם index גלובלי, לצד KaTeX fragments.
 * fragmentKinds[] מקביל ל-currentMap — מסווג כל fragment כ-"katex" או "code".
 * בסוף parseToHtml, מחלצים katexFragments ו-codeFragments לפי הסוג (לא לפי קשר).
 * זה עמיד לסדר: code-first-then-math ו-math-first-then-code מסווגים נכון.
 *
 * renderMarkdown (markdown.ts) מחיל KATEX_ALLOW על katexFragments ו-CODE_ALLOW על codeFragments.
 * allClean[] בנוי כ-sparse array לפי global index — replacePlaceholders מתאים מ-allClean[idx].
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
import { escapeHtml, highlightCode } from "./code-highlight"
import { decideImageSrc } from "./markdown-image-src"

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
// fragmentKinds — מקביל ל-currentMap, מסווג כל index כ-"katex" | "code" | "image".
// עמיד לסדר: code-before-katex מסווג נכון (לא תלוי offset).
let fragmentKinds: ("katex" | "code" | "image")[] = []
// currentCwd — נקבע בכל parseToHtml; משמש renderer.image לפתרון נתיבים יחסיים.
let currentCwd: string | null = null

export type MarkdownRenderOptions = { cwd?: string | null }

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
  fragmentKinds.push("katex")
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

function storeInlinePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  fragmentKinds.push("katex")
  return `${INLINE_SENTINEL}${idx}${INLINE_SENTINEL}`
}

/**
 * מאחסן code block ב-currentMap (בכל index, לא מחייב אחרי KaTeX).
 * fragmentKinds[idx]="code" מבטיח שהסיווג עמיד לסדר (code-before-katex).
 */
function storeCodePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  fragmentKinds.push("code")
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

function storeImagePlaceholder(html: string): string {
  const idx = currentMap.length
  currentMap.push(html)
  fragmentKinds.push("image")
  return `${BLOCK_SENTINEL}${idx}${BLOCK_SENTINEL}`
}

function buildImgPlaceholder(src: string, alt: string, title: string | null | undefined): string {
  let html = `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"`
  if (title !== null && title !== undefined && title !== "") {
    html += ` title="${escapeHtml(title)}"`
  }
  html += ">"
  return storeImagePlaceholder(html)
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
    image(token: Tokens.Image): string {
      const decision = decideImageSrc(token.href, currentCwd)
      if (decision.kind === "proxy" || decision.kind === "data") {
        return buildImgPlaceholder(decision.src, token.text, token.title)
      }
      if (decision.kind === "remote") {
        const alt = token.text.replace(/[[\]]/g, "")
        return escapeHtml(`![${alt}](${decision.url})`)
      }
      return escapeHtml(token.raw)
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
 * מאפס currentMap + fragmentKinds, מנרמל bidi, מריץ marked.parse עם 4 extensions + renderer.code,
 * ומחזיר snapshots נפרדים: katexFragments ו-codeFragments לפי fragmentKinds[] (עמיד לסדר).
 *
 * ⚠️ אסור להשתמש ב-html שמוחזר ישירות ב-{@html} — חייב לעבור sanitize ב-renderMarkdown.
 */
export function parseToHtml(text: string, opts?: MarkdownRenderOptions): {
  html: string
  katexFragments: string[]
  codeFragments: string[]
  imageFragments: string[]
  fragmentKinds: ("katex" | "code" | "image")[]
} {
  currentMap = []
  fragmentKinds = []
  currentCwd = opts?.cwd ?? null
  const normalized = normalizeInvisibles(text)
  const html = marked.parse(normalized, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string
  // סיווג לפי fragmentKinds — עמיד לסדר (code-before-katex נשמר נכון)
  const katexFragments = currentMap.filter((_, i) => fragmentKinds[i] === "katex")
  const codeFragments = currentMap.filter((_, i) => fragmentKinds[i] === "code")
  const imageFragments = currentMap.filter((_, i) => fragmentKinds[i] === "image")
  return { html, katexFragments, codeFragments, imageFragments, fragmentKinds }
}

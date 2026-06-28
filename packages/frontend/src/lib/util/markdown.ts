/**
 * markdown.ts — renderMarkdown ל-HTML מחוטא, עם רינדור KaTeX (LaTeX math)
 *               + צביעת syntax (code-highlight, slice-code-syntax-highlight).
 *
 * ── Pipeline (four-pass) ────────────────────────────────────────────────────
 * renderMarkdown(text):
 *   1. parseToHtml(text) [markdown-parse.ts] — מנרמל bidi, marked.parse עם 4 extensions:
 *        tokenizer מזהה $$..$$  \[..\]  $.$  \(..\)  (block לפני inline)
 *        renderer.code קורא highlightCode → שומר HTML ב-currentMap[katexCount..] → מחזיר BLOCK_SENTINEL
 *        renderer katex: קורא katex.renderToString → שומר HTML ב-currentMap[0..n-1] → מחזיר BLOCK/INLINE_SENTINEL
 *        placeholder = sentinels PUA (U+E000/E001) — שורדים marked+DOMPurify כטקסט.
 *      → { html: markdownHtml, katexFragments (indexes 0..n), codeFragments (indexes n..) }
 *   2. DOMPurify.sanitize(markdownHtml, MARKDOWN_ALLOW) — allowlist שמרני, ללא span/style/class.
 *      ה-sentinels = טקסט → שורדים. <span style> גולמי של מודל → נמחק. ← הלב האבטחתי.
 *   3a. כל KaTeX HTML ב-katexFragments: DOMPurify.sanitize(katexHtml, KATEX_ALLOW) — allowlist נדיב.
 *   3b. כל code HTML ב-codeFragments: DOMPurify.sanitize(codeHtml, CODE_ALLOW) — allowlist צר (span+class).
 *   4. החלף sentinels ב-cleanKatex[i] + cleanCode[i] → תוצאה סופית.
 *
 * ── Storage architecture ─────────────────────────────────────────────────────
 * currentMap[i] = כל ה-fragments (KaTeX + code) בסדר גלובלי (לפי סדר הופעה בטקסט).
 * fragmentKinds[i] = "katex" | "code" — מסווג כל index; עמיד לסדר (code-first-then-katex).
 * ⚠️ U+E002 נמחק ע"י DOMPurify — לכן code fragments משתמשים ב-BLOCK_SENTINEL (U+E000).
 *
 * ── Security invariant ──────────────────────────────────────────────────────
 *  `style` מותר רק ב-KATEX_ALLOW כי ה-input הוא KaTeX generated (trust:false).
 *  `class` מותר רק ב-CODE_ALLOW (מסלול hljs) + KATEX_ALLOW — לא ב-MARKDOWN_ALLOW.
 *  MARKDOWN_ALLOW לעולם בלי span/style/class — secure by construction נגד
 *  overlay-phishing מ-prompt-injection (המודל פולט <span style="position:fixed">).
 *  CODE_ALLOW: pre/code/span + class בלבד (ללא style) — hljs פולט class-only, מאומת אמפירית.
 *
 * ── SSR ─────────────────────────────────────────────────────────────────────
 *  DOMPurify דורש DOM. ב-SSR (typeof document === 'undefined') — מדלגים על sanitize.
 *  פלט ה-SSR עובר סריאליזציה של Svelte, לא innerHTML גולמי → בטוח.
 *  katex.renderToString + hljs עובדים ב-node (ללא DOM) — אומת אמפירית.
 */

import DOMPurify from "dompurify"
import { BLOCK_SENTINEL, INLINE_SENTINEL, parseToHtml } from "./markdown-parse"

// ─── Re-export normalizeInvisibles לנוחות הטסטים ────────────────────────────
export { normalizeInvisibles } from "./markdown-parse"

// ─── BIDI block tags — מקבלים dir="auto" דרך ה-DOMPurify hook ──────────────
// pre/code/span מוחרגים בכוונה — קוד נשאר LTR (CSS כופה direction:ltr).
// guard (!node.hasAttribute("dir")) מונע דריסת dir מפורש שהמודל פלט.
const BIDI_BLOCK_TAGS = new Set(["P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH"])

// ─── Allowlists ─────────────────────────────────────────────────────────────

// MARKDOWN_ALLOW: post-tables (chat-render-polish) — ללא span/style/class
// ⚠️ אל תוסיף style — style = vector ל-CSS injection.
// ⚠️ אל תוסיף class — class ב-MARKDOWN נותן כח לעיצוב גולמי מהמודל.
const MARKDOWN_TAGS = [
  "p",
  "br",
  "strong",
  "em",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "a",
  "hr",
  // ─── GFM tables (chat-render-polish) ───
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "colgroup",
  "col",
]
const MARKDOWN_ATTR = ["href", "title", "lang", "dir", "target", "rel", "align"]

// KATEX_ALLOW: KaTeX generated HTML (trust:false) — נדיב: span/style/MathML/SVG.
// כל tag/attr אומת אמפירית מול katex.renderToString (output:htmlAndMathml) על 6 נוסחאות.
const KATEX_TAGS = [
  // ─── HTML wrapper ───
  "span",
  // ─── MathML — core ───
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mn",
  "mo",
  "mtext",
  "mfrac",
  "msup",
  "msub",
  "msubsup",
  "msqrt",
  "mroot",
  "mspace",
  // ─── MathML — common forms (אמות אמפירית ב-r2) ───
  "mtable",
  "mtr",
  "mtd",
  "mstyle",
  "munderover",
  "mover",
  "munder",
  // ─── MathML — binom / xrightarrow (אמות אמפירית ב-r3) ───
  "mpadded",
  // ─── SVG ───
  "svg",
  "path",
  "line",
]
const KATEX_ATTR = [
  // ─── HTML ───
  "class",
  "style",
  "aria-hidden",
  // ─── MathML — core ───
  "encoding",
  "xmlns",
  "display",
  "mathvariant",
  "stretchy",
  "fence",
  "accent",
  "accentunder",
  // ─── MathML — layout (r2) ───
  "rowspacing",
  "columnalign",
  "columnspacing",
  "scriptlevel",
  "displaystyle",
  "mathcolor",
  // ─── MathML — binom/xrightarrow (r3) ───
  "linethickness",
  "lspace",
  "minsize",
  // ─── SVG ───
  "viewBox",
  "d",
  "width",
  "height",
  "preserveAspectRatio",
]

// CODE_ALLOW: hljs generated HTML — צר: pre/code/span + class בלבד.
// ⚠️ אסור style — style = דליפת overlay vector. hljs פולט class-only (אמות אמפירית ב-Commit 0).
const CODE_TAGS = ["pre", "code", "span"]
const CODE_ATTR = ["class"]

// ─── DOMPurify hook (נרשם פעם אחת ברמת מודול) ────────────────────────────────
if (typeof document !== "undefined") {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    // ── קיים (לא נוגעים): <a href> → target/rel ──
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
    // ── חדש (slice-B): block elements → dir="auto" (יישור עצמאי פר-פסקה) ──
    // guard: לא לדרוס dir מפורש שהמודל פלט (dir ב-MARKDOWN_ATTR → שורד sanitize)
    if (BIDI_BLOCK_TAGS.has(node.tagName) && !node.hasAttribute("dir")) {
      node.setAttribute("dir", "auto")
    }
  })
}

/**
 * מרנדר Markdown ל-HTML מחוטא, עם תמיכה ב-KaTeX LaTeX + syntax highlighting.
 * בטוח לשימוש עם {@html} בתוך קומפוננטות Svelte.
 */
export function renderMarkdown(text: string): string {
  if (text.length === 0) return ""

  // Pass 1: parseToHtml → { html, katexFragments, codeFragments, fragmentKinds }
  // fragmentKinds[] מסווג כל global index כ-"katex" או "code" — עמיד לסדר.
  const { html: markdownHtml, katexFragments, codeFragments, fragmentKinds } = parseToHtml(text)

  // SSR path — שחזר fragments לפי global index (לא מחייב DOMPurify)
  if (typeof document === "undefined") {
    // בנה allFragments לפי global index בעזרת fragmentKinds
    let ki = 0
    let ci = 0
    const allFragments = fragmentKinds.map((kind) =>
      kind === "katex" ? (katexFragments[ki++] ?? "") : (codeFragments[ci++] ?? ""),
    )
    return replacePlaceholders(markdownHtml, allFragments)
  }

  // Pass 2: sanitize markdown — ללא span/style/class
  const cleanMarkdown = DOMPurify.sanitize(markdownHtml, {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: MARKDOWN_ATTR,
    ALLOW_DATA_ATTR: false,
  })

  // Pass 3a: sanitize KaTeX fragments
  const cleanKatex = katexFragments.map((katexHtml) =>
    DOMPurify.sanitize(katexHtml, {
      ALLOWED_TAGS: KATEX_TAGS,
      ALLOWED_ATTR: KATEX_ATTR,
      ALLOW_DATA_ATTR: false,
    }),
  )

  // Pass 3b: sanitize code fragments — span+class בלבד (ללא style)
  const cleanCode = codeFragments.map((codeHtml) =>
    DOMPurify.sanitize(codeHtml, {
      ALLOWED_TAGS: CODE_TAGS,
      ALLOWED_ATTR: CODE_ATTR,
      ALLOW_DATA_ATTR: false,
    }),
  )

  // Pass 4: replace sentinels
  // allClean[] נבנה לפי global index בעזרת fragmentKinds — עמיד לסדר (F1 fix).
  // code-first-then-katex ו-katex-first-then-code מיופו נכון לפי sentinel index.
  let ki = 0
  let ci = 0
  const allClean = fragmentKinds.map((kind) =>
    kind === "katex" ? (cleanKatex[ki++] ?? "") : (cleanCode[ci++] ?? ""),
  )
  return replacePlaceholders(cleanMarkdown, allClean)
}

/**
 * מחליף BLOCK_SENTINEL ו-INLINE_SENTINEL ב-fragments לפי index גלובלי.
 * allFragments[i] = fragment עבור index i (KaTeX ו-code ב-index רציף).
 */
function replacePlaceholders(html: string, allFragments: string[]): string {
  // החלפת block sentinels (KaTeX block + code blocks)
  let result = html.replace(
    new RegExp(`${BLOCK_SENTINEL}(\\d+)${BLOCK_SENTINEL}`, "g"),
    (_, idx) => allFragments[Number(idx)] ?? "",
  )
  // החלפת inline sentinels (KaTeX inline)
  result = result.replace(
    new RegExp(`${INLINE_SENTINEL}(\\d+)${INLINE_SENTINEL}`, "g"),
    (_, idx) => allFragments[Number(idx)] ?? "",
  )
  return result
}

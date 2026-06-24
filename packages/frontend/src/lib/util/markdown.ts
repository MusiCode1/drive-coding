/**
 * markdown.ts — renderMarkdown ל-HTML מחוטא, עם רינדור KaTeX (LaTeX math).
 *
 * ── Pipeline (two-pass) ──────────────────────────────────────────────────────
 * renderMarkdown(text):
 *   1. marked.parse(text) — עם extension פנימי (נרשם פעם אחת ברמת מודול):
 *        tokenizer מזהה $$..$$  \[..\]  $.$  \(..\)  (block לפני inline)
 *        renderer קורא katex.renderToString → שומר HTML ב-currentMap → מחזיר placeholder
 *        placeholder = sentinels PUA (U+E000/E001) — שורדים marked+DOMPurify כטקסט.
 *      → markdownHtml עם placeholders (ה-KaTeX HTML עדיין לא נמצא כאן)
 *   2. DOMPurify.sanitize(markdownHtml, MARKDOWN_ALLOW) — allowlist שמרני, ללא span/style.
 *      ה-sentinels = טקסט → שורדים. <span style> גולמי של מודל → נמחק. ← הלב האבטחתי.
 *   3. כל KaTeX HTML ב-currentMap: DOMPurify.sanitize(katexHtml, KATEX_ALLOW) — allowlist נדיב
 *      (span/style/MathML/SVG). כל אחד מסונן בנפרד.
 *   4. החלף sentinels ב-katexClean[i] → תוצאה סופית.
 *
 * ── Security invariant ──────────────────────────────────────────────────────
 *  `style` מותר רק ב-KATEX_ALLOW כי ה-input הוא KaTeX generated (trust:false).
 *  MARKDOWN_ALLOW לעולם בלי span/style — secure by construction נגד
 *  overlay-phishing מ-prompt-injection (המודל פולט <span style="position:fixed">).
 *
 * ── SSR ─────────────────────────────────────────────────────────────────────
 *  DOMPurify דורש DOM. ב-SSR (typeof document === 'undefined') — מדלגים על sanitize.
 *  פלט ה-SSR עובר סריאליזציה של Svelte, לא innerHTML גולמי → בטוח.
 *  katex.renderToString עובד ב-node (ללא DOM) — אומת אמפירית.
 *
 * ── Extension registration ───────────────────────────────────────────────────
 *  marked.use({ extensions }) נרשם פעם אחת ברמת מודול.
 *  currentMap הוא module-level ref ש-renderMarkdown מאפס per-call.
 *  אסור marked.use בתוך renderMarkdown — היה רושם extension מצטבר בכל קריאה.
 */

import DOMPurify from "dompurify"
import katex from "katex"
import { marked } from "marked"

// ─── Allowlists ─────────────────────────────────────────────────────────────

// MARKDOWN_ALLOW: post-tables (chat-render-polish) — ללא span/style
// ⚠️ אל תוסיף style — style = vector ל-CSS injection.
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
// כל tag/attr אומת אמפירית מול katex.renderToString (output:htmlAndMathml) על 6 נוסחאות:
// matrix / binom / xrightarrow / sum / vec / integral.
// אין foreignObject, אין a, אין href/src/xlink:href/on* — KaTeX עם trust:false לא מייצר אותם.
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

// ─── Sentinel (Private-Use Area) ─────────────────────────────────────────────
// U+E000 = block math placeholder prefix, U+E001 = inline math placeholder prefix.
// שורדים marked.parse ו-DOMPurify.sanitize כטקסט. Collision-resistant ולא מתפרשים כ-markdown.
const BLOCK_SENTINEL = ""
const INLINE_SENTINEL = ""

// ─── Module-level KaTeX map ───────────────────────────────────────────────────
// נרשם ברמת מודול, מתאפס בכל קריאה ל-renderMarkdown.
// אסור להזיז את marked.use לתוך renderMarkdown (יירשום extension מצטבר per-call).
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
            text: match[1].trim(),
          }
        }
        return undefined
      },
      renderer(token: { text: string }) {
        return storePlaceholder(renderKatex(token.text, true))
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
            text: match[1].trim(),
          }
        }
        return undefined
      },
      renderer(token: { text: string }) {
        return storePlaceholder(renderKatex(token.text, true))
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
            text: match[1].trim(),
          }
        }
        return undefined
      },
      renderer(token: { text: string }) {
        return storeInlinePlaceholder(renderKatex(token.text, false))
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
            text: match[1].trim(),
          }
        }
        return undefined
      },
      renderer(token: { text: string }) {
        return storeInlinePlaceholder(renderKatex(token.text, false))
      },
    },
  ],
})

// ─── DOMPurify hook (נרשם פעם אחת ברמת מודול) ────────────────────────────────
// כל קישור בתוכן (markdown) נפתח בלשונית חדשה — לחיצה לא מנווטת את ה-SPA מחוץ לשיחה.
// rel="noopener noreferrer": מונע tabnabbing ולא מדליף referrer.
if (typeof document !== "undefined") {
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A" && node.hasAttribute("href")) {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
  })
}

/**
 * מרנדר Markdown ל-HTML מחוטא, עם תמיכה ב-KaTeX LaTeX.
 * בטוח לשימוש עם {@html} בתוך קומפוננטות Svelte.
 *
 * Security: two-pass עם allowlist פר-מקור — span/style קיימים רק במסלול KaTeX,
 * MARKDOWN_ALLOW לעולם בלי span/style. ← מוכח ע"י טסט "strips raw model <span style>".
 */
export function renderMarkdown(text: string): string {
  if (text.length === 0) return ""

  // אפס את ה-map לפני כל קריאה (module-level ref, reset per-call)
  currentMap = []

  // Pass 1: marked.parse + extension פנימי → placeholders במקום KaTeX HTML
  const markdownHtml = marked.parse(text, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string

  // SSR: DOMPurify דורש DOM — דלג בסביבות ללא document
  if (typeof document === "undefined") {
    // ב-SSR — החזר HTML גולמי עם placeholders (יוחלפו ב-KaTeX HTML raw)
    // הסריאליזציה של Svelte מטפלת בזה בבטחה
    const snapshot = [...currentMap]
    return replacePlaceholders(markdownHtml, snapshot)
  }

  // Pass 2: sanitize markdown HTML — ללא span/style (מוחק <span style> גולמי של מודל)
  const cleanMarkdown = DOMPurify.sanitize(markdownHtml, {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: MARKDOWN_ATTR,
    ALLOW_DATA_ATTR: false,
  })

  // Pass 3: sanitize כל KaTeX HTML בנפרד — עם span/style (מסלול מהימן)
  const cleanKatex = currentMap.map((katexHtml) =>
    DOMPurify.sanitize(katexHtml, {
      ALLOWED_TAGS: KATEX_TAGS,
      ALLOWED_ATTR: KATEX_ATTR,
      ALLOW_DATA_ATTR: false,
    }),
  )

  // Pass 4: החלף sentinels ב-KaTeX HTML מסונן
  return replacePlaceholders(cleanMarkdown, cleanKatex)
}

/** מחליף placeholders עם sentinels בפלט KaTeX. */
function replacePlaceholders(html: string, katexClean: string[]): string {
  // החלפת block sentinels
  let result = html.replace(
    new RegExp(`${BLOCK_SENTINEL}(\\d+)${BLOCK_SENTINEL}`, "g"),
    (_, idx) => katexClean[Number(idx)] ?? "",
  )
  // החלפת inline sentinels
  result = result.replace(
    new RegExp(`${INLINE_SENTINEL}(\\d+)${INLINE_SENTINEL}`, "g"),
    (_, idx) => katexClean[Number(idx)] ?? "",
  )
  return result
}

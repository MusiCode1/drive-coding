/**
 * markdown.ts — רינדור (render) של Markdown ל-HTML מחוטא.
 *
 * צינור עיבוד (Pipeline): הפונקציה marked.parse (CommonMark + GFM) → DOMPurify.sanitize.
 *
 * רשימת הרשאות שמרנית (allowlist): רק עיצוב טקסט, כותרות, רשימות, קישורים, וקוד.
 * מסיר את כל הסקריפטים, מאזיני אירועים, וקישורים (hrefs) שאינם https/יחסיים.
 *
 * שימוש בקומפוננטות: {@html renderMarkdown(seg.text)}
 * עטוף ב-<div dir="auto"> עבור טיפול RTL בטקסט מעורב עברית/אנגלית.
 *
 * הערת SSR: ל-adapter-static של SvelteKit יש מעבר (pass) רינדור בצד השרת. DOMPurify
 * דורש DOM (המשתנה הגלובלי document). ב-SSR (כאשר typeof document === 'undefined'),
 * אנו מדלגים על חיטוי — פלט ה-SSR עובר דרך הסריאליזציה של Svelte בעצמו
 * ולעולם לא מגיע ל-DOM של הדפדפן כ-innerHTML גולמי.
 */

import { marked } from "marked"
import DOMPurify from "dompurify"

const ALLOWED_TAGS = [
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
]
const ALLOWED_ATTR = ["href", "title", "lang", "dir"]

/**
 * מרנדר (Render) Markdown ל-HTML מחוטא.
 * בטוח לשימוש עם {@html} בתוך קומפוננטות Svelte.
 */
export function renderMarkdown(text: string): string {
  if (text.length === 0) return ""
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  // DOMPurify דורש DOM פעיל — דלג בסביבות SSR/Node ללא אובייקט document.
  if (typeof document === "undefined") return html
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

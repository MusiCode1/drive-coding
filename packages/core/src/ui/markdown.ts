/**
 * רינדור Markdown → HTML עם סניטיזציה בסיסית.
 *
 * משמש גם ל-live messages וגם ל-history. ה-HTML מוכן לתצוגה ב-{@html}.
 *
 * Port מ-v1: /home/user/projects/voice-acp/backend/src/markdown.ts
 */

import { marked } from "marked"

// קונפיגורציה: GFM (Github Flavored Markdown), שורות חדשות → <br>
marked.setOptions({
  gfm: true,
  breaks: true,
})

// תגיות מסוכנות שצריך להסיר.
// מודל ה-LLM בקושי יוציא אותן, אבל זו רשת ביטחון.
const DANGEROUS_TAGS =
  /<(script|style|iframe|object|embed|form|meta|link|base|noscript)[^>]*>[\s\S]*?<\/\1>/gi
const DANGEROUS_TAGS_SELF =
  /<(script|style|iframe|object|embed|form|meta|link|base|noscript)[^>]*\/?>/gi
const EVENT_ATTRS = /\s(on\w+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_HREFS = /\s(href|src|action)\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi

/**
 * ממיר Markdown ל-HTML מנקה.
 * @param text - הטקסט הגולמי במרקדאון
 * @returns HTML מוכן ל-`{@html ...}` ב-Svelte
 */
export function renderMarkdown(text: string): string {
  if (!text) return ""
  const rawHtml = marked.parse(text, { async: false }) as string
  return rawHtml
    .replace(DANGEROUS_TAGS, "")
    .replace(DANGEROUS_TAGS_SELF, "")
    .replace(EVENT_ATTRS, "")
    .replace(JS_HREFS, "")
}

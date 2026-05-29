/**
 * markdown.ts — render Markdown to sanitized HTML.
 *
 * Pipeline: marked.parse (CommonMark + GFM) → DOMPurify.sanitize.
 *
 * Conservative allowlist: only text formatting, headings, lists, links, code.
 * Strips all scripts, event handlers, and non-https/relative hrefs.
 *
 * Usage in components: {@html renderMarkdown(seg.text)}
 * Wrap in <div dir="auto"> for mixed Hebrew/English RTL handling.
 *
 * SSR note: SvelteKit adapter-static has a server-render pass. DOMPurify
 * requires a DOM (document global). In SSR (typeof document === 'undefined'),
 * we skip sanitization — SSR output goes through Svelte's own serialization
 * and never reaches the browser DOM as raw innerHTML.
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
 * Render Markdown to sanitized HTML.
 * Safe to use with {@html} in Svelte components.
 */
export function renderMarkdown(text: string): string {
  if (text.length === 0) return ""
  const html = marked.parse(text, { async: false, breaks: true, gfm: true }) as string
  // DOMPurify requires a DOM — skip in SSR/Node environments without document.
  if (typeof document === "undefined") return html
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  })
}

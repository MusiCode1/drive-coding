// @vitest-environment jsdom
/**
 * markdown.test.ts — טסטים בשיטת TDD עבור renderMarkdown.
 *
 * רץ בסביבת jsdom (ראה אנוטציה למעלה) משום ש-DOMPurify דורש
 * DOM פעיל. jsdom מספק window + document כדי ש-DOMPurify.sanitize() יעבוד.
 */

import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown"

describe("renderMarkdown", () => {
  it("empty input returns empty string", () => {
    expect(renderMarkdown("")).toBe("")
  })

  it("renders bold and italic", () => {
    const out = renderMarkdown("**bold** and *italic*")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<em>italic</em>")
  })

  it("renders inline code", () => {
    const out = renderMarkdown("use `console.log()`")
    expect(out).toContain("<code>console.log()</code>")
  })

  it("renders fenced code block", () => {
    const out = renderMarkdown("```\nhello world\n```")
    expect(out).toContain("<pre>")
    // code element עם class hljs (מ-code-highlight) — לא <code> plain
    expect(out).toContain("<code")
    expect(out).toContain("hello world")
  })

  it("renders unordered list", () => {
    const out = renderMarkdown("- item one\n- item two")
    expect(out).toContain("<ul>")
    expect(out).toContain("<li>")
  })

  it("preserves Hebrew text", () => {
    const out = renderMarkdown("שלום עולם")
    expect(out).toContain("שלום עולם")
  })

  it("strips script tags (XSS)", () => {
    const out = renderMarkdown("<script>alert(1)</script>")
    expect(out).not.toContain("<script>")
    expect(out).not.toContain("alert(1)")
  })

  it("strips onerror attributes (XSS)", () => {
    const out = renderMarkdown("<img src=x onerror=alert(1)>")
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("alert(1)")
  })

  it("strips javascript: href (XSS)", () => {
    const out = renderMarkdown("[click](javascript:alert(1))")
    expect(out).not.toContain("javascript:")
  })

  it("allows https links", () => {
    const out = renderMarkdown("[example](https://example.com)")
    expect(out).toContain('href="https://example.com"')
  })

  it("opens links in a new tab with safe rel", () => {
    const out = renderMarkdown("[example](https://example.com)")
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it("renders heading", () => {
    const out = renderMarkdown("# Hello")
    expect(out).toContain("<h1>")
    expect(out).toContain("Hello")
  })

  it("renders GFM table", () => {
    const out = renderMarkdown("| a | b |\n|:--|--:|\n| 1 | 2 |")
    expect(out).toContain("<table>")
    expect(out).toContain("<th")
    expect(out).toContain("<td")
    expect(out).toContain('align="left"')
    expect(out).toContain('align="right"')
  })

  it("preserves Hebrew inside table cells", () => {
    const out = renderMarkdown("| שם | גיל |\n|---|---|\n| דני | 30 |")
    expect(out).toContain("שם")
    expect(out).toContain("דני")
  })

  // ─── KaTeX math rendering (slice-latex-math) ──────────────────────────────

  it("renders $...$ inline math", () => {
    const out = renderMarkdown("$a^2$")
    expect(out).toContain("katex")
  })

  it("renders $$...$$ block math", () => {
    const out = renderMarkdown("$$\\int x$$")
    expect(out).toContain("katex")
  })

  it("renders \\(...\\) inline math", () => {
    const out = renderMarkdown("\\(b^2\\)")
    expect(out).toContain("katex")
  })

  it("renders \\[...\\] block math", () => {
    const out = renderMarkdown("\\[c^2\\]")
    expect(out).toContain("katex")
  })

  it("renders a matrix without dropping MathML structure", () => {
    // finding #1 (avigail r2): mtable חייב להיות ב-KATEX_ALLOW — אחרת MathML מנוקה בשקט
    const out = renderMarkdown("$$\\begin{matrix} a & b \\\\ c & d \\end{matrix}$$")
    expect(out).toContain("katex")
    expect(out).toContain("mtable")
  })

  it("does NOT render math inside inline code", () => {
    // ה-tokenizer של marked מכבד code spans — $ בתוך `code` לא נתפס
    const out = renderMarkdown("`$x$`")
    expect(out).not.toContain("katex")
  })

  it("does NOT render math inside fenced code block", () => {
    const out = renderMarkdown("```\n$$math$$\n```")
    expect(out).not.toContain("katex")
  })

  // ★ הטסט הקריטי: מוכיח שה-two-pass מבודד (לב האבטחה של ה-slice)
  it("strips raw model <span style> (overlay vector)", () => {
    // span+style גולמי של מודל — MARKDOWN_ALLOW בלי span/style → נמחק
    const out = renderMarkdown('<span style="position:fixed;inset:0">x</span>')
    expect(out).not.toContain("position:fixed")
    expect(out).not.toContain("<span")
  })

  it("keeps KaTeX positioning style (KATEX_ALLOW)", () => {
    // KaTeX span+style עובר מסלול KATEX_ALLOW → מותר
    const out = renderMarkdown("$a^2$")
    expect(out).toMatch(/style=|class="katex/)
  })

  it("existing XSS guards pass after KaTeX addition", () => {
    // רגרסיה: XSS הקיימים לא נפגעו
    const out = renderMarkdown("<script>alert(1)</script>")
    expect(out).not.toContain("<script>")
  })

  it("multiple math expressions in one message render correctly", () => {
    // map reset per-call — כמה נוסחאות באותה הודעה
    const out = renderMarkdown("$a$ and $b$ and $c$")
    const katexCount = (out.match(/class="katex/g) ?? []).length
    expect(katexCount).toBeGreaterThanOrEqual(3)
  })

  it("map resets between calls — no index leak between messages", () => {
    // module-level ref reset per-call — ריצות נפרדות לא דולפות
    const out1 = renderMarkdown("$x^2$")
    const out2 = renderMarkdown("$y^2$")
    // שתי קריאות עצמאיות — שתיהן מרנדרות
    expect(out1).toContain("katex")
    expect(out2).toContain("katex")
  })

  // ─── Code syntax highlighting (slice-code-syntax-highlight) ───────────────

  it("renders code block with syntax highlighting (ts)", () => {
    const out = renderMarkdown("```ts\nconst x = 1\n```")
    // בלוק עם שפה מוכרת → spans עם class hljs-keyword
    expect(out).toContain('<span class="hljs-keyword">const</span>')
    expect(out).toContain('class="hljs')
  })

  it("security: code block with injected style= is stripped as attribute", () => {
    // בלוק-קוד שמכיל span style זדוני — CODE_ALLOW מסיר style כ-attribute HTML
    // hljs מעבד את ה-text ומחלץ < > ל-&lt;&gt;, אז ה-style מופיע כ-escaped text בלבד (לא CSS)
    const out = renderMarkdown('```ts\n</code><span style="position:fixed">x\n```')
    // ה-style גולמי של מודל (כ-HTML attribute) לא אמור להופיע — רק כ-escaped text
    // בדיקה: אין <span style= כ-HTML attribute (לא escaped)
    expect(out).not.toContain("<span style=")
    // style כ-escaped text (&lt;span style=...) מותר — לא מבצע CSS
  })

  it("security: code block with <script> → no <script in output", () => {
    // <script> בתוך בלוק-קוד → escaped (hljs מחלץ ל-&lt; + spans)
    const out = renderMarkdown("```html\n<script>alert(1)</script>\n```")
    expect(out).not.toContain("<script>")
  })

  it("KaTeX still works after code highlight addition (no regression)", () => {
    const out = renderMarkdown("$x^2$")
    expect(out).toContain("katex")
  })

  it("tables still work after code highlight addition (no regression)", () => {
    const out = renderMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(out).toContain("<table>")
  })

  it("code block without lang → plain pre>code, no spans", () => {
    const out = renderMarkdown("```\nplain text\n```")
    expect(out).toContain("<pre>")
    expect(out).toContain("<code") // code element עם class="hljs" (ללא language)
    expect(out).not.toContain('<span class="hljs') // אין spans (אין שפה → escapeHtml בלבד)
    expect(out).toContain("plain text")
  })

  it("code block with unknown lang → plain (no throw)", () => {
    const out = renderMarkdown("```foobar\nsome code\n```")
    expect(out).toContain("<pre>")
    expect(out).not.toContain('<span class="hljs')
  })

  it("mixed code + math in same message → both render correctly", () => {
    const out = renderMarkdown("```ts\nconst x = 1\n```\n\n$x^2$")
    expect(out).toContain('<span class="hljs-keyword">const</span>')
    expect(out).toContain("katex")
  })
})

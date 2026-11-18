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
    // <li> מקבל dir="auto" מ-slice-B hook — בודקים נוכחות ה-tag בכל צורה
    expect(out).toContain("<li")
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
    // <h1> מקבל dir="auto" מ-slice-B hook — בודקים נוכחות ה-tag בכל צורה
    expect(out).toContain("<h1")
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

  // ─── F1 regression tests: code-first-then-math (calev-heavy finding) ──────

  it("code-before-math: <pre> survives when code block precedes KaTeX (F1 fix)", () => {
    // F1 bug: code block before KaTeX had its <pre><code> stripped by KATEX_ALLOW.
    // Fixed by fragmentKinds[] type-based splitting (order-invariant).
    const out = renderMarkdown("```ts\nconst x = 1\n```\n\n$x^2$")
    // ה-<pre> חייב לשרוד — בלעדיו הקוד מרונדר כ-spans ערומים בלי monospace/padding
    expect(out).toContain("<pre>")
    expect(out).toContain('<span class="hljs-keyword">const</span>')
    expect(out).toContain("katex")
  })

  it("code-before-math: multiple code blocks before KaTeX all get <pre>", () => {
    const out = renderMarkdown("```ts\nconst a = 1\n```\n\n```py\ndef f():\n    pass\n```\n\n$x^2$")
    const preCount = (out.match(/<pre>/g) ?? []).length
    expect(preCount).toBe(2)
    expect(out).toContain("katex")
  })

  it("math-then-code-then-math-then-code: all <pre> survive", () => {
    const out = renderMarkdown("$a$ code:\n\n```ts\nconst x=1\n```\n\n$b$ and:\n\n```py\npass\n```")
    const preCount = (out.match(/<pre>/g) ?? []).length
    expect(preCount).toBe(2)
    const katexCount = (out.match(/class="katex/g) ?? []).length
    expect(katexCount).toBeGreaterThanOrEqual(2)
  })

  // ─── Slice B: dir="auto" פר block-element (TDD) ──────────────────────────────

  it("B-1: paragraph gets dir=auto", () => {
    // פסקה רגילה — <p> חייב לקבל dir="auto"
    const out = renderMarkdown("שלום עולם")
    expect(out).toContain('<p dir="auto">')
  })

  it("B-2: list items get dir=auto", () => {
    // כל <li> חייב לקבל dir="auto"
    const out = renderMarkdown("- פריט\n- item")
    const liWithDir = (out.match(/<li dir="auto">/g) ?? []).length
    expect(liWithDir).toBeGreaterThanOrEqual(2)
  })

  it("B-3: heading gets dir=auto", () => {
    // כותרת <h1> חייבת לקבל dir="auto"
    const out = renderMarkdown("# כותרת")
    expect(out).toContain('<h1 dir="auto">')
  })

  it("B-4: blockquote gets dir=auto", () => {
    // ציטוט <blockquote> חייב לקבל dir="auto"
    const out = renderMarkdown("> ציטוט")
    expect(out).toContain('<blockquote dir="auto">')
  })

  it("B-5: pre and code do NOT get dir=auto", () => {
    // בלוק-קוד — <pre> ו-<code> לא אמורים לקבל dir (קוד נשאר LTR)
    const out = renderMarkdown("```ts\nconst x = 1\n```")
    expect(out).not.toContain('<pre dir=')
    expect(out).not.toContain('<code dir=')
    // ה-<pre> עצמו כן קיים (רגרסיה: לא נשבר)
    expect(out).toContain('<pre>')
  })

  it("B-6: <a> still gets target=_blank (no regression in hook)", () => {
    // הענף ה-<a> הקיים לא נפגע
    const out = renderMarkdown("[link](https://example.com)")
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener noreferrer"')
  })

  it("B-6b: KaTeX still renders after dir hook addition", () => {
    // KaTeX לא מושפע — ה-hook גלובלי אך span/math לא ב-set
    const out = renderMarkdown("$x^2$")
    expect(out).toContain("katex")
  })

  it("B-7: explicit dir attribute is NOT overridden (guard)", () => {
    // guard: dir מפורש מהמודל לא נדרס ע"י dir="auto" האוטומטי
    // MARKDOWN_ATTR כולל "dir" → שורד sanitize, ה-hook לא ידרוס
    const out = renderMarkdown('<p dir="rtl">טקסט RTL מפורש</p>')
    // dir="rtl" חייב לשרוד — לא להיות dir="auto"
    expect(out).toContain('dir="rtl"')
    expect(out).not.toContain('<p dir="auto">')
  })

  // ─── slice msg-media: markdown images (Commit 1) ─────────────────────────────

  it("local absolute image → proxy img with alt", () => {
    const out = renderMarkdown("![alt text](/tmp/p/x.png)")
    expect(out).toContain("<img")
    expect(out).toContain(
      `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
    )
    expect(out).toContain('alt="alt text"')
  })

  it("local relative image with cwd → proxy img", () => {
    const out = renderMarkdown("![a](x.png)", { cwd: "/tmp/p" })
    expect(out).toContain(
      `/api/fs/file?uri=${encodeURIComponent("file:///tmp/p/x.png")}`,
    )
  })

  it("local relative image without cwd → source text, no img", () => {
    const out = renderMarkdown("![a](x.png)")
    expect(out).not.toContain("<img")
    expect(out).toContain("![a](x.png)")
  })

  it("remote https image → no img, no evil src", () => {
    const out = renderMarkdown("![a](https://evil.example/x.png?d=1)")
    expect(out).not.toContain("<img")
    expect(out).not.toMatch(/src\s*=\s*["'][^"']*evil/)
  })

  it("raw model img https → stripped (raw door closed)", () => {
    const out = renderMarkdown('<img src="https://evil.example/beacon.png">')
    expect(out).not.toContain("<img")
  })

  it("raw model img local → stripped even with cwd", () => {
    const out = renderMarkdown('<img src="out.png">', { cwd: "/tmp/p" })
    expect(out).not.toContain("<img")
  })

  it("data:image/png → img with data src", () => {
    const out = renderMarkdown("![a](data:image/png;base64,iVBORw0KGgo=)")
    expect(out).toContain("<img")
    expect(out).toContain("data:image/png")
  })

  it("data:text/html → no img", () => {
    const out = renderMarkdown("![a](data:text/html;base64,PHN2Zz4=)")
    expect(out).not.toContain("<img")
  })

  it("protocol-relative //host → no img, no evil in src", () => {
    const out = renderMarkdown("![a](//evil.example/x.png)", { cwd: "/t" })
    expect(out).not.toContain("<img")
    expect(out).not.toMatch(/src\s*=\s*["'][^"']*evil/)
  })

  it("image + code block + inline math → all three render", () => {
    const out = renderMarkdown(
      "![img](/tmp/p/x.png)\n\n```ts\nconst z = 1\n```\n\n$q$",
      { cwd: "/tmp/p" },
    )
    expect(out).toContain("<img")
    expect(out).toContain("<pre>")
    expect(out).toContain("katex")
  })

  it("image inside inline code stays as code text", () => {
    const out = renderMarkdown("`![c](c.png)`")
    expect(out).toContain("<code>![c](c.png)</code>")
    expect(out).not.toContain('<img src=')
  })
})

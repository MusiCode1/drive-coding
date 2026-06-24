// @vitest-environment jsdom
/**
 * markdown.test.ts — טסטים בשיטת TDD עבור renderMarkdown.
 *
 * רץ בסביבת jsdom (ראה אנוטציה למעלה) משום ש-DOMPurify דורש
 * DOM פעיל. jsdom מספק window + document כדי ש-DOMPurify.sanitize() יעבוד.
 */

import { describe, it, expect } from "vitest"
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
    expect(out).toContain("<code>")
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
    const out = renderMarkdown('<script>alert(1)</script>')
    expect(out).not.toContain("<script>")
    expect(out).not.toContain("alert(1)")
  })

  it("strips onerror attributes (XSS)", () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toContain("onerror")
    expect(out).not.toContain("alert(1)")
  })

  it("strips javascript: href (XSS)", () => {
    const out = renderMarkdown('[click](javascript:alert(1))')
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
})

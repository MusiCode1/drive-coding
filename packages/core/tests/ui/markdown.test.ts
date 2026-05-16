/**
 * Tests for `renderMarkdown` — Markdown→HTML conversion + sanitization.
 *
 * Pure function — no mocks needed.
 *
 * Behaviors documented in `docs/behaviors.md` (MARKDOWN-1..MARKDOWN-8).
 */

import { describe, expect, test } from "vitest"
import { renderMarkdown } from "../../src/ui/markdown.js"

describe("renderMarkdown — basic markdown rendering", () => {
  test("empty string → empty string — MARKDOWN-2", () => {
    expect(renderMarkdown("")).toBe("")
  })

  test("plain text → wrapped in <p>", () => {
    const html = renderMarkdown("hello")
    expect(html).toContain("<p>hello</p>")
  })

  test("GFM features: tables work — MARKDOWN-1", () => {
    const md = "| A | B |\n|---|---|\n| 1 | 2 |"
    const html = renderMarkdown(md)
    expect(html).toContain("<table>")
    expect(html).toContain("<th>A</th>")
    expect(html).toContain("<td>1</td>")
  })

  test("breaks=true: single newline → <br>", () => {
    const html = renderMarkdown("line one\nline two")
    expect(html).toContain("<br")
  })

  test("bold + italic", () => {
    const html = renderMarkdown("**bold** and *italic*")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("<em>italic</em>")
  })

  test("Hebrew text passes through", () => {
    const html = renderMarkdown("שלום עולם")
    expect(html).toContain("שלום עולם")
  })
})

describe("renderMarkdown — sanitization: paired dangerous tags (MARKDOWN-3)", () => {
  test("script tag removed", () => {
    const html = renderMarkdown("before <script>alert('xss')</script> after")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert")
  })

  test("style tag removed (block content included)", () => {
    const html = renderMarkdown("<style>body{color:red}</style>after")
    expect(html).not.toContain("<style")
    expect(html).not.toContain("color:red")
  })

  test("iframe tag removed", () => {
    const html = renderMarkdown("<iframe src='http://evil.com'>fallback</iframe>")
    expect(html).not.toContain("<iframe")
    expect(html).not.toContain("evil.com")
  })

  test("object/embed/form/noscript removed", () => {
    for (const tag of ["object", "embed", "form", "noscript"]) {
      const html = renderMarkdown(`<${tag} foo='bar'>x</${tag}>after`)
      expect(html).not.toContain(`<${tag}`)
    }
  })

  test("paired tag detection is case-insensitive", () => {
    const html = renderMarkdown("<SCRIPT>x</SCRIPT>")
    expect(html.toLowerCase()).not.toContain("<script")
  })

  test("paired tag with attributes still removed", () => {
    const html = renderMarkdown(`<script type="text/javascript" defer>alert(1)</script>`)
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert(1)")
  })

  test("multiline paired tag content removed — [\\s\\S]*?", () => {
    const html = renderMarkdown("<script>\nlet x = 1;\nalert(x);\n</script>")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert")
  })
})

describe("renderMarkdown — sanitization: self-closing dangerous tags (MARKDOWN-4)", () => {
  test("self-closing iframe removed", () => {
    const html = renderMarkdown("<iframe src='evil' />")
    expect(html).not.toContain("<iframe")
  })

  test("meta refresh removed", () => {
    const html = renderMarkdown(`<meta http-equiv="refresh" content="0; url=evil.com">`)
    expect(html).not.toContain("<meta")
  })

  test("link tag removed", () => {
    const html = renderMarkdown(`<link rel="stylesheet" href="evil.css">`)
    expect(html).not.toContain("<link")
  })

  test("base tag removed", () => {
    const html = renderMarkdown(`<base href="http://evil.com/">`)
    expect(html).not.toContain("<base")
  })
})

describe("renderMarkdown — sanitization: event attributes (MARKDOWN-5)", () => {
  test("onclick removed from a tag", () => {
    const html = renderMarkdown(`<a href="x" onclick="evil()">click</a>`)
    expect(html).not.toContain("onclick")
    expect(html).not.toContain("evil()")
    // The <a> tag itself is preserved (only the attr is removed)
    expect(html).toContain("<a")
  })

  test("onerror on img removed", () => {
    const html = renderMarkdown(`<img src="x" onerror="alert(1)">`)
    expect(html).not.toContain("onerror")
    expect(html).not.toContain("alert(1)")
  })

  test("onmouseover with single quotes removed", () => {
    const html = renderMarkdown(`<div onmouseover='evil()'>x</div>`)
    expect(html).not.toContain("onmouseover")
  })

  test("on* attribute without quotes removed", () => {
    const html = renderMarkdown(`<a onclick=evil>x</a>`)
    expect(html).not.toContain("onclick")
  })

  test("case-insensitive — ONCLICK removed", () => {
    const html = renderMarkdown(`<a ONCLICK="x">link</a>`)
    expect(html.toLowerCase()).not.toContain("onclick")
  })
})

describe("renderMarkdown — sanitization: javascript: URLs (MARKDOWN-6)", () => {
  test("href=javascript: removed", () => {
    const html = renderMarkdown(`<a href="javascript:alert(1)">click</a>`)
    expect(html).not.toContain("javascript:")
  })

  test("src=javascript: removed", () => {
    const html = renderMarkdown(`<img src="javascript:alert(1)">`)
    expect(html).not.toContain("javascript:")
  })

  test("action=javascript: removed", () => {
    const html = renderMarkdown(`<a action="javascript:evil()">x</a>`)
    expect(html).not.toContain("javascript:")
  })

  test("safe http hrefs preserved", () => {
    const html = renderMarkdown(`<a href="https://example.com">link</a>`)
    expect(html).toContain("https://example.com")
  })
})

describe("renderMarkdown — combined / edge cases", () => {
  test("normal markdown with embedded XSS attempt → markdown preserved, script removed", () => {
    const html = renderMarkdown(
      "# Heading\n\nSome **bold** text.\n\n<script>alert(1)</script>\n\nMore text.",
    )
    expect(html).toContain("<h1")
    expect(html).toContain("<strong>bold</strong>")
    expect(html).toContain("More text")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("alert")
  })

  test("multiple dangerous tags in one document", () => {
    const html = renderMarkdown(`<script>a</script><style>b</style><iframe>c</iframe>safe`)
    expect(html).not.toContain("<script")
    expect(html).not.toContain("<style")
    expect(html).not.toContain("<iframe")
    expect(html).toContain("safe")
  })

  test("Hebrew text with bold and link is sanitized correctly", () => {
    const html = renderMarkdown(
      `**הדגשה** ו-[קישור](https://example.com) וגם <script>evil</script>`,
    )
    expect(html).toContain("הדגשה")
    expect(html).toContain("https://example.com")
    expect(html).not.toContain("<script")
    expect(html).not.toContain("evil")
  })
})

// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { renderMarkdown } from "$lib/util/markdown"
import { joinSegmentText, visibleThoughtSegments } from "./bubble-rendering"

describe("bubble rendering", () => {
  it("renders markdown across streaming message segments", () => {
    const html = renderMarkdown(
      joinSegmentText([
        { id: "s1", text: "# Hello\n\n- **bold" },
        { id: "s2", text: " item**\n\n```python\nprint('hi')\n```" },
      ]),
    )
    document.body.innerHTML = html

    expect(document.querySelector("h1")?.textContent).toBe("Hello")
    expect(document.querySelector("li strong")?.textContent).toBe("bold item")
    expect(document.querySelector("pre code")?.textContent).toContain("print('hi')")
  })

  it("hides untranslated thought leftovers after translated sentences arrive", () => {
    const segments = visibleThoughtSegments([
      { id: "s1", text: "translated output", originalText: "source sentence" },
      { id: "s2", text: " raw" },
      { id: "s3", text: " leftovers" },
    ])
    document.body.textContent = segments.map((seg) => `${seg.text} ${seg.originalText ?? ""}`).join(" ")

    expect(document.body.textContent).toContain("translated output")
    expect(document.body.textContent).toContain("source sentence")
    expect(document.body.textContent).not.toContain("raw leftovers")
  })
})

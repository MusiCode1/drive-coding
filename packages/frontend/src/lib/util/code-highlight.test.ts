// @vitest-environment node
/**
 * code-highlight.test.ts — TDD עבור highlightCode.
 *
 * סביבה: node (לא jsdom) — hljs סינכרוני ורץ ב-node.
 * הטסטים מאמתים אמפירית:
 * 1. פלט hljs מכיל class= ולא style= (ליבת האבטחה)
 * 2. שפה מוכרת → spans עם class hljs-*
 * 3. שפה לא-מוכרת → plain escaped, ללא throw
 * 4. lang חסר → plain escaped
 * 5. קוד עם < > & → escaped (אין HTML-injection)
 * 6. <script> בקוד → escaped, לא עובר
 */

import { describe, expect, it } from "vitest"
import { highlightCode } from "./code-highlight"

describe("highlightCode", () => {
  it("typescript: מכיל span עם class hljs-keyword", () => {
    const out = highlightCode("const x = 1", "typescript")
    expect(out).toContain('<span class="hljs-keyword">const</span>')
  })

  it("אבטחה: פלט מכיל class= אבל לא style=", () => {
    const out = highlightCode("const x = 1", "typescript")
    expect(out).toContain("class=")
    expect(out).not.toContain("style=")
  })

  it("שפה לא-מוכרת: plain escaped, ללא span, ללא throw", () => {
    const out = highlightCode("some code", "brainfuck")
    expect(out).not.toContain("<span")
    expect(out).toContain("some code")
  })

  it("lang חסר (undefined): plain escaped, ללא span", () => {
    const out = highlightCode("plain text", undefined)
    expect(out).not.toContain("<span")
    expect(out).toContain("plain text")
  })

  it("< > & → escaped (אין HTML-injection מהקוד עצמו)", () => {
    const out = highlightCode("a < b && c > d", "javascript")
    expect(out).toContain("&lt;")
    expect(out).toContain("&gt;")
    expect(out).toContain("&amp;")
    expect(out).not.toContain(" < ")
    expect(out).not.toContain(" > ")
  })

  it("<script> בקוד → escaped (לא מריץ JS)", () => {
    // hljs מקודד <script> כ-spans של tag+name — אין <script> גולמי בפלט
    const out = highlightCode("<script>alert(1)</script>", "html")
    expect(out).not.toContain("<script>")
    // hljs עוטף ב-span.hljs-tag + span.hljs-name, ה-< עצמו מחלץ ל-&lt;
    expect(out).toContain("&lt;")
  })

  it("python: מכיל span עם class", () => {
    const out = highlightCode("def foo(): pass", "python")
    expect(out).toContain('<span class="hljs-keyword">def</span>')
  })

  it("json: מכיל span עם class hljs-attr", () => {
    const out = highlightCode('{"key": "value"}', "json")
    expect(out).toContain("hljs-attr")
  })

  it("lang ריק ('') → plain escaped, ללא span", () => {
    const out = highlightCode("no lang", "")
    expect(out).not.toContain("<span")
    expect(out).toContain("no lang")
  })
})

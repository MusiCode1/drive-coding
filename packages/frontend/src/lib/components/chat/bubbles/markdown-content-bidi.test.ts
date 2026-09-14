/**
 * markdown-content-bidi.test.ts — CSS gates for mixed RTL+LTR in bubbles.
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MarkdownContent.svelte"), "utf-8")

describe("MarkdownContent — mixed RTL+LTR (user bubble bidi)", () => {
  it("isolates inline code like file-link (Hebrew around backticks)", () => {
    expect(src).toMatch(/:global\(code\)[\s\S]*unicode-bidi:\s*isolate/)
    expect(src).toMatch(/:global\(\.file-link\)[\s\S]*unicode-bidi:\s*isolate/)
  })

  it("does not apply isolate to pre blocks only via the shared code rule", () => {
    expect(src).toMatch(/:global\(pre\)\s*\{[^}]*direction:\s*ltr/)
    const codeBlock = src.match(/:global\(code\)\s*\{[^}]+\}/)?.[0] ?? ""
    expect(codeBlock).toContain("unicode-bidi: isolate")
  })

  it("uses plaintext bidi on markdown block tags with per-paragraph dir", () => {
    expect(src).toMatch(/:global\(p\)[\s\S]*unicode-bidi:\s*plaintext/)
    expect(src).toMatch(/:global\(li\)[\s\S]*unicode-bidi:\s*plaintext/)
  })
})

// @vitest-environment jsdom
/**
 * markdown-bidi.test.ts — failing tests עבור slice-latex-math-bidi-fix.
 *
 * Commit 0 (TDD — RED): מתעד את ההתנהגות הרצויה לפני שנוסיף normalizeInvisibles (בוצע ב-slice-latex-math-bidi-fix).
 * RLM/LRM בתחילת שורה מונע זיהוי block markers ע"י marked (^ עוגן).
 * math markers ($$) כבר מרונדרים אך RLM דולף לנוסחה → unknownSymbol ב-KaTeX.
 */

import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown"

const RLM = "‏" // Right-to-Left Mark

describe("renderMarkdown — bidi normalization at line start", () => {
  it("RLM before table → <table> renders", () =>
    expect(renderMarkdown(`${RLM}| a | b |\n|---|---|\n| 1 | 2 |`)).toContain("<table"))

  it("RLM before heading → <h1>", () =>
    expect(renderMarkdown(`${RLM}# כותרת`)).toContain("<h1"))

  it("RLM before list → <ul>", () =>
    expect(renderMarkdown(`${RLM}- פריט`)).toContain("<li"))

  it("RLM before blockquote → <blockquote>", () =>
    expect(renderMarkdown(`${RLM}> ציטוט`)).toContain("<blockquote"))

  it("RLM before $$ → katex (no unknownSymbol)", () => {
    const out = renderMarkdown(`${RLM}$$\\int x$$`)
    expect(out).toContain("katex")
    expect(out).not.toContain("‏") // ה-RLM נמחק, לא דלף לנוסחה
  })

  it("RLM kept in plain paragraph (not stripped)", () =>
    expect(renderMarkdown(`${RLM}שלום עולם`)).toContain("‏"))

  it("RLM mid-text untouched", () =>
    expect(renderMarkdown(`שלום ${RLM}עולם`)).toContain("‏"))

  it("heading starting Latin keeps RTL via pushed RLM", () => {
    // RLM נדחף לתוך תוכן ה-h2 → first-strong = RLM
    const out = renderMarkdown(`${RLM}## ChatGPT הוא כלי`)
    expect(out).toMatch(/<h2[^>]*>‏/)
  })
})

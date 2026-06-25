// @vitest-environment jsdom
/**
 * markdown-invisibles.test.ts — full invisibles matrix (slice-latex-math-invisibles).
 *
 * Commit 0 (TDD — RED): מתעד את ההתנהגות הרצויה לפני normalizeInvisibles.
 * כל אחד מהטסטים כאן אמור להיכשל עד Commit 1 שמוסיף את המימוש.
 */

import { describe, expect, it } from "vitest"
import { renderMarkdown } from "./markdown"
import { normalizeInvisibles } from "./markdown-parse"

const R = "‏" // RLM — Right-to-Left Mark
const L = "‎" // LRM — Left-to-Right Mark
const Z = "​" // ZWSP — Zero Width Space
const N = " " // NBSP — Non-Breaking Space

describe("renderMarkdown — full invisibles matrix (normalizeInvisibles)", () => {
  // ── separator (תסמין החי) ──────────────────────────────────────────────────
  it("RLM after | in separator → table", () =>
    expect(renderMarkdown(`| a | b |\n|${R}---|---|\n| 1 | 2 |`)).toContain("<table"))

  it("model-real: RLM in every cell+separator → table", () =>
    expect(
      renderMarkdown(`| ${R}a | ${R}b |\n|${R}---|${R}---|\n| ${R}x | ${R}y |`),
    ).toContain("<table"))

  // ── משפחת התווים (range, לא רק RLM) ─────────────────────────────────────
  it("LRM before heading → h1", () =>
    expect(renderMarkdown(`${L}# כ`)).toContain("<h1"))

  it("ZWSP before list → li", () =>
    expect(renderMarkdown(`${Z}- פ`)).toContain("<li"))

  it("NBSP after # → h1", () =>
    expect(renderMarkdown(`#${N}כ`)).toContain("<h1"))

  // ── math: range delete (before + inside, both markers) ───────────────────
  it("RLM before \\[ → katex, no RLM leak", () => {
    const o = renderMarkdown(`${R}\\[x\\]`)
    expect(o).toContain("katex")
    expect(o).not.toContain(R)
  })

  it("RLM inside $$ → katex, no RLM leak", () => {
    const o = renderMarkdown(`$$${R}x$$`)
    expect(o).toContain("katex")
    expect(o).not.toContain(R)
  })

  // ── markers נוספים ───────────────────────────────────────────────────────
  it("ordered list + RLM → ol", () =>
    expect(renderMarkdown(`${R}1. פ`)).toContain("<ol"))

  it("nested quote + RLM → blockquote", () =>
    expect(renderMarkdown(`${R}> > צ`)).toContain("<blockquote"))

  // ── שמירה בתוכן (regression guard — אסור למחוק) ─────────────────────────
  it("RLM kept in plain text", () =>
    expect(renderMarkdown(`${R}שלום עולם`)).toContain(R))

  it("RLM kept mid-text", () =>
    expect(renderMarkdown(`a ${R}b`)).toContain(R))

  // ── finding #2 regression guard: מחיר עם invis בין $..$  NOT math ───────
  it("invis between prices ($5..$10) is NOT stripped", () =>
    expect(renderMarkdown(`costs $5 ${R}x $10 today`)).toContain(R))

  it("heading starting Latin keeps RTL via relocated RLM", () =>
    expect(renderMarkdown(`${R}## ChatGPT`)).toMatch(/<h2[^>]*>‏ChatGPT/))

  // ── unit test ישיר על הפונקציה הטהורה ───────────────────────────────────
  it("normalizeInvisibles strips separator invis but keeps content", () => {
    const out = normalizeInvisibles(`| a |\n|${R}---|\nplain ${R}text`)
    expect(out).not.toMatch(/\|‏---/) // separator נוקה
    expect(out).toContain(`plain ‏text`) // תוכן נשמר
  })
})

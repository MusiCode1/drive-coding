---
project: "drive-coding"
slice: "slice-latex-math-invisibles"
verifier: "calev"
date: "2026-06-25"
mode: "light"
verdict: "GO"
dod_items:
  - "separator with RLM after | renders as table"
  - "model-real (RLM in every cell+separator) renders as table"
  - "full char family (RLM/LRM/ZWSP/NBSP) works with markers"
  - "math (before+inside, $$+\\[) renders katex, zero invis leak"
  - "ordered/nested markers work"
  - "invis in content/mid-text preserved (regression guard)"
  - "heading Latin keeps RTL via relocated RLM"
  - "unit test on normalizeInvisibles directly"
  - "63+ existing tests green + new matrix"
  - "typecheck clean"
  - "live: tables+math render in browser pipeline"
spot_check: "renderMarkdown pipeline tested live with jsdom — 7/7 cases pass"
findings: []
---

# slice-latex-math-invisibles — Verification Report (Light)

> **תאריך:** 2026-06-25
> **Tier:** light
> **Commit:** 05cb8f9

## TL;DR

| מדד | תוצאה |
|------|--------|
| DoD items עוברים | 11/11 |
| Happy path עובד | ✅ |
| Bugs חדשים | 0 |

## DoD items

| # | Item | סטטוס | Evidence |
|---|------|--------|----------|
| 1 | separator עם RLM אחרי `\|` → טבלה | ✅ | `vitest run` — test "RLM after | in separator → table" pass |
| 2 | model-real (RLM בכל תא+separator) → טבלה | ✅ | test "model-real: RLM in every cell+separator → table" pass |
| 3 | כל משפחת התווים (RLM/LRM/ZWSP/NBSP) → marker עובד | ✅ | 5 טסטים: LRM→h1, ZWSP→li, NBSP→h1, ordered→ol, nested→blockquote — כולם pass |
| 4 | math (before+inside, `$$`+`\[`) → katex, אפס דליפת invis | ✅ | "RLM before \\[ → katex, no RLM leak" + "RLM inside $$ → katex, no RLM leak" — pass |
| 5 | ordered/nested markers → עובדים | ✅ | "ordered list + RLM → ol" + "nested quote + RLM → blockquote" — pass |
| 6 | invis בתוכן/אמצע — נשמר (regression guard) | ✅ | "RLM kept in plain text" + "RLM kept mid-text" + "invis between prices ($5..$10) is NOT stripped" — pass |
| 7 | heading Latin → RTL (RLM נדחף) | ✅ | "heading starting Latin keeps RTL via relocated RLM" — match `/<h2[^>]*>‏ChatGPT/` pass |
| 8 | unit test ישיר על normalizeInvisibles | ✅ | "normalizeInvisibles strips separator invis but keeps content" — pass |
| 9 | 63 קיימים ירוקים + isolation "strips raw model" | ✅ | `npx vitest run src/lib/util/` → 7 files, **77 tests passed** |
| 10 | typecheck נקי | ✅ | `pnpm --filter @drive-coding/frontend-v2 typecheck` → 0 errors, 0 warnings |
| 11 | אימות חי: טבלאות+נוסחאות מרונדרות בדפדפן | ✅ | `renderMarkdown` pipeline עם jsdom: 7/7 cases pass (table×2, katex×2, RLM-leak×2, heading-RTL) |

## Happy path

שליחת 3 inputs דרך `renderMarkdown` pipeline (jsdom = DOM אמיתי, DOMPurify פועל):

1. טבלה עם RLM בספרטור → `<table>` ✅
2. נוסחת `$$x^2$$` → `katex` class ✅
3. `‏## ChatGPT` → `<h2>‏ChatGPT` (RLM אחרי marker) ✅

✅ Happy path עבד — pipeline שלם (normalizeInvisibles → marked → DOMPurify → replacePlaceholders).

## פרטים נוספים שנבדקו

- **מחיקת `normalizeLineLeadingBidi`**: `grep -rn normalizeLineLeadingBidi packages/frontend/src` → 0 תוצאות (כולל re-export ב-`markdown.ts:41` שעודכן ל-`normalizeInvisibles`).
- **Re-export תקין**: `markdown.ts` מייצא `normalizeInvisibles` (לא הפונקציה הישנה).
- **Typecheck עם verbatimModuleSyntax**: 0 errors — finding #1 של ה-brief (re-export blocker) תוקן.
- **77 טסטים** (63 קיימים + 14 חדשים ממטריצת invisibles) — כולם pass.

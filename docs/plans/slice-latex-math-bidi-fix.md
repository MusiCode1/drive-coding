# Slice latex-math-bidi-fix — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: הושלם — אליעזר (2026-06-25, 3 commits: 9de7869, 91daefd, 2882006)
> **Complexity**: 5/10 (verifier: light)
> **תלות (depends_on)**: `slice-latex-math` (לא מוזג). **base = branch `slice-latex-math`** (שרשור), לא dev. ה-commits נכנסים לאותו branch.

---

## §0 — Pre-flight

### Worktree
ה-worktree כבר קיים — אנחנו עובדים בתוכו:
```bash
cd /home/user/projects/drive-coding/.worktrees/slice-latex-math
# כבר על branch slice-latex-math, pnpm install בוצע
```

### Run / Tests
- Tests: `npx vitest run src/lib/util/` (מתוך `packages/frontend/`)
- בדיקת קובץ בודד: `npx vitest run src/lib/util/markdown.test.ts`
- typecheck: `pnpm --filter @drive-coding/frontend-v2 typecheck` (⚠️ שם החבילה הוא `-v2` — `@drive-coding/frontend` מחזיר "No projects matched" + exit 0 = typecheck פאנטום)

### Reading list
**must-read**:
- `packages/frontend/src/lib/util/markdown.ts` — ה-pipeline הקיים (renderMarkdown, two-pass, 4 extensions, currentMap).
- `packages/frontend/src/lib/util/markdown.test.ts` — 26 הטסטים הקיימים (jsdom). תוסיף, אל תשבור.
- `docs/plans/slice-latex-math.md` §3 — ה-two-pass architecture (לא משתנה).

---

## §1 — מטרה

נוסחאות LaTeX וטבלאות Markdown מרונדרות נכון **גם כשהמודל או המשתמש מזריק תווי כיווניות (bidi-control: RLM/LRM) בתחילת שורה** — תרחיש ליבה באפליקציה עברית. כיום RLM בתחילת שורה חוסם את ה-block-tokenizer של `marked` שעוגן ל-`^`: `^#` (כותרת), `^|` (טבלה), `^>` (ציטוט), `^-`/`^*` (רשימה) → הם נשארים raw. **הערה (finding #3)**: ה-math markers `$$`/`\[` דווקא *כבר* מרונדרים עם RLM מקדים (ה-`start()` של ה-extension = `indexOf`, לא עוגן ל-`^`), אבל ה-RLM **דולף לתוך נוסחת ה-LaTeX** → `unknownSymbol` ב-KaTeX. לכן: block-markers נשברים (צריך נרמול), math-markers עובדים אך מתלכלכים (צריך מחיקת RLM). בנוסף, ה-pipeline מתפצל ל-`markdown-parse.ts` (טהור, בר-בדיקה ללא DOM) + `markdown.ts` (עוטף-סניטיזציה), ללא שינוי ב-export הציבורי `renderMarkdown` ובאבטחה.

---

## §2 — Scope

| פיצ'ר | כן/לא | הערה |
|------|------|------|
| נרמול bidi-marks בתחילת שורה (heuristic היברידי) | ✅ | לב ה-slice |
| פיצול `markdown-parse.ts` / `markdown.ts` | ✅ | refactor, אחרי התיקון |
| שינוי ה-two-pass / allowlists / KaTeX | ❌ | תקין — לא נוגעים |
| הסרת RLM מאמצע שורה / מטקסט רגיל | ❌ | RLM שם ניטרלי ומועיל — לא נוגעים |
| העברת קוד ל-`core` | ❌ | DOMPurify דורש DOM; נשאר ב-FE |
| נרמול ב-`joinSegmentText` / ב-bubbles | ❌ | הנרמול חי בשכבת ה-parse בלבד |

---

## §3 — Architecture

```
markdown.ts  (export ציבורי יחיד: renderMarkdown)
  └─ קורא →  markdown-parse.ts  (חדש — טהור, בלי DOMPurify, בר-בדיקה ב-environment:node)
                 1. normalizeLineLeadingBidi(text)   ← חדש (לב התיקון)
                 2. marked.parse(...) עם 4 ה-extensions + currentMap → { html, katexFragments }
  └─ DOMPurify two-pass (MARKDOWN_ALLOW / KATEX_ALLOW) + replace sentinels   ← נשאר ב-markdown.ts
```

> הפיצול הוא **internal module boundary בתוך FE** — לא API חוצה-package. ה-export הציבורי היחיד נשאר `renderMarkdown`. אסור לחשוף פונקציה שמחזירה HTML לא-מסונן ככניסה ציבורית.

### היוריסטיקת הנרמול (היברידי — אושר ע"י המשתמשת)

לכל שורה שמתחילה ברצף bidi-control (`[‎‏‪-‮⁦-⁩]+`):

| אחרי ה-bidi-marks בא… | פעולה | סיבה |
|----------------------|-------|------|
| math marker (`$$` או `\[`) | **מחק** את ה-bidi-marks | נוסחה היא LTR; RLM בתוך LaTeX = `unknownSymbol` ב-KaTeX (אומת אמפירית) |
| block marker אחר (`#`/`>`/`-`/`*`/`+`/`\|`/ספרה+`.`/`)`) | **דחוף** את ה-bidi-marks אל אחרי ה-marker (כולל הרווח) | marked מזהה את ה-block, וה-RLM נוחת בתחילת התוכן → `dir="auto"` בוחר RTL נכון (אומת אמפירית) |
| אות/ספרה (טקסט רגיל) | **השאר** | RLM שם ניטרלי/מועיל — לא נוגעים |

---

## §4 — Commits

### Commit 0 — failing tests: bidi at line start (approach: TDD)

**קובץ חדש**: `packages/frontend/src/lib/util/markdown-bidi.test.ts` (`// @vitest-environment jsdom`).
טסטים שמתעדים את ההתנהגות הרצויה (נכשלים לפני התיקון):

```ts
const RLM = "‏"
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
  expect(out).not.toContain("‏")   // ה-RLM נמחק, לא דלף לנוסחה
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
```

**Verification**: `npx vitest run src/lib/util/markdown-bidi.test.ts` — אדום (מתעד את הבאג).

### Commit 1 — normalizeLineLeadingBidi + חיווט (approach: TDD)

**שינוי `markdown.ts`** (עדיין בלי פיצול — תיקון תחילה): הוסף פונקציה טהורה והפעל אותה ב-`renderMarkdown` **לפני** `marked.parse`.

**API skeleton**:
```ts
// טהור. מנרמל רק bidi-control בתחילת שורה לפי הטבלה ב-§3.
// לא נוגע ב-bidi באמצע שורה או לפני טקסט.
export function normalizeLineLeadingBidi(text: string): string
```

הצעת מימוש (אליעזר מותר לכוונן כדי שכל טסטי Commit 0 + 26 הקיימים יעברו):
- `const BIDI = "‎‏‪-‮⁦-⁩"`
- math: `text.replace(new RegExp(`^[${BIDI}]+(?=\\$\\$|\\\\\\[)`, "gmu"), "")`
- push: `text.replace(new RegExp(`^([${BIDI}]+)(#{1,6} |>+ |[-*+] |\\d+[.)] |\\| ?)`, "gmu"), "$2$1")`
- ⚠️ סדר: math-delete לפני push. ⚠️ flag `m` (multiline `^`) + `u`.

**Verification**: `npx vitest run src/lib/util/` — כל הטסטים ירוקים (26 קיימים + Commit 0). הבאג מתוקן.

### Commit 2 — refactor: split markdown-parse.ts (approach: manual, pure refactor)

**קובץ חדש**: `packages/frontend/src/lib/util/markdown-parse.ts` — מעביר אליו: `normalizeLineLeadingBidi`, ה-`marked.use({extensions})`, ה-tokenizers/renderers, ה-`currentMap` (state פנימי שמתאפס per-call), ה-`storePlaceholder`/`storeInlinePlaceholder` שכותבים ל-`currentMap`, ופונקציה:
```ts
// טהור (ללא DOMPurify) — בר-בדיקה ב-environment:node.
// מאפס currentMap, מנרמל bidi, מריץ marked.parse, ומחזיר snapshot של currentMap כ-katexFragments.
export function parseToHtml(text: string): { html: string; katexFragments: string[] }
```

**⚠️ חלוקת בעלות מפורשת (finding #2 — אביגיל)**:
- **עובר ל-`markdown-parse.ts`**: `currentMap`, `storePlaceholder`/`storeInlinePlaceholder`, ה-extensions, `normalizeLineLeadingBidi`. ה-`katexFragments` המוחזר = snapshot של `currentMap` (לא ה-ref עצמו — `[...currentMap]`).
- **נשאר ב-`markdown.ts`**: `renderMarkdown`, ה-DOMPurify two-pass (MARKDOWN_ALLOW/KATEX_ALLOW), הקבועים `BLOCK_SENTINEL`/`INLINE_SENTINEL`, ו-`replacePlaceholders` — שכן `renderMarkdown` קורא לו **בשני מקומות** (SSR branch ~`markdown.ts:315` + return סופי ~`:335`). `renderMarkdown` מעביר ל-`replacePlaceholders` את ה-`katexFragments` שקיבל מ-`parseToHtml` (במקום לקרוא `currentMap` גלובלי).
- **‏הסכנה להימנע ממנה**: אל תעביר את ה-sentinels/`replacePlaceholders` ל-`markdown-parse.ts` — זה ישבור את ה-import של `renderMarkdown`. ה-sentinel הוא חוזה משותף → הגדר אותו פעם אחת ויובא ע"י שני הקבצים (או הישאר ב-markdown.ts ו-markdown-parse מייבא ממנו).

**export ציבורי יחיד נשאר `renderMarkdown`**. `parseToHtml` exported-for-test בלבד (JSDoc `@internal`).

**קובץ חדש (אופציונלי)**: `markdown-parse.test.ts` (`environment:node`) — בודק את ה-parse ללא DOM (מהיר).

**Verification**: `npx vitest run src/lib/util/` ירוק · `pnpm --filter @drive-coding/frontend-v2 typecheck` נקי (⚠️ `-v2`) · diff מראה הזזת-קוד בלבד ב-renderMarkdown (אין שינוי לוגי בסניטיזציה).

---

## §5 — DoD

| בדיקה | איך |
|------|-----|
| RLM לפני טבלה/כותרת/רשימה/ציטוט → מרונדר | טסטי Commit 0 |
| RLM לפני `$$`/`\[` → katex, RLM לא דולף לנוסחה | טסט (`not.toContain RLM`) |
| RLM בטקסט רגיל/אמצע — נשמר | טסט |
| heading שמתחיל Latin → RTL (RLM נדחף לתוכן) | טסט regex `<h2>‏` |
| 26 הטסטים הקיימים ירוקים | `vitest run src/lib/util/` |
| הבידוד האבטחתי לא נשבר (span/style גולמי עדיין נמחק) | טסט קיים "strips raw model" ירוק |
| typecheck נקי | `pnpm --filter @drive-coding/frontend-v2 typecheck` (⚠️ `-v2`) |
| אימות חי: ההדגמה (טבלאות+display) מרונדרת בדפדפן linux-gui | calev |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| נרמול גורף מסיר RLM לגיטימי | over-reach | heuristic ממוקד — מוחק רק לפני math, דוחף לפני block, משאיר בטקסט (טסטים "kept"/"untouched") |
| RLM נדחף לתוך LaTeX → unknownSymbol | KaTeX | מסלול math = **מחיקה** (לא דחיפה); טסט `not.toContain RLM` |
| regex push שובר marker מורכב (nested `>`, task-list) | regex | טסטים מכסים markers נפוצים; nested = escalation §7 |
| refactor Commit 2 משנה לוגיקת סניטיזציה בטעות | refactor | "הזזת-קוד בלבד"; טסט "strips raw model" + 26 הקיימים חוסמים רגרסיה |
| Hardcoded Hebrew | pre-commit hook | אין מחרוזות UI חדשות (לוגיקה טהורה) |

---

## §7 — Escalation triggers
- marker מורכב (nested blockquote `> >`, task-list `- [ ]`) שה-regex לא מכסה ומופיע בפועל.
- נדרש לנרמל תו bidi מעבר ל-`U+200E/200F/202A-202E/2066-2069`.
- הפיצול (Commit 2) דורש שינוי בלוגיקת ה-two-pass/allowlist כדי לעבוד — עצור (האבטחה לא אמורה להשתנות).

## §8 — Complexity score
- commits: 3 · שכבה: 1 (util) · לוגיקה טהורה (regex normalize) · refactor הזזת-קוד · אין protocol/streaming/external-API · רגישות: רגרסיית-אבטחה (מכוסה בטסט קיים).
- **Score: 5/10 → calev light.**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | task-list / nested-quote ב-MVP? | לא — markers נפוצים בלבד; nested = escalation | ❌ |
| 2 | `parseToHtml` exported-for-test או `@internal`? | exported-for-test (JSDoc `@internal`) | ❌ |
| 3 | טסט `markdown-parse.test.ts` ב-node — חובה? | מומלץ (מדגים את ערך הפיצול), לא חוסם | ❌ |

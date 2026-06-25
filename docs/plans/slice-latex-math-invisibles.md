# Slice latex-math-invisibles — תוכנית

> **תאריך**: 2026-06-25
> **סטטוס**: הושלם — 2 commits, calev GO (2026-06-25)
> **Complexity**: 5/10 (verifier: light)
> **תלות (depends_on)**: `slice-latex-math` (לא מוזג; כולל את slice-latex-math-bidi-fix). **base = branch `slice-latex-math`** (שרשור).

---

## §0 — Pre-flight

### Worktree
ה-worktree קיים — עובדים בתוכו:
```bash
cd /home/user/projects/drive-coding/.worktrees/slice-latex-math
```

### Run / Tests
- Tests: `npx vitest run src/lib/util/` (מתוך `packages/frontend/`)
- typecheck: `pnpm --filter @drive-coding/frontend-v2 typecheck` (⚠️ שם החבילה `-v2`)

### Reading list
**must-read**:
- `packages/frontend/src/lib/util/markdown-parse.ts` — ה-pipeline + `normalizeLineLeadingBidi` הקיים (שמוחלף בזה).
- `packages/frontend/src/lib/util/markdown-bidi.test.ts` — 8 הטסטים הקיימים (jsdom).

---

## §1 — מטרה

נוסחאות, טבלאות וכל מבני ה-Markdown מרונדרים נכון גם כשהמודל/המשתמש מזריק **תווים בלתי-נראים** (bidi-control + zero-width + soft-hyphen + NBSP) בכל מיקום — לא רק RLM בתחילת שורה. אבחון אמפירי (מטריצת {10 תווים × 6 מיקומים}) הראה שכל המשפחה שוברת את כל המיקומים התחביריים, וש**ה-fix הקודם (RLM בתחילת שורה בלבד) חלקי** — בפרט שורת ה-separator של טבלה נשברת מ-RLM ש**אחרי** ה-`|` (תסמין חי: שתי טבלאות שלא רונדרו). הפתרון: עיקרון אחיד — *"הצמד את התו הבלתי-נראה לטקסט אמיתי; מחק רק באזורי-תחביר-טהור (separator, math)."*

---

## §2 — Scope

| פיצ'ר | כן/לא | הערה |
|------|------|------|
| נרמול range של כל הבלתי-נראים, בכל המיקומים | ✅ | לב ה-slice — מחליף את `normalizeLineLeadingBidi` |
| strip מ-separator + math-spans; relocate בתחילת שורה; שמירה בתוכן | ✅ | האלגוריתם ב-§3 |
| שינוי ה-two-pass / DOMPurify / extensions | ❌ | לא נוגעים |
| הסרת בלתי-נראים מתוכן אמיתי (אמצע מילה/פסקה) | ❌ | לגיטימי — נשמר |
| נרמול בתוך fenced code blocks | ❌ | escalation §7 — edge נדיר, מתועד |

---

## §3 — Architecture

נשאר ב-`markdown-parse.ts`, מחליף את `normalizeLineLeadingBidi` בפונקציה אחת (שם חדש: `normalizeInvisibles`). עדיין פונקציה טהורה, מנותקת מהרינדור והסניטיזציה (אין ספגטי).

```
char-class:  INVIS = [​-‏‪-‮⁠⁦-⁩﻿­؜]
             NBSP  = [  ]   (מטופל בנפרד — המרה לרווח)

normalizeInvisibles(text):
  1. NBSP-like → רווח רגיל        (משמר "עזרה" אחרי #, מתקן bold)
  2. שורת separator → strip INVIS  (שורה שכולה [|:\-\s+INVIS] ובה מקף ויש בה |)
  3. math span → strip INVIS       ($$..$$ / \[..\] / \(..\)  — NOT $..$ inline, finding #2: מחיר $5..$10)
  4. תחילת שורה:
       INVIS לפני math-marker ($$|\[) → מחק
       INVIS לפני block-marker (# > - * + | digit.) → הזז אחרי ה-marker
  5. השאר (INVIS צמוד לטקסט) → נשאר
```

> **reference implementation (הורץ אמפירית — 16/16 כולל כל המטריצה + שמירת RLM בתוכן):**
```ts
const INVIS = "\\u200B-\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF\\u00AD\\u061C"
const NBSP  = "\\u00A0\\u202F"
const reInvis = new RegExp(`[${INVIS}]`, "gu")

export function normalizeInvisibles(text: string): string {
  // 1. NBSP-like → space
  let t = text.replace(new RegExp(`[${NBSP}]`, "gu"), " ")
  // 2. separator rows: strip
  t = t.replace(/^.*$/gm, (line) => {
    const s = line.replace(reInvis, "")
    return (/\|/.test(s) && /^[\s|:-]*-[\s|:-]*$/.test(s)) ? s : line
  })
  // 3. math spans: strip — block+paren בלבד.
  // ⚠️ NOT inline $..$ (finding #2): "$5 ... $10" (מחיר) ייתפס כ-span ויאבד invis = content-mutation.
  // invis בתוך $x$ inline math (נדיר) → נשאר → רעש unknownSymbol קל ב-KaTeX, לא שבירה.
  t = t.replace(/\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)/g,
                (m) => m.replace(reInvis, ""))
  // 4a. line-start before math-marker: delete
  t = t.replace(new RegExp(`^[${INVIS}]+(?=\\$\\$|\\\\\\[)`, "gmu"), "")
  // 4b. line-start before block-marker: relocate after marker
  t = t.replace(new RegExp(`^([${INVIS}]+)(#{1,6} |>+ |[-*+] |\\d+[.)] |\\| ?)`, "gmu"), "$2$1")
  return t
}
```

`parseToHtml` קורא ל-`normalizeInvisibles` במקום `normalizeLineLeadingBidi` (שם הפונקציה הישנה נמחק/מוחלף).

---

## §4 — Commits

### Commit 0 — failing tests: full invisibles matrix (approach: TDD)

**שינוי `markdown-bidi.test.ts`** (או קובץ חדש `markdown-invisibles.test.ts`) — מוסיף את כל המטריצה. תרחישים (`// @vitest-environment jsdom`, דרך `renderMarkdown`). **ה-unit test (האחרון) מייבא `normalizeInvisibles` מ-`$lib/util/markdown-parse`** (המקור — לא דרך ה-re-export):

```ts
const R = "‏", L = "‎", Z = "​", N = " "
// separator — התסמין החי
it("RLM after | in separator → table", () =>
  expect(renderMarkdown(`| a | b |\n|${R}---|---|\n| 1 | 2 |`)).toContain("<table"))
it("model-real: RLM in every cell+separator → table", () =>
  expect(renderMarkdown(`| ${R}a | ${R}b |\n|${R}---|${R}---|\n| ${R}x | ${R}y |`)).toContain("<table"))
// משפחת התווים (range, לא רק RLM)
it("LRM before heading → h1", () => expect(renderMarkdown(`${L}# כ`)).toContain("<h1"))
it("ZWSP before list → li", () => expect(renderMarkdown(`${Z}- פ`)).toContain("<li"))
it("NBSP after # → h1", () => expect(renderMarkdown(`#${N}כ`)).toContain("<h1"))
// math: range delete (before + inside, both markers)
it("RLM before \\[ → katex, no RLM leak", () => {
  const o = renderMarkdown(`${R}\\[x\\]`); expect(o).toContain("katex"); expect(o).not.toContain(R)
})
it("RLM inside $$ → katex, no RLM leak", () => {
  const o = renderMarkdown(`$$${R}x$$`); expect(o).toContain("katex"); expect(o).not.toContain(R)
})
// markers נוספים
it("ordered list + RLM → ol", () => expect(renderMarkdown(`${R}1. פ`)).toContain("<ol"))
it("nested quote + RLM → blockquote", () => expect(renderMarkdown(`${R}> > צ`)).toContain("<blockquote"))
// שמירה בתוכן (regression guard — אסור למחוק)
it("RLM kept in plain text", () => expect(renderMarkdown(`${R}שלום עולם`)).toContain(R))
it("RLM kept mid-text", () => expect(renderMarkdown(`a ${R}b`)).toContain(R))
// finding #2 regression guard: מחיר עם invis בין $..$ — NOT math, אסור למחוק
it("invis between prices ($5..$10) is NOT stripped", () =>
  expect(renderMarkdown(`costs $5 ${R}x $10 today`)).toContain(R))
it("heading starting Latin keeps RTL via relocated RLM", () =>
  expect(renderMarkdown(`${R}## ChatGPT`)).toMatch(/<h2[^>]*>‏ChatGPT/))
// unit test ישיר על הפונקציה הטהורה
it("normalizeInvisibles strips separator invis but keeps content", () => {
  const out = normalizeInvisibles(`| a |\n|${R}---|\nplain ${R}text`)
  expect(out).not.toMatch(/\|‏---/)   // separator נוקה
  expect(out).toContain(`plain ‏text`) // תוכן נשמר
})
```

**Verification**: `npx vitest run src/lib/util/markdown-invisibles.test.ts` — אדום.

### Commit 1 — normalizeInvisibles (approach: TDD)

**שינוי `markdown-parse.ts`**: החלף את `normalizeLineLeadingBidi` ב-`normalizeInvisibles` (§3 reference). עדכן את `parseToHtml` לקרוא לה. ייצא `normalizeInvisibles` (exported-for-test). הסר את `normalizeLineLeadingBidi`.

**⚠️ חובה (finding #1 — blocker): עדכן את ה-re-export ב-`markdown.ts:41`.** כיום שם:
```ts
export { normalizeLineLeadingBidi } from "./markdown-parse"   // ← שורה 41, חייב להשתנות
```
→ ל-`export { normalizeInvisibles } from "./markdown-parse"`. בלי זה `verbatimModuleSyntax` strict שובר typecheck/build (re-export של symbol מחוק).

**אימות מחיקה**: `grep -rn normalizeLineLeadingBidi packages/frontend/src` → 0 תוצאות (כולל ה-re-export ב-`markdown.ts:41` וההערה ב-`markdown.ts:173`).

**Verification**: `npx vitest run src/lib/util/` — כל הטסטים ירוקים (63 קיימים + מטריצה חדשה). `pnpm --filter @drive-coding/frontend-v2 typecheck` נקי.

---

## §5 — DoD

| בדיקה | איך |
|------|-----|
| separator עם RLM (אחרי \|) → טבלה | טסט |
| model-real (RLM בכל תא+separator) → טבלה | טסט |
| כל משפחת התווים (RLM/LRM/ZWSP/NBSP) → marker עובד | טסטים |
| math (before+inside, $$+\[) → katex, אפס דליפת invis | טסטים |
| ordered/nested markers → עובדים | טסטים |
| **invis בתוכן/אמצע — נשמר** | טסטים (regression guard) |
| heading Latin → RTL (RLM נדחף) | טסט regex |
| unit test ישיר על normalizeInvisibles | טסט |
| 63 הקיימים ירוקים + isolation "strips raw model" | `vitest run src/lib/util/` |
| typecheck נקי | `typecheck` |
| אימות חי: ההדגמה (טבלאות+נוסחאות) מרונדרת בדפדפן | calev |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| separator regex תופס שורת-תוכן בטעות | regex | התנאי `^[\s|:-]*-...$` דורש שכל השורה רק `\|:-\s`+invis ויש בה `-` — שורת תוכן (אותיות) לא מתאימה; טסט "kept in plain" |
| math-span strip פוגע ב-`$` במחיר (`$5..$10`) | regex (finding #2) | **ה-strip מודר מ-`$..$` inline** — רק `$$`/`\[`/`\(`. invis בתוך `$x$` inline נשאר (רעש KaTeX קל, לא שבירה). טסט: `costs $5 ‏x $10` שומר RLM |
| math-span strip בתוך code span (`` `$$x$$` ``) | regex רץ לפני marked | known limitation (§7) — נדיר (math delimiters בתוך code); אם מתגלה בפועל → דילוג על code spans |
| invis בתחילת שורה בתוך fenced code block נדחף | regex | edge נדיר — escalation §7; מתועד כ-known limitation |
| relocate שובר RTL בתוכן | dir | ה-RLM נדחף *לתוך* התוכן (first-strong) → dir="auto" בוחר RTL; טסט heading-Latin |
| שם פונקציה ישן נשאר בשימוש | refactor | grep ל-`normalizeLineLeadingBidi` אחרי השינוי — 0 תוצאות |

---

## §7 — Escalation triggers
- תו בלתי-נראה שמשבש markdown ולא ב-char-class (הרץ את מטריצת {תו×מיקום} אם צץ חדש).
- fenced code block שתוכנו משתנה ע"י הנרמול (אם מתגלה בפועל — להוסיף דילוג על spans בין fences).
- marked מתנהג שונה על separator אחרי הנרמול ממה שה-prototype הראה.

## §8 — Complexity score
- commits: 2 · שכבה: 1 (util, פונקציה אחת) · לוגיקה טהורה (regex) · אין protocol/streaming/external · רגישות: רגרסיית-טבלאות+אבטחה (מכוסה בטסטים קיימים).
- **Score: 5/10 → calev light.**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|-----------|-------|
| 1 | fenced code block — לדלג על תוכנו בנרמול? | לא ל-MVP (edge נדיר, escalation) | ❌ |
| 2 | להשאיר את `normalizeLineLeadingBidi` כ-alias או למחוק? | למחוק (אין צרכן חיצוני; grep מוודא) | ❌ |
| 3 | NBSP — להמיר לרווח או למחוק? | להמיר לרווח (משמר semantics אחרי #) | ❌ |

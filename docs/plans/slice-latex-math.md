# Slice latex-math — תוכנית (rework r2)

> **תאריך**: 2026-06-24
> **סטטוס**: הושלם — 2026-06-25. commits: 43441da..f203e7e (2 commits). 263/263 טסטים ירוקים.
> **Complexity**: 7/10 (verifier: light, אבל בדיקת ה-XSS/בידוד דורשת תשומת-לב — אם אביגיל חוששת → heavy)
> **תלות**: `chat-render-polish` (נוגע ב-`markdown.ts`). **base = dev אחרי merge של chat-render-polish.** חוסם dispatch.

---

## §0 — Pre-flight

### Worktree
```bash
# רק אחרי merge של chat-render-polish ל-dev
git worktree add .worktrees/slice-latex-math -b slice-latex-math dev
cd .worktrees/slice-latex-math
pnpm install && pnpm hooks:install
```

### Run / Browser
- FE: `pnpm --filter @drive-coding/frontend-v2 dev` · Tests: `... test`
- Build + tunnel חיצוני לאימות בנייד (running-locally §ב — **תמיד URL חיצוני אחרי build**).

### Reading list
**must-read**:
- `packages/frontend/src/lib/util/markdown.ts` (post-tables, 82 שורות) — ה-pipeline הקיים.
- `reports/drive-coding/slice-latex-math-avigail.md` (ב-ריפו השיטה) — **הסבר מלא למה r1 נכשל**. קרא לפני שמתחילים.
- KaTeX docs §security + §options — `trust` default, `output` modes.

---

## §1 — מטרה

נוסחאות מתמטיות בכל 4 הסגנונות (`$...$`, `$$...$$`, `\(...\)`, `\[...\]`) שהמודל פולט — מרונדרות כ-KaTeX מלא ומלוטש, בכל בועה. **בלי לפתוח חור CSS-injection.**

---

## §2 — רקע: למה r1 נכשל (קרא קודם)

r1 הציע להוסיף `style` ל-`ALLOWED_ATTR` הגלובלי, בהנחה ש"DOMPurify מסנן `url()`/`javascript:`". **אביגיל אימתה בהרצה — זה false.** DOMPurify v3 מעביר inline style verbatim. הוספת `style` גלובלי הייתה פותחת overlay-phishing (`position:fixed`) ו-exfiltration (`url()`) — לא RCE (מת ב-2026), אבל ממשי בעוזר שמבצע פעולות, דרך prompt-injection (המודל קורא תוכן עוין ופולט `<span style>` מתחזה).

**התובנה המכרעת (מהמשתמשת)**: ה-CSS המסוכן לא מגיע מ-KaTeX (positioning יחסי, בטוח) ולא מ-LaTeX (`trust:false` חוסם), אלא מ-**HTML גולמי שהמודל פולט**, שעובר **רק כי** הרחבנו allowlist בשביל KaTeX. הפתרון: **allowlist פר-מקור, לא רשימה כללית אחת** — secure by construction, לא by filtering.

---

## §3 — Architecture: two-pass (per-input allowlist)

```
renderMarkdown(text):
  1. marked.parse(text)  ─ עם extension פנימי שלנו:
        tokenizer מזהה $..$ / $$..$$ / \(..\) / \[..\]  (בתוך pipeline של marked → מכבד code)
        renderer מריץ katex.renderToString → שומר HTML ב-map → מחזיר placeholder katex{i}
     → markdownHtml עם placeholders (ה-KaTeX איננו כאן — רק sentinels)
  2. DOMPurify.sanitize(markdownHtml, MARKDOWN_ALLOW)   ─ allowlist שמרני: בלי span, בלי style
     → ה-sentinels הם טקסט → שורדים. <span style> מתחזה של מודל → נמחק (span לא ב-allowlist).
  3. לכל KaTeX HTML ב-map: DOMPurify.sanitize(katexHtml, KATEX_ALLOW)  ─ allowlist נדיב: span/style/MathML/SVG
     → katexClean[i]   (כל אחד מסונן בנפרד — לא "modify after")
  4. החלף sentinels ב-katexClean[i]  → תוצאה סופית
```

> **שני allowlists נפרדים. ה-`span`+`style` קיימים אך-ורק במסלול KaTeX (input מהימן: generated, `trust:false`). מסלול ה-markdown לעולם לא מקבל אותם → span גולמי של מודל נמחק.** זה הלב של ה-slice.
> ה-re-inject (שלב 4) **לא** מפר את אזהרת DOMPurify "modify-after": ה-KaTeX שמוזרק כבר עבר DOMPurify (שלב 3).

לא נוגע בקומפוננטות. `renderMarkdown` משותף — כל הבועות מקבלות LaTeX.

---

## §4 — Commits

### Commit 0 — two-pass + extension פנימי (approach: manual)

**deps**: `pnpm --filter @drive-coding/frontend-v2 add katex` (**רק katex — לא marked-katex-extension**).

**`util/markdown.ts`** — שכתוב `renderMarkdown` ל-two-pass:

1. **extension פנימי** (`marked.use({ extensions: [...] })`, ברמת מודול):
   - 4 inline/block extensions: `$...$` (inline), `$$...$$` (block), `\(...\)` (inline), `\[...\]` (block).
   - כל `tokenizer` מחזיר token; כל `renderer(token)` קורא:
     ```ts
     const html = katex.renderToString(token.text, {
       displayMode: <block?>, throwOnError: false, output: "htmlAndMathml",
       maxSize: 50, maxExpand: 1000,   // הגנות DoS (KaTeX security)
     })
     ```
     ושומר ל-map + מחזיר placeholder `katex${i}`.
   - ⚠️ ה-tokenizer חייב לרוץ ב-pipeline של marked (לא regex על ה-string הגולמי) — כך `$` בתוך `` `code` `` / code-block לא נתפס. **אמת זאת בטסט.**
   - ⚠️ **block לפני inline** (finding #3): רשום/סדר את ה-block extensions (`$$`, `\[`) **לפני** ה-inline (`$`, `\(`), אחרת `$$x$$` עלול להיתפס כ-2× `$..$`. בנוסף — ה-tokenizer של `\[` מול `\(` חולק prefix `\` → ודא הבחנה מדויקת ב-`start`/`tokenizer`.
   - ⚠️ **map — module-level ref, reset per-call** (finding #2, **לא** "closure"): ה-extension נרשם **פעם אחת ברמת מודול** (`marked.use(...)` ברמת קובץ). ה-map הוא `let currentMap` ברמת מודול ש-`renderMarkdown` **מאפס בתחילת כל קריאה** (`currentMap = []`), וה-`renderer` קורא/דוחף אליו. **אסור `marked.use` בתוך `renderMarkdown`** (ירשום extension מצטבר/דולף בכל קריאה). אומת ע"י אביגיל: אינדקסים מתאפסים בין קריאות, אין דליפה.

2. **שני allowlists**:
   ```ts
   const MARKDOWN_TAGS = [ <הנוכחי post-tables: p,br,strong,...,table,...,col> ]   // ללא span/style
   const MARKDOWN_ATTR = ["href","title","lang","dir","target","rel","align"]      // ללא style
   const KATEX_TAGS = ["span","math","semantics","mrow","mi","mn","mo","mtext","mfrac",
                       "msup","msub","msubsup","msqrt","mroot","mspace","annotation",
                       "svg","path","line",
                       // ─── finding #1 (אביגיל r2 מדדה אמפירית — נדרשים לנוסחאות נפוצות) ───
                       "mtable","mtr","mtd","mstyle","munderover","mover","munder",
                       // ─── finding r3 (\binom, \xrightarrow) ───
                       "mpadded"]
   const KATEX_ATTR = ["class","style","aria-hidden","encoding","xmlns","viewBox","d",
                       "width","height","preserveAspectRatio",
                       // ─── finding #1 ───
                       "display","mathvariant","stretchy","fence","accent","accentunder",
                       "rowspacing","columnalign","columnspacing","scriptlevel",
                       "displaystyle","mathcolor",
                       // ─── finding r3 ───
                       "linethickness","lspace","minsize"]
   ```
   > **finding #1 (אביגיל r2)**: הרשימה לעיל היא מה שאביגיל מדדה אמפירית מ-`katex.renderToString` על 7 נוסחאות (matrix/cases/sum/vector/bold/overline). בלי ה-tags/attrs האלה, ה-MathML (layer ה-a11y שבחרנו ב-§9) מושמט בשקט — הנוסחה עדיין מרונדרת ויזואלית (CSS classes) אבל `display="block"`/מטריצה נשברים ב-MathML. **בכל זאת — הרץ `katex.renderToString` על מטריצה+סכום+וקטור בפועל ואמת שאין tag/attr נוסף חסר** (אל תניח שהרשימה מושלמת). אם מופיע tag מעבר ל-MathML/SVG/positioning (למשל `<foreignObject>`/event-handler) → escalate §7.
   > הערת-invariant בקוד: "`style` מותר **רק** ב-KATEX_ALLOW כי ה-input הוא KaTeX generated (`trust:false`, output should-be-safe). MARKDOWN_ALLOW לעולם בלי style — secure by construction."

3. **two-pass** ב-`renderMarkdown` (ראה §3). placeholder sentinel: ``/`` (Unicode Private-Use) — שורד marked+DOMPurify כטקסט, collision-resistant. אמת שאינו מתפרש כ-markdown.

4. **SSR** (`typeof document === "undefined"`): כיום מחזיר html גולמי. עם KaTeX — ה-output מכיל span/style. זה עובר serialization של Svelte (לא innerHTML גולמי) → בטוח, כפי שמתעד ה-comment הקיים. ודא ש-`katex.renderToString` לא זורק ב-node (אין DOM) — אומת ע"י אביגיל ✅.

**CSS**: `@import "katex/dist/katex.min.css";` ב-`app.css`. ודא ש-fonts (`KaTeX_*`) נארזים ב-adapter-static build.

**Verification**: `typecheck` · `build` (fonts!) · ידני: 4 סגנונות מרונדרים.

### Commit 1 — tests: rendering + בידוד-allowlist (approach: TDD)

```ts
// rendering — כל 4 הסגנונות
it("renders $...$ / $$...$$ / \\(...\\) / \\[...\\]", () => {
  for (const s of ["$a^2$","$$\\int x$$","\\(b^2\\)","\\[c^2\\]"])
    expect(renderMarkdown(s)).toContain("katex")
})
// finding #1: נוסחה מורכבת (מטריצה) — MathML לא מושמט בשקט
it("renders a matrix without dropping MathML structure", () => {
  const out = renderMarkdown("$$\\begin{matrix} a & b \\\\ c & d \\end{matrix}$$")
  expect(out).toContain("katex")
  expect(out).toContain("mtable")   // ה-MathML של המטריצה שורד (KATEX_ALLOW כולל mtable)
})
// math בתוך code block לא מרונדר
it("does NOT render math inside inline code", () => {
  expect(renderMarkdown("`$x$`")).not.toContain("katex")  // נשאר טקסט
})
// ★ הלב: span+style גולמי של מודל נמחק (MARKDOWN_ALLOW בלי span/style)
it("strips raw model <span style> (overlay vector)", () => {
  const out = renderMarkdown('<span style="position:fixed;inset:0">x</span>')
  expect(out).not.toContain("position:fixed")
  expect(out).not.toContain("<span")
})
// KaTeX span+style כן עובר (KATEX_ALLOW)
it("keeps KaTeX positioning style", () => {
  expect(renderMarkdown("$a^2$")).toMatch(/style=|class="katex/)
})
// XSS קיימים
it("existing XSS guards pass", () => {
  expect(renderMarkdown("<script>alert(1)</script>")).not.toContain("<script>")
})
```

**Verification**: `pnpm test -- markdown` — הכל ירוק. **הטסט הקריטי**: `strips raw model <span style>` — מוכיח שה-two-pass מבודד.

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| 4 סגנונות מרונדרים | טסט + ידני |
| math בתוך code לא מרונדר | טסט |
| **span+style גולמי של מודל נמחק** | טסט "strips raw model" (★ הוכחת הבידוד) |
| KaTeX positioning עובר | טסט |
| XSS קיימים ירוקים | טסט |
| fonts ב-build | `build` + נייד |
| RTL: נוסחה LTR | ידני |
| typecheck נקי | `typecheck` |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| placeholder collision / נמחק ב-DOMPurify | מימוש | Private-Use sentinel; טסט שמוודא round-trip |
| map → אינדקסים מצטברים/דולפים בין קריאות | concurrency | module-level `currentMap` ref ש-`renderMarkdown` מאפס בתחילת כל קריאה; ה-extension נרשם פעם אחת. **אסור `marked.use` בתוך renderMarkdown.** (אומת ע"י אביגיל) |
| `$$x$$` נתפס כ-2×`$..$` | סדר extensions | block לפני inline (finding #3) |
| MathML של מטריצה/סכום מושמט בשקט | KATEX_ALLOW חסר | mtable/mtr/mtd/mstyle/munder... ב-allowlist (finding #1) + טסט מטריצה |
| tokenizer תופס `$` בתוך code | regex-vs-pipeline | extension ב-marked pipeline (לא regex); טסט "inside inline code" |
| KaTeX tags חסר tag → נוסחה שבורה | אי-ודאות | אמת מול `katex.renderToString` בפועל (לא ניחוש) |
| **דליפת style למסלול markdown** | אבטחה (לב ה-slice) | MARKDOWN_ALLOW בלי span/style; טסט "strips raw model" חוסם רגרסיה |
| fonts לא נארזים ב-build | adapter-static | DoD + escalation |
| KaTeX `renderToString` ב-SSR זורק | SSR | אומת ✅ (אביגיל) — לא זורק ב-node |

---

## §7 — Escalation triggers
- `katex.renderToString` output דורש tag/attr שמרחיב את KATEX_ALLOW מעבר ל-positioning/MathML/SVG (למשל `<foreignObject>`, `<iframe>`, event-handler).
- אי אפשר לכתוב placeholder ששורד marked+DOMPurify בלי collision.
- ה-extension של marked תופס `$` בתוך code גם אחרי שימוש ב-pipeline (לא ב-regex).
- KaTeX fonts לא נכנסים ל-adapter-static build.

---

## §8 — Complexity score
- commits: 2 · dependency: +1 (katex) · two-pass + extension פנימי: +2 · אבטחה (בידוד allowlists): +2
- **Score: 7/10 → calev light** (אם אביגיל חוששת מהבידוד → calev-heavy)

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | `\(...\)`/`\[...\]` ב-MVP? | **כן** (extension פנימי שולט בכל ה-delimiters) | ❌ |
| 2 | lazy-load של KaTeX (270KB+fonts) | eager ל-MVP; lazy = future | ❌ |
| 3 | `output` mode | `htmlAndMathml` (a11y + rendering) | ❌ |
| 4 | profile-per-bubble (`chat` vs `document` ל-viewer) | מבנה ל-future; MVP profile יחיד `chat` | ❌ |

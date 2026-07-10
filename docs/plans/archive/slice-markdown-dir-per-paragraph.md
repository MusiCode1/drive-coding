# Slice B — markdown-dir-per-paragraph — תוכנית

> **תאריך**: 2026-06-28 · **עודכן**: 2026-06-29 (base=dev הכולל את D — D מוזג `05fe3b6`)
> **סטטוס**: ✅ **מוזג ל-dev** — אביגיל אימתה-מחדש מול dev+D (`f1763d4`, 6/6 claims, finding 🟢 `dir`-guard שולב); commit `0fe7b87`, 67/67 טסטים; כלב GO 8/8; אומת חי ב-preview. סוגר את batch Markdown-UX.
> **Complexity**: 4/10 (verifier: light)
> **תלות**: depends_on: []. **base=dev** (כולל את A+C+D שכבר מוזגו). B נוגע רק ב-`markdown.ts`. ⚠️ **merge-order ההיסטורי "B לפני D" בטל — D כבר על dev**; B נבנה עכשיו **מעל** D (ראה §0 + Reading list).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/markdown-dir-per-paragraph -b slice/markdown-dir-per-paragraph dev
cd .worktrees/markdown-dir-per-paragraph
pnpm install && pnpm hooks:install
```
> **base=dev** — A, C ו-D כבר מוזגו. B נבנה מעל המצב הנוכחי של `markdown.ts` (כולל pass-3b של D).
>
> ### ⚠️ אינטראקציה עם D (code-syntax-highlight) — מאומת מול הקוד הנוכחי
> D הוסיף ל-`markdown.ts` שלושה passים נפרדים של sanitize (Pass 2=markdown, 3a=KaTeX, 3b=code).
> ה-hook `afterSanitizeAttributes` נרשם **גלובלית** (שורה ~157) → **רץ על כל שלושת ה-passים**.
> ההשלכה ל-B:
> - ה-set של B (`P/LI/H1-6/BLOCKQUOTE/TD/TH`) **לא כולל** `pre`/`code`/`span` → code-fragments
>   (Pass 3b) **לא** יקבלו `dir`. הקוד נשאר LTR. ✅ זה בדיוק הרצוי.
> - block-elements של ה-markdown (Pass 2) יקבלו `dir="auto"` כמתוכנן.
> - ה-hook רץ אחרי הניקוי → ה-`dir` שמוזרק שורד גם אם `dir` לא ב-`CODE_ATTR` (לא רלוונטי — code לא ב-set).

### Run
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- Tests: `pnpm --filter @drive-coding/frontend-v2 test markdown`

### Browser
- Chrome רגיל. הבדיקה הקריטית: הודעה אחת עם **פסקה בעברית ופסקה באנגלית** — כל אחת מיושרת לכיוונה.

### OneCLI agent
- `voice-acp` — רק להרצת BE לבועות-אמת (לא חובה; אפשר לבדוק עם renderMarkdown ב-jsdom).

### Reading list
**must-read לפני**:
- `src/lib/util/markdown.ts` — **במיוחד** ה-DOMPurify hook הקיים (`afterSanitizeAttributes`, שורות **156-163**
  אחרי מיזוג D) שכבר מוסיף `target=_blank` ל-`<a>`. **B מרחיב את אותו hook** — לא יוצר חדש.
  ⚠️ שים לב ל-`renderMarkdown` (שורות ~169-221): D הוסיף **Pass 3b** (`CODE_TAGS=pre/code/span`,
  `CODE_ATTR=class`, שורות 150-153 + 203-210) — ה-hook הגלובלי רץ גם עליו, אך ה-set של B לא נוגע ב-code.
- `src/lib/util/markdown-parse.ts` §normalizeInvisibles — להבין שה-bidi הקיים מטפל ב**תווים** (RLM/invisibles),
  ו-B משלים אותו ברמת ה**אלמנט** (`dir` attribute). הם משלימים, לא חופפים.

**reference**:
- `MARKDOWN_ATTR` ב-`markdown.ts:79` — `dir` **כבר** ב-allowlist (שורד sanitize).

## §1 — מטרה

היום `dir="auto"` יושב על **מכל-הבועה** כולה — כל הבועה מקבלת כיוון אחד לפי התו-החזק הראשון.
הודעה עם פסקה בעברית ואחריה פסקה באנגלית → שתיהן נכפות לאותו כיוון, ואחת מהן נראית הפוך/שבור.
אחרי ה-slice: **כל בלוק-טקסט (פסקה, פריט-רשימה, כותרת, ציטוט, תא-טבלה) מקבל `dir="auto"` משלו**
ובוחר כיוון עצמאית. עברית מימין-לשמאל, אנגלית משמאל-לימין — באותה הודעה, כל פסקה כשורה.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `dir="auto"` פר block-element (p/li/h1-6/blockquote/td/th) | ✅ | req #6 |
| הזרקה דרך הרחבת ה-DOMPurify hook הקיים | ✅ | מקום-שינוי יחיד |
| `pre`/`code` מקבלים dir="auto" | ❌ | קוד **נשאר LTR** (CSS קיים כופה `direction:ltr`) — לא נוגעים |
| נורמליזציית תווי-bidi (RLM/invisibles) | ❌ | כבר קיים (`normalizeInvisibles`) — B משלים ברמת-אלמנט, לא נוגע בזה |
| שינוי ב-CSS של הבועות | ❌ | זה pipeline בלבד; ה-`dir` עושה את העבודה |

## §3 — Architecture diagram

```
util/
  markdown.ts   ← משתנה: הרחבת ה-afterSanitizeAttributes hook הקיים —
                  להוסיף dir="auto" ל-block elements (בנוסף ל-target=_blank של <a> שכבר שם)
```
שינוי ב-**קובץ אחד**, ב-**hook אחד קיים**. אין קובץ חדש, אין שכבה חדשה.

> **למה hook ולא marked-renderer**: marked-renderer היה דורש override ל-paragraph/listitem/heading/
> blockquote/tablecell בנפרד (5+ overrides), והיה מתנגש עם ה-`renderer.code` של slice D. ה-hook
> ריכוזי (מקום אחד), רץ אחרי ה-sanitize, ועובד על ה-DOM אחרי שכבר נבנה — מוסיף `dir` לכל מה שצריך
> במעבר אחד. `dir` כבר ב-`MARKDOWN_ATTR` → שורד.

## §4 — Commits

### Commit 0 — הרחבת ה-hook (approach: **TDD** — renderMarkdown ב-jsdom)

**שינויים**: `src/lib/util/markdown.ts` — בתוך ה-`DOMPurify.addHook("afterSanitizeAttributes", ...)` הקיים,
להוסיף: אם `node.tagName` הוא אחד מ-`P, LI, H1-H6, BLOCKQUOTE, TD, TH` **ואין לו כבר `dir`** → `node.setAttribute("dir","auto")`.
(ה-`<a>` logic הקיים נשאר כמו שהוא — מוסיפים ענף, לא מחליפים.)
> **למה `if (!node.hasAttribute("dir"))`** (finding אביגיל 🟢): המודל יכול לפלוט `dir` מפורש
> (`dir` ב-`MARKDOWN_ATTR` → שורד sanitize). כוונה מפורשת מנצחת `dir="auto"` האוטומטי — לא לדרוס.

**API skeleton** — ⚠️ **מוסיפים ענף בתוך ה-callback הקיים, לא hook חדש.** ה-`DOMPurify.addHook`
הקיים עטוף ב-`if (typeof document !== "undefined") { ... }` (שורות **156-163** אחרי D). את ה-`Set` מגדירים
ברמת-מודול; את הענף מוסיפים בתוך אותו callback אחד:
```ts
// רמת-מודול (ליד ה-allowlists):
const BIDI_BLOCK_TAGS = new Set(["P","LI","H1","H2","H3","H4","H5","H6","BLOCKQUOTE","TD","TH"])

// בתוך ה-if (typeof document !== "undefined") הקיים — אותו addHook, callback אחד:
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // ── קיים (לא נוגעים): <a href> → target/rel ──
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank")
    node.setAttribute("rel", "noopener noreferrer")
  }
  // ── חדש: block elements → dir="auto" (יישור עצמאי פר-פסקה) ──
  // guard: לא לדרוס dir מפורש שהמודל אולי פלט (finding אביגיל 🟢)
  if (BIDI_BLOCK_TAGS.has(node.tagName) && !node.hasAttribute("dir")) {
    node.setAttribute("dir", "auto")
  }
})
```
> **אסור** ליצור `addHook` שני או להוציא את ה-callback מתוך עטיפת ה-`if (typeof document...)` —
> זו אותה רישום-hook יחיד ברמת-מודול, רק עם ענף נוסף.
> ⚠️ **לא** להוסיף `pre`/`code` ל-set — קוד נשאר LTR (CSS כופה `direction:ltr`).
> ⚠️ ה-hook גלובלי (רץ גם על KaTeX fragments) — אך KaTeX מפיק `span`/`math`, לא block-tags → לא מושפע.

**Verification (TDD)**:
```bash
cd packages/frontend && pnpm test markdown
# טסטים (ב-jsdom — renderMarkdown דורש DOM):
# 1. renderMarkdown("שלום עולם") מכיל <p dir="auto">
# 2. renderMarkdown("- פריט\n- item") → כל <li> עם dir="auto"
# 3. renderMarkdown("# כותרת") → <h1 dir="auto">
# 4. renderMarkdown("> ציטוט") → <blockquote dir="auto">
# 5. <pre>/<code> **בלי** dir="auto" (נשאר LTR)
# 6. KaTeX עדיין עובד, <a> עדיין מקבל target=_blank (אין רגרסיה ב-hook)
pnpm typecheck
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| כל block-element מקבל dir="auto" | `pnpm test markdown` (טסטים 1-4) |
| pre/code נשארים בלי dir="auto" | טסט 5 |
| `<a>` עדיין target=_blank (אין רגרסיה) | טסט 6 |
| **פסקה-עברית + פסקה-אנגלית באותה הודעה — כל אחת לכיוונה** | browser: הודעה עם 2 פסקאות מעורבות → יישור עצמאי נכון |
| פריט-רשימה מעורב מיושר נכון | browser: רשימה עם פריטים עברית+אנגלית |
| typecheck + lint ירוקים | `pnpm typecheck && pnpm lint` |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ה-hook הגלובלי מוסיף dir ל-KaTeX/code בטעות | hook גלובלי | ה-set כולל רק block-text-tags; KaTeX=span/math, code=pre/code — לא ב-set. טסט 5 מאמת. |
| התנגשות עם normalizeInvisibles (bidi קיים) | bidi כפול | הם בשכבות שונות: normalize=תווים (RLM), B=attribute (`dir`). משלימים. לבדוק חי שטקסט מעורב לא נשבר. |
| `dir="auto"` על `td` משבש טבלאות RTL | edge | `dir=auto` פר-תא הוא דווקא הנכון לטבלאות מעורבות. לאמת חי בטבלה עברית+אנגלית. |
| ה-hook לא מורחב נכון ושובר את לוגיקת ה-`<a>` | רגרסיה | מוסיפים **ענף חדש** (`if BIDI_BLOCK_TAGS`), לא נוגעים בענף ה-`<a>`. טסט 6. |

## §7 — Escalation triggers
- אם טקסט מעורב נראה שבור אחרי B (התנגשות עם ה-bidi-normalization הקיים) → עצור ושאל מרדכי.
- אם נדרש לגעת ב-`normalizeInvisibles`/`markdown-parse.ts` כדי שזה יעבוד → עצור (סימן ש-scope שגוי).

## §8 — Complexity score
- commits: 1 (נמוך) · שכבות חדשות: 0 · APIs חיצוניים: 0 · streaming: לא · security-path: hook קיים, תוספת זעירה
- **Score: 4/10 → verifier: light (`calev`)**. בדיקה ויזואלית (RTL/LTR מעורב) היא הליבה.

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | להוסיף `dir="auto"` גם ל-`td`/`th`? | כן — תאי-טבלה מעורבים נפוצים | ❌ |
| 2 | להוסיף ל-`ul`/`ol` עצמם (לא רק `li`)? | לא — ה-`li` הוא יחידת-הטקסט; `dir` על ה-list-container עלול להפוך מיקום-סמן | ❌ |

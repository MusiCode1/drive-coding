---
slice: code-syntax-highlight
verifier: calev-heavy
model: opus
verdict: GO
findings_total: 3
findings_blocking: 0
dod_pass: 10
dod_total: 10
date: 2026-06-28
branch: slice/code-syntax-highlight
head: f83869a
base: dev (merged a20fbda)
env: Windows dev box — runtime verified via headless jsdom render (pipeline is pure/SSR-safe); live per-palette colors confirmed by user in preview build
re_run: true
prior_verdict: NO-GO (head 0f22d5c) — F1 blocking
---

> **⚠️ RE-RUN (head `f83869a`) → GO 10/10.** הסבב הראשון (head `0f22d5c`) החזיר NO-GO על F1
> (בלוק-קוד לפני KaTeX איבד את עוטף `<pre><code>`). F1 תוקן ב-`b01cfd1` (`fragmentKinds[]` +
> 3 טסטי-רגרסיה); calev-heavy רץ שוב על `f83869a` → **GO**: טבלת-ההוכחה האמפירית של F1 כולה ירוקה
> (כל בלוק שומר `<pre><code class="hljs">` בכל סדר), אבטחה ללא רגרסיה, 359/359 טסטים, typecheck 0,
> SSR build עובר. residual (צבעים-חיים פר-פלטה) אומת ע"י המשתמשת בדפדפן. F3 (class="hljs" ריק) cosmetic נשאר.
> מוזג ל-dev ב-`05fe3b6` (release v0.5.0). הסעיף שלהלן הוא **הדוח המקורי (NO-GO)** — נשמר כהיסטוריה.

---

# כלב-heavy — code-syntax-highlight (סבב 1 — היסטוריה)

## Verdict: NO-GO — 1 blocking finding (regression), 2 minor

הסלייס בנוי היטב כמעט בכל ציר שה-brief הדגיש: מודל-האבטחה תקין, ה-bundle נשלט
(רק 16 grammars, אין full-import), כל 8 הפלטות מגדירות את כל 9 ה-`--hl-*`, typecheck
נקי, SSR build עובר, ו-65 הטסטים ירוקים. **אבל** יש באג-סיווג-fragments אחד שמשבית
את הפיצ'ר המרכזי בתרחיש נפוץ-מאוד: **בלוק-קוד שמופיע לפני ביטוי KaTeX באותה הודעה
מאבד את עוטף ה-`<pre><code class="hljs">`** — מתרנדר כ-spans צבועים ערומים בלי block,
בלי monospace, בלי רקע, ובבועה עברית (RTL) — הפוך ומעוות.

זו בדיוק מחלקת-הבאג שה-heavy gate קיים כדי לתפוס: ה-suite ירוק כי הטסט המעורב היחיד
(`mixed code + math`) **תת-מאמת** — הוא בודק נוכחות spans+katex אבל לא שה-`<pre>` שורד.

---

## Findings

### F1 — [BLOCKING / regression] בלוק-קוד לפני KaTeX מאבד את עוטף `<pre><code class="hljs">`

**שורש מאומת** (`markdown-parse.ts` + `markdown.ts`):
ה-brief תכנן `CODE_SENTINEL` נפרד (PUA `U+E002`). המימוש סטה: כיוון ש-`U+E002` נמחק
ע"י DOMPurify, code fragments אוחסנו ב-`currentMap` המשותף עם `BLOCK_SENTINEL`, וההפרדה
KaTeX/code נעשית לפי **גבול-מיקום** `currentMap.slice(0, katexCount)` / `slice(katexCount)`.
אבל `storeCodePlaceholder` **לא** מעדכן את `katexCount`, ורק `storePlaceholder`/`storeInlinePlaceholder`
(KaTeX) כן. לכן כש-code block נדחף **לפני** KaTeX, הוא נוחת ב-`currentMap[0]`, אז ה-KaTeX
דוחף ומקפיץ `katexCount=2`, וכל המערך מסווג כ-`katexFragments`. ה-code block עובר
**KATEX_ALLOW** במקום CODE_ALLOW. KATEX_TAGS לא כולל `pre`/`code` → העוטף נמחק, רק ה-spans
שורדים.

**הוכחה אמפירית** (headless render דרך `renderMarkdown`):

| קלט | preCount צפוי | preCount קיבל |
|---|---|---|
| ` ```ts``` ` בלבד | 1 | **1 ✓** |
| ` ```ts``` ` + `$x^2$` (code→math) | 1 | **0 ✗** |
| `$x^2$` + ` ```ts``` ` (math→code) | 1 | 1 ✓ |
| code,math,code | 2 | **1 ✗** |
| code,math,code,math,code | 3 | **1 ✗** |
| code + table + `$z^2$` | 1 | **0 ✗** |

הכלל: **כל בלוקי-הקוד שלפני ביטוי-ה-KaTeX הראשון בהודעה מאבדים את העוטף.**

מבנה הפלט בכשל (קלט `"Here is code:\n\n```ts\nconst greeting='hi'\n```\n\nAnd math $x^2$ done."`):
```
<p>Here is code:</p>
<span class="hljs-keyword">const</span> greeting = <span class="hljs-string">'hi'</span><p>And math <span class="katex">…</span> done.</p>
```
ה-spans הצבועים תלויים באוויר בין שני `<p>` — בלי `<pre>` (`white-space:pre`,רקע,padding,
overflow-x), בלי `pre code` (monospace), ובלי `direction:ltr` (MarkdownContent.svelte:69).
בבועה עברית הקוד יזרום RTL עם newlines קרוסים — שבירה ויזואלית בולטת.

**חומרה**: high-functional. ה-trigger נפוץ מאוד (סוכן עונה בקוד ואז נוסחה/inline-math).
**לא** חור-אבטחה: hljs מבצע escape לתוכן הקוד *לפני* ה-sanitize, אז גם בנתיב KATEX_ALLOW
(שמתיר style) injection של `<span style="position:fixed">` יוצא כטקסט-escaped בלבד
(`&lt;span style=…&gt;`), לא כ-attribute חי. אומת ישירות — `<span style="position:fixed`
לא מופיע בפלט. המודל-אבטחה מחזיק; רק הרינדור נשבר.

**הטסט שמיסך**: `markdown.test.ts:221` "mixed code + math" משתמש ב-code-first-then-math
(בדיוק התרחיש השבור) אבל מאמת רק `hljs-keyword` ו-`katex` — לא `<pre>`. לכן ירוק על באג.

### F2 — [minor] תיעוד/תכנון פנימי לא תואם את המימוש (sentinel)

ה-brief (§4 Commit 1) + ה-API skeleton מציינים `CODE_SENTINEL = ""` (U+E002) ו-
`parseToHtml → { html, katexFragments, codeFragments }` עם sentinel עצמאי. המימוש זנח
את ה-sentinel הנפרד לטובת boundary-by-index משותף. הסטייה עצמה לגיטימית (U+E002 נמחק),
אבל היא **שורש F1** — ה-boundary השברירי. אילו היה sentinel-נפרד ששורד (או מיפוי
type-per-index), הסיווג היה עמיד-לסדר. ראוי לתיעוד-decision; קשור ישירות ל-fix של F1.

### F3 — [minor / cosmetic] `<code>` plain ללא lang מקבל `class="hljs"` ריק

בלוק בלי שפה (` ``` ` סתום) מרונדר `<pre><code class="hljs">…</code></pre>` בלי spans
(כצפוי, escape בלבד) — אבל עם `class="hljs"`. לא מזיק (אין כלל-CSS שתלוי ב-`.hljs` הריק,
רק ב-`.hljs-*`), והעוטף נכון. רושם כאן רק לשלמות; לא חוסם.

---

## DoD (§5)

| # | בדיקה | סטטוס | ראיה |
|---|---|---|---|
| 1 | highlightCode + טסטים ירוקים | ✅ | 9/9 code-highlight ירוקים |
| 2 | בלוק עם שפה מוצג צבוע | ✅* | spans hljs-* נכונים — *אבל נשבר אם קודם ל-KaTeX (F1) |
| 3 | אין `style=` בפלט-המרקדאון (אבטחה) | ✅ | code-only injected style → 0 raw `<span style=`; hljs escape קודם ל-sanitize |
| 4 | `<script>` בקוד escaped | ✅ | `<script>` לא בפלט בכל התרחישים |
| 5 | שפה לא-מוכרת → plain, בלי שגיאה | ✅ | brainfuck/lang-ענק → plain, ללא throw |
| 6 | KaTeX + טבלאות בלי רגרסיה | ⚠️ | KaTeX/טבלאות לבד תקינים; **code+KaTeX מעורב שובר את הקוד (F1)** |
| 7 | theme מתחלף עם הפלטה | ✅ (סטטי) | כל 8 פלטות × 9 `--hl-*` מוגדרים; CSS vars → token classes. *(לא אומת חי — אין דפדפן)* |
| 8 | bundle בגבול (לא full hljs) | ✅ | רק 16 grammars; שפות לא-רשומות (php/swift/haskell/kotlin…) = 0 hits בבאנדל |
| 9 | typecheck + lint ירוקים | ✅ | svelte-check 0 errors 0 warnings; build עובר |
| 10 | streaming: בלוק-קוד נצבע תוך-זרימה | ✅ | קוד חלקי (`ignoreIllegals`) → spans, ללא throw, `<pre>` שורד (כל עוד אין KaTeX קודם) |

**8/10 PASS** · #2 ו-#6 נפגעים מ-F1.

---

## מה כן נבדק ואומת (אזורי-כיסוי heavy)

- **Bundle control**: אומת אמפירית שאין full-import — grep על grammars לא-רשומות בבאנדל הקליינט = 0.
- **Security (critical)**: code-only injected `<span style>` → לא דולף (CODE_ALLOW). raw model overlay span → נמחק (MARKDOWN_ALLOW). js-href/onerror → נמחקים. גם בנתיב-הכשל F1 — אין דליפת style חי.
- **Cross-store / fragment pipeline**: זה השדה שבו נמצא F1 — סיווג KaTeX↔code לפי boundary.
- **Hardcoded nulls / spec drift**: SAFE_LANG_RE מסנן lang זדוני (`ts" onload=…` → no onX). אין null hardcoded.
- **Regression (slices קודמים)**: טבלאות GFM, bold/italic/heading/list, KaTeX inline+block+matrix — כולם תקינים ללא code מעורב.
- **Edge cases**: code-in-list, indented-code, tilde-fence, empty-block, huge-lang, hebrew-in-code, partial-streaming — כולם OK (כשאין KaTeX קודם).
- **SSR**: `pnpm build` עובר — hljs+katex רצים ב-node.

## מה לא ניתן לבדוק בסביבה זו

- **סקירה ויזואלית חיה בדפדפן** (mobile/desktop, החלפת-פלטה, RTL חי): אין linux-gui /
  playwright / browser CLI על ה-Windows dev box. ה-pipeline טהור (jsdom/node, SSR-safe),
  כך שכל ה-DOM-output אומת headless — שזה משטח-הבאג המלא של הסלייס. הצביעה-לפי-פלטה
  היא CSS-vars טהור ואומתה סטטית (כל הפלטות × כל ה-tokens). שכבת ה-layout בלבד לא נצפתה חי.

## המלצה (לא הכרעה — מרדכי מחליט)

F1 דורש fix לפני merge. הכיוון הטבעי: לרשום **type פר-index** ב-currentMap (למשל
`fragmentKinds: ("katex"|"code")[]`) ולסנן בפועל לפי הסוג, במקום הנחת-סדר `slice(katexCount)`.
זה גם מייתר את F2. אחרי fix — להוסיף טסט שמאמת `<pre>` שורד בקלט code-first-then-math
(ולא רק spans+katex), כדי שה-suite יתפוס regression כזה בעתיד.

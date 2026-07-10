# Slice D — code-syntax-highlight — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: הושלם — 3 commits (ffd902a, b3ab9e1, da82552) על branch slice/code-syntax-highlight. ממתין לאימות כלב-heavy ומיזוג ע"י מרדכי.
> **Complexity**: 8/10 (verifier: **heavy** — `calev-heavy`)
> **תלות**: slice A (`markdown-content-unify`). **depends_on: [A]**. base=**dev לאחר מיזוג A**.

## §0 — Pre-flight

### ⛔ Dispatch gate — קראי לפני הכל
**אסור ליצור את ה-worktree של ה-slice הזה לפני ש-slice A מוזג ל-dev.** ה-slice כותב theme-CSS
ל-`MarkdownContent.svelte` ומסתמך על ה-wrapper `.md-content` ועל `white-space:pre` — **כולם נוצרים ב-A**.
מרדכי מדאספטצ'ת את D **רק אחרי** ש-A על dev. ברגע ש-A מוזג → `MarkdownContent.svelte` קיים ב-dev,
ו-base=dev נכון ופשוט (בלי שרשור-merge). (אם מסיבה כלשהי צריך להריץ D במקביל ל-A לפני מיזוג —
זו הכרעת-מרדכי, base=`slice/markdown-content-unify`, אבל **ברירת-המחדל היא להמתין למיזוג A**.)

### Worktree
```bash
# רק אחרי ש-A מוזג ל-dev (ראה Dispatch gate למעלה). MarkdownContent.svelte כבר על dev.
git worktree add .worktrees/code-syntax-highlight -b slice/code-syntax-highlight dev
cd .worktrees/code-syntax-highlight
pnpm install && pnpm hooks:install
```

### Run
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- Tests: `pnpm --filter @drive-coding/frontend-v2 test`
- BE (לבועות-אמת): `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`

### Browser
- Chrome רגיל. לבדוק **גם בערכת-עיצוב כהה וגם בהירה** (theme-CSS תלוי-פלטה) ובעברית+אנגלית.

### OneCLI agent
- `voice-acp` — רק להרצת BE.

### Reading list
**must-read לפני**:
- `src/lib/util/markdown.ts` — ה-pipeline two-pass + ה-allowlists + הדפוס של KaTeX (**זה התקדים המדויק**).
- `src/lib/util/markdown-parse.ts` — `marked.use({extensions})`, `currentMap`, `storePlaceholder`, ה-sentinels.
- `docs/decisions/voice-acp.md` §latex-math — הרציונל של allowlist-פר-מקור (two-pass).

**reference**:
- `MarkdownContent.svelte` (מ-A) — היכן ה-CSS של code-block יושב (שם נכנס ה-theme).

## §1 — מטרה

היום קוד בתוך הצ'אט מוצג בצבע אחיד (אפור על רקע כהה). אחרי ה-slice: בלוקי-קוד עם שפה
מוגדרת (` ```ts `, ` ```python ` וכו') מוצגים **צבועים** — מילות-מפתח, מחרוזות, הערות, מספרים —
לפי ערכת-העיצוב הפעילה. הצביעה נעשית **מבלי לפגוע במודל-האבטחה** (secure-by-construction):
אף `style` גולמי לא נכנס לנתיב-המרקדאון; הצביעה מבודדת ל-pass-שלישי משלה (בדיוק כמו KaTeX).

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| צביעת בלוקי-קוד עם שפה מוכרת (class-based, highlight.js) | ✅ | req #7 |
| pass-שלישי-מבודד לסינון ה-HTML הצבוע (`span`+`class` בלבד) | ✅ | ליבת-האבטחה |
| theme-CSS תלוי-פלטה (`.hljs-*` → CSS vars) | ✅ | — |
| רישום סלקטיבי של ~15 שפות נפוצות (לא ה-full bundle) | ✅ | bundle control |
| **inline-style** בצביעה (כמו Shiki) | ❌ | נדחה — מתנגש במודל. ראה §הכרעה |
| auto-detection אגרסיבי לשפה לא-מוגדרת | ❌ | §9 — ברירת-מחדל: שפה לא-מוכרת/חסרה → plain |
| צביעת **inline code** (`` `x` ``) | ❌ | רק בלוקים (` ``` `). inline נשאר מונוכרום |
| כפתור copy על הבלוק | ❌ | **slice C** (`code-copy-button`) |
| no-wrap + גלילה אופקית | ❌ | **slice A** (כבר שם) |

## §3 — Architecture diagram + ההכרעה המרכזית

```
util/
  code-highlight.ts        ← חדש: registerLanguages() פעם אחת + highlightCode(code, lang): string
  markdown-parse.ts        ← משתנה: renderer.code override → highlightCode + storeCodePlaceholder
                              + CODE_SENTINEL חדש + codeFragments מוחזר מ-parseToHtml
  markdown.ts              ← משתנה: pass-שלישי — DOMPurify(codeFragment, CODE_ALLOW=span+class)
                              + splice של code sentinels
components/chat/bubbles/
  MarkdownContent.svelte   ← משתנה (מ-A): מוסיף theme-CSS .hljs-* → CSS vars
```

### ההכרעה: למה pass-שלישי-מבודד, ולמה highlight.js

מודל-האבטחה הקיים: `MARKDOWN_ALLOW` **בלי** `span`/`style`/`class` — הגנה מ-overlay-phishing
דרך prompt-injection (מודל זדוני פולט `<span style="position:fixed">`). כל highlighter מוסיף
markup בתוך הקוד → **חייב** מסלול מבודד. הדפוס כבר קיים ומוכח עבור KaTeX (block/inline sentinels
→ `KATEX_ALLOW` נדיב מבודד). מוסיפים מסלול שלישי **צר יותר** לקוד.

**הזרימה (ארבעה passes, הרחבה של השניים הקיימים):**
```
parseToHtml(text):
  marked.parse עם renderer.code:
    highlightCode(token.text, token.lang) → "<span class='hljs-keyword'>...</span>..."
    fullBlock = <pre><code class="hljs language-ts">...spans...</code></pre>
    storeCodePlaceholder(fullBlock) → codeFragments.push, מחזיר sentinel **עצמאי** (block-level):
      CODE_SENTINEL{idx}CODE_SENTINEL
  → { html, katexFragments, codeFragments }

renderMarkdown(text):
  pass-2: DOMPurify(html, MARKDOWN_ALLOW)        // ה-sentinel = טקסט בלבד (שורד)
  pass-3a: DOMPurify(katexFragment, KATEX_ALLOW)  // קיים
  pass-3b: DOMPurify(codeFragment, CODE_ALLOW)    // ← חדש: { ALLOWED_TAGS:['pre','code','span'], ALLOWED_ATTR:['class'] }
  pass-4: replace sentinels (katex + code)
```

> ⚠️ **למה הבלוק כולו ב-fragment ולא רק ה-spans** (גוטשה שתפסתי בתכנון): `MARKDOWN_ATTR` **לא**
> כולל `class` (בכוונה — secure-by-construction). אם ה-`<pre><code class="hljs">` נשאר בנתיב-המרקדאון,
> pass-2 ימחק את ה-`class` מהעוטף → ה-theme יישבר. לכן ה-**בלוק כולו** (pre+code+spans) נכנס ל-fragment
> המבודד, ו-`CODE_ALLOW` מתיר `pre`/`code`/`span` + `class`. `MARKDOWN_ALLOW` נשאר נקי לחלוטין מ-`class`.
> זה גם מדויק יותר לתקדים KaTeX (שמאחסן את הבלוק השלם, לא רק את הפנימיים).

**למה highlight.js ולא Shiki/Prism:**
- **highlight.js** — פלט class-בלבד (`<span class="hljs-...">`), **סינכרוני**, ללא WASM, רץ ב-node
  (SSR-safe כמו KaTeX). מתלבש 1:1 על המסלול-המבודד: `CODE_ALLOW` = `span`+`class`, **בלי style**.
  `MARKDOWN_ALLOW` נשאר נקי. → **נבחר.**
- **Shiki** — פלט inline-`style` (מתנגש במודל), async, WASM כבד. נדחה.
- **Prism** — גם class-based, אך highlight.js נקי יותר ב-node ובזיהוי-שפה. נדחה לטובת hljs.

**bundle**: `highlight.js/lib/core` + רישום ידני של ~15 שפות (לא `highlight.js` המלא ~ מאות KB).

## §4 — Commits

### Commit 0 — `code-highlight.ts` (approach: **TDD** — פונקציה דטרמיניסטית)

**קבצים חדשים**: `packages/frontend/src/lib/util/code-highlight.ts` + `code-highlight.test.ts`
**dep חדש**: `highlight.js` (^11) — `pnpm --filter @drive-coding/frontend-v2 add highlight.js`

**API skeleton**:
```ts
// רישום סלקטיבי — נקרא פעם אחת ברמת-מודול (כמו marked.use)
// שפות: typescript, javascript, json, bash, python, xml(html), css,
//        markdown, diff, yaml, sql, rust, go, c, java
import hljs from "highlight.js/lib/core"
import typescript from "highlight.js/lib/languages/typescript"
// ...

/**
 * מחזיר HTML צבוע (span.hljs-* בלבד) לקוד נתון.
 * - lang מוכר ורשום → hljs.highlight(code, { language: lang })
 * - lang חסר/לא-מוכר → escape בלבד (plain), בלי spans, בלי זריקה.
 * אסור throw. trust=N/A (hljs לא מריץ HTML).
 */
export function highlightCode(code: string, lang: string | undefined): string
```

**Verification (TDD)**:
```bash
cd packages/frontend && pnpm test code-highlight
# הטסטים חייבים לכלול:
# 1. highlightCode("const x = 1","typescript") מכיל <span class="hljs-keyword">const</span>
# 2. הפלט מכיל class= אבל **לא** מכיל style= (אימות-אבטחה אמפירי על hljs)
# 3. lang לא-מוכר ("brainfuck") → plain escaped, ללא <span, ללא throw
# 4. lang חסר (undefined) → plain escaped
# 5. קוד עם < > & → escaped נכון (אין HTML-injection מהקוד עצמו)
pnpm typecheck
```

### Commit 1 — חיווט ל-pipeline + pass-שלישי-מבודד (approach: **TDD** — pure parse/render)

**שינויים**:
- `markdown-parse.ts`:
  - להוסיף `CODE_SENTINEL` (PUA חדש, למשל ``) ליד `BLOCK_SENTINEL`/`INLINE_SENTINEL`.
  - להוסיף `let codeFragments: string[] = []` + `storeCodePlaceholder(html)` (כמו `storePlaceholder`).
  - `marked.use({ renderer: { code(token) {...} } })` — קורא `highlightCode(token.text, token.lang)`,
    בונה את הבלוק השלם `<pre><code class="hljs${langClass}">${spans}</code></pre>` (כש-`langClass` =
    ` language-${escapeLang(token.lang)}` רק אם lang קיים), קורא `storeCodePlaceholder(fullBlock)`,
    ומחזיר sentinel **עצמאי** `${CODE_SENTINEL}${idx}${CODE_SENTINEL}` (לא עטוף ב-pre/code — הם בתוך ה-fragment).
    ⚠️ `token.lang` חייב escape/allowlist `[a-z0-9+#-]` בלבד לפני שילובו ב-class.
  - `parseToHtml` מאפס `codeFragments=[]` ומחזיר `{ html, katexFragments, codeFragments }`.
- `markdown.ts`:
  - `CODE_ALLOW = { ALLOWED_TAGS: ["pre","code","span"], ALLOWED_ATTR: ["class"], ALLOW_DATA_ATTR: false }`.
  - ב-`renderMarkdown`: לסנן כל `codeFragment` עם `CODE_ALLOW`, ולהרחיב את `replacePlaceholders`
    שיחליף גם `CODE_SENTINEL` (מ-`cleanCode[]`).
  - SSR path: כמו KaTeX — `replacePlaceholders` עם ה-raw fragments.

**API skeleton (markdown-parse)**:
```ts
export const CODE_SENTINEL = ""
export function parseToHtml(text: string):
  { html: string; katexFragments: string[]; codeFragments: string[] }
```

**Verification (TDD)**:
```bash
cd packages/frontend && pnpm test markdown
# טסטים חדשים ב-markdown.test.ts:
# 1. renderMarkdown("```ts\nconst x=1\n```") מכיל <span class="hljs-keyword"> ו-class="hljs"
# 2. **אבטחה**: בלוק-קוד שמכיל </code><span style="position:fixed">x — הפלט **בלי** style=
# 3. אבטחה: בלוק-קוד עם <script> → אין <script בפלט (escaped)
# 4. KaTeX עדיין עובד (אין רגרסיה — $x^2$ מרונדר), טבלאות עדיין עובדות
# 5. בלוק בלי שפה → <pre><code> בלי spans (plain), עדיין מסונן
pnpm typecheck
```

### Commit 2 — theme-CSS תלוי-פלטה (approach: manual — browser visual)

**שינויים**: `MarkdownContent.svelte` (מ-A) — להוסיף ל-`<style>` mapping `.hljs-*` → CSS vars:
```css
.md-content :global(.hljs-keyword), .md-content :global(.hljs-built_in) { color: var(--hl-keyword); }
.md-content :global(.hljs-string), .md-content :global(.hljs-regexp)     { color: var(--hl-string); }
.md-content :global(.hljs-comment)                                       { color: var(--hl-comment); font-style: italic; }
.md-content :global(.hljs-number), .md-content :global(.hljs-literal)    { color: var(--hl-number); }
.md-content :global(.hljs-title), .md-content :global(.hljs-function)    { color: var(--hl-func); }
.md-content :global(.hljs-attr), .md-content :global(.hljs-property)     { color: var(--hl-attr); }
/* ...שאר ה-token classes הנפוצים... */
```
- להגדיר את ה-tokens `--hl-*` ב-`app.css` תחת **כל** פלטה (`@layer base`, ליד שאר ה-tokens), כך
  שהצבעים מתחלפים עם ה-theme. ערכים: לקחת מ-theme hljs קיים (למשל github-dark/light) ולהתאים לקונטרסט.

**Verification (manual)**:
```bash
cd packages/frontend && pnpm build   # לוודא bundle נבנה
# למדוד תוספת-bundle: השוואת dist לפני/אחרי (יעד: < ~60KB gzip לתוספת hljs+languages)
# browser: בלוק ```ts``` + ```python``` + ```bash``` → צבעים נכונים בכל פלטה (כהה+בהיר)
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `highlightCode` קיים + טסטים ירוקים | `pnpm test code-highlight` |
| בלוק עם שפה מוצג צבוע | browser: ` ```ts ` → מילות-מפתח בצבע |
| **אין `style=` בפלט-המרקדאון** (אבטחה) | טסט: renderMarkdown של code עם `<span style>` זדוני → 0 התאמות `style=` |
| `<script>` בקוד לא רץ | טסט: code עם `<script>` → escaped |
| שפה לא-מוכרת → plain, בלי שגיאה | טסט + browser: ` ```foobar ` → טקסט-קוד רגיל |
| KaTeX + טבלאות בלי רגרסיה | `pnpm test markdown` ירוק |
| theme מתחלף עם הפלטה | browser: החלפת ערכת-עיצוב → צבעי-קוד משתנים |
| תוספת-bundle בגבול | מדידת dist לפני/אחרי < יעד |
| typecheck + lint ירוקים | `pnpm typecheck && pnpm lint` |
| streaming: בלוק-קוד נצבע גם תוך-כדי-זרימה | browser: תשובה ארוכה עם code → נצבע, מתייצב בסוף |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| hljs פולט `style` במקרה-קצה → דליפה ל-DOM | אבטחה | `CODE_ALLOW` **מסיר** style גם אם יופיע (allowlist=class בלבד). טסט-אבטחה ב-DoD מאמת אמפירית. |
| `token.lang` זדוני נכנס ל-`class="language-X"` | injection | escape/allowlist `[a-z0-9+#-]` על lang לפני שילובו ב-class. |
| bundle מתנפח (highlight.js המלא) | bundle | `highlight.js/lib/core` + רישום ידני בלבד. **אסור** `import hljs from "highlight.js"` (גורר הכל). מדידת-bundle ב-DoD. |
| highlightAuto איטי/שגוי בזיהוי | perf/UX | לא משתמשים ב-auto — שפה לא-מוכרת→plain (§9). |
| streaming: hljs על קוד חלקי פולט שגיאה/ריצוד | streaming | hljs `ignoreIllegals:true`; הצביעה מתייצבת בסוף-הזרם. מקובל. בדיקה חיה. |
| sentinel CODE_SENTINEL מתנגש ב-katex sentinels | pipeline | PUA נפרד (``); regex-replace נפרד. טסט שמערבב code+math באותה הודעה. |
| ה-theme לא קריא בפלטה בהירה | UX | `--hl-*` מוגדר פר-פלטה; בדיקה ויזואלית בכהה **וגם** בהיר ב-DoD. |
| SSR: hljs לא רץ ב-node | SSR | hljs core סינכרוני ורץ ב-node (כמו `katex.renderToString`). לאמת ב-`pnpm build`. |

## §7 — Escalation triggers

- אם `CODE_ALLOW=span+class` חוסם משהו ש-hljs **כן** צריך (tag/attr לא-צפוי) → **עצור ושאל מרדכי**;
  אל תרחיב את ה-allowlist לבד (זו הכרעת-אבטחה).
- אם נדרש `style` כדי שצביעה תיראה טוב → **עצור** — זה סימן שבחירת-הספרייה שגויה (חזרה ל-§ההכרעה).
- אם hljs core לא רץ ב-node (SSR שובר) → עצור; ייתכן שצריך lazy/CSR-only — הכרעה ארכיטקטונית.
- אם תוספת-ה-bundle חורגת מהותית מהיעד → עצור, נשקול subset קטן יותר של שפות.

## §8 — Complexity score

- commits: 3 (סביר), אבל 2 מהם TDD על pipeline רגיש
- שכבות חדשות: util חדש (`code-highlight`) + הרחבת ה-pipeline (+pass) — בינוני-גבוה
- APIs חיצוניים: dep חדש (highlight.js) +1
- streaming/async pipeline: נוגע ברינדור-streaming +2
- שינוי ב-security-critical path (allowlist חדש, sentinel חדש) +2

**Score: 8/10 → verifier: heavy (`calev-heavy`)**. הנימוק: שינוי ב-**נתיב קריטי-לאבטחה** + streaming +
visual-per-palette. heavy בודק רגרסיות (KaTeX/טבלאות), edge-cases (code+math מעורב, lang זדוני),
וסקירה ויזואלית בשתי פלטות.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | שפה חסרה/לא-מוכרת — auto-detect או plain? | **plain** (מהיר, ללא זיהוי-שגוי) | ❌ |
| 2 | אילו ~15 שפות לרשום? | ts/js/json/bash/python/xml/css/md/diff/yaml/sql/rust/go/c/java | ❌ |
| 3 | theme — לגזור מ-github-dark/light או לכתוב ידנית פר-פלטה? | להתחיל מ-github ולהתאים קונטרסט ל-4 הפלטות | ❌ |
| 4 | האם לצבוע גם inline `` `code` ``? | לא — בלוקים בלבד (inline מונוכרום) | ❌ |
| 5 | ~~base — A מוזג בזמן ה-dispatch?~~ **הוכרע** | **base=dev, gated על merge של A** (ראה Dispatch gate ב-§0). D לא מדאספטצ'ת לפני ש-A על dev. | ✅ **נסגר** |

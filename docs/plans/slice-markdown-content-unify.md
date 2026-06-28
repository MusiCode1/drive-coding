# Slice A — markdown-content-unify — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: מאושר (אביגיל READY — סבב 2, 0 findings חוסמים)
> **Complexity**: 6/10 (verifier: light)
> **תלות**: אין (base=dev). פותח את שרשרת C-frontend: B (dir-per-paragraph), C (code-copy-button), D (syntax-highlight) ייבנו מעל ה-slice הזה.

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/markdown-content-unify -b slice/markdown-content-unify dev
cd .worktrees/markdown-content-unify
pnpm install && pnpm hooks:install
```

### Run
- FE בלבד (slice זה לא נוגע ב-BE): `pnpm --filter @drive-coding/frontend-v2 dev` (port: OS-assigned, Vite מדפיס).
- כדי לראות בועות אמיתיות צריך BE+agent מחובר: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts` (TTS לא נדרש ל-slice הזה, אבל BE כן — לחיבור agent).
- Tests: `pnpm --filter @drive-coding/frontend-v2 test`

### Browser
- Chrome רגיל על `http://localhost:<vite-port>` מספיק (אין secure-context APIs ב-slice הזה).
- לאמת **גם בעברית וגם באנגלית** (RTL/LTR משפיע על list-marker ועל code-block).

### OneCLI agent
- `voice-acp` — רק כדי להריץ BE לחיבור agent. אין שינוי בנתיבי-proxy.

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי-הזהב של ה-FE (שכבות; component ב-presentation בלבד).
- הקבצים שמשתנים (קצרים): `MarkdownContent` חדש; `MessageBubble.svelte`, `UserBubble.svelte`, `ThoughtBubble.svelte`, `modals/ContentViewerDialog.svelte`.

**reference בזמן עבודה**:
- `src/lib/util/markdown.ts` — לוודא ש-`renderMarkdown` נקרא כמו שהוא (אסור לגעת).
- `src/lib/components/chat/bubbles/bubble-rendering.ts` — `joinSegmentText`.

## §1 — מטרה

היום ארבעת משטחי-המרקדאון מטפלים בו בדרכים לא-עקביות:
- `MessageBubble` — CSS **מלא** (p/strong/em/blockquote/ul/ol/li/h1-3/a/hr/code/pre/table).
- `UserBubble` — קורא `renderMarkdown` אבל ה-CSS שלו **חלקי**: מגדיר רק `code`/`pre`/`table`.
  **חסרים `blockquote`, `ul`, `ol`, `li`, `h1-3`, `a`, `hr`, `p`** → ציטוט/רשימה/כותרת בהודעת-משתמש
  מרונדרים כ-HTML נכון אך **ללא עיצוב** → נראים כטקסט רגיל. (זה השורש ל"מרקדאון לא נראה בהודעות-משתמש":
  `> ציטוט` יוצר `<blockquote>` אמיתי, אבל בלי border/indent הוא ויזואלית = פסקה. `**bold**` שורד רק
  כי דפדפן מדגיש כברירת-מחדל.)
- `ThoughtBubble` — מרנדר **טקסט גולמי בלבד** (`whitespace-pre-wrap`, ללא מרקדאון).
- `ContentViewerDialog` — עותק רביעי של ה-CSS המלא, עם שני באגים (ראה למטה). בנוסף יש שני באגים נראים-לעין:
(1) **רשימות ממוספרות/תבליטים לא מציגים סמן** — Tailwind v4 preflight מאפס `list-style:none`
ו-ה-CSS של הבועות לא משחזר; (2) **קוד ארוך נשבר לשורות** במקום גלילה אופקית. אחרי ה-slice
הזה: קומפוננטה אחת `MarkdownContent.svelte` היא מקור-האמת היחיד לרינדור-מרקדאון-בבועה —
שלוש הבועות מאצילות אליה, מחשבות תומכות במרקדאון מלא, רשימות מציגות סמנים, וקוד גולש אופקית.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| חילוץ `MarkdownContent.svelte` משותף | ✅ | — |
| תיקון רשימות (list-style restore) | ✅ | req #5 |
| קוד: no-wrap + גלילה אופקית | ✅ | req #1 |
| בועת-מחשבה → מרקדאון מלא | ✅ | req #4 |
| הודעות-משתמש מרקדאון (כבר קיים — נשמר עקבי) | ✅ | req #3 |
| `ContentViewerDialog` (תצוגת-fullscreen) — משטח-מרקדאון **רביעי** | ✅ | finding אביגיל #1 — כפתור expand ב-MessageBubble פותח אותו; בלי זה שני הבאגים שורדים קליק אחד |
| `dir="auto"` **פר-פסקה** | ❌ | **slice B** (`markdown-dir-per-paragraph`) — נשאר `dir="auto"` ברמת-המכל כמו היום |
| כפתור copy פר code-block | ❌ | **slice C** (`code-copy-button`) |
| סימון-קוד צבעוני (syntax highlight) | ❌ | **slice D** (`code-syntax-highlight`) |
| `ToolBubble` (פלט-כלי) | ❌ | מחוץ ל-scope — הוא כופה `dir=ltr` בכוונה; לא נוגעים |
| שינוי ב-`markdown.ts` / `markdown-parse.ts` (ה-pipeline) | ❌ | A הוא **CSS+composition בלבד**. שינויי-pipeline שמורים ל-B/D |

## §3 — Architecture diagram

```
view-models/   (ללא שינוי)
actions/        (ללא שינוי)
engines/        (ללא שינוי)
adapters/       (ללא שינוי)
routes/components:
  chat/bubbles/
    MarkdownContent.svelte   ← חדש: {@html renderMarkdown(text)} + כל ה-:global markdown CSS
    MessageBubble.svelte     ← משתנה: מאציל ל-MarkdownContent, מסיר CSS משוכפל
    UserBubble.svelte        ← משתנה: מאציל ל-MarkdownContent, מסיר CSS משוכפל
    ThoughtBubble.svelte     ← משתנה: running-text + translated paths → MarkdownContent
  modals/
    ContentViewerDialog.svelte ← משתנה: variant="viewer" → MarkdownContent, מסיר CSS משוכפל
  util/
    markdown.ts              ← ללא שינוי (renderMarkdown נשאר כמו שהוא)
```

ה-pipeline (`renderMarkdown`) **לא נוגעים בו**. כל השינוי הוא בשכבת ה-presentation:
איפה קוראים ל-`renderMarkdown` ואיזה CSS עוטף את הפלט.

## §4 — Commits

### Commit 0 — `MarkdownContent.svelte` (approach: manual — UI composition, browser smoke)

**קבצים חדשים**: `packages/frontend/src/lib/components/chat/bubbles/MarkdownContent.svelte`

**תוכן**: קומפוננטה דקה שמקבלת `text` ומרנדרת מרקדאון מחוטא, ומחזיקה את **כל** ה-CSS
של מרקדאון-בבועה (מאוחד מ-`MessageBubble`+`UserBubble` — הם זהים כמעט-לחלוטין).

**API skeleton**:
```svelte
<script lang="ts">
import { renderMarkdown } from "$lib/util/markdown"
let { text, variant = "bubble" }: { text: string; variant?: "bubble" | "viewer" } = $props()
</script>

<div class="md-content" class:viewer={variant === "viewer"} dir="auto">{@html renderMarkdown(text)}</div>
```

> **הערה**: `dir="auto"` נשאר על המכל (כמו היום). פר-פסקה = slice B.
> ה-`<div class="md-content">` החיצוני קיים כדי שכלל ה-`:global` יתוחם תחתיו (`.md-content :global(...)`).
> **`variant="viewer"`** (עבור `ContentViewerDialog` fullscreen) — מגדיל כותרות בלבד; כל השאר זהה.
> זו נקודת-האיחוד היחידה שמונעת רגרסיה ב-fullscreen (שם הכותרות היו h1=1.4em vs 1.2em בבועה).

**CSS** (ב-`<style>` של הקומפוננטה) — מאוחד מ-`MessageBubble`/`UserBubble`, **עם שני התיקונים**:
```css
.md-content :global(p) { margin: 0.25em 0; }
.md-content :global(p:first-child) { margin-top: 0; }
.md-content :global(p:last-child) { margin-bottom: 0; }
.md-content :global(strong) { font-weight: 700; }
.md-content :global(em) { font-style: italic; }
.md-content :global(code) {
  font-family: ui-monospace, monospace; font-size: 0.88em;
  background: rgba(0,0,0,0.25); padding: 0.1em 0.3em; border-radius: 3px;
  overflow-wrap: anywhere;   /* inline code עדיין נשבר — רק block code גולש */
}
/* ── req #1: code BLOCK — no-wrap + גלילה אופקית (היה white-space:pre-wrap) ── */
.md-content :global(pre) {
  background: rgba(0,0,0,0.35); padding: 0.6rem 0.8rem; border-radius: 6px;
  margin: 0.4em 0;
  white-space: pre;          /* היה pre-wrap → לא שובר שורות */
  overflow-x: auto;          /* גלילה אופקית */
}
.md-content :global(pre code) {
  background: none; padding: 0; font-size: 0.85em;
  overflow-wrap: normal;     /* מבטל את ה-anywhere של inline-code בתוך pre */
  white-space: pre;          /* יורש, מפורש להבהרה */
}
/* ── req #5: שחזור list-style ש-Tailwind preflight איפס ── */
.md-content :global(ul) { padding-inline-start: 1.4em; margin: 0.3em 0; list-style: disc outside; }
.md-content :global(ol) { padding-inline-start: 1.4em; margin: 0.3em 0; list-style: decimal outside; }
.md-content :global(li) { margin: 0.15em 0; }
.md-content :global(h1) { font-size: 1.2em; font-weight: 700; margin: 0.4em 0 0.15em; }
.md-content :global(h2) { font-size: 1.1em; font-weight: 700; margin: 0.4em 0 0.15em; }
.md-content :global(h3) { font-size: 1em; font-weight: 700; margin: 0.4em 0 0.15em; }
/* h4-h6 בלי font-size מפורש → יורשים 1em מההורה. שקול ל-ContentViewerDialog הקודם שהגדיר 1em מפורש (finding אביגיל r2 — equivalent). */
.md-content :global(h4), .md-content :global(h5), .md-content :global(h6) { font-weight: 700; margin: 0.35em 0 0.15em; }
/* variant="viewer" — כותרות גדולות יותר ל-fullscreen (שימור התנהגות ContentViewerDialog הקודמת) */
.md-content.viewer :global(h1) { font-size: 1.4em; margin: 0.5em 0 0.2em; }
.md-content.viewer :global(h2) { font-size: 1.2em; margin: 0.45em 0 0.2em; }
.md-content.viewer :global(h3) { font-size: 1.1em; }
.md-content :global(blockquote) {
  border-inline-start: 3px solid var(--border); padding-inline-start: 0.7rem;
  margin: 0.3em 0; opacity: 0.8;
}
.md-content :global(a) { color: var(--accent); text-decoration: underline; }
.md-content :global(hr) { border: none; border-top: 1px solid var(--border); margin: 0.5em 0; }
/* code blocks כיוון LTR — מניעת ערבוב RTL בקוד (היה C5) */
.md-content :global(pre), .md-content :global(code) { direction: ltr; text-align: left; }
/* GFM tables (מ-chat-render-polish) */
.md-content :global(table) {
  border-collapse: collapse; margin: 0.4em 0; font-size: 0.92em;
  display: block; overflow-x: auto; max-width: 100%;
}
.md-content :global(th), .md-content :global(td) {
  border: 1px solid var(--border); padding: 0.3em 0.55em; text-align: start;
}
.md-content :global(th) { background: rgba(0,0,0,0.18); font-weight: 700; }
```

> ⚠️ **למה ה-list-fix עובד (מנגנון מדויק — תיקון finding אביגיל #2)**: זה **לא** specificity.
> Tailwind preflight יושב ב-`@layer base` ומאפס `list-style:none`. ה-CSS של קומפוננטת Svelte
> (`:global` בתוך `<style>`) הוא **unlayered** — וב-CSS cascade, סגנון unlayered **תמיד מנצח**
> כל `@layer` (ללא קשר ל-specificity). לכן `.md-content :global(ol){list-style:decimal}` גובר.
> זה גם מסביר למה השחזור החלקי הקיים (`padding-inline-start`) "עבד" אבל `list-style` פשוט לא היה שם.
>
> ⚠️ **list-style + RTL**: `list-style: decimal outside` עם `dir="auto"`/rtl — הסמן מופיע בצד
> ההתחלה הלוגי (ימין ב-rtl) הודות ל-`padding-inline-start`. לאמת חי בעברית **וגם** באנגלית.

**Verification**:
```bash
cd packages/frontend
pnpm typecheck            # svelte-check ירוק
pnpm test                 # אין רגרסיה בקיימים (bubble-rendering.test.ts)
```

### Commit 1 — חיווט `MessageBubble` + `UserBubble` (approach: manual)

**שינויים**:
- `MessageBubble.svelte`: להחליף את `<div ...>{@html renderMarkdown(joinSegmentText(...))}</div>`
  ב-`<MarkdownContent text={joinSegmentText(bubble.segments)} />`. **להסיר** את כל בלוק ה-CSS
  של מרקדאון (`:global(p)`...`:global(th)`) — עבר ל-`MarkdownContent`. **לשמור** את ה-styling
  של הבועה עצמה (`background`, `rounded`, `px/py`, ה-outline של isPlaying) ואת ה-`dir="auto"`
  על מעטפת-הבועה. לשמור את `<span class="hidden">{bubble.segments.length}</span>` (ריאקטיביות).
- `UserBubble.svelte`: זהה — להחליף את ה-`{@html}` ב-`<MarkdownContent>`, להסיר CSS משוכפל.

> **Svelte 5 reactivity**: ה-`<span class="hidden">{bubble.segments.length}</span>` חייב להישאר
> בתוך הבועה (לא בתוך `MarkdownContent`) — הוא מה שמכריח re-render על `.segments.push()`.
> `MarkdownContent` מקבל `text` כ-prop נגזר → משתנה כש-`joinSegmentText` משתנה → re-render. תקין.

**Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm test
# browser smoke: בועת-משתמש + בועת-סוכן עם **/bold/**, רשימה ממוספרת, code block ארוך
```

### Commit 2 — חיווט `ThoughtBubble` למרקדאון מלא (approach: manual) — req #4

**שינויים**: `ThoughtBubble.svelte`
- **מסלול running-text** (לא-מתורגם): להחליף `<div ...>{runningText}</div>` ב-
  `<MarkdownContent text={runningText} />` (להסיר `whitespace-pre-wrap` — מרקדאון מטפל).
- **מסלול מתורגם** (per-segment): את `<div ...>{seg.text}</div>` ל-`<MarkdownContent text={seg.text} />`.
  את `seg.originalText` (טקסט-מקור עמום) **להשאיר כטקסט גולמי** `dir="ltr"` — זה raw source, לא מרקדאון.
- לוודא שה-italic/`fg-dim`/`<details>` של בועת-המחשבה נשמרים (ה-CSS של `MarkdownContent` יורש `color`/`font-style` מההורה).

> **גוצ'ה**: בועת-המחשבה italic. ה-`code`/`pre` שבתוך `MarkdownContent` כופים `direction:ltr;text-align:left`
> אבל **לא** מבטלים italic. זה מקובל (קוד נטוי בתוך מחשבה). אם נראה רע חי — escalation, לא להחליט לבד.

**Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm test
# browser smoke: לגרום לסוכן לפלוט מחשבה עם רשימה/קוד/בולד → מאומת שמרונדר מרקדאון
```

### Commit 3 — חיווט `ContentViewerDialog` (approach: manual) — finding אביגיל #1

**שינויים**: `packages/frontend/src/lib/components/modals/ContentViewerDialog.svelte`
- במסלול `kind === "markdown"`: להחליף
  `<div class="markdown-body" dir="auto">{@html renderMarkdown(viewer.payload.text)}</div>`
  ב-`<MarkdownContent text={viewer.payload.text} variant="viewer" />`.
- **להסיר** את כל בלוק ה-CSS `.markdown-body :global(...)` (שורות ~85-134) — עבר ל-`MarkdownContent`.
  זה מסיר אוטומטית את שני הבאגים שהיו שם (`white-space:pre-wrap` + `ol/ul` ללא `list-style`).
- **לשמור**: מסלול ה-image (`<img class="viewer-image">`) וה-CSS שלו (`.viewer-image`) — לא קשור למרקדאון.
- **לשמור**: invariant האבטחה — `MarkdownContent` קורא רק ל-`renderMarkdown` (אסור DOMPurify ידני חדש; אסור `{@html}` על תמונה).

> **למה זה חובה ולא nice-to-have**: כפתור ה-expand ב-`MessageBubble` (`viewer.show({kind:"markdown",...})`)
> פותח את הדיאלוג הזה. בלי החיווט — המשתמשת לוחצת expand על הודעה עם רשימה-ממוספרת/קוד-רחב
> ורואה את **אותם שני הבאגים** שתיקנו בבועה. הבאג שורד קליק אחד.

**Verification**:
```bash
cd packages/frontend && pnpm typecheck && pnpm test
# browser smoke: בועת-סוכן עם רשימה+קוד → לחיצה על expand → fullscreen מציג סמנים + קוד גולש (לא שבור)
```

## §5 — DoD

| בדיקה | איך |
|---|---|
| `MarkdownContent.svelte` קיים ומיוצא | `ls packages/frontend/src/lib/components/chat/bubbles/MarkdownContent.svelte` |
| שלוש הבועות + הדיאלוג מאצילים אליו | `grep -l MarkdownContent .../bubbles/{Message,User,Thought}Bubble.svelte .../modals/ContentViewerDialog.svelte` → 4 |
| אין CSS-מרקדאון משוכפל בארבעת המשטחים | `grep -c ":global(p)" UserBubble MessageBubble ThoughtBubble ContentViewerDialog` → 0 בכולם |
| **fullscreen-expand מציג רשימות+קוד תקין** (finding #1) | browser: expand על הודעה עם `1.\n2.` + code רחב → סמנים + גלילה אופקית בדיאלוג |
| typecheck ירוק | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| טסטים ירוקים | `pnpm --filter @drive-coding/frontend-v2 test` |
| **רשימה ממוספרת מציגה 1. 2. 3.** (req #5) | browser: הודעה עם `1.\n2.\n3.` → סמנים נראים בעברית וגם באנגלית |
| **תבליטים מציגים •** | browser: הודעה עם `- a\n- b` → תבליטים נראים |
| **code block ארוך גולש אופקית** (req #1) | browser: ` ``` ` עם שורה ארוכה → סרגל-גלילה אופקי, אין שבירת-שורה |
| **בועת-מחשבה מרנדרת מרקדאון** (req #4) | browser: מחשבה עם `**bold**` + רשימה → מעוצב, לא raw |
| **ציטוט בהודעת-משתמש נראה כציטוט** (req #3 — השורש האמיתי) | browser: הודעת-משתמש `> ציטוט` → border-inline-start + indent + opacity (לא טקסט-רגיל) |
| **רשימה/כותרת בהודעת-משתמש מעוצבות** (req #3) | browser: הודעת-משתמש עם `1.\n2.` + `# כותרת` → סמנים + כותרת מודגשת (לא raw) |
| streaming: בועת-סוכן מתעדכנת תוך-כדי-זרימה | browser: תשובה ארוכה → הטקסט גדל חלק, אין הקפאה |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| `list-style:none` של Tailwind preflight חוזר ומנצח את ה-`:global` | שורש-הבאג #5 + finding אביגיל #2 | `list-style: decimal/disc outside` מפורש; **המנגנון = cascade-layer order** — ה-`:global` של Svelte הוא unlayered ומנצח את `@layer base` שבו preflight (לא specificity). לאמת חי. |
| `white-space:pre` שובר עטיפת **inline** code (לא רק block) | חדש | ה-CSS מפריד: `pre code` מקבל `pre`+`overflow-wrap:normal`; `code` לבד (inline) נשאר עם `overflow-wrap:anywhere` ובלי `white-space` → inline-code עדיין נשבר בתוך הבועה. לאמת ` `inline` ` ארוך לא מרחיב בועה. |
| Svelte 5 reactivity — בועת-streaming מפסיקה להתעדכן אחרי החילוץ | learnings (push לא מפעיל re-render בלי קריאת `.length`) | להשאיר `<span class="hidden">{bubble.segments.length}</span>` בתוך כל בועה; `MarkdownContent` מקבל `text` prop נגזר. בדיקת-stream ב-DoD. |
| בועת-מחשבה: italic/dim נשבר אחרי המעבר למרקדאון | חדש (Thought לא היה לו markdown CSS) | ה-`MarkdownContent` יורש `color`/`font-style` מההורה (לא מאפס). smoke חי על מחשבה. |
| `MarkdownContent` חושף `{@html}` של פלט לא-מחוטא | אבטחה | `MarkdownContent` קורא **אך ורק** ל-`renderMarkdown` (two-pass DOMPurify קיים). אסור לו לקבל HTML גולמי. ה-prop הוא `text: string` בלבד. |
| i18n — מחרוזת עברית מקודדת | pre-commit hook | אין מחרוזות חדשות ב-slice הזה (CSS+composition). אם בכל-זאת — `t(key)`. |

## §7 — Escalation triggers

- `list-style` לא מופיע אחרי שחזור מפורש (ייתכן ש-preflight/`@layer` מנצח באופן לא-צפוי) → עצור ושאל מרדכי.
- בועת-מחשבה נראית שבורה ויזואלית אחרי מרקדאון (italic+code מתנגשים) → עצור, אל תחליט עיצוב לבד.
- אם מתברר שצריך לגעת ב-`markdown.ts`/`markdown-parse.ts` כדי להשיג משהו מ-A → עצור; זה סימן שה-scope של A שגוי (A הוא CSS+composition בלבד).
- Svelte 5: אם ה-stream לא מתעדכן אחרי החילוץ ולא ברור למה → עצור.

## §8 — Complexity score

- commits: 4 (סביר)
- שכבות חדשות: 1 (component אחת, עם variant prop) — נמוך
- APIs חיצוניים: 0
- streaming/async: נוגע ב-streaming-render (קיים) אך לא משנה אותו → +1
- refactor state model: לא
- protocol BE↔FE: לא

**Score: 6/10 → verifier: light (`calev`)**. הסיכון העיקרי ויזואלי (CSS/RTL/streaming) — מאומת הכי טוב חי בדפדפן, לא ב-unit.

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | האם להחיל את `MarkdownContent` גם על `ToolBubble` (פלט-כלי)? | לא — הוא כופה `dir=ltr` בכוונה; מחוץ ל-scope A | ❌ |
| 2 | `list-style` `outside` או `inside`? | `outside` (סטנדרטי; עם `padding-inline-start` הסמן בתוך הבועה) | ❌ |
| 3 | בועת-מחשבה — לרנדר גם `originalText` (מקור-תרגום) כמרקדאון? | לא — raw source נשאר טקסט `dir=ltr` | ❌ |

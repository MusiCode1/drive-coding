# Slice C — code-copy-button — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: **בוצע + כלב GO 8/8** (`f14ec41` + `8957af3`); אביגיל READY r2. **base אוחד עם dev הכולל את D** (קונפליקט CSS ב-`MarkdownContent.svelte` נפתר additive). ממתין ל-smoke חי ב-preview + merge מרדכי
> **Complexity**: 6/10 (verifier: light — אך **גוטשת streaming** דורשת בדיקה חיה)
> **תלות**: depends_on: [A] — **מומשה**: A (`MarkdownContent.svelte`) כבר על dev. base=**dev** (ישיר, לא שרשור). עצמאי-קבצים מ-B ומ-D.

## §0 — Pre-flight

### ✅ Dispatch gate — נפתח
A (`markdown-content-unify`) **מוזג ל-dev** (merge `a20fbda`); `MarkdownContent.svelte` קיים על dev.
התלות היחידה של C מומשה → C משוגר ישירות על base=dev. C עצמאי-קבצים מ-B ומ-D (קובץ אחר) → אפשר במקביל להם.

### Worktree
```bash
# A כבר על dev — MarkdownContent.svelte קיים. base=dev ישיר.
git worktree add .worktrees/code-copy-button -b slice/code-copy-button dev
cd .worktrees/code-copy-button
pnpm install && pnpm hooks:install
```

### Run
- FE: `pnpm --filter @drive-coding/frontend-v2 dev`
- Tests: `pnpm --filter @drive-coding/frontend-v2 test`
- BE לבדיקת-streaming חי: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`

### Browser
- Chrome רגיל. **הבדיקה הקריטית**: בלוק-קוד שמגיע **תוך כדי-זרימה** (streaming) — לוודא שהכפתור עובד גם אחרי שה-`{@html}` מתעדכן.

### Reading list
**must-read לפני**:
- `MarkdownContent.svelte` (מ-A) — לאן נכנס ה-`use:` action וה-CSS של הכפתור.
- `src/lib/util/clipboard.ts` — `copyToClipboard(text): Promise<boolean>` (קיים, לשימוש חוזר).
- `MessageBubble.svelte` — דפוס כפתור-ההעתקה הקיים (icon→check ל-2 שניות, i18n `bubble.copy`/`bubble.copied`).

**reference**:
- `packages/frontend/AGENTS.md` — חוקי-הזהב (action ב-`actions/`, presentation).

## §1 — מטרה

היום כדי להעתיק קטע-קוד מהצ'אט צריך לסמן ידנית (קשה בנייד, ועם no-wrap+גלילה מ-slice A — בלתי-אפשרי כמעט).
אחרי ה-slice: כל בלוק-קוד מציג **כפתור העתקה** בפינה; לחיצה מעתיקה את כל הקוד ללוח ומציגה ✓ לרגע.
עובד בכל המשטחים (הודעת-סוכן/משתמש/מחשבה/תצוגה-מלאה) כי כולם עוברים דרך `MarkdownContent`.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| כפתור-העתקה פר בלוק-קוד (`<pre>`) | ✅ | req #2 |
| משוב ✓ "הועתק" ל-2 שניות | ✅ | עקבי עם כפתור-בועה קיים |
| שימוש חוזר ב-`copyToClipboard` + i18n `bubble.copy`/`bubble.copied` | ✅ | FE-only, **בלי** שינוי core |
| כפתור על **inline code** (`` `x` ``) | ❌ | רק בלוקים |
| כפתור עם תווית-שפה / מספרי-שורות | ❌ | מחוץ ל-scope |
| מפתח i18n חדש (`code.copy`) | ❌ | משתמשים חוזר ב-`bubble.copy` הקיים → נשאר FE-only |

## §3 — Architecture diagram

```
components/chat/bubbles/
  enhance-code-blocks.ts    ← חדש: Svelte use:-action (presentation DOM) — מזריק כפתור לכל <pre>
  MarkdownContent.svelte    ← משתנה (מ-A): use:enhanceCodeBlocks={...} על .md-content + CSS לכפתור
```
> ⚠️ **מיקום** (finding אביגיל): ה-action **לא** ב-`src/lib/actions/` — התיקייה ההיא שמורה
> ל-cross-layer procedures (intents כמו `connect-agent.ts`), לא ל-presentation DOM-actions.
> ה-action הזה הוא presentation טהור → **co-located** ליד `MarkdownContent.svelte`.

> **למה action ולא קומפוננטה פר-בלוק**: הקוד מרונדר עם `{@html}` — אין קומפוננטת-Svelte פר `<pre>`.
> action על המכל סורק את ה-`<pre>` שנוצרו ומזריק כפתור. **event delegation**: מאזין-לחיצה **אחד**
> נרשם על המכל ב-setup (שורד החלפת-innerHTML), הכפתורים עצמם מוזרקים-מחדש בכל `update`.

## §4 — Commits

### Commit 0 — action `enhanceCodeBlocks` (approach: manual — DOM/browser)

**קבצים חדשים**: `src/lib/components/chat/bubbles/enhance-code-blocks.ts` (co-located, **לא** `actions/`)

**API skeleton**:
```ts
import type { Action } from "svelte/action"
import { copyToClipboard } from "$lib/util/clipboard"

type Params = { text: string; labelCopy: string; labelCopied: string }

/**
 * מזריק כפתור-העתקה לכל <pre> תחת ה-node.
 * - mount + update(params): מזריק כפתור לכל <pre> שאין לו עדיין (data-flag).
 * - event delegation: מאזין click אחד על ה-node (נרשם פעם אחת ב-setup, שורד re-render).
 * - update קורה כש-text משתנה (streaming) → ה-{@html} הוחלף → מזריקים מחדש.
 */
export const enhanceCodeBlocks: Action<HTMLElement, Params> = (node, params) => { ... }
```

**לוגיקה**:
- ב-setup: רישום `node.addEventListener("click", onClick)` **פעם אחת**. `onClick` בודק
  `e.target.closest(".code-copy-btn")`; אם כן → מוצא את ה-`<pre>` (closest), קורא את
  `pre.querySelector("code")?.textContent ?? ""`, `await copyToClipboard(text)`, ומחליף
  זמנית את ה-icon/aria ל"הועתק" ל-2 שניות.
- `enhance()`: `node.querySelectorAll("pre:not([data-copy-ready])")` → לכל אחד: `pre.dataset.copyReady="1"`,
  להזריק `<button class="code-copy-btn" type="button" aria-label={labelCopy}>` עם **SVG inline** של
  אייקון-העתקה (path של lucide `copy`), בתוך ה-`<pre>` (שיהיה `position:relative`).
- `enhance()` נקרא ב-setup וב-`update` (אחרי ש-`{@html}` החדש נבנה).

> ⚠️ **גוטשת streaming**: כש-`text` משתנה, Svelte מחליף את innerHTML של `{@html}` → הכפתורים נמחקים.
> `update(params)` רץ **אחרי** עדכון-ה-DOM → `enhance()` מזריק-מחדש. ה-delegation listener על ה-node
> **לא** נמחק (הוא על ה-node, לא על ה-pre). זו הנקודה הקריטית לבדיקה חיה.

**Verification**: `pnpm typecheck` + browser (ראה DoD).

### Commit 1 — חיווט ל-`MarkdownContent` + CSS (approach: manual)

**שינויים**: `MarkdownContent.svelte`
- לייבא `enhanceCodeBlocks` + `getI18n` (לתוויות), ולהוסיף ל-`.md-content`:
  `use:enhanceCodeBlocks={{ text, labelCopy: t("bubble.copy"), labelCopied: t("bubble.copied") }}`.
- CSS: `.md-content :global(pre) { position: relative; }` +
  `.md-content :global(.code-copy-btn)` — `position:absolute; top:0.3rem; inset-inline-end:0.3rem;`
  עיגול/רקע `var(--bg-card)`/border כמו `.action-btn` הקיים; `opacity:0` ומופיע ב-hover על ה-`pre`
  (desktop), `opacity:0.7` תמיד ב-mobile (`@media (hover:none)`).
- ה-`t("bubble.copy")` → `getI18n()` מתוך context.

> ✅ **זמינות-context מוכחת** (finding אביגיל): `getI18n()` בטוח מכל 4 המשטחים —
> שלוש הבועות כבר קוראות `getI18n()`, ו-**`ContentViewerDialog.svelte:20` כבר קורא `getI18n().t`**
> בעצמו → ה-context מגיע גם למשטח-המודאלי. בנוסף, context ב-Svelte זורם דרך **עץ-הקומפוננטות**
> (לא ה-DOM), כך ש-`MarkdownContent` שמרונדר בתוך `BitsDialog.Portal` עדיין רואה אותו. אם בכל-זאת
> מתברר ש-context לא מגיע ל-Portal בזמן-ריצה → escalation (ראה §7), **לא** לפתור עם prop ידני בלי לשאול.

**Verification**: `pnpm typecheck && pnpm test` + browser.

## §5 — DoD

| בדיקה | איך |
|---|---|
| כל בלוק-קוד מציג כפתור-העתקה | browser: הודעה עם ` ``` ` → כפתור בפינה |
| לחיצה מעתיקה את הקוד | browser: לחיצה → הדבקה במקום אחר = הקוד המלא |
| משוב ✓ ל-2 שניות | browser: לחיצה → ✓ ואז חוזר |
| **בלוק-קוד מ-streaming → כפתור עובד** (גוטשה) | browser: תשובה ארוכה עם code שמגיע תוך-כדי → הכפתור עובד אחרי סיום-הזרם |
| כפתור בכל 4 המשטחים | browser: code בהודעת-משתמש + מחשבה + תצוגה-מלאה |
| אין כפתור על inline code | browser: `` `x` `` בשורה → אין כפתור |
| typecheck + lint ירוקים | `pnpm typecheck && pnpm lint` |
| אין מפתח i18n חדש (FE-only) | `git diff packages/core` → ריק |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| streaming: כפתורים נמחקים בכל re-render | learnings (Svelte `{@html}` מחליף innerHTML) | event-delegation על ה-node (לא על הכפתור) + re-inject ב-`update`. **DoD בודק חי.** |
| `update` רץ לפני שה-DOM החדש מוכן | Svelte action lifecycle | ב-Svelte, action.update רץ אחרי patch ה-DOM. אם בכל-זאת בעיה → `queueMicrotask` ל-enhance. escalation אם לא נפתר. |
| `textContent` כולל את ה-spans של highlight (אחרי D) | אינטגרציה עם D | `textContent` מתעלם מ-tags → מחזיר טקסט-קוד נקי גם עם `<span>` של hljs. תקין. |
| כפתור מכסה קוד בפינה | UX | `inset-inline-end`, opacity ב-hover; padding-top קל ל-`pre` אם צריך. |
| i18n: מחרוזת קשיחה | pre-commit hook | משתמשים ב-`t("bubble.copy")`/`t("bubble.copied")` — אין מחרוזת קשיחה. ה-SVG הוא markup, לא טקסט. |
| Svelte 5: action על component עם `{@html}` ריאקטיבי | reactivity | ה-`text` prop מועבר כ-param ל-action → `update` נורה כשהוא משתנה. עקבי עם streaming. |

## §7 — Escalation triggers
- אם הכפתור לא עובד אחרי streaming-re-render גם עם re-inject + delegation → עצור ושאל מרדכי.
- אם `update` של ה-action לא נורה כש-`text` משתנה (ריאקטיביות שבורה) → עצור.
- אם נדרש מפתח i18n חדש (core) כדי לעמוד ב-FE-only → עצור ושאל (אולי בכל-זאת מצדיק).
- אם `getI18n()` ב-`MarkdownContent` זורק/לא-מוגדר כשהוא בתוך `ContentViewerDialog` (context לא מגיע ל-Portal) → עצור ושאל מרדכי (אל תעקוף עם prop ידני בלי החלטה).

## §8 — Complexity score
- commits: 2 · שכבות חדשות: 1 (action) · APIs חיצוניים: 0 · streaming: כן (+2, הגוטשה המרכזית) · security-path: לא
- **Score: 6/10 → verifier: light (`calev`)** — אבל הבדיקה הקריטית (streaming) חייבת להיות **חיה בדפדפן**.

## §9 — שאלות פתוחות
| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | אייקון — SVG inline או תו-יוניקוד (📋)? | SVG inline (lucide copy) — עקבי עם שאר האייקונים | ❌ |
| 2 | להעתיק עם או בלי ה-trailing newline של הבלוק? | בלי trailing newline מיותר (`.trimEnd()`) | ❌ |
| 3 | base — A מוזג בזמן dispatch? | base=dev. **A מוזג בפועל (`a20fbda`)** → gate נפתח, base=dev ישיר | ✅ נסגר |

# Slice — ui-session-polish — תוכנית

> ‏שם קודם `ui-polish-batch` שונה ל-`ui-session-polish` (‏התנגשות עם slice ישן מ-06/18).

> **תאריך**: 2026-07-04
> **סטטוס**: הושלם (‏אליעזר 2026-07-04, 5 commits, branch slice/ui-session-polish)
> **Complexity**: 5/10 (verifier: light — `calev`)
> **תלות**: אין (base=dev)

חמישה תיקוני-ממשק קטנים ובלתי-תלויים זה בזה, מקובצים ל-slice אחד קליל. כולם FE
(‏פלוס תוספת מפתחות ל-`packages/core/src/i18n`). אין שינוי-חוזה, אין BE, אין streaming.

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/ui-session-polish -b slice/ui-session-polish dev
cd .worktrees/ui-session-polish
pnpm install && pnpm hooks:install
```

### Run
- ‏FE: `pnpm --filter @drive-coding/frontend dev` (‏Vite, port OS-assigned)
- ‏BE (‏רק אם צריך סוכן חי ל-fix 4/5): `PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` ב-`packages/backend`, ואז `BE_PORT=4001 pnpm --filter @drive-coding/frontend dev`
- ‏typecheck/build: `pnpm typecheck` · `pnpm --filter @drive-coding/frontend build`
- ‏i18n lint: `pnpm lint:i18n`

### Browser
- ‏Chrome רגיל על `localhost` (‏secure-context עובד ב-localhost). ל-fix 2/3 מספיק לפתוח את פאנל-הסשנים; אין צורך בסוכן חי.
- ‏ל-fix 4/5 צריך סוכן חי (‏claude/opencode) כדי לראות `connecting`/`turnState`.

### Reading list
**must-read**:
- ‏`packages/frontend/AGENTS.md` — חמשת כללי-הזהב (‏שכבות)
- ‏`docs/conventions/parallel-safe-code.md` — §מפתחות i18n (‏בלוק חדש נפרד ב-`keys.ts`)

**reference**:
- ‏`packages/frontend/src/lib/components/modals/FolderPickerDialog.svelte` — שלד bits-ui ל-copy ב-fix 5
- ‏`packages/frontend/src/lib/components/chat/MicLarge.svelte` — דפוס `Loader2Icon` + `animate-spin` (‏fix 5)
- ‏`packages/frontend/src/lib/components/chat/bubbles/UserBubble.svelte` — דפוס copy-button + copied-state (‏fix 3)

### OneCLI agent
- ‏שם: `voice-acp` (‏רק אם מריצים BE ל-fix 4/5)

---

## §1 — מטרה

חמישה חידודי-ממשק שנתפסו בשימוש: (1) שדה-הפרומפט לא יראה פס-גלילה מיותר בשורה
אחת; (2) כותרת-סשן ארוכה תוצג במלואה (‏מעבר-שורה) במקום להיחתך; (3) אפשר להעתיק
מזהה-סשן בלחיצה; (4) אזהרת-היציאה (‏מודאל + ‏`beforeunload`) לא תקפוץ כשאין תור
פעיל שיכול להיתקע; (5) רכיב מודאל-טעינה עם ספינר לשימוש-חוזר, מחווט לטעינת-סשן.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| תיקון פס-גלילה, ‏מעבר-שורה בכותרת, ‏העתקת-מזהה, ‏guard לאזהרה, ‏LoadingModal | ✅ | הסלייס הזה |
| ‏auto-generate כותרת-סשן | ❌ | future נפרד |
| ‏פקודות-סלאש / ‏dropdown בקלט | ❌ | slice נפרד (‏בספייק) |
| ‏שינוי מנגנון-האזהרה עצמו / ‏permission-UI | ❌ | `slice-permission-ui` |
| ‏extract של `<Modal>` shell גנרי + ‏refactor של הדיאלוגים הקיימים | ❌ | future (‏fix 5 רק **מוסיף** רכיב, לא מרפקטר קיים) |
| ‏ספינר במקומות-טעינה נוספים מעבר לטעינת-סשן | ❌ | future (‏הרכיב נבנה reusable, אבל מחווטים רק שימוש אחד) |

---

## §3 — Architecture (5 שכבות FE)

```
routes/           +page.svelte (connect) · chat/+page.svelte (beforeunload guard ← fix4)
  │
components/       TypeArea.svelte (← fix1)  SessionCard.svelte (← fix2,3)
                  SessionOptionsPanel.svelte (leave-modal guard ← fix4)
                  AppShell.svelte (mount LoadingModal ← fix5)
                  modals/LoadingModal.svelte (← fix5 חדש)
  │
view-models/      agent-session.svelte.ts — קריאה בלבד: status, turnState, bypassActive (ללא שינוי)
  │
core/i18n/        keys.ts + catalogs/{he,en}.ts — מפתחות חדשים (← fix3,5)
```

הכל additive. ה-VM לא משתנה — fix 4/5 רק **קוראים** שדות ציבוריים קיימים
(`turnState`, `status`, `bypassActive`).

---

## §4 — Commits

> כל הקומיטים approach=**manual** (‏glue/UI, אין לוגיקה טהורה חדשה; `copyToClipboard`
> כבר מכוסה-TDD). סדר הקומיטים עצמאי — אפשר לבצע בכל סדר, אבל מומלץ כלמטה.

### Commit 0 — fix1: פס-גלילה-רפאים ב-TypeArea (manual)

**קובץ שמשתנה**: `packages/frontend/src/lib/components/chat/TypeArea.svelte`

**מה משתנה**:
- ‏הסר את `overflow-y:auto` **הקבוע** מ-`style` של ה-`<textarea>` (‏שורה ~201).
- ‏שנה את ה-`$effect` (‏שורות 34-40) כך שיחשב אם התוכן חורג מה-`max-height`, ורק אז יציג scrollbar. גישה מומלצת (‏executor רשאי לכוונן):

```ts
$effect(() => {
  promptText
  const el = taEl
  if (!el) return
  el.style.height = "auto"
  const maxH = parseFloat(getComputedStyle(el).maxHeight)   // px מ-ה-max-height ב-CSS
  const needed = el.scrollHeight
  const clamped = Number.isFinite(maxH) && needed > maxH
  el.style.height = clamped ? `${maxH}px` : `${needed}px`
  el.style.overflowY = clamped ? "auto" : "hidden"          // scrollbar רק כשבאמת חתוך
})
```

**Verification**:
- ‏`pnpm typecheck`
- ‏ידני: פתח את שדה-הפרומפט ריק/שורה-אחת → **אין** פס-גלילה. הקלד 7+ שורות → פס-גלילה מופיע והגובה ננעל ל-6 שורות. מחק חזרה לשורה אחת → פס-הגלילה נעלם.

### Commit 1 — fix2: כותרת-סשן מלאה (manual)

**קובץ שמשתנה**: `packages/frontend/src/lib/components/modals/SessionCard.svelte` (‏שורה 46)

**מה משתנה**: החלף את `truncate` בכותרת ב-`line-clamp-2` (‏מעבר-שורה עד 2 שורות, עקבי
עם `header-title-responsive`). שורת-המשנה (`cwd · date`, שורה 47) **נשארת** `truncate`.
```svelte
<div class="text-sm font-medium line-clamp-2">{session.title || session.sessionId.slice(0, 8)}</div>
```

**Verification**: ידני — סשן עם כותרת עברית ארוכה מוצג ב-2 שורות ללא חיתוך-אמצע; הכרטיס גדל לגובה בהתאם.

### Commit 2 — fix3: כפתור העתקת-מזהה-סשן (manual)

**קבצים**:
- ‏`packages/frontend/src/lib/components/modals/SessionCard.svelte`
- ‏`packages/core/src/i18n/keys.ts` + `catalogs/he.ts` + `catalogs/en.ts`

**מה משתנה** — ⚠️ **כרטיס-הסשן הוא `<button>` שלם** (‏שורות 32-51), ולכן כפתור-העתקה
מקונן אינו HTML תקין. שינוי-מבנה: עטוף ב-`<div class="relative">`, השאר את כרטיס-ה-`<button>`
הראשי כפי שהוא, והוסף כפתור-העתקה **אח** (‏sibling) ממוקם absolutely:
```svelte
<div class="relative">
  <button class="text-start rounded-2xl border p-3.5 flex items-center gap-3 w-full" ... onclick={onSelect}>
    ...קיים...
  </button>
  <button
    class="absolute top-2 inline-end-2 p-1.5 rounded-lg opacity-70 hover:opacity-100"
    aria-label={copied ? t("bubble.copied") : t("session.copyId")}
    title={copied ? t("bubble.copied") : t("session.copyId")}
    onclick={handleCopy}
  >
    {#if copied}<CheckIcon size={14} />{:else}<CopyIcon size={14} />{/if}
  </button>
</div>
```
- ‏`handleCopy` — העתק דפוס מ-`UserBubble.svelte` (‏שורות 38-49): `copyToClipboard(session.sessionId)`, ‏`copied=true` ל-2 שניות. ⚠️ **ל-`handleCopy` ב-UserBubble אין פרמטר-event** — כאן **הוסף פרמטר** `(e: MouseEvent)` וקרא `e.stopPropagation()` ראשון (‏אחרת הלחיצה מפעילה את `onSelect` של הכרטיס). [‏אביגיל finding]
- ‏ייבוא: `copyToClipboard` מ-`$lib/util/clipboard`, ‏`CopyIcon`/`CheckIcon` מ-`@lucide/svelte/icons/copy`+`/check`.
- ‏מפתחות i18n חדשים (‏בבלוק נפרד ב-`keys.ts` ל-merge-safety): `session.copyId` → he `"העתק מזהה סשן"`, en `"Copy session ID"`. את מצב-"הועתק" השתמש-מחדש ב-`bubble.copied` הקיים.

**Verification**:
- ‏`pnpm typecheck` · `pnpm lint:i18n`
- ‏ידני: לחיצה על הכפתור מעתיקה את המזהה המלא (‏הדבק בעורך לוודא) ומראה ✓ ל-2ש'; לחיצה על הכפתור **לא** בוחרת/פותחת את הסשן.

### Commit 3 — fix4: guard לאזהרת-יציאה כשאין תור פעיל (manual)

**קבצים**:
- ‏`packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` (`onLeaveRunning`, שורות 56-62)
- ‏`packages/frontend/src/routes/chat/+page.svelte` (`onBeforeUnload`, שורות 39-43, בתוך `onMount`)

**מה משתנה** — הוסף תנאי "‏תור פעיל" לשני ה-guards. "‏סוכן שרץ" = `session.turnState !== "idle"`
(‏ראה `agent-session.svelte.ts:119` — `idle` = אין תור פעיל; stall אפשרי רק כשתור בתעופה):

מודאל:
```ts
function onLeaveRunning() {
  if (session.bypassActive || settings.suppressLeaveWarning || session.turnState === "idle") {
    doLeaveRunning()          // bypass / הושתק / אין תור פעיל → צא ישר, בלי אזהרה
  } else {
    leaveConfirmOpen = true
  }
}
```
`beforeunload`:
```ts
if (session.status === "connected" && session.turnState !== "idle" && !session.bypassActive) {
  e.preventDefault(); e.returnValue = ""
}
```

**Verification**:
- ‏`pnpm typecheck`
- ‏ידני (‏BE חי, mode לא-bypass): (‏א) התחבר, אל תשלח כלום (`turnState==="idle"`) → לחץ "‏צא — השאר רץ" → **יוצא מיד בלי מודאל**; רענן טאב → **אין** דיאלוג-דפדפן. (‏ב) שלח פרומפט ובזמן שהמודל חושב/עונה → לחץ יציאה → **המודאל כן** מופיע; רענון בזמן זה → **דיאלוג-דפדפן כן** מופיע.

### Commit 4 — fix5: LoadingModal (‏ספינר) + חיווט לטעינת-סשן (manual)

**קבצים**:
- ‏חדש: `packages/frontend/src/lib/components/modals/LoadingModal.svelte`
- ‏`packages/frontend/src/lib/components/layout/AppShell.svelte` (‏mount)
- ‏`packages/core/src/i18n/keys.ts` + `catalogs/{he,en}.ts`
- ‏(‏אין שינוי CSS) `@keyframes spin` **כבר קיים** ב-`packages/frontend/src/app.css:296`, ו-Tailwind v4 מזריק `animate-spin` אוטומטית → הספינר עובד as-is עם `class="animate-spin"`. אין צורך לגעת ב-app.css. [‏אימות אביגיל r2]

**API skeleton** — רכיב **prop-driven** (‏reusable, בלי context):
```ts
// LoadingModal.svelte
let { open, label }: { open: boolean; label?: string } = $props()
// שלד bits-ui מ-FolderPickerDialog: Root open={open} → Portal → Overlay (z-40 bg-black/60 backdrop-blur-sm)
//   → Content (z-50 flex items-center justify-center) → כרטיס --bg-elev/--border rounded-2xl
//   → גוף: <Loader2Icon class="animate-spin" size={32} /> + {label ?? t("modal.loading.session")}
// bits-ui Dialog צריך onOpenChange — ספק no-op (מודאל לא-סגיר ידנית; נסגר כשה-open נהיה false)
```
חיווט ב-`AppShell.svelte` (‏mount יחיד, מכסה את switch/load/new בתוך-האפליקציה):
```svelte
<LoadingModal open={session.status === "connecting"} />
```
(`session` מ-`getSession()` — כבר זמין ב-AppShell.)

- ‏מפתח i18n חדש (‏בלוק נפרד): `modal.loading.session` → he `"טוען סשן…"`, en `"Loading session…"`.
- ‏**אל תעטוף** את מסך-ה-connect (`routes/+page.svelte`) — לו כבר יש חיווי inline (`connect.submitting`). ראה §9 Q2.

**Verification**:
- ‏`pnpm typecheck` · `pnpm lint:i18n` · `pnpm --filter @drive-coding/frontend build`
- ‏ידני (‏BE חי): בחר סשן קיים מפאנל-הסשנים → בזמן `connecting` המודאל+ספינר מופיעים ונעלמים כשמגיע `connected`. ודא שהספינר **מסתובב** (‏keyframes).

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| ‏typecheck ירוק | `pnpm typecheck` = 0 |
| ‏build ירוק | `pnpm --filter @drive-coding/frontend build` |
| ‏i18n lint ירוק | `pnpm lint:i18n` (‏אין עברית מוקשחת בקוד) |
| ‏fix1: אין scrollbar בשורה אחת, יש ב-7+ | ידני בדפדפן |
| ‏fix2: כותרת ארוכה ב-2 שורות ללא חיתוך | ידני |
| ‏fix3: העתקה מעתיקה מזהה מלא + לא בוחרת סשן | ידני (‏הדבקה) |
| ‏fix4: אין אזהרה כש-`turnState==="idle"`; יש אזהרה בתור פעיל | ידני, 2 תרחישים |
| ‏fix5: מודאל-ספינר מופיע בטעינת-סשן ונעלם ב-connected | ידני |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ‏Hardcoded Hebrew → pre-commit חוסם | learnings (‏קבוע) | כל מחרוזת → `t(key)`; מפתחות ב-3 הקבצים (`keys.ts`+2 catalogs) |
| ‏מפתחות i18n בקונפליקט-merge | parallel-safe-code | כל מפתח חדש ב**בלוק נפרד** בסוף האזור הרלוונטי ב-`keys.ts` |
| ‏כפתור-copy מפעיל `onSelect` של הכרטיס | HTML nesting | `e.stopPropagation()` ב-`handleCopy`; copy הוא sibling ל-`<button>`, לא מקונן |
| ‏(‏לא-סיכון) ספינר סטטי | אביגיל r2: `@keyframes spin` כבר ב-`app.css:296` + Tailwind v4 auto | אין פעולה — `animate-spin` עובד as-is |
| ‏`getComputedStyle(...).maxHeight` = `"none"` → NaN | fix1 | `Number.isFinite(maxH)` כבר מטפל (‏נופל ל-height=scrollHeight) |
| ‏Svelte 5 reactivity | קבוע | `copied`/`open` הם `$state`; `open` נגזר מ-`session.status` (‏reactive getter) |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי (‏parent task) אם:
- ‏`turnState` לא משקף נכון "‏תור פעיל" בבדיקה חיה (‏fix4 — הליבה של הבאג)
- ‏bits-ui `Dialog` דורש context/props שלא צפויים ל-LoadingModal לא-סגיר
- ‏החלטת title-wrap (‏Q1) או mount-scope של המודאל (‏Q2) מתבררת כמשמעותית מהצפוי
- ‏שינוי חורג מ-FE + `core/i18n` (‏אסור לגעת ב-BE/contract)

---

## §8 — Complexity score

- ‏commits: 5 (‏כל אחד קטן, <60 שורות) → +1
- ‏שכבות חדשות: רכיב אחד (`LoadingModal`) → +1
- ‏APIs חיצוניים: 0 · streaming: 0 · state refactor: 0 · protocol: 0
- ‏קריאה-בלבד מה-VM (‏turnState/status/bypassActive) → 0

**Score ≈ 5/10 → verifier: `calev` (light).** כל התיקונים עצמאיים; רגרסיה נמוכה (‏additive).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | ‏כותרת-סשן: `line-clamp-2` או wrap בלתי-מוגבל? | `line-clamp-2` (‏עקבי עם header-title-responsive; רשימה מסודרת) | ❌ |
| 2 | ‏LoadingModal — לחווט גם למסך-connect או רק ל-in-app loads? | רק AppShell (‏למסך-connect כבר יש inline feedback) | ❌ |
| 3 | ‏כפתור-copy — always-visible או hover-reveal? | always-visible ב-opacity-70 (‏מובייל=drive-first, אין hover) | ❌ |
| 4 | ‏fix4 — האם לגדר גם ב-`status === "connected"` בנוסף ל-turnState? | כן ב-beforeunload; במודאל ה-LogOut ממילא מוצג רק ב-connected | ❌ |

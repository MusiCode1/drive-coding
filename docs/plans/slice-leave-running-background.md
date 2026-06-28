# Slice — leave-running-background — תוכנית

> **תאריך**: 2026-06-28
> **סטטוס**: הושלם (אליעזר, 2026-06-28 — 4 commits: b55930b..7ed4f2b על slice/leave-running-background)
> **Complexity**: 5/10 (verifier: light — calev)
> **תלות**: אין (FE-טהור; base=dev). depends_on: []

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/leave-running-background -b slice/leave-running-background dev
cd .worktrees/leave-running-background
pnpm install && pnpm hooks:install
```
branch: `slice/leave-running-background` | dir: `.worktrees/leave-running-background` (בלי קידומת)

### Run
- BE: `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` (port 4000)
  - לבדיקת הסלייס הזה **אין צורך ב-TTS proxy** — אפשר גם `PORT=4000 bun src/server.ts` (ראה AGENTS.md "Running locally").
- FE: `pnpm --filter @drive-coding/frontend dev` (port: OS-assigned; proxy→BE 4000)
- Tests: `pnpm test` · `pnpm typecheck` · `pnpm lint`

### Browser
- Chrome רגיל מול `http://localhost:<vite-port>` (localhost הוא secure-context — מספיק).
- **חובה ספק claude** לבדיקת ה-bypass-gating (ה-mode `bypassPermissions` קיים רק ב-claude). את הכפתור עצמו אפשר לבדוק גם מול opencode.

### OneCLI agent
- שם: `voice-acp` · שימוש רק אם בודקים TTS (לא נדרש לסלייס הזה).

### Reading list
**must-read לפני**:
- `packages/frontend/AGENTS.md` — חמשת חוקי-הזהב (שכבות VM/component).
- `docs/conventions/parallel-safe-code.md` — **חובה**: הסלייס נוגע ב-`context.ts`? לא. אבל נוגע ב-`i18n/keys.ts` (בלוק חדש בסוף) ו-`SessionOptionsPanel.svelte`. קרא את כללי-התוספתיות.
- סעיף §3 כאן (ארכיטקטורה) — מסמן מה-חדש איפה.

**reference בזמן עבודה**:
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `detach()` (~543), `#cleanup()` def (~1093), קריאת `deleteAgent` בתוך cleanup (~1111). הבסיס למתודה החדשה. (מספרי-שורות מקורבים — אמת לפני עריכה.)
- `packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte` — שורת-הפעולות (176-216), `onDisconnect` (37-40).
- `docs/decisions/voice-acp.md` — log רציונל.

## §1 — מטרה

היום, כדי לצאת מסשן **בלי להרוג אותו** (שימשיך לרוץ ברקע ב-BE), המשתמש נאלץ לעבור למצב עקיפת-הרשאות (`bypassPermissions`) **ולרענן את הדפדפן** — כי כפתור ה"ניתוק" הקיים קורא ל-`detach()` שמוחק את הסוכן ב-BE (`deleteAgent`), בעוד שרענון-דפדפן מפיל רק את ה-WS וה-BE שומר את ה-child חי. אחרי הסלייס: יהיה **כפתור ייעודי "צא — השאר רץ"** שמחזיר לרשימת-התהליכים בלי רענון ובלי להרוג את הסוכן; כשהמשתמש **לא** במצב bypass — תוצג אזהרה שברגע שתגיע בקשת-הרשאה הריצה תיעצר (כי ה-FE הוא ה-ACP client). אותה אזהרה תקפוץ גם בניסיון רענון/סגירת-טאב כשלא-ב-bypass.

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| כפתור "צא — השאר רץ" (לא הורג) | ✅ | — |
| אזהרה בעזיבה כשלא-ב-bypass (claude) | ✅ | — |
| אזהרת `beforeunload` ברענון/סגירה כשלא-ב-bypass | ✅ | — |
| זיהוי bypass חוצה-ספקים (opencode/codex) | ❌ | מחכה לאיחוד מנגנון-ACP — ראה §9 + הערת-קוד. claude בלבד עכשיו; שאר הספקים = אזהרה תמיד |
| UI אישור/דחיית בקשות-הרשאה (permission UI) | ❌ | Track C "ממשק אישור-בקשות" — slice נפרד |
| auto-answer בצד ה-BE כשאין FE | ❌ | Track F — slice נפרד |
| persist של ה-mode עצמו | ❌ | Track F — slice נפרד |
| שינוי טקסט מותאם ב-beforeunload | ❌ | חסם דפדפן — הדפדפן מציג dialog גנרי בלבד. רק מפעילים/לא-מפעילים |

## §3 — Architecture diagram

```
routes/                 chat/+page.svelte ─── מוסיף onMount→beforeunload guard (commit 3) ← חדש
  │                       (active רק כש-status==connected && !session.bypassActive)
  ▼
components/  SessionOptionsPanel.svelte
  │            ├─ onDisconnect()  (קיים — הורג)            ← אייקון/צבע/תווית משתנים
  │            └─ onLeaveRunning() (חדש — לא הורג)         ← חדש (commit 2)
  │                 └─ אם !session.bypassActive → confirm modal (commit 2)
  ▼
view-models/ agent-session.svelte.ts
  │            ├─ leaveRunning()      ← חדש (commit 1) — כמו detach בלי deleteAgent
  │            ├─ #cleanup({keepAgent}) ← שינוי חתימה (commit 1)
  │            └─ get bypassActive     ← חדש (commit 0/1) — קורא ל-helper טהור
  ▼
util/        permission-mode.ts  ← חדש (commit 0) — isBypassMode() טהור + TDD
  │
core i18n/   keys.ts + catalogs/he.ts + en.ts  ← בלוק חדש בסוף (תוויות + אזהרה)
```

## §4 — Commits

### Commit 0 — helper טהור `isBypassMode` + מפתחות i18n (approach: TDD)

**קבצים חדשים**:
- `packages/frontend/src/lib/util/permission-mode.ts`
- `packages/frontend/src/lib/util/permission-mode.test.ts`

**שינויים**:
- `packages/core/src/i18n/keys.ts` — בלוק חדש **בסוף** האיחוד:
  ```ts
  // ─── leave-running (slice leave-running-background) ───
  | "session.leaveRunning"          // תווית כפתור "צא — השאר רץ" (חדש)
  | "session.leaveWarning.title"
  | "session.leaveWarning.body"     // "הריצה תיעצר ברגע שתגיע בקשת-הרשאה..."
  | "session.leaveWarning.confirm"
  | "session.leaveWarning.cancel"
  ```
  > **⚠️ key יתום (avigail r1)**: כפתור-הסגירה ההרסני **ממשיך** להשתמש במפתח הקיים
  > `header.disconnect` (כבר ב-`catalogs/he.ts`) — **אל תוסיף** `session.closeSession`
  > ואל תיצור מפתח כפול. רק `session.leaveRunning` חדש לכפתור החדש. אם רוצים תווית-טקסט
  > שונה לכפתור-הסגירה מ-`header.disconnect`, זו החלטת-UI — escalate; ברירת-מחדל: שמור `header.disconnect`.
- `packages/core/src/i18n/catalogs/he.ts` + `en.ts` — אותו בלוק, תרגומים (he חובה, en פלייסולדר).

**API skeleton** (זה המקום היחיד שמרכז את ידע ה-"claude בלבד" — ההערה חיה כאן):
```ts
// permission-mode.ts
import type { CliKind } from "@drive-coding/core"

/** מזהה ID של mode עקיפת-הרשאות, פר-ספק.
 * ⚠️ claude בלבד כרגע. כשיושלם תכנון מנגנון-ה-ACP המאוחד (roadmap Track C
 * "ממשק אישור-בקשות") — נאחד את זיהוי-המצבים לכל הספקים שבדקנו (opencode/codex)
 * במקום אחד. עד אז: ספק שאינו claude → isBypassMode=false → אזהרה תמיד. */
const BYPASS_MODE_ID: Partial<Record<CliKind, string>> = {
  claude: "bypassPermissions",
}

export function isBypassMode(
  cliKind: CliKind | null,
  currentModeId: string | null | undefined,
): boolean {
  if (!cliKind || !currentModeId) return false
  return BYPASS_MODE_ID[cliKind] === currentModeId
}
```

**Verification**:
```bash
pnpm test -- permission-mode
pnpm typecheck
pnpm lint:i18n   # אוכף 0 עברית בקוד
```
טסטים נדרשים: claude+"bypassPermissions"→true · claude+"default"→false · opencode+כל-ערך→false · null→false.

### Commit 1 — `leaveRunning()` + `bypassActive` ב-VM (approach: manual)

**שינויים** ב-`packages/frontend/src/lib/view-models/agent-session.svelte.ts`:
- `#cleanup()` → `#cleanup(opts?: { keepAgent?: boolean })`: עוטף את שורת ה-`deleteAgent` (1111) ב-`if (!opts?.keepAgent)`. כל הקריאות הקיימות ל-`#cleanup()` (539, 549, 676) **נשארות בלי ארגומנט** → התנהגות זהה (הורג, ברירת-מחדל).
- מתודה חדשה `leaveRunning` — **עותק מדויק של `detach()` (542-557) פרט לקריאת ה-cleanup**:
  ```ts
  /** יציאה מהסשן בלי להרוג את הסוכן ב-BE — ה-child שורד (ws-agent.ts:126),
   *  ה-WS נסגר, ה-VM מתאפס ל-idle. מאפשר reconnect/חזרה דרך רשימת-התהליכים. */
  leaveRunning = (): void => {
    this.#detached = true
    this.#clearReconnectTimer()
    this.#reconnecting = false
    this.reconnectAttempt = 0
    this.#cleanup({ keepAgent: true })   // ← ההבדל היחיד מ-detach
    this.#setStatus("idle")
    this.error = null
    this.bubbles = []
    this.sessions = []
    this.#sessionsLoaded = false
    this.sessionsError = null
  }
  ```
- getter חדש (קורא ל-helper מ-commit 0; `#cliKind` ו-`modes` נגישים כאן):
  ```ts
  /** האם הסשן הנוכחי במצב עקיפת-הרשאות (claude בלבד כרגע — ראה permission-mode.ts). */
  get bypassActive(): boolean {
    return isBypassMode(this.#cliKind, this.modes?.currentModeId)
  }
  ```
  import: `import { isBypassMode } from "$lib/util/permission-mode"`.

> ⚠️ **executor — אל תשנה את חתימת `leaveRunning`/`bypassActive`.** אם `detach()` שונה מאז כתיבת ה-brief — סנכרן את גוף `leaveRunning` מולו (העתק-1:1 פרט ל-cleanup).

**Verification**:
```bash
pnpm typecheck
pnpm test -- agent-session   # הטסטים הקיימים חייבים להישאר ירוקים (cleanup default = הורג)
```

### Commit 2 — כפתור UI + modal אזהרה (approach: manual — browser smoke)

**שינויים** ב-`packages/frontend/src/lib/components/layout/SessionOptionsPanel.svelte`:
- imports אייקונים: `PowerIcon` (`@lucide/svelte/icons/power`) לכפתור-הסגירה, `Minimize2Icon` (`@lucide/svelte/icons/minimize-2`) לכפתור-החדש.
- **שורת-הפעולות (176-216)**: הוסף כפתור "צא — השאר רץ" **משמאל לכפתור הסגירה** (כדי שהסגירה ההרסנית תישאר ימנית-קיצונית ב-RTL, מופרדת). שני כפתורי-היציאה מקבלים **תווית-טקסט** (לא icon-only) — ההבחנה החזותית:
  - **סגור (הורג)**: `PowerIcon`, צבע `--recording` (אדום), `onclick={onDisconnect}`, תווית=`t("header.disconnect")` (מפתח קיים — בלי key חדש).
  - **צא — השאר רץ**: `Minimize2Icon`, צבע `--fg-dim` (ניטרלי), `onclick={onLeaveRunning}`, תווית=`t("session.leaveRunning")` (מפתח חדש מ-commit 0).
  > השאר את אייקון ה-audio וה-settings כפי שהם. שים לב לרוחב — 4 כפתורים בשורה; אם צפוף מדי במובייל, ה-2 של היציאה יכולים לרדת לשורה משלהם (executor מחליט לפי המוקאפ; שמור על touch-target ≥40px).
- `onLeaveRunning()` חדש:
  ```ts
  let leaveConfirmOpen = $state(false)
  function onLeaveRunning() {
    if (session.bypassActive) { doLeaveRunning() }   // bypass → אין stall → צא ישר
    else { leaveConfirmOpen = true }                  // לא-bypass → אזהר קודם
  }
  function doLeaveRunning() {
    leaveConfirmOpen = false
    session.leaveRunning()
    goto("/")
  }
  ```
- **Confirm modal**: בדוק קודם אם קיים primitive דיאלוג בפרויקט (content-viewer השתמש ב-`bits-ui Dialog`; חפש `src/lib/components/ui/` או `modals/`). אם יש — השתמש בו. אם אין confirm גנרי — מימוש inline פשוט (overlay + 2 כפתורים) בתוך הקומפוננטה, **עם כל הטקסטים דרך `t(...)`**. כותרת=`session.leaveWarning.title`, גוף=`session.leaveWarning.body`, אישור=`...confirm`→`doLeaveRunning()`, ביטול=`...cancel`→`leaveConfirmOpen=false`.

**Verification** (ידני בדפדפן):
```bash
pnpm typecheck && pnpm lint
```
- claude + mode רגיל → לחיצה על "צא — השאר רץ" → **modal אזהרה** → אישור → חזרה ל-`/`, הסוכן **עדיין מופיע** ב-active-agents widget (לא נהרג).
- claude + mode=bypassPermissions → לחיצה → **בלי modal**, חזרה ישירה, הסוכן חי.
- כפתור הסגירה האדום (Power) → הורג כרגיל (active-agents מתעדכן/נעלם).

### Commit 3 — beforeunload guard (approach: manual — browser smoke)

**שינויים** ב-`packages/frontend/src/routes/chat/+page.svelte`:
> **⚠️ מצב הקובץ היום (avigail r1)**: route דק (~52 שורות), **אין בו `onMount` כלל ולא import ל-`svelte`**. commit-3 מוסיף את שניהם מאפס: `import { onMount } from "svelte"` ב-`<script>`, ובלוק `onMount(() => { ... })` חדש. אל תניח קוד-lifecycle קיים. שמור על ה-guard הסינכרוני הקיים (status==="idle"→goto) כפי שהוא — לא קשור.
- `onMount` חדש שמוסיף listener ל-`beforeunload`; ב-handler:
  ```ts
  function onBeforeUnload(e: BeforeUnloadEvent) {
    if (session.status === "connected" && !session.bypassActive) {
      e.preventDefault()      // מפעיל את ה-dialog הגנרי של הדפדפן
      e.returnValue = ""      // נדרש לדפדפנים ישנים
    }
  }
  ```
  הסר ב-cleanup של `onMount` (`return () => removeEventListener(...)`).
- **חשוב**: רק ב-route הצ'אט (לא גלובלי) — כדי שרענון במסך-הבית/רשימה לא יזהיר.
- **גוטשה SSR**: `beforeunload`/`window` לא קיימים ב-SSR. `onMount` רץ רק בדפדפן → בטוח. אל תוסיף ברמת module-scope.

**Verification** (ידני):
- claude + mode רגיל, סשן מחובר → רענון (F5)/סגירת-טאב → **dialog אזהרה של הדפדפן** מופיע.
- claude + bypassPermissions → רענון → **בלי** אזהרה.
- מסך-הבית `/` → רענון → בלי אזהרה (ה-guard לא רשום שם).

## §5 — DoD

| בדיקה | איך |
|---|---|
| `isBypassMode` נכון ל-4 מקרים | `pnpm test -- permission-mode` ירוק |
| `leaveRunning` לא קורא `deleteAgent` | קריאת-קוד: `#cleanup({keepAgent:true})` עוקף את שורת 1111 |
| טסטי `detach`/cleanup קיימים נשארים ירוקים | `pnpm test -- agent-session` |
| typecheck + lint + lint:i18n נקיים | `pnpm typecheck && pnpm lint && pnpm lint:i18n` |
| כפתור "צא — השאר רץ" → חזרה ל-`/` בלי רענון, הסוכן חי | ידני: active-agents מציג את הסוכן אחרי לחיצה |
| לא-bypass → modal אזהרה לפני עזיבה | ידני בדפדפן (claude, mode=default) |
| bypass → בלי modal, יציאה ישירה | ידני בדפדפן (claude, mode=bypassPermissions) |
| כפתור הסגירה האדום עדיין הורג | ידני: הסוכן נעלם מ-active-agents |
| beforeunload מזהיר רק כשלא-bypass + מחובר + ב-chat | ידני: 3 התרחישים ב-§commit-3 |
| הבחנה חזותית סגור↔צא ברורה (אדום+Power מול ניטרלי+Minimize+תווית) | סקירה ויזואלית |

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ID ה-mode `bypassPermissions` שגוי/השתנה | roadmap Track F (acp-attr:2480) — לא אומת חי בסלייס זה | ריכוז ב-`BYPASS_MODE_ID` (נקודת-שינוי יחידה). **executor: אמת חי** — פתח claude, החלף ל-bypass, ובדוק את הערך ב-`session.modes.currentModeId` (console/devtools). אם שונה — עדכן את הקבוע ותעד ב"סטיות". |
| Hardcoded Hebrew → pre-commit hook חוסם | learnings (קבוע) | כל טקסט (תוויות+אזהרה) דרך `t(key)`; `pnpm lint:i18n` ב-DoD |
| beforeunload לא נותן טקסט מותאם | מגבלת דפדפן ידועה | scope §2 מסמן זאת מפורש — dialog גנרי בלבד, מקובל |
| שכפול גוף `detach`↔`leaveRunning` יוצא מסנכרון | drift עתידי | הערת-קוד "סנכרן מול detach" + commit 1 §; שניהם קצרים (~10 שורות) |
| `#cleanup` נקרא ב-error path בלי keepAgent | קוד קיים (539/676) | ברירת-המחדל נשארת "הורג" (keepAgent=false) → אין רגרסיה ב-error path |
| confirm modal חוסם פוקוס/scroll במובייל | UX | עדיף primitive קיים (bits-ui Dialog כמו content-viewer) על-פני inline; אם inline — overlay עם trap בסיסי |

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ה-mode ID החי **אינו** `bypassPermissions` ב-claude (משנה הנחת-יסוד).
- אין primitive דיאלוג בפרויקט **וגם** inline-confirm יוצא > 50 שורות (אולי שווה רכיב `ConfirmDialog` משותף — החלטה ארכיטקטונית).
- `detach()` עבר refactor מהותי מאז ה-brief (לא ניתן להעתיק 1:1).
- מתברר ש-`leaveRunning` משאיר state תקוע (WS/timer דולף) שלא קיים ב-detach.

## §8 — Complexity score

- commits: 4 (0-3) → סביר
- שכבות חדשות: util טהור (1) + getter/method ב-VM + glue ב-component + listener ב-route → low-mid
- APIs חיצוניים: 0
- streaming/async: 0
- refactor state-model: לא (תוספתי; `#cleanup` חתימה אחורה-תואמת)
- protocol BE↔FE: 0
- **Score: 5/10 → verifier: light (`calev`, mode: light)**

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | זיהוי bypass חוצה-ספקים | claude בלבד; opencode/codex→אזהרה תמיד. איחוד עתידי כשיושלם מנגנון-ACP מאוחד (הערת-קוד + Track C) | ❌ (הוכרע) |
| 2 | מיקום הכפתור | בשורת-הפעולות, משמאל לסגירה (אדום נשאר ימני-קיצוני) | ❌ (הוכרע) |
| 3 | אייקונים | סגור=Power(אדום), צא=Minimize2(ניטרלי)+תווית-טקסט | ❌ (הוכרע) |
| 4 | confirm modal — primitive או inline | primitive קיים אם יש (bits-ui Dialog); אחרת inline | ❌ (executor מחליט; escalate אם >50 שורות) |

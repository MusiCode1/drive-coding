# Slice — slash-commands — תוכנית

> **תאריך**: 2026-07-04
> **סטטוס**: ✅ **הושלם** (2026-07-07, 3 commits על `slice/slash-commands`; אומת חי בדפדפן עם
> claude+opencode אמיתיים; ר' `docs/walkthrough.md` לפירוט מלא כולל bug שנמצא+תוקן ב-Commit 2)
> **Complexity**: 5/10 (verifier: light — ר' §8, borderline)
> **תלות**: ‏אין (`depends_on: []`, base=dev)

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/slash-commands -b slice/slash-commands dev   # branch: slice/slash-commands | dir: .worktrees/slash-commands
cd .worktrees/slash-commands
pnpm install && pnpm hooks:install
```

### Run
- ‏**BE** (‏דרך OneCLI — ‏חובה ל-TTS proxy, ‏אבל לא קריטי לסבב הזה): ‏מהתיקייה `packages/backend`:
  `PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
  (‏אם onecli לא זמין ב-Windows — ‏`PORT=4000 bun --watch src/server.ts` ‏מספיק; ‏אין קריאות TTS בסבב).
- ‏**FE**: `pnpm --filter @drive-coding/frontend dev` (‏port OS-assigned; ‏מדפיס בהרצה).
- ‏**Tests**: `pnpm --filter @drive-coding/frontend test` · `pnpm typecheck` · `pnpm lint`.

### Browser
- ‏Chrome רגיל על `http://localhost:<vite-port>` ‏מספיק (‏אין secure-context API בסבב — ‏רק הקלדה/‏dropdown). ‏אימות חי: ‏חבר סוכן **claude** (‏הכי הרבה פקודות — ‏ר' §5).

### OneCLI agent
- ‏שם: `voice-acp`. ‏לא נדרש לפונקציונליות הסבב (‏אין TTS/‏translate). ‏רק אם רוצים flow מלא.

### Reading list
**‏must-read לפני**:
- `packages/frontend/AGENTS.md` — ‏חמשת חוקי-הזהב (‏שכבות: view-models / engines / components).
- `packages/frontend/src/lib/view-models/agent-session.mode-config-sync.test.svelte.ts` — ‏**‏התקדים המדויק** ‏ל-Commit 0 (‏handler ל-session-update variant + ‏בדיקות VM).
- `packages/frontend/src/lib/components/chat/TypeArea.svelte` — ‏רכיב הקלט שבו נכנס ה-dropdown (‏קראתי; ‏יש בו כבר keydown handler ל-Enter-to-send — ‏שם ההתנגשות ב-Commit 2).

**‏reference בזמן עבודה**:
- `docs/conventions/parallel-safe-code.md` — ‏אם נוגעים ב-`i18n.svelte.ts` (‏מפתחות chrome בלבד; ‏ר' §6).
- ‏הקלטת-אמת: `packages/backend/data/wire-recordings/_pre-test-archive/29175b45-*-1781776443783.jsonl` — ‏מכילה `available_commands_update` ‏אמיתי (47 ‏פקודות). ‏לבדיקה: `grep -h available_commands_update <file> | jq '.raw|fromjson|.params.update.availableCommands[0]'`.

---

## §1 — מטרה

‏משתמש מקליד `/` ‏בתיבת-הכתיבה ורואה **‏רשימת-השלמה** ‏של פקודות-ה-slash שהספק חושף (‏למשל `/commit`, `/code-review`, `/find-docs`), ‏עם שם + ‏תיאור מקוצר. ‏הוא מסנן תוך-כדי-הקלדה, ‏בוחר בחצים+Enter ‏או בלחיצה, ‏וה-token מוכנס לתיבה (`/<name> `) ‏מוכן להוספת ארגומנטים. ‏שליחה רגילה שולחת את הטקסט כ-prompt (‏הספק מזהה את ה-`/` ‏המוביל) — ‏בדיוק כמו ב-Zed/‏CLI. ‏כשהספק לא חושף פקודות (‏dropdown ריק) — ‏אין שינוי חוויה.

---

## §2 — Scope: מה כן, מה לא

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏קבלת `available_commands_update` ‏ל-state | ✅ | ‏Commit 0 |
| ‏dropdown השלמה מסונן ב-TypeArea | ✅ | ‏Commit 1+2 |
| ‏ניווט-מקלדת (‏↑↓/Enter/Tab/Esc) + ‏עכבר | ✅ | ‏Commit 2 |
| ‏הפעלת-פקודה = ‏טקסט-prompt (`sendPrompt` ‏קיים) | ✅ (‏ללא שינוי) | — |
| ‏**‏שינוי BE / ‏חוזה / ‏method חדש** | ❌ | ‏לא נדרש — ‏BE dumb-pipe, ‏ההפעלה טקסטואלית |
| ‏רינדור מובנה של `input.hint` ‏כ-form / ‏שדות | ❌ | ‏future — ‏כרגע ה-`hint` ‏מוצג כטקסט-רמז בלבד |
| ‏echo-suppression של פקודות local-only (`/clear`) | ❌ | ‏future (‏האדפטר כבר מטפל; ‏לא ענייננו) |
| ‏gating על `vm.supports.commands` | ❌ | ‏**‏הדגל מקובע `false`** (§6) — ‏גייטינג על `availableCommands.length` |
| ‏auto-open / ‏רינדור פקודות בבועות-צ'אט | ❌ | ‏מחוץ ל-scope |

---

## §3 — Architecture diagram

```
5 שכבות (FE):

routes/                     — (ללא שינוי)
components/
  chat/TypeArea.svelte      ← משתנה: dropdown + keydown-intercept (Commit 2)
  chat/SlashCommandMenu.svelte  ← חדש: רכיב תצוגת-הרשימה (Commit 2)
actions/                    — (ללא שינוי; השליחה נשארת sendPrompt)
engines/
  slash-commands.ts         ← חדש: matchSlashCommands() + applySlashSelection() טהור (Commit 1, TDD)
view-models/
  agent-session.svelte.ts   ← משתנה: availableCommands $state + handler + reset (Commit 0, TDD)
adapters/                   — (ללא שינוי — BE dumb-pipe, האירוע מגיע דרך #onSessionUpdate הקיים)
```

**‏עיקרון**: ‏צד-הקבלה מראה 1:1 ‏את `acp-mode-config-sync` (‏VM-only, ‏additive). ‏הליבה הטהורה (‏matching) ‏ב-engines עם TDD. ‏רק ה-glue של ה-dropdown ב-component הוא non-TDD (‏browser).

---

## §4 — Commits בסדר

### Commit 0 — VM: ‏קבלת available_commands_update (approach: **TDD**)

‏מראה מדויק של `acp-mode-config-sync` (‏אותו קובץ, ‏אותו דפוס handler).

**‏קבצים חדשים**: ‏אין (‏בדיקות → ‏קובץ חדש בהמשך).
- `packages/frontend/src/lib/view-models/agent-session.slash-commands.test.svelte.ts` — ‏מראה `agent-session.mode-config-sync.test.svelte.ts`.

**‏שינויים** ב-`agent-session.svelte.ts`:
- ‏להוסיף import: `AvailableCommand` ‏מ-`@agentclientprotocol/sdk` (‏כבר מיובאים ממנו טיפוסים בראש הקובץ, ‏שורות **12-17**).
  **‏שים לב לגרסה**: ‏ה-FE ‏resolve ל-`@agentclientprotocol/sdk@0.21.1` (‏לא 1.1.0). ‏אומת: ‏0.21.1 ‏**‏כן** ‏מייצאת `AvailableCommand` / `AvailableCommandsUpdate` / `available_commands_update` ‏(‏צורה זהה: `{ name, description, input?: {hint}|null, _meta? }`). ‏**‏אזהרה**: ‏ה-repo ‏מכיל גם alias `acp-sdk-v1` (npm:@agentclientprotocol/sdk@1.0.0) ‏ב-`packages/provider` — ‏**‏אל תייבא ממנו**; ‏ייבא מ-`@agentclientprotocol/sdk` ‏הרגיל (‏כמו שאר הקובץ).
- ‏להוסיף `$state` ‏ליד `modes`/`configOptions` (~‏שורה 143):
  ```ts
  /** פקודות ה-slash שהספק חשף (available_commands_update). [] = אין/טרם. */
  availableCommands = $state<AvailableCommand[]>([])
  ```
- ‏ב-`#onSessionUpdate` — ‏handler **‏לפני** ‏ה-gate `if (!text) return` (‏ליד `config_option_update`, ‏שורה ~1525):
  ```ts
  if (update.sessionUpdate === "available_commands_update") {
    const cmds = (update as { availableCommands?: unknown }).availableCommands
    this.availableCommands = Array.isArray(cmds) ? (cmds as AvailableCommand[]) : []
    return
  }
  ```
- ‏ב-`#captureSessionConfig` (‏המתודה מתחילה בשורה **1307**; ‏האיפוס של `configOptions`/`modes` ‏מ-new/load ‏ב-שורות **1312/1314**) — ‏להוסיף איפוס:
  ```ts
  this.availableCommands = []   // ניקוי בהחלפת/פתיחת סשן; ה-update הטרי יאכלס
  ```
  (‏חשוב: ‏ההקלטה מראה שה-`available_commands_update` ‏מגיע **‏אחרי** ‏תגובת session/new → ‏האיפוס לא דורס את הטרי. ‏שם-המתודה הוא `#captureSessionConfig` — ‏**‏לא** `#captureSessionState`.)

**‏API skeleton**: ‏אין class חדש — ‏רק שדה `$state` ‏ותוספת handler.

**‏Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- slash-commands
pnpm typecheck
```
‏הבדיקות: (‏א) update ‏מאכלס `availableCommands`; (‏ב) update ‏עם payload ריק → `[]`; (‏ג) `#captureSessionConfig` ‏מאפס ל-`[]`; (‏ד) update ‏שאינו-מערך → `[]` ‏בלי crash.

---

### Commit 1 — engine: ‏matching טהור (approach: **TDD**)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/engines/slash-commands.ts`
- `packages/frontend/src/lib/engines/slash-commands.test.ts`

**‏API skeleton** (‏executor **‏לא** ‏משנה חתימות):
```ts
import type { AvailableCommand } from "@agentclientprotocol/sdk"

export interface SlashMatch {
  /** ה-query שהוקלד אחרי "/" (לפני הרווח הראשון), כמו-שהוא */
  query: string
  /** הפקודות שתואמות ל-query (prefix, case-insensitive) */
  matches: AvailableCommand[]
}

/**
 * מחזיר null כאשר הקלט אינו במצב "הקלדת-פקודה":
 *  - לא מתחיל ב-"/" (הפקודה תקפה רק כתו הראשון), או
 *  - כבר יש רווח אחרי ה-token (המשתמש מקליד ארגומנטים → סוגרים dropdown).
 * אחרת: query + הפקודות המסוננות (prefix על name, case-insensitive; query ריק → כל הפקודות).
 */
export function matchSlashCommands(
  input: string,
  commands: readonly AvailableCommand[],
): SlashMatch | null

/** הערך החדש ל-textarea אחרי בחירה: "/<name> " (רווח נגרר להתחלת ארגומנטים). */
export function applySlashSelection(command: AvailableCommand): string
```

‏כללי-מימוש (‏לבדיקות):
- `""` → `null`; `"hi"` → `null`; `"/"` → ‏כל הפקודות, `query=""`.
- `"/co"` → ‏matches ‏של `commit`,`code-review`,`commit`... (`name.toLowerCase().startsWith("co")`).
- `"/commit "` (‏רווח) → `null` (‏מצב-ארגומנטים).
- ‏case-insensitive: `"/svelte"` ‏תואם `Svelte-MCP` (‏שמות mixed-case קיימים — ‏ר' §6).
- `"/zzz"` → `{ query: "zzz", matches: [] }` (‏לא null — ‏המצב "‏פקודה" ‏פעיל, ‏אבל אין תוצאות → ‏ה-UI לא יפתח dropdown ריק).
- `applySlashSelection({name:"commit",...})` → `"/commit "`.

**‏Verification**:
```bash
pnpm --filter @drive-coding/frontend test -- slash-commands
pnpm typecheck
```

---

### Commit 2 — UI: ‏dropdown השלמה ב-TypeArea (approach: **manual/browser**)

**‏קבצים חדשים**:
- `packages/frontend/src/lib/components/chat/SlashCommandMenu.svelte` — ‏רשימת-בחירה absolute מעל ה-textarea.

**‏שינויים** ב-`TypeArea.svelte`:
- `const slash = $derived(matchSlashCommands(promptText, session.availableCommands))`
- ‏מצב פתיחה: `const menuOpen = $derived(!!slash && slash.matches.length > 0 && !dismissed)`.
- `let dismissed = $state(false)` + `let selectedIndex = $state(0)`.
  - ‏`dismissed` ‏מתאפס ל-`false` ‏בכל שינוי-קלט שמשנה את ה-query (‏effect על `slash?.query`).
  - ‏`selectedIndex` ‏מתאפס ל-0 ‏כשרשימת ה-matches משתנה.
- ‏**‏keydown intercept** — ‏מוסיפים **‏בראש** ‏ה-handler הקיים (‏שורה 210), ‏**‏לפני** ‏לוגיקת ה-Enter-to-send:
  ```ts
  // Cmd/Ctrl+Enter תמיד שולח — לא נבלע כאן (החרגת המקש המשולב במפורש).
  // `&& slash` נחוץ ל-narrowing: menuOpen הוא derived נפרד ולא מצמצם את slash ל-non-null.
  if (menuOpen && slash && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
    const n = slash.matches.length
    if (e.key === "ArrowDown") { e.preventDefault(); selectedIndex = (selectedIndex + 1) % n; return }
    if (e.key === "ArrowUp")   { e.preventDefault(); selectedIndex = (selectedIndex - 1 + n) % n; return }
    // Enter רגיל בוחר (לא Shift+Enter — שורה-חדשה נשמרת); Tab בוחר.
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
      const cmd = slash.matches[selectedIndex]   // noUncheckedIndexedAccess → AvailableCommand | undefined
      if (cmd) { e.preventDefault(); acceptSelection(cmd); return }
    }
    if (e.key === "Escape") { e.preventDefault(); dismissed = true; return }
  }
  ```
  ‏**‏זו נקודת-הרגרסיה הקריטית**: ‏כש-menuOpen, ‏Enter **‏רגיל** ‏בוחר — ‏**‏לא** ‏שולח. ‏כש-menu סגור (‏כולל אחרי בחירה, ‏כי אז יש רווח → `slash===null`), ‏Enter ‏שולח כרגיל. ‏**‏Cmd/Ctrl+Enter תמיד שולח** — ‏ה-guard `!((e.metaKey||e.ctrlKey) && e.key==="Enter")` ‏מוציא אותו מה-intercept כך שהוא נופל ללוגיקת ה-send הקיימת (§Q3).
- `acceptSelection(cmd)`: `promptText = applySlashSelection(cmd)`, ‏מיקוד חזרה ל-textarea, `dismissed=false`.
- ‏קליק על פריט ב-`SlashCommandMenu` → `acceptSelection`.

**‏SlashCommandMenu.svelte** — ‏props:
```ts
let { matches, selectedIndex, onselect }: {
  matches: AvailableCommand[]
  selectedIndex: number
  onselect: (cmd: AvailableCommand) => void
} = $props()
```
- ‏רשימה `absolute bottom-full` (‏מעל ה-textarea), `max-h-64 overflow-y-auto`, ‏רקע `var(--bg-card)` + `var(--border)`.
- ‏כל פריט: `name` (‏מודגש) + `description` **‏מקוצר לשורה אחת** (`truncate` / `line-clamp-1`) — ‏התיאורים ארוכים ורב-שורתיים (§6). ‏הפריט הנבחר: ‏רקע `var(--accent)` ‏עמום.
- ‏Svelte 5: ‏`{#each matches as cmd, i (cmd.name)}` — ‏key על `name`; ‏קורא `matches.length` (‏reactivity — §6).
- ‏i18n: ‏שם/‏תיאור/‏hint הם **‏data מהספק** (‏אנגלית דינמית) — ‏**‏לא** ‏מתורגמים. ‏רק aria-label ‏של הרשימה → `t(...)` (§6).

**‏Verification** (‏browser, ‏claude מחובר):
```bash
pnpm --filter @drive-coding/frontend build   # gate: build ירוק
pnpm typecheck && pnpm lint
```
+ ‏בדיקה ידנית לפי §5.

---

## §5 — DoD verifiable

| ‏בדיקה | ‏איך |
|---|---|
| ‏VM ‏מאכלס `availableCommands` ‏מ-update | ‏בדיקת Commit 0 ‏ירוקה |
| ‏VM ‏מאפס בהחלפת-סשן | ‏בדיקת Commit 0 ‏ירוקה |
| ‏`matchSlashCommands` ‏מכסה את כל הכללים | ‏בדיקות Commit 1 ‏ירוקות (‏כולל case-insensitive + ‏מצב-ארגומנטים) |
| ‏typecheck + ‏lint + ‏build ‏ירוקים | `pnpm typecheck && pnpm lint && pnpm --filter @drive-coding/frontend build` |
| ‏חי: `/` ‏פותח dropdown עם פקודות claude | ‏חבר claude → ‏הקלד `/` → ‏רואים רשימה (‏claude חושף ~47 ‏פקודות; ‏מגיע מיד עם החיבור) |
| ‏חי: ‏סינון תוך-הקלדה | ‏הקלד `/co` → ‏הרשימה מצטמצמת ל-`commit`/`code-review`... |
| ‏חי: ‏ניווט-מקלדת ↑↓ + Enter ‏בוחר | ‏חצים מזיזים הדגשה; ‏Enter ‏מכניס `/commit ` ‏**‏ולא שולח** |
| ‏חי: ‏Esc ‏סוגר | ‏Esc ‏סוגר; ‏הקלדת תו נוסף פותח שוב |
| ‏חי: ‏קליק בוחר | ‏לחיצה על פריט מכניסה את ה-token |
| ‏**‏רגרסיה**: ‏שליחה רגילה עובדת | ‏טקסט ללא `/` → ‏Enter ‏שולח כרגיל; ‏`/commit ` (‏עם רווח) → ‏Enter ‏שולח |
| ‏חי: ‏הפעלה מקצה-לקצה | ‏שלח `/commit` → ‏claude מבצע את הפקודה (‏מגיב, ‏לא הודעת-שגיאה) |
| ‏ריק-graceful: ‏opencode ‏ללא פקודות | ‏חבר opencode → ‏הקלד `/` → ‏אין dropdown, ‏אין שגיאה |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏**‏גייטינג על `supports.commands` = ‏פיצ'ר מת** | ‏קוד: ‏`capabilities-static.ts` + ‏`claude/capabilities.ts` ‏מקבעים `commands: false` (‏מעולם לא חווט) | ‏**‏חובה** ‏לגייט את ה-UI על `session.availableCommands.length > 0` ‏בלבד. ‏**‏לא** ‏להשתמש ב-`vm.supports.commands`. |
| ‏**‏רגרסיית Enter-to-send** | ‏TypeArea.svelte:210 — ‏Enter כבר שולח | ‏ה-intercept **‏קודם** ‏ל-send, ‏ורק כש-`menuOpen`. ‏DoD ‏כולל שורת-רגרסיה מפורשת. ‏זו הנקודה שכלב/‏אביגיל צריכים לבחון. |
| ‏Svelte 5 reactivity על array | ‏learnings (§6 ‏ב-README) | ‏`{#each matches as c (c.name)}` + ‏קריאת `.length`; ‏השמה (‏לא mutation) ל-`availableCommands`. |
| ‏שמות mixed-case/‏מיוחדים (`Svelte-MCP`, `eleven-v3-...`) | ‏הקלטת-אמת | ‏matching **‏case-insensitive**; ‏לא להניח `[a-z-]`. |
| ‏תיאורים ארוכים רב-שורתיים | ‏הקלטת-אמת (47 ‏פקודות, ‏חלקן פסקאות) | ‏`line-clamp-1`/`truncate` ‏על התיאור; ‏רשימה `overflow-y-auto max-h`. |
| ‏Hardcoded Hebrew → ‏pre-commit חוסם | ‏learnings | ‏תוכן-הפקודה = ‏data (‏לא מתורגם); ‏רק chrome-labels → `t()`. `pnpm lint:i18n` ‏ירוק. |
| ‏קונפליקט על TypeArea/‏i18n | ‏parallel-safe-code.md | ‏base=dev; ‏TypeArea על dev כולל image-paste — ‏תוספת additive ל-keydown, ‏לא נגיעה ב-image-paste. |
| ‏קדימות Cmd+Enter מול menu פתוח | ‏עיצוב | ‏החלטה מתועדת בקוד: ‏menu-Enter ‏רק ל-Enter רגיל; ‏Cmd/Ctrl+Enter ‏שולח תמיד. |

---

## §7 — Escalation triggers

‏אם X — ‏עצור ושאל את מרדכי ב-parent task:
- ‏מתברר ש-claude/‏opencode ‏**‏לא** ‏פולטים `available_commands_update` ‏בסביבה החיה (‏למרות ההקלטה+‏האדפטר) — ‏שינוי-הנחת-יסוד.
- ‏ההפעלה כטקסט-`/name` ‏**‏לא** ‏מתפרשת ע"י הספק (‏דורש method ייעודי / ‏מבנה prompt אחר) — ‏שינוי-חוזה.
- ‏ה-intercept של Enter דורש focus-trap / ‏רכיב bits-ui מלא (‏מורכבות-focus גבוהה מהצפוי) → ‏לשקול העלאת tier ל-heavy.
- ‏החלטה ארכיטקטונית שלא מכוסה ב-D1-D50.

---

## §8 — Complexity score + verifier choice

- ‏commits: 3 (‏נמוך)
- ‏שכבות חדשות: engine (‏helper טהור) + ‏component (‏dropdown) — ‏~2
- ‏APIs חיצוניים: 0
- ‏streaming/async: ‏לא
- ‏refactor state model: ‏לא (‏additive `$state`)
- ‏שינוי protocol BE↔FE: ‏0

**‏Score: 5/10 → light (calev).**

‏הערה (‏borderline): ‏המורכבות הגולמית נמוכה, ‏אבל ה-Enter-intercept על **‏משטח-הקלט הראשי** (‏blast-radius גבוה) + ‏ניווט-מקלדת + ‏מובייל הם היכן ש-light-tier מפספס. ‏בחרתי light לפי הרובריקה (‏לא 8+), ‏עם **‏DoD רגרסיה מפורש** ‏על השליחה הרגילה. ‏אם Commit 2 ‏חושף focus-management מסובך → ‏escalation (§7) ‏ל-heavy.

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏prefix-match או fuzzy/‏includes? | ‏**prefix על name** (‏צפוי, ‏פשוט). ‏fuzzy = ‏future. | ❌ |
| 2 | ‏להציג את `input.hint` ‏בבחירה? | ‏MVP: ‏להציג את ה-`description` ‏בפריט; ‏ה-`hint` ‏אפשר כ-placeholder-רמז אחרי בחירה (‏nice-to-have, ‏לא חוסם). | ❌ |
| 3 | ‏Cmd+Enter ‏כש-menu פתוח — ‏שולח או בוחר? | ‏**‏שולח** (‏power-user). ‏menu-Enter רק ל-Enter רגיל. | ❌ |
| 4 | ‏לגייט גם על `supports.commands` ‏כשיחווט בעתיד? | ‏לא כרגע — ‏הדגל מקובע false; ‏`availableCommands.length` ‏הוא האות. | ❌ |
| 5 | ‏רכיב dropdown מותאם או bits-ui? | ‏**‏מותאם** ‏(absolute list, ‏keyboard-driven) — ‏bits-ui Select לא מתאים ל-inline-filter. | ❌ |

‏כל השאלות **‏לא-חוסמות** → ‏ה-slice מוכן ל-verification ע"י אביגיל.

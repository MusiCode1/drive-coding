# Slice connect-recent-projects — הסרת בורר-הסשן ממסך הפתיחה + רשימת תיקיות אחרונות — בריף

> **תאריך**: 2026-06-27
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: הושלם (2026-06-28, אליעזר, 5 commits: 1875b7f..9792c2b)
> **אימות אביגיל**: (טרם — הרץ אחרי כתיבה)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`; אחרת זה בריף לא-גמור.
> **Complexity**: 6/10 (verifier: light → `calev`)
> **תלויות (`depends_on`)**: [`folder-picker-fixes`]
> **Base**: `dev` — **לאחר** ש-`slice-folder-picker-fixes` מוזג אליו (שרשרת סדרתית, ראה §0)
> **Gate**: ⛔ **אל תשגר את הסלייס הזה לפני ש-`slice-folder-picker-fixes` מוזג ל-dev.** שני הסלייסים
> נוגעים ב-`+page.svelte` → merge מקביל ייצור קונפליקט. מרדכי ימזג את folder-picker-fixes קודם,
> ורק אז יגזור את הסלייס הזה מ-dev המעודכן.
> **Dev tip בעת הכתיבה**: `88d447b` (לפני merge של folder-picker-fixes). **ה-base בפועל בעת dispatch
> = dev tip המעודכן אחרי ה-merge** — מרדכי יקבע אותו ב-state.json.

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **תלוי** ב-`slice-folder-picker-fixes` (שרשרת **סדרתית** דרך dev):
- **Base = dev לאחר merge של folder-picker-fixes.** הסלייס הקודם ממוזג ל-dev *לפני* שזה נגזר.
  גזור מ-`dev` המעודכן — **לא** מ-branch בשם `slice/folder-picker-fixes` (worktree-branch שנמחק
  אחרי merge+cleanup; הוא לא יהיה קיים בעת dispatch). מרדכי קובע ב-state.json את ה-`base` המדויק.
- **Pre-flight check (חובה לפני Commit 1)**: ודא שה-base כולל את folder-picker-fixes —
  `grep -n "startPath" packages/frontend/src/routes/+page.svelte` חייב להראות
  `<FolderPickerDialog startPath={cwd} />` (שורה ~236) ו-`grep -n "startPath" .../FolderPickerDialog.svelte`
  חייב להראות את ה-`$props()`. **אם הם לא שם → התלות לא מוזגה → עצור ודווח למרדכי** (אל תתחיל;
  base שגוי). זה מחליף את "שמר את ה-prop" — אתה מאמת שהוא קיים בבסיס, ולא מוסיף אותו בעצמך.

נשען על תשתית קיימת:
- **ProjectsRegistry** (BE) — `packages/backend/src/app/projects-registry.ts`: `recordCwd`/`recordSession`/
  `getProjects`. כבר מאוכלס: `recordCwd` נקרא ב-`session-attached` (`http-agents.ts`). **ה-data כבר זורם.**
- **Endpoint קיים** `GET /api/projects` → `{ projects: ProjectEntry[] }` (ממוין lastSeen יורד),
  ב-`http-history.ts` `registerProjectsHttp`. **טרם נצרך ב-FE.**
- **דפוס ActiveAgents** (VM + adapter + panel + context wiring) — חיקוי מדויק לפיצ'ר החדש:
  `active-agents.svelte.ts`, `ActiveProcessesPanel.svelte`, wiring ב-`+layout.svelte` + `context.ts`.
- **`connectAgent`** action — `packages/frontend/src/lib/actions/connect-agent.ts` — חיבור לתיקייה (סשן חדש).

### Worktree

```bash
cd /home/user/projects/drive-coding
# base = dev — לאחר ש-folder-picker-fixes כבר מוזג אליו (שרשרת סדרתית)
git worktree add /home/user/projects/drive-coding/.worktrees/connect-recent-projects \
  -b slice/connect-recent-projects dev
cd /home/user/projects/drive-coding/.worktrees/connect-recent-projects
pnpm install && pnpm hooks:install
# Pre-flight: ודא שהתלות בבסיס (אחרת base שגוי → עצור)
grep -n "startPath" packages/frontend/src/routes/+page.svelte   # → <FolderPickerDialog startPath={cwd} />
```

### איך להריץ

- **BE** (port 4000; data חי ב-`~/.drive-coding/` — ⚠️ **אל תזהם**: השתמש ב-`DRIVE_CODING_DATA_DIR`
  נפרד כדי ש-`projects-registry.json` של הבדיקה לא יתערבב עם החי):
  ```bash
  cd packages/backend
  DRIVE_CODING_DATA_DIR=/tmp/dc-recent-test onecli run --agent voice-acp -- bun --watch src/server.ts
  ```
- **FE dev**: `pnpm --filter @drive-coding/frontend dev`
- **Tests FE**: `pnpm --filter @drive-coding/frontend test` (vitest)
- **Typecheck**: `pnpm -r typecheck`
- **Lint i18n**: `pnpm lint:i18n` (הסלייס **כן** מוסיף מחרוזות → דרך הקטלוג בלבד, לא inline).

> כדי לראות תיקיות אחרונות בבדיקה: חבר לכמה תיקיות שונות (סשן חדש בכל אחת) → כל אחת נרשמת
> ב-`projects-registry.json`. ואז רענן את מסך הפתיחה. לחלופין זרע ידנית את הקובץ
> `$DRIVE_CODING_DATA_DIR/cache/projects-registry.json` (ראה §0 reading list לפורמט).

### Browser

UI integration — אימות בדפדפן (`playwright-cli` skill או דפדפן רגיל). אמת: (א) **אין** עוד dropdown
בחירת-סשן במסך הפתיחה; (ב) רשימת תיקיות אחרונות מוצגת; (ג) לחיצה על תיקיה אחרונה מחברת אליה.

### Reading list

**must-read**:
- `packages/frontend/src/routes/+page.svelte` — כל הקובץ. קריטי: imports — `listSessionsForCwd, type
  SessionInfo` (שורה **7**), `SessionPicker` (שורה **9**), `FolderPickerDialog` (שורה **13**);
  `sessions` state (82-104, כולל `MOCK_FIXTURES`), `loadSessions` (106-120), ה-`onMount`
  sessions-autoload (34-39), `onSubmit` עם ענף `selectedSessionId` (136-150), רינדור
  `<SessionPicker .../>` (206-215), `<FolderPickerDialog startPath={cwd} />` (מהסלייס הקודם — **לאמת
  שקיים ב-base**, ראה Pre-flight check).
- `packages/frontend/src/lib/adapters/sessions.ts` — **קריטי**: הקובץ מייצא גם את `listSessionsForCwd`
  (להסרה) **וגם** את `SessionInfo` + `normalizeSessionInfo` (**להשאיר** — בשימוש ב-`agent-session.svelte.ts:37`
  וב-`SessionCard.svelte:7`). אל תמחק את הקובץ.
- `packages/frontend/src/lib/view-models/active-agents.svelte.ts` — הדפוס המלא ל-VM (state/loading/error/refresh).
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte` — דפוס ה-panel
  (כולל `folderName(cwd)` basename, status, RTL/`bdi` לנתיב).
- `packages/frontend/src/lib/adapters/agents-api.ts` — דפוס adapter (`listAgents` → fetch + parse).
- `packages/backend/src/app/projects-registry.ts` — צורת `ProjectEntry` (`cwd`, `kind`, `lastSeen`,
  `lastSessionId?`). `kind: BridgeKind` (= alias ל-`CliKind`, `packages/core/src/ports.ts:38`).
- `packages/frontend/src/lib/actions/connect-agent.ts` — חתימת `connectAgent({ cliKind, cwd, session, settings })`.
- `packages/frontend/src/routes/+layout.svelte` — wiring של VMs: import של `setActiveAgents` מ-context
  (שורה ~19), import של class `ActiveAgents` (שורה **38**), `new ActiveAgents()` (~98),
  `setActiveAgents(activeAgents)` (~133). + `packages/frontend/src/lib/context.ts` שורות 28, 67.
- `packages/core/src/i18n/keys.ts` — איך מוסיפים `MessageKey` (בלוק דומיין חדש בסוף האיחוד).

**reference**:
- `docs/conventions/parallel-safe-code.md` — קטלוגים append-only + תוספתי.
- `docs/decisions/drive-coding.md` — entry של הסלייס הזה (יכתוב מרדכי).

---

## §1 — מטרה

אחרי הסלייס, מסך הפתיחה **כבר לא מריץ תהליך-סוכן חד-פעמי** רק כדי להציג רשימת סשנים, ואין בו יותר
dropdown לבחירת סשן. במקומו מוצגת **רשימת תיקיות אחרונות** (מתוך ה-registry הקיים): המשתמשת רואה את
התיקיות שפתחה לאחרונה, ובלחיצה אחת מתחברת לאחת מהן (סשן חדש) ועוברת לצ'אט. בחירת סשן ספציפי נעשית
**מתוך** הסשן הפעיל (התשתית הקיימת `SessionOptionsPanel` — switchSession/newSession warm), כפי
שהמשתמשת ביקשה. התוצאה: פחות spawn-ים יקרים, מסך-פתיחה מהיר, וכניסה מהירה לתיקייה מוכרת.

---

## §2 — Scope: מה כן, מה לא

| לא בסקופ (בכוונה) | היכן/הערה |
|---|---|
| שינוי בחירת-הסשן **בתוך** הסשן (`SessionOptionsPanel`/`switchSession`/`newSession`) | נשאר כפי שהוא — זה ה-UX שמחליף את בורר-הפתיחה. לא נוגעים. |
| מחיקת `SessionInfo`/`normalizeSessionInfo` מ-`sessions.ts` | **לא** — בשימוש חי (agent-session, SessionCard). למחוק רק `listSessionsForCwd`. |
| הסרת `ActiveProcessesPanel` (תהליכים חיים) | נשאר — הוא משלים, לא חופף. ראה §6. |
| הצגת/בחירת `lastSessionId` של תיקיה אחרונה | לא ב-MVP — לחיצה = חיבור (סשן חדש). בחירת סשן נעשית מתוך הסשן. |
| מחיקת/עריכת רשומות ב-registry מה-UI | מחוץ לסקופ — קריאה בלבד. |
| הוספת endpoint BE חדש | לא — `GET /api/projects` כבר קיים. |
| שינוי לוגיקת ה-`onMount` `fetchServerOptions` (homeDir fill) | נשאר — רק בלוק ה-sessions-autoload יוסר. |

---

## §3 — Architecture diagram (5 שכבות FE)

```
routes (+page.svelte)              ← משתנה: מסיר SessionPicker+sessions state; מרנדר RecentProjectsPanel; onSelect→connect
   │
components/connect
   ├─ ActiveProcessesPanel.svelte  (קיים — ללא שינוי)
   ├─ RecentProjectsPanel.svelte   ← חדש (panel: רשימת תיקיות אחרונות)
   └─ SessionPicker.svelte         ← נמחק
   │
view-models
   └─ recent-projects.svelte.ts    ← חדש (RecentProjects VM: projects/loading/error/refresh)
   │
adapters
   ├─ recent-projects.ts           ← חדש (listRecentProjects → GET /api/projects)
   └─ sessions.ts                  ← משתנה: מסיר listSessionsForCwd (משאיר SessionInfo/normalizeSessionInfo)
   │
context.ts + +layout.svelte        ← משתנה: wiring של RecentProjects (כמו ActiveAgents)

backend                            ← ללא שינוי (endpoint + registry קיימים)
```

---

## §4 — Commits בסדר

### Commit 1 — adapter: `recent-projects.ts` (GET /api/projects)

- **Approach**: `manual` (glue/adapter — ה-shape מתגלה בשימוש).
- **קבצים חדשים**: `packages/frontend/src/lib/adapters/recent-projects.ts`
- **API skeleton**:
  ```ts
  import type { CliKind } from "@drive-coding/core"
  import { beUrl } from "$lib/util/be-url"   // ודא את הנתיב המדויק של helper ה-URL (כמו ב-fs-browse.ts)

  /** רשומת פרויקט מ-GET /api/projects (משקף את ProjectEntry של ה-BE). */
  export type RecentProject = {
    cwd: string
    kind: CliKind
    lastSeen: string          // ISO 8601
    lastSessionId?: string
  }

  /** מחזיר את התיקיות האחרונות (ממוין lastSeen יורד — ה-BE כבר ממיין). */
  export async function listRecentProjects(signal?: AbortSignal): Promise<RecentProject[]> {
    const res = await fetch(beUrl("/api/projects"), { signal })
    if (!res.ok) throw new Error(`projects failed: ${res.status}`)
    const body = (await res.json()) as { projects?: unknown[] }
    return (body.projects ?? []).map(normalizeRecentProject)
  }

  function normalizeRecentProject(p: unknown): RecentProject {
    const item = p as Record<string, unknown>
    return {
      cwd: String(item["cwd"] ?? ""),
      kind: String(item["kind"] ?? "claude") as CliKind,
      lastSeen: String(item["lastSeen"] ?? ""),
      lastSessionId: item["lastSessionId"] ? String(item["lastSessionId"]) : undefined,
    }
  }
  ```
  > בדוק את שם ה-helper המדויק להרכבת URL ל-BE (`fs-browse.ts` משתמש ב-`beUrl`; `agents-api.ts`
  > עשוי להשתמש בשם אחר). השתמש באותו helper שכבר בשימוש ל-`GET` ב-`agents-api.ts`.
- **Verification**:
  ```bash
  pnpm -r typecheck
  # ידני: עם BE רץ + registry מאוכלס — בקונסול: await fetch('/api/projects').then(r=>r.json())
  ```

### Commit 2 — VM: `recent-projects.svelte.ts` + wiring

- **Approach**: `manual` (חיקוי מדויק של `ActiveAgents`).
- **קבצים חדשים**: `packages/frontend/src/lib/view-models/recent-projects.svelte.ts`
- **קבצים שמשתנים**:
  - `packages/frontend/src/lib/context.ts` — הוסף `[getRecentProjects, setRecentProjects]`
    (כמו שורה 67 ל-ActiveAgents) + import type (כמו 28).
  - `packages/frontend/src/routes/+layout.svelte` — שלוש תוספות בחיקוי ActiveAgents:
    (א) `setRecentProjects` לבלוק ה-import מ-`$lib/context` (~שורה 19);
    (ב) import של class `RecentProjects` (ליד import ה-class של `ActiveAgents`, ~שורה 38);
    (ג) `const recentProjects = new RecentProjects()` (~98) + `setRecentProjects(recentProjects)` (~133).
- **API skeleton**:
  ```ts
  // recent-projects.svelte.ts
  import { listRecentProjects, type RecentProject } from "$lib/adapters/recent-projects"

  export class RecentProjects {
    projects = $state<RecentProject[]>([])
    loading = $state(false)
    error = $state<string | null>(null)

    refresh = async (): Promise<void> => {
      this.loading = true
      this.error = null
      try {
        this.projects = await listRecentProjects()
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e)
      } finally {
        this.loading = false
      }
    }
  }
  ```
- **Verification**: `pnpm -r typecheck`

### Commit 3 — component: `RecentProjectsPanel.svelte`

- **Approach**: `manual` (UI).
- **קבצים חדשים**: `packages/frontend/src/lib/components/connect/RecentProjectsPanel.svelte`
- **קבצים שמשתנים**: i18n — ראה Commit 5 (ניתן לכתוב יחד; אל תכניס עברית inline).
- **התנהגות**:
  - props: `onSelect: (project: RecentProject) => void`.
  - קורא `getRecentProjects()` מ-context; `onMount`/`$effect` → `refresh()`. (אופציונלי: רענון
    כמו ActiveProcessesPanel, אבל **לא חובה** — registry סטטי-יחסית.)
  - מציג: כותרת (`t("connect.recent.title")`), מצב ריק (`t("connect.recent.empty")`), כפתור refresh.
  - לכל פרויקט: basename בולט (חיקוי `folderName(cwd)` מ-ActiveProcessesPanel), badge `kind`, נתיב
    מלא ב-`<bdi>` עם RTL ellipsis, זמן יחסי (`lastSeen`). השורה כולה לחיצה → `onSelect(project)`.
  - **שימוש חוזר**: העתק את `folderName` + סגנון ה-`.cwd-full`/`.folder-name`/`.cli-badge`
    מ-`ActiveProcessesPanel.svelte` (אחידות ויזואלית).
- **API skeleton**:
  ```svelte
  <script lang="ts">
    import type { RecentProject } from "$lib/adapters/recent-projects"
    import { getRecentProjects, getI18n } from "$lib/context"
    let { onSelect }: { onSelect: (project: RecentProject) => void } = $props()
    const recent = getRecentProjects()
    const t = getI18n().t
    // onMount → void recent.refresh()
  </script>
  ```
- **Verification**: `pnpm -r typecheck` + הרצת FE, ראייה ויזואלית.

### Commit 4 — `+page.svelte`: הסרת בורר-הסשן + חיווט RecentProjectsPanel

- **Approach**: `manual` (composition).
- **קבצים שמשתנים**: `packages/frontend/src/routes/+page.svelte`
  - **הסר**:
    - import `SessionPicker` (9) + import `listSessionsForCwd, type SessionInfo` (7).
    - state: `sessions`, `sessionsLoading`, `sessionsError`, `selectedSessionId` (82-85).
    - `MOCK_FIXTURES` (87-104) + `loadSessions` (106-120).
    - בלוק sessions-autoload ב-`onMount` (34-39) — **רק** הבלוק הזה; השאר `activeAgents.refresh()`
      ו-`fetchServerOptions().then(...)`.
    - רינדור `<SessionPicker .../>` (206-215).
    - ב-`onSubmit` (136-150): מחק את ענף `if (selectedSessionId !== null) {...}` והשאר רק את
      `connectAgent({ cliKind, cwd: cwd.trim(), session, settings })`.
  - **הוסף**:
    - import `RecentProjectsPanel` + `type RecentProject`.
    - רינדור `<RecentProjectsPanel onSelect={handleRecentSelect} />` (במקום ה-SessionPicker, או ליד
      `ActiveProcessesPanel` למעלה — החלטת-מיקום של ה-executor; עדיף סמוך ל-ActiveProcessesPanel).
    - handler `handleRecentSelect(project)`:
      ```ts
      async function handleRecentSelect(project: RecentProject) {
        cliKind = project.kind
        cwd = project.cwd
        // connectAgent כבר עושה setCliKind/setLastCwd ו-goto("/chat") פנימית (connect-agent.ts).
        // אל תכפיל goto כאן — רק עדכן את ה-state המקומי (cwd/cliKind) ל-UI ואז חבר.
        await connectAgent({ cliKind: project.kind, cwd: project.cwd, session, settings })
      }
      ```
      > **אמת** ב-`connect-agent.ts` שהוא אכן עושה `goto("/chat")` ו-`settings.setLastCwd/setCliKind`
      > פנימית (כפי שעושה הזרימה הרגילה של `onSubmit`). אם **לא** — הוסף אותם כאן. אל תכפיל אם כן.
  - **שמר** (אל תיגע): `<FolderPickerDialog startPath={cwd} />` (מהסלייס הקודם), כפתור התיקייה,
    שדה ה-cwd, ה-`$effect` של folderWasOpen (57-61), ה-`$effect` של ניקוי-שגיאה (66-73).
- **Verification**:
  ```bash
  pnpm -r typecheck    # אסור שיישארו רפרנסים ל-SessionPicker/listSessionsForCwd/selectedSessionId
  pnpm --filter @drive-coding/frontend test
  ```

### Commit 5 — ניקוי adapter + מחיקת SessionPicker + i18n

- **Approach**: `manual`.
- **קבצים שמשתנים**:
  - `packages/frontend/src/lib/adapters/sessions.ts` — **הסר** את `listSessionsForCwd` (36-74)
    ואת ה-imports שהפכו ללא-בשימוש (`createAcpClient`, `WsAcpTransport`, `createAgent`,
    `deleteAgent`, `beWsUrl`, ו-`CliKind` אם כבר לא נצרך). **השאר** `SessionInfo` (17-22) +
    `normalizeSessionInfo` (77-85).
  - **מחק קובץ**: `packages/frontend/src/lib/components/connect/SessionPicker.svelte`.
  - **i18n** (קטלוג בלבד — `lint:i18n`):
    - `packages/core/src/i18n/keys.ts` — בלוק דומיין חדש בסוף האיחוד:
      ```ts
      // ─── recent-projects ─── (slice connect-recent-projects)
      | "connect.recent.title"
      | "connect.recent.empty"
      | "connect.recent.refresh"
      ```
    - `packages/core/src/i18n/catalogs/he.ts` — בלוק חדש: `"connect.recent.title": "תיקיות אחרונות"`,
      `"connect.recent.empty": "אין תיקיות אחרונות"`, `"connect.recent.refresh": "רענן"`.
    - `packages/core/src/i18n/catalogs/en.ts` — אותם מפתחות: `"Recent folders"`, `"No recent folders"`,
      `"Refresh"`.
    - אם משתמשים בזמן-יחסי לכותרת/שורה — אפשר לעטוף ב-`Intl.RelativeTimeFormat` (כמו ב-SessionPicker
      `formatDate`) בלי מחרוזת UI חדשה.
  > ⚠️ **בדוק שאריות-קוד** (לא הערות): ה-gate הוא על **imports/שימושים** — לא על הערות. קיימות
  > 3 הפניות **בהערות-קוד בלבד** שיישארו וזה תקין (לא שוברות typecheck/build):
  > `packages/frontend/src/lib/util/formatting.ts:6`, `formatting.test.ts:6`,
  > `agent-session.svelte.ts:922` ("דף החיבור משתמש ב-listSessionsForCwd..."). **עדכן את ההערה
  > ב-`agent-session.svelte.ts:922`** כך שתשקף את המציאות החדשה (דף החיבור כבר לא משתמש ב-spawn);
  > את שתי ההערות ב-`formatting.*` אפשר להשאיר. ה-gate הנכון:
  > ```bash
  > # שימושי-קוד בלבד (מחריג הערות // ו-* ); חייב 0:
  > grep -rn "SessionPicker\|listSessionsForCwd\|selectedSessionId" packages/frontend/src \
  >   | grep -vE "^\s*[^:]+:[0-9]+:\s*(//|\*|/\*)"
  > ```
- **Verification**:
  ```bash
  # שימושי-קוד בלבד (מחריג הערות) — חייב 0:
  grep -rn "SessionPicker\|listSessionsForCwd" packages/frontend/src \
    | grep -vE "^\s*[^:]+:[0-9]+:\s*(//|\*|/\*)"
  pnpm lint:i18n
  pnpm -r typecheck
  pnpm --filter @drive-coding/frontend test
  pnpm --filter @drive-coding/frontend build   # ⚠️ build-gate: ודא שה-vite build עובר (לא רק vitest)
  ```

---

## §5 — DoD verifiable

| בדיקה | איך מבצעים |
|---|---|
| אין spawn חד-פעמי במסך הפתיחה | קוד: `listSessionsForCwd` נמחק; ידני: פתח מסך פתיחה ובדוק ב-Network/BE-log שאין `POST /api/agents` עד שמתחברים |
| אין dropdown בחירת-סשן במסך הפתיחה | ידני — אין יותר `SessionPicker` |
| רשימת תיקיות אחרונות מוצגת | ידני — חבר ל-2-3 תיקיות, רענן מסך פתיחה, ראה אותן ברשימה |
| מצב ריק כשאין registry | ידני — `DRIVE_CODING_DATA_DIR` ריק → "אין תיקיות אחרונות" |
| לחיצה על תיקיה אחרונה מחברת ועוברת לצ'אט | ידני — לחץ שורה → `/chat` עם ה-cwd הנכון |
| בחירת סשן עדיין עובדת **מתוך** הסשן | ידני — בצ'אט פתח `SessionOptionsPanel`, החלף/צור סשן |
| `SessionInfo`/`normalizeSessionInfo` לא נשברו | `pnpm --filter @drive-coding/frontend test` (טסטי agent-session) ירוקים |
| אין שאריות-**קוד** של SessionPicker/listSessionsForCwd (הערות מותרות) | ה-grep המסונן מהערות (Commit 5) → 0 |
| typecheck נקי | `pnpm -r typecheck` |
| **vite build עובר** (build-gate) | `pnpm --filter @drive-coding/frontend build` |
| lint i18n נקי | `pnpm lint:i18n` |

---

## §6 — Risks + mitigations

- **סיכון (קריטי): מחיקת כל `sessions.ts` שוברת in-session listing.** הקובץ מייצא `SessionInfo` +
  `normalizeSessionInfo` בשימוש ב-`agent-session.svelte.ts:37` וב-`SessionCard.svelte:7`.
  *מיטיגציה*: למחוק **רק** את `listSessionsForCwd` + imports יתומים; להשאיר את היתר. אמת עם `grep`
  ועם הרצת טסטי FE.
- **סיכון: import לא-תקין שחודר ל-FE bundle ושובר את ה-vite build (כמו תקדים ה-acp barrel).**
  *הבהרה* (אביגיל finding #5): ה-barrel `provider-contract/acp` **כבר** ב-bundle דרך
  `agent-session.svelte.ts:20` ו-`ws-transport.ts:19`, וה-build על dev עובר — הסרת `listSessionsForCwd`
  לא משנה זאת. ה-adapter החדש משתמש ב-`fetch` רגיל בלבד (אין import של `provider-contract/acp` או
  `node:*`) → לא מוסיף סיכון. *מיטיגציה*: DoD כולל `vite build` מפורש (לא רק vitest) — שער כללי
  שמגן מפני import-בטעות עתידי, לא בגלל ה-adapter הספציפי. ראה memory `provider-contract /acp barrel
  breaks FE build`.
- **סיכון: כפילות מול ActiveProcessesPanel.** תיקיה עם agent חי תופיע גם ב"תהליכים פעילים" (reconnect
  warm, שומר state) וגם ב"תיקיות אחרונות" (spawn חדש). זו **לא** באג — סמנטיקה שונה. *מיטיגציה*:
  מיקום ויזואלי ברור (תהליכים פעילים למעלה, תיקיות אחרונות אחריו); אין צורך לסנן חופפים ב-MVP.
- **סיכון: `kind` מה-registry אינו `CliKind` תקין (data ישן/פגום).** *מיטיגציה*: `normalizeRecentProject`
  עושה `String(...)` עם fallback; אם ה-kind לא נתמך, `connectAgent` ייכשל gracefully (session.error).
- **סיכון: רפקטור `+page.svelte` מוחק בטעות את `startPath={cwd}` (שהגיע מ-folder-picker-fixes ל-dev).**
  *מיטיגציה*: §0 Pre-flight מאמת שהוא קיים ב-base; §4 Commit 4 מסמן אותו במפורש כ"לשמר".
- **סיכון: dispatch לפני merge של folder-picker-fixes → base בלי `startPath`, +page בקונפליקט.**
  *מיטיגציה*: ה-**Gate** בראש ה-brief + Pre-flight check ב-§0 (`grep startPath`). מרדכי לא מסמן
  `dispatch_ready` עד שה-folder-picker-fixes מוזג ל-dev.
- **סיכון: עברית inline (`lint:i18n`).** *מיטיגציה*: כל המחרוזות דרך הקטלוג; הרץ `pnpm lint:i18n`.
- **סיכון: שכחת `pnpm install` ב-worktree חדש.** *מיטיגציה*: §0 כולל `pnpm install && pnpm hooks:install`
  אחרי יצירת ה-worktree.

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- מתברר ש-`GET /api/projects` מחזיר ריק תמיד למרות חיבורים (כלומר `recordCwd` לא נקרא בפועל בנתיב
  שבדקת) — דווח לפני שתשנה את ה-BE.
- ה-shape של `ProjectEntry` בפועל שונה ממה שמתואר כאן (שדות חסרים/נוספים).
- מתעורר צורך ב-endpoint BE חדש (לא היה אמור — אם כן, זו החלטה ארכיטקטונית).
- בחירה: האם לחיצה על תיקיה צריכה לטעון את `lastSessionId` במקום סשן חדש (החלטת-UX — לא לבד).
- ה-`vite build` נכשל עם `spawn not exported` / `node:*` — סימן ל-import לא-תקין שחדר ל-bundle.

---

## §8 — Complexity score + verifier choice

**Score: 6/10.**
- Commits: 5 (סביר-גבולי).
- שכבות חדשות: 3 (adapter + VM + component) — אבל כולן חיקוי מדויק של דפוס ActiveAgents קיים.
- APIs חיצוניים: 0 (endpoint פנימי קיים).
- מחיקה/רגרסיה-risk: בינוני — נגיעה ב-`sessions.ts` משותף (mitigated) + רפקטור `+page.svelte`.
- אין לוגיקה אלגוריתמית מורכבת; רובו glue + removal.

**Verifier: `calev` (mode: light).** מתחת לסף 8+. האמת כאן היא runtime: רשימת תיקיות נטענת, לחיצה
מחברת, אין spawn מיותר, in-session listing לא נשבר. כולל `vite build` (build-gate) באימות.

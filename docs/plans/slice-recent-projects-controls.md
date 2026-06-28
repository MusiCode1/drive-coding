# Slice recent-projects-controls — מחיקה (הסתרה קבועה) + כיווץ-panel נשמר — בריף

> **תאריך**: 2026-06-28
> **סוג מסמך**: בריף ביצועי לסלייס — לא תוכנית טרום-בריף
> **סטטוס**: הושלם (2026-06-28)
> **אימות אביגיל**: READY (r1)
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`; אחרת זה בריף לא-גמור.
> **Complexity**: 6/10 (verifier: light → `calev`)
> **תלויות (`depends_on`)**: [] — בנוי ישירות על dev (מעל `connect-recent-projects` שכבר מוזג)
> **Base**: `dev`
> **Dev tip**: `ebf50ae`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **אינו תלוי** באף slice לא-merged. הוא בונה **מעל** `connect-recent-projects` (כבר מוזג
ל-dev ב-`726f9f3`) ומרחיב אותו. נשען על תשתית קיימת:
- **ProjectsRegistry** (BE) — `packages/backend/src/app/projects-registry.ts`: `recordCwd`/`recordSession`/
  `getProjects`. עובדת על `<stateDir>/cache/projects-registry.json`. **כאן נוסיף `hideCwd` + שדה `hidden`.**
- **endpoint** `registerProjectsHttp` ב-`http-history.ts` (כרגע רק `GET /api/projects`). **כאן נוסיף `DELETE`.**
- **RecentProjects VM + adapter + panel** (מ-connect-recent-projects): `recent-projects.svelte.ts`,
  `recent-projects.ts`, `RecentProjectsPanel.svelte`.
- **Settings store** — `settings.svelte.ts`: דפוס persist ל-localStorage (`showThoughts`/`showTools`).
  **כאן נוסיף `recentCollapsed`.**
- **context** — `getSettings()` (שורה 37) ו-`getRecentProjects()` כבר זמינים ל-panel.

### Pre-flight check (חובה לפני Commit 1)

ודא שה-base כולל את connect-recent-projects:
```bash
grep -n "registerProjectsHttp" packages/backend/src/delivery/http-history.ts   # חייב להופיע
grep -n "getRecentProjects" packages/frontend/src/lib/context.ts               # חייב להופיע
ls packages/frontend/src/lib/components/connect/RecentProjectsPanel.svelte     # חייב להתקיים
```
אם חסר → base שגוי (connect-recent-projects לא מוזג) → עצור ודווח למרדכי.

### Worktree

```bash
cd /d/UserProjects/AI/drive-coding
git worktree add /d/UserProjects/AI/drive-coding/.worktrees/recent-projects-controls \
  -b slice/recent-projects-controls dev
cd /d/UserProjects/AI/drive-coding/.worktrees/recent-projects-controls
pnpm install && pnpm hooks:install
```
(bare repo — נתיב אבסולוטי חובה. ה-branch הוא `slice/recent-projects-controls`, ה-dir בלי הקידומת.)

### איך להריץ

- **BE** (port 4000; אם תפוס → `PORT=4002`). ⚠️ **data חי ב-`<home>/.config/drive-coding/`** —
  אל תזהם את ה-registry החי. הרץ עם `HOME` מבודד:
  ```bash
  cd packages/backend
  HOME=/tmp/dc-controls-test PORT=4000 bun src/server.ts
  ```
  > ⚠️ ה-state dir **אינו** `DRIVE_CODING_DATA_DIR` — `getStateDir()` ב-`paths.ts` נגזר מ-`getHomeDir()`
  > (`process.env.HOME || USERPROFILE || os.homedir()`). הקובץ בפועל: `<HOME>/.config/drive-coding/cache/projects-registry.json`.
  > זְרַע אותו ידנית כדי לראות תיקיות (פורמט: `{ "projects": [{ "cwd": "...", "kind": "claude", "lastSeen": "ISO" }] }`).
- **FE dev**: `pnpm --filter @drive-coding/frontend-v2 dev` (שם ה-package הוא `@drive-coding/frontend-v2`).
- **Tests BE**: `pnpm vitest run packages/backend` (מה-root). ⚠️ **לא** `pnpm --filter @drive-coding/backend test`
  (no-op — אין script). לקובץ בודד: `pnpm vitest run packages/backend/tests/storage-layer.test.ts`.
- **Tests FE**: `pnpm --filter @drive-coding/frontend-v2 test`
- **Typecheck**: `pnpm -r typecheck`
- **Lint i18n**: `pnpm lint:i18n` (הסלייס **כן** מוסיף מחרוזות → קטלוג בלבד, לא inline).
- **build-gate**: `pnpm --filter @drive-coding/frontend-v2 build`

### Browser

UI integration — אימות בדפדפן (`playwright-cli` skill או דפדפן רגיל). אמת: (א) כפתור מחיקה בכל שורה
מסיר אותה מהרשימה; (ב) אחרי מחיקה הרשומה **לא חוזרת** גם אחרי refresh/חיבור חוזר (הסתרה קבועה);
(ג) כפתור הכיווץ מסתיר את הרשימה ומשאיר רק את ה-header; (ד) מצב-הכיווץ **נשמר** אחרי רענון הדף (localStorage).

### Reading list

**must-read**:
- `packages/backend/src/app/projects-registry.ts` — כל הקובץ (81 שורות). קריטי: `ProjectEntry` (13-18),
  `recordCwd` (45-57 — **כבר עושה spread** `{...projects[idx]!, cwd, kind, lastSeen}` → שדות נוספים שורדים),
  `getProjects` (71-76 — sort; כאן ייכנס ה-filter).
- `packages/backend/tests/storage-layer.test.ts` שורות 28-94 — `describe("createProjectsRegistry")`.
  דפוס הטסטים (tmpDir, recordCwd, getProjects). כאן ייכנסו טסטי ה-hide (TDD).
- `packages/backend/src/delivery/http-history.ts` שורות 22-35 — `registerProjectsHttp` (כרגע רק GET).
- `packages/backend/tests/http-history.test.ts` — דפוס integration test (Hono app + fetch). הוסף DELETE.
- `packages/frontend/src/lib/adapters/recent-projects.ts` — כל הקובץ (38 שורות). דפוס `beUrl` + fetch.
- `packages/frontend/src/lib/view-models/recent-projects.svelte.ts` — כל הקובץ (28 שורות). `refresh`.
- `packages/frontend/src/lib/view-models/settings.svelte.ts` — דפוס הוספת שדה persist (ה-doc-comment
  בראש הקובץ מפרט את 3 הצעדים: Persisted + DEFAULTS + $state/setter). ראה `showThoughts` כתקדים מדויק.
- `packages/frontend/src/lib/components/connect/RecentProjectsPanel.svelte` — כל הקובץ (238 שורות).
  קריטי: ה-`panel-header` (33-45), ה-`project-row` + `project-btn` (53-74), ה-styles.
- `packages/frontend/src/lib/context.ts` שורה 37 (`getSettings`) — לקריאת מצב-הכיווץ ב-panel.

**reference**:
- `packages/frontend/src/lib/components/connect/ActiveProcessesPanel.svelte` — דפוס כפתור-פעולה בשורה
  (Trash icon + confirm). כאן **לא** נשתמש ב-confirm (ראה §4 Commit 5), אך הדפוס הוויזואלי שימושי.
- `packages/core/src/i18n/keys.ts` (215-218) + `catalogs/he.ts` (205-208) + `en.ts` — בלוק `connect.recent.*`
  הקיים (append-only — נוסיף מפתחות חדשים לאותו בלוק).
- `docs/conventions/parallel-safe-code.md` — קטלוגים append-only + תוספתי.

---

## §1 — מטרה

אחרי הסלייס, ב-panel "תיקיות אחרונות" במסך הפתיחה יש שני פקדים חדשים:
1. **מחיקה (הסתרה קבועה)** — כפתור בכל שורה שמסיר את התיקייה מהרשימה. ההסתרה **שורדת** — התיקייה
   לא תחזור לרשימה גם אם המשתמשת תתחבר אליה שוב (דגל `hidden` בשרת, מסונכרן בין מכשירים).
2. **כיווץ ה-panel** — כפתור שמקפל את הרשימה (משאיר רק את ה-header), למשתמשת שלא רוצה לראות אותה.
   מצב-הכיווץ **נשמר** (localStorage, per-device) — נשאר מכווץ בכניסה הבאה.

---

## §2 — Scope: מה כן, מה לא

| לא בסקופ (בכוונה) | היכן/הערה |
|---|---|
| ביטול-הסתרה מה-UI (un-hide) | לא ב-MVP. הסתרה היא חד-כיוונית מה-UI; ביטול דורש מחיקת הרשומה ב-`projects-registry.json` ידנית. אפשר להוסיף בעתיד. |
| מחיקה אמיתית של הרשומה (DELETE שורה) | לא — אנו **מסתירים** (`hidden: true`), לא מוחקים. שומר על lastSessionId/lastSeen אם תיקח חזרה בעתיד. |
| confirm לפני מחיקה ("בטוח?") | לא ב-MVP — ההסתרה הפיכה (לא הורסת קוד/סשנים). ראה §6. |
| toggle ל-`recentCollapsed` ב-SettingsScreen | לא — הכיווץ נשלט מה-panel עצמו (chevron). רק ה-persist נכנס ל-Settings store. |
| כיווץ ActiveProcessesPanel (תהליכים פעילים) | מחוץ לסקופ — panel נפרד. |
| סנכרון מצב-הכיווץ בין מכשירים | לא — `recentCollapsed` הוא localStorage (העדפת-תצוגה מקומית), בניגוד ל-`hidden` (server-side). |

---

## §3 — Architecture diagram

```
routes (+page.svelte)              ← ללא שינוי (RecentProjectsPanel כבר מחווט)
   │
components/connect
   └─ RecentProjectsPanel.svelte   ← משתנה: כפתור-מחיקה פר-שורה (sibling ל-project-btn) + chevron כיווץ ב-header
   │      getSettings() → recentCollapsed (כיווץ) ; recent.hide(cwd) (מחיקה)
view-models
   ├─ recent-projects.svelte.ts    ← משתנה: action hide(cwd) (optimistic remove + adapter call)
   └─ settings.svelte.ts           ← משתנה: שדה recentCollapsed + setter (דפוס showThoughts)
adapters
   └─ recent-projects.ts           ← משתנה: hideRecentProject(cwd) → DELETE /api/projects
   │      DELETE /api/projects  body {cwd}
backend/delivery
   └─ http-history.ts              ← משתנה: registerProjectsHttp מוסיף DELETE /api/projects
backend/app
   └─ projects-registry.ts         ← משתנה: ProjectEntry.hidden? + hideCwd(cwd) + getProjects מסנן hidden
```

אין שכבות חדשות. recordCwd **לא משתנה** (ה-spread הקיים כבר משמר את `hidden`).

---

## §4 — Commits בסדר

### Commit 1 — BE: `ProjectsRegistry.hideCwd` + סינון `hidden` ב-`getProjects` (TDD)

- **Approach**: `mixed` (TDD unit ב-storage-layer.test.ts).
- **קבצים שמשתנים**:
  - `packages/backend/src/app/projects-registry.ts`:
    - `ProjectEntry`: הוסף שדה `readonly hidden?: boolean`.
    - הוסף מתודה `hideCwd(cwd: string): Promise<void>` — טוענת, מוצאת לפי cwd, ומסמנת `hidden: true`
      (אם לא קיימת — no-op, כמו `recordSession`).
    - `getProjects`: סנן רשומות `hidden === true` **לפני** המיון.
    - **אל תיגע ב-`recordCwd`** — ה-spread `{ ...projects[idx]!, cwd, kind, lastSeen }` כבר משמר את
      `hidden` (כך ההסתרה שורדת חיבור חוזר). זה הליבה של "הסתרה קבועה".
  - `packages/backend/tests/storage-layer.test.ts` (בתוך `describe("createProjectsRegistry")`):
    - **TDD red→green**: `it("hideCwd hides a project from getProjects")` — recordCwd, hideCwd, ואז
      `getProjects` **לא** מחזיר אותה.
    - `it("hidden survives a subsequent recordCwd")` — recordCwd, hideCwd, recordCwd שוב (אותו cwd),
      ואז getProjects **עדיין לא** מחזיר אותה (ההסתרה שרדה).
    - `it("hideCwd on unknown cwd is a no-op")` — hideCwd על cwd לא-קיים לא זורק ולא משנה.
- **API skeleton**:
  ```ts
  export type ProjectEntry = {
    readonly cwd: string
    readonly kind: BridgeKind
    readonly lastSeen: string
    readonly lastSessionId?: string
    readonly hidden?: boolean   // ← נוסף: הסתרה קבועה (לא מוחזר ב-getProjects)
  }

  // בתוך ה-return של createProjectsRegistry:
  async hideCwd(cwd: string): Promise<void> {
    const projects = await load()
    const idx = projects.findIndex((p) => p.cwd === cwd)
    if (idx < 0) return                       // unknown cwd → no-op (כמו recordSession)
    const updated = [...projects]
    updated[idx] = { ...projects[idx]!, hidden: true }
    await persist(updated)
  },

  async getProjects(): Promise<readonly ProjectEntry[]> {
    const projects = await load()
    return [...projects]
      .filter((p) => p.hidden !== true)       // ← נוסף: לא מחזירים מוסתרות
      .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
  },
  ```
- **Verification**:
  ```bash
  pnpm vitest run packages/backend/tests/storage-layer.test.ts   # כולל 3 הטסטים החדשים — ירוק
  pnpm -r typecheck
  ```

### Commit 2 — BE: endpoint `DELETE /api/projects` (body `{cwd}`)

- **Approach**: `mixed` (integration test).
- **שורש העיצוב**: `cwd` מכיל תווים מיוחדים (`:` ב-Windows, `\`, `/`) → לא נוח כ-path param. נשתמש ב-JSON
  body. הדפוס `app.delete` כבר קיים בפרויקט (`http-agents.ts:89`).
- **קבצים שמשתנים**:
  - `packages/backend/src/delivery/http-history.ts` (בתוך `registerProjectsHttp`):
    ```ts
    // DELETE /api/projects  { cwd }  → מסתיר את התיקייה (hidden=true)
    app.delete("/api/projects", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { cwd?: unknown }
      const cwd = typeof body.cwd === "string" ? body.cwd : ""
      if (!cwd) return c.json({ error: "cwd required" }, 400)
      await deps.projectsRegistry.hideCwd(cwd)
      return c.body(null, 204)
    })
    ```
  - `packages/backend/tests/http-history.test.ts`:
    - integration test: seed registry (recordCwd) → `DELETE /api/projects` עם `{cwd}` → 204 →
      `GET /api/projects` **לא** מחזיר אותה.
    - test: `DELETE` בלי cwd → 400.
- **Verification**:
  ```bash
  pnpm vitest run packages/backend/tests/http-history.test.ts
  pnpm -r typecheck
  ```

### Commit 3 — FE adapter: `hideRecentProject(cwd)`

- **Approach**: `manual` (glue).
- **קבצים שמשתנים**: `packages/frontend/src/lib/adapters/recent-projects.ts`:
  ```ts
  /** מסתיר תיקייה מרשימת התיקיות האחרונות (קבוע — DELETE /api/projects). */
  export async function hideRecentProject(cwd: string): Promise<void> {
    const res = await fetch(beUrl("/api/projects"), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    })
    if (!res.ok) throw new Error(`hide project failed: ${res.status}`)
  }
  ```
- **Verification**: `pnpm -r typecheck`

### Commit 4 — FE VM: `hide(cwd)` action

- **Approach**: `manual`.
- **קבצים שמשתנים**: `packages/frontend/src/lib/view-models/recent-projects.svelte.ts`:
  - הוסף `import { listRecentProjects, hideRecentProject, type RecentProject }`.
  - הוסף action `hide` — **optimistic**: מסיר את ה-cwd מ-`projects` מיד, ואז קורא ל-BE; בכשל → `refresh()`
    (שחזור מה-מקור-אמת) + `error`.
  ```ts
  hide = async (cwd: string): Promise<void> => {
    const prev = this.projects
    this.projects = this.projects.filter((p) => p.cwd !== cwd)   // optimistic
    try {
      await hideRecentProject(cwd)
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e)
      this.projects = prev                                        // rollback
    }
  }
  ```
- **Verification**: `pnpm -r typecheck`

### Commit 5 — FE Settings: `recentCollapsed` persist (localStorage)

- **Approach**: `manual` (דפוס מדויק של `showThoughts` — ראה doc-comment בראש settings.svelte.ts).
- **קבצים שמשתנים**: `packages/frontend/src/lib/view-models/settings.svelte.ts` — 4 נגיעות:
  1. `Persisted` type: הוסף `recentCollapsed: boolean` (בלוק חדש בסוף).
  2. `DEFAULTS`: `recentCollapsed: false` (ברירת-מחדל = פתוח).
  3. `$state` + setter `setRecentCollapsed(v)` שקורא `#persist()` (בלוק domain חדש).
  4. constructor: `this.recentCollapsed = loaded.recentCollapsed`; ו-`#persist()`: הוסף את השדה ל-object.
  ```ts
  // ─── תיקיות אחרונות ─── (slice recent-projects-controls)
  // Persisted: recentCollapsed: boolean
  // DEFAULTS:  recentCollapsed: false
  recentCollapsed = $state<boolean>(DEFAULTS.recentCollapsed)
  setRecentCollapsed = (v: boolean): void => {
    this.recentCollapsed = v
    this.#persist()
  }
  ```
- **Verification**: `pnpm -r typecheck`

### Commit 6 — FE component: כפתור-מחיקה פר-שורה + כיווץ-panel + i18n

- **Approach**: `manual` (UI).
- **קבצים שמשתנים**:
  - `packages/frontend/src/lib/components/connect/RecentProjectsPanel.svelte`:
    - **כיווץ**: import `getSettings`; `const settings = getSettings()`. ב-`panel-header` הוסף כפתור chevron
      (לפני/אחרי refresh) → `onclick={() => settings.setRecentCollapsed(!settings.recentCollapsed)}`,
      `aria-expanded`. עטוף את גוף ה-panel (`{#if projects.length...}{:else}...`) ב-`{#if !settings.recentCollapsed}`.
      כשמכווץ — כפתור ה-refresh מוסתר (אופציונלי) וה-chevron מורה על מצב.
    - **מחיקה**: ⚠️ **קריטי — nested button אסור** (HTML לא תקין). כפתור המחיקה חייב להיות **sibling**
      של `project-btn`, **לא ילד**. שנה את ה-`project-row` ל-flex עם `project-btn` (גמיש) + `delete-btn`:
      ```svelte
      <li class="project-row">
        <button type="button" class="project-btn" onclick={() => onSelect(project)}>
          ... (ללא שינוי פנימי) ...
        </button>
        <button
          type="button"
          class="delete-btn"
          onclick={() => void recent.hide(project.cwd)}
          title={t("connect.recent.hide")}
          aria-label={t("connect.recent.hide")}
        >✕</button>
      </li>
      ```
      CSS: `.project-row { display:flex; align-items:stretch }`, `.project-btn { flex:1; min-width:0 }`,
      `.delete-btn` = כפתור צר בצד (דפוס `.refresh-btn`), מופיע ב-hover (אופציונלי) או תמיד.
    - **אל תוסיף confirm** — מחיקה ישירה (ראה §6).
  - **i18n** (קטלוג בלבד — append-only לבלוק `connect.recent.*` הקיים):
    - `packages/core/src/i18n/keys.ts` (אחרי 218):
      ```ts
      | "connect.recent.hide"
      | "connect.recent.collapse"
      | "connect.recent.expand"
      ```
    - `he.ts` (אחרי 208): `"connect.recent.hide": "הסר מהרשימה"`, `"connect.recent.collapse": "כווץ"`,
      `"connect.recent.expand": "הרחב"`.
    - `en.ts`: `"Remove from list"`, `"Collapse"`, `"Expand"`.
- **Verification**:
  ```bash
  pnpm lint:i18n
  pnpm -r typecheck
  pnpm --filter @drive-coding/frontend-v2 test
  pnpm --filter @drive-coding/frontend-v2 build   # build-gate
  ```

---

## §5 — DoD verifiable

| בדיקה | איך מבצעים |
|---|---|
| `hideCwd` מסתיר מ-`getProjects` | `pnpm vitest run packages/backend/tests/storage-layer.test.ts` — הטסט ירוק |
| הסתרה שורדת `recordCwd` חוזר | הטסט `hidden survives a subsequent recordCwd` ירוק |
| `hideCwd` על cwd לא-מוכר = no-op | הטסט ירוק |
| `DELETE /api/projects` מסתיר (204) + בלי cwd → 400 | `pnpm vitest run packages/backend/tests/http-history.test.ts` ירוק |
| בדפדפן: כפתור מחיקה מסיר שורה | ידני — לחץ ✕, השורה נעלמת |
| בדפדפן: מחיקה קבועה (לא חוזרת אחרי refresh) | ידני — מחק, רענן דף / לחץ refresh → לא חוזרת |
| בדפדפן: כיווץ מסתיר את הרשימה | ידני — לחץ chevron, הרשימה נעלמת, header נשאר |
| בדפדפן: מצב-כיווץ נשמר אחרי רענון | ידני — כווץ, רענן דף (F5) → נשאר מכווץ |
| אין nested `<button>` (HTML תקין) | קוד — `delete-btn` הוא sibling של `project-btn`, לא ילד |
| typecheck נקי | `pnpm -r typecheck` |
| FE tests + vite build עוברים | `pnpm --filter @drive-coding/frontend-v2 test` + `... build` |
| lint i18n נקי | `pnpm lint:i18n` |

---

## §6 — Risks + mitigations

- **סיכון (קריטי): nested `<button>` — HTML לא תקין + event bubbling.** אם כפתור המחיקה ירונדר **בתוך**
  `project-btn`, לחיצה עליו תפעיל גם את `onSelect` (connect). *מיטיגציה*: כפתור המחיקה הוא **sibling**
  (§4 Commit 6) — `project-row` הופך ל-flex. ה-DoD בודק זאת.
- **סיכון: `recordCwd` ידרוס את `hidden`.** *הבהרה*: לא — ה-spread `{ ...projects[idx]!, ... }` כבר משמר
  שדות שלא מוזכרים. **אל תשנה את recordCwd.** הטסט `hidden survives` מאמת זאת end-to-end.
- **סיכון: DELETE עם body נחסם ע"י proxy/fetch.** Hono קורא `c.req.json()`; Vite proxy מעביר את כל `/api`.
  *מיטיגציה*: integration test ב-BE + אימות ידני בדפדפן. אם נכשל — fallback ל-`POST /api/projects/hide`.
- **סיכון: optimistic remove + כשל BE משאיר UI לא-עקבי.** *מיטיגציה*: rollback ל-`prev` + `error` (§4 Commit 4).
- **סיכון: persist נדרס במיגרציה עתידית.** *מיטיגציה*: `recentCollapsed` נוסף בסוף `Persisted`/`DEFAULTS`
  (append-only) ו-`load()` עושה `{ ...DEFAULTS, ...parsed }` → מפתח חסר נופל ל-default. דפוס מוכח.
- **סיכון: עברית inline (`lint:i18n`).** *מיטיגציה*: כל המחרוזות דרך הקטלוג; הרץ `pnpm lint:i18n`.
- **סיכון: זיהום registry חי בבדיקה.** *מיטיגציה*: `HOME` מבודד (§0 "איך להריץ").

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- `DELETE /api/projects` עם body נכשל ברמת הרשת/proxy (לא מגיע ל-handler) — דווח לפני מעבר ל-POST.
- מתברר ש-`recordCwd` **כן** דורס את `hidden` (כלומר ה-spread לא מתנהג כצפוי) — דווח, אל תשנה את recordCwd לבד.
- מתעורר צורך ב-un-hide UI (החלטת-UX — לא לבד).
- ה-chevron/כיווץ דורש שינוי מבני ב-`+page.svelte` (אמור להיות מקומי ל-panel בלבד).
- צריך החלטה ארכיטקטונית שלא מכוסה ב-D1-D50.

---

## §8 — Complexity score + verifier choice

**Score: 6/10.**
- Commits: 6 (סביר).
- שכבות חדשות: 0 (מרחיב קיים — registry method + endpoint + adapter fn + VM action + settings field + UI).
- APIs חיצוניים: 0.
- TDD: Commit 1 (registry unit) + Commit 2 (endpoint integration). UI manual: Commit 6.
- מחיקה/רגרסיה-risk: נמוך-בינוני — נגיעה ב-`projects-registry.ts` (mitigated: recordCwd לא משתנה) +
  refactor markup של `RecentProjectsPanel` (nested-button risk, mitigated ב-DoD).

**Verifier: `calev` (mode: light).** מתחת לסף 8+. האמת היא runtime: מחיקה מסתירה-קבוע, כיווץ נשמר —
+ סוויטות BE/FE ו-build.

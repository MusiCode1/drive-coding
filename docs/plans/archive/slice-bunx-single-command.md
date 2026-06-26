# Slice — bunx single-command launch — ‏תוכנית

> ✅ **בוצע · אומת · מוזג ל-dev.** אורכב ב-2026-06-27 (הסטטוס אומת מול היסטוריית git/roadmap; פרטי הביצוע והאימות בהמשך הקובץ).

> **‏תאריך**: 2026-06-16
> **‏סטטוס**: הושלם (commits: 848cf44..0d28e00)
> **Complexity**: 3/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [] ‏— ‏בנוי ישירות על dev
> **‏Base**: dev
> **‏Dev tip**: `161bd94`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏אין לו תלויות** — ‏בנוי ישירות על dev. ‏הוא משתמש ברכיבים קיימים בלבד:
- `packages/backend/src/server.ts` — ‏כבר תומך ב-`FE_STATIC_DIR` (single-origin serving, ‏שורות 78-89). ‏לא משתנה ב-slice הזה.
- `packages/frontend/build/` — ‏FE build קיים (`index.html` + `_app/` + fallback). ‏נבדק שקיים.

### Worktree

```bash
cd d:\UserProjects\AI\drive-coding\dev
git worktree add .worktrees/slice-bunx-single-command -b slice-bunx-single-command dev
cd .worktrees/slice-bunx-single-command
pnpm install && pnpm hooks:install
```

> ‏אם ה-FE build חסר ב-worktree החדש (gitignored) — ‏ראה §6 risk #4. ‏פתרון: `pnpm --filter @drive-coding/frontend-v2 build` ‏בתוך ה-worktree, ‏או junction ‏ל-build הקיים.

### ‏איך להריץ

- **‏ה-entry החדש (‏מה שה-slice בונה)**: `bun packages/backend/src/bin/drive-coding.ts` — ‏מרים BE על :4000 ‏שמגיש את ה-FE. ‏פקודה אחת.
- **BE לבד (dev, ‏קיים)**: `cd packages/backend && bun --watch src/server.ts` (port 4000)

> **‏הבהרה (finding #4)**: ‏ל-`packages/backend/package.json` ‏**‏כבר יש** `"start": "bun src/server.ts"` (‏BE-only, ‏בלי FE). ‏זה **‏לא** ‏ה-`start` ‏שאנחנו מוסיפים — ‏Commit 1 ‏מוסיף `start` ‏ב-**root** package.json ‏שמרים BE+FE. ‏אל תבלבל ביניהם, ‏ואל תיגע ב-backend start ‏הקיים.

> **‏הערה ל-shell (finding #3)**: ‏סביבת ה-dev ‏היא **Windows / PowerShell**. ‏כל פקודות ה-Verification ‏בהמשך כתובות ב-PowerShell. ‏הרצת ה-server ‏ברקע — ‏השתמש ב-`run_in_background` ‏של כלי ה-shell (‏לא `&`). ‏Bash tool ‏זמין ל-POSIX ‏אם נדרש.
- **FE build**: `pnpm --filter @drive-coding/frontend-v2 build` → `packages/frontend/build/`
- **Tests**: `pnpm test` (vitest) — ‏ספציפי: `pnpm test -- backend`
- **Typecheck**: `pnpm typecheck`
- **Lint**: `pnpm lint` (biome) + `pnpm lint:i18n`

### Browser

‏אימות ה-serving: ‏דפדפן רגיל על `http://localhost:4000/` ‏(או `curl`). ‏אין צורך ב-linux-gui.

### ‏Runtime ‏הכרעה — bunx, ‏לא node, ‏לא bundling

‏ה-entry מורץ תחת **Bun** (`#!/usr/bin/env bun`). ‏זו החלטה מבוססת:
1. `moduleResolution: "Bundler"` ‏ב-`tsconfig.base.json` — ‏הקוד מתוכנן ל-Bun/bundler, ‏לא ל-`tsc → node`.
2. ‏ה-plugin `packages/backend/plugins/prompt-injector.ts` **‏חייב להישאר .ts נגיש ב-runtime** — ‏OpenCode טוען אותו דרך `file://` ‏באמצעות Bun (‏ראה `plugins/README.md`). ‏bundling ‏ישבור אותו.
3. ‏production (Dockerfile, systemd) ‏כבר רץ עם Bun.

‏המעבר המלא ל-Node (`AGENTS.md`: "Node 22.5+ (Slice 2+)") ‏הוא slice עתידי, ‏לא כאן.

### Reading list

**must-read** (‏לפני שמתחילים):
- `packages/backend/src/server.ts` ‏שורות 1-9, 78-136 — ‏ה-imports, ‏בלוק ה-`FE_STATIC_DIR`, ‏ו-`serve()` ‏ה-top-level (‏ה-server עולה **‏on-import**, ‏אין `startServer()`).
- `packages/frontend/svelte.config.js` — `adapter-static` ‏מוציא ל-`build/` ‏עם `fallback: "index.html"`.

**reference** (‏בזמן עבודה):
- `packages/backend/plugins/README.md` §"Production notes" — ‏למה plugins/ ‏חייב להישאר נגיש.
- `package.json` ‏(root) — `scripts` ‏קיימים (`dev`, `build`, `test`).

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏מפתח/משתמש ‏יכול להריץ **‏פקודה אחת** (`bun packages/backend/src/bin/drive-coding.ts`, ‏ובהמשך `bunx drive-coding`) ‏שמרימה את ה-backend על פורט יחיד, ‏מגישה את ה-frontend הבנוי מאותו origin, ‏ומדפיסה את ה-URL ‏המוכן לפתיחה. ‏אין צורך לזכור `FE_STATIC_DIR`, ‏להריץ שני תהליכים, ‏או להבין את מבנה ה-monorepo. ‏אם ה-agent ‏החיצוני (opencode ‏וכו') ‏חסר — ‏המשתמש מקבל הודעת הכוונה ברורה ‏במקום כשל סתום.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| bin entry שמגדיר `FE_STATIC_DIR`+`PORT` ‏ומייבא את server.ts | ✅ | ‏בslice הזה |
| `bin` field ב-package.json (‏הכנה ל-`bunx`) | ✅ | ‏בslice הזה |
| launcher script ‏שבונה FE ‏אם חסר ‏ואז מריץ | ✅ | ‏בslice הזה |
| preflight: ‏הדפסת URL + ‏אזהרה אם agent ‏חסר ב-PATH | ✅ | ‏בslice הזה |
| ‏הסרת `private`, `files[]`, ‏פרסום ל-npm בפועל | ❌ | slice-npm-publish (‏המשך) |
| ‏פתרון `@drive-coding/core` workspace + `provider-contract` git ל-npm | ❌ | slice-npm-publish |
| ‏מעבר ל-Node runtime (‏בלי Bun) | ❌ | slice עתידי (AGENTS "Slice 2+") |
| `DATA_DIR` ‏להחצנת `data/` ‏מ-cwd | ❌ | ‏ראה §9 Q1 |

> ‏זו לא טבלת TODO. ‏זו הגנה מ-scope creep. ה-slice הזה = **‏ה-mechanism**, ‏לא ה-publish.

---

## §3 — Architecture diagram

```
‏המשתמש: bun packages/backend/src/bin/drive-coding.ts
        │
        ▼
┌────────────────────────────────────┐
│ src/bin/drive-coding.ts  ← ‏חדש     │   ‏בתוך src/ → ‏מכוסה ע"י typecheck
│  1. FE_STATIC_DIR ??= <build>      │   ‏יחסית ל-import.meta.dirname:
│  2. PORT ??= 4000                  │   (../../../frontend/build)
│  3. preflight: agent ב-PATH?       │   ‏אזהרה אם חסר, ‏לא חוסם
│  4. ‏הדפס URL                       │
│  5. await import("../server.js")   │
└──────────────┬─────────────────────┘
               │ (side-effect import)
               ▼
┌───────────────────────────────┐
│ src/server.ts  ← ‏קיים, ‏לא נגע │
│  serve({ fetch, port })       │   ‏עולה on-import
│  if (FE_STATIC_DIR):          │
│    serveStatic(build) +       │   ← ‏מוגש single-origin
│    SPA fallback index.html    │
└───────────────────────────────┘
               ▲
               │  ‏מצביע אל
┌───────────────────────────────┐
│ packages/frontend/build/      │ ← ‏קיים (index.html + _app/)
└───────────────────────────────┘

‏root package.json  ← ‏מוסיף script "start" (‏שונה מ-backend start ‏הקיים)
scripts/dc-launch.* ← ‏build FE ‏אם חסר, ‏ואז bin (Commit 1)
```

---

## §4 — Commits ‏בסדר

### Commit 0 — bin entry + bin field (approach: integration)

**‏קבצים חדשים**:
- `packages/backend/src/bin/drive-coding.ts` — **‏בתוך `src/`** ‏(‏ולא ב-`bin/` ‏בשורש ה-package). ‏סיבה (finding #1+#2): `packages/backend/tsconfig.json` ‏מגדיר `rootDir: "./src"` + `include: ["src/**/*"]`. ‏קובץ מחוץ ל-`src/` ‏**‏היה נדלג בשקט ע"י `pnpm typecheck`** (false-positive ל-DoD #1). ‏בתוך `src/bin/` — ‏הוא מכוסה אוטומטית, ‏וגם ה-`await import` ‏מאומת סטטית. **‏אסור לגעת ב-`tsconfig.json`** (rootDir/outDir).

**‏קבצים שמשתנים**:
- `packages/backend/package.json` — ‏מוסיף `"bin": { "drive-coding": "./src/bin/drive-coding.ts" }`. ‏לא משנה scripts קיימים (‏כולל ה-`start` ‏הקיים — finding #4).

**API skeleton** (‏החתימה המדויקת — executor אסור לסטות):

```ts
#!/usr/bin/env bun
// packages/backend/src/bin/drive-coding.ts
import path from "node:path"

// FE build ‏יושב ב-packages/frontend/build.
// ‏הקובץ ב-packages/backend/src/bin → ‏עלה שלוש רמות (bin→src→backend→packages),
// ‏ואז לתוך frontend/build.
const feBuildDir = path.resolve(import.meta.dirname, "../../../frontend/build")

// ‏לא לדרוס ערכים שהמשתמש קבע מפורשות (env > default).
process.env.FE_STATIC_DIR ??= feBuildDir
process.env.PORT ??= "4000"

// ‏ה-import מפעיל את ה-server (side-effect, ‏עולה on-import).
// ‏חייב להגיע **‏אחרי** ‏הגדרת ה-env (server.ts ‏קורא env on-import).
await import("../server.js")
```

> ‏הערה ל-executor: ‏ה-import הוא `../server.js` (‏מ-`src/bin` ‏עולה ל-`src/server.ts`; ‏סיומת `.js` ‏עקבית עם שאר הקוד למרות `moduleResolution: Bundler`). ‏Bun פותר ל-`.ts`.

**Verification** (PowerShell — ‏הרץ את ה-server עם `run_in_background`):

```powershell
pnpm typecheck   # ‏עכשיו בודק גם את src/bin/drive-coding.ts (‏מכוסה ע"י include)
pnpm --filter @drive-coding/frontend-v2 build
# ‏הרם את ה-server ברקע (run_in_background של כלי ה-shell), ‏ואז:
Start-Sleep -Seconds 2
(Invoke-WebRequest http://localhost:4000/ -UseBasicParsing).StatusCode          # ‏מצופה 200
(Invoke-WebRequest http://localhost:4000/ -UseBasicParsing).Content -match '<!doctype html'   # True
(Invoke-WebRequest http://localhost:4000/api/agents -UseBasicParsing).StatusCode # ‏API ‏חי (‏לא ה-index.html)
# ‏עצור את ה-job/process של ה-server (Stop-Job / Stop-Process)
```

> ‏חלופה: `curl.exe` (‏קיים ב-Windows 10+) ‏עם הדגלים מ-bash — `curl.exe -s -o NUL -w "%{http_code}" http://localhost:4000/`.

### Commit 1 — launcher script + root `start` (approach: manual)

**‏קבצים חדשים**:
- `scripts/dc-launch.mjs` — ‏Node/Bun script: ‏בדוק אם `packages/frontend/build/index.html` ‏קיים; ‏אם לא → ‏הרץ `pnpm --filter @drive-coding/frontend-v2 build`; ‏ואז spawn ‏את ה-bin.

**‏קבצים שמשתנים**:
- `package.json` (root) — ‏מוסיף `"start": "node scripts/dc-launch.mjs"`. ‏לא נוגע ב-`dev`/`build`/`test`. **‏שונה מ-backend `start`** ‏הקיים (finding #4): ‏זה מרים BE+FE, ‏ההוא BE-only.

**Verification** (PowerShell — ‏הרץ את `pnpm start` ‏עם `run_in_background`):

```powershell
pnpm typecheck
# ‏מחק build ‏וודא שהוא נבנה אוטומטית:
Remove-Item -Recurse -Force packages/frontend/build
# ‏הרם את pnpm start ברקע (run_in_background), ‏ואז:
Start-Sleep -Seconds 30                     # build + boot
(Invoke-WebRequest http://localhost:4000/ -UseBasicParsing).StatusCode   # 200
# ‏עצור את ה-job/process
```

### Commit 2 — preflight UX: URL + agent check (approach: manual)

**‏קבצים שמשתנים**:
- `packages/backend/src/bin/drive-coding.ts` — ‏מוסיף **‏לפני** ‏ה-`await import`:
  1. ‏בדיקת זמינות agent (‏ברירת-מחדל `opencode`) ב-PATH דרך `node:child_process` (`which`/`where`) ‏או `OPENCODE_BIN`. ‏אם חסר — `console.warn` ‏הודעת הכוונה (‏לא לזרוק, ‏לא לחסום — ‏המשתמש אולי משתמש ב-claude/codex ‏שמורדים דרך npx).
  2. ‏`console.log` ‏עם ה-URL: `http://localhost:${PORT}`.

> ‏אסור להכניס מחרוזות עברית קשיחות לקוד (‏ראה §6). ‏הודעות preflight ‏באנגלית, ‏או דרך מנגנון i18n קיים אם ‏ה-BE ‏כבר ‏מחזיק ‏אחד ל-stdout (‏בדוק — ‏אם אין, ‏אנגלית פשוטה מותרת ב-CLI bootstrap).

**Verification** (PowerShell):

```powershell
# agent ‏קיים:
bun packages/backend/src/bin/drive-coding.ts   # ‏מדפיס URL, ‏בלי warning
# agent ‏חסר (‏סימולציה): ‏הגדר OPENCODE_BIN ‏לנתיב שלא קיים
$env:OPENCODE_BIN = "C:\nonexistent\opencode.exe"
bun packages/backend/src/bin/drive-coding.ts   # ‏מדפיס warning, ‏עדיין עולה
Remove-Item Env:\OPENCODE_BIN
```

---

## §5 — DoD verifiable

‏(‏פקודות ב-PowerShell; ‏הרצת server ברקע = `run_in_background`)

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + tests ‏עוברים | `pnpm typecheck; pnpm test` — ‏typecheck ‏**‏מכסה** ‏את `src/bin/drive-coding.ts` (‏בתוך include) |
| 2 | lint + lint:i18n | `pnpm lint; pnpm lint:i18n` (‏אין מחרוזות עברית בקוד) |
| 3 | ‏פקודה אחת מרימה BE+FE | `bun packages/backend/src/bin/drive-coding.ts` → `(iwr http://localhost:4000/ -UseBasicParsing).StatusCode` = 200 + ‏Content ‏הוא HTML של ה-FE |
| 4 | regression: ‏API ‏לא מוצל ע"י ה-SPA fallback | `(iwr http://localhost:4000/api/agents -UseBasicParsing)` ‏מחזיר תגובת API (‏לא ה-index.html) |
| 5 | regression: WS ‏עדיין עולה | ‏חיבור ל-`ws://localhost:4000/ws/echo` ‏מצליח (‏טסט WS ‏קיים, ‏או client קצר) |
| 6 | ‏הרצה מ-cwd ‏אחר מוצאת את ה-FE | ‏מ-`C:\Temp`: `bun <abs-path>\packages\backend\src\bin\drive-coding.ts` → StatusCode 200 (‏ה-path מוחלט) |
| 7 | Windows: ‏ה-paths עובדים | ‏על Windows: ‏הרץ את ה-bin, ‏וודא serving (‏`import.meta.dirname`+`path.resolve` cross-platform) |
| 8 | agent ‏חסר → ‏אזהרה, ‏לא קריסה | `$env:OPENCODE_BIN="C:\nonexistent.exe"; bun ...\drive-coding.ts` ‏מדפיס warning ‏ועולה |

‏לא "‏הכל עובד" — ‏טבלת checkboxes ‏עם פקודה לכל אחד.

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| `data/cache`+`data/recordings` ‏נוצרים יחסית ל-**cwd** (`path.resolve("data/...")` ‏ב-server.ts) | ‏server.ts:56-57 | ‏מחוץ ל-scope (§9 Q1). ‏לתעד ב-walkthrough. ‏אם executor רואה כשל ‏בגלל זה — escalate, ‏לא לאלתר `DATA_DIR`. |
| ‏FE build חסר/stale ב-worktree (gitignored) | memory: worktree-test-setup | Commit 1 ‏בונה אוטומטית; ‏ב-worktree ‏ראשוני הרץ build ‏ידני או junction (‏ראה §0). |
| ‏Hardcoded Hebrew strings ‏בהודעות preflight | dev-conventions | pre-commit hook חוסם; ‏הודעות CLI ‏באנגלית. ‏וודא `pnpm hooks:install`. |
| Windows path/shebang — `#!/usr/bin/env bun` ‏ב-Windows | memory: e2e-on-windows-blockers | `bun <file>` ‏ישיר עוקף shebang; ‏`bunx` ‏יוצר shim. ‏אמת DoD #7 ‏על Windows אמיתי. |
| ‏ה-import ‏לפני ‏הגדרת env → ה-server קורא env ‏ריק | ‏server.ts ‏עולה on-import | ‏סדר קשיח ב-Commit 0: env **‏ואז** `await import`. ‏אסור static import ל-server. |
| ‏פורט 4000 ‏תפוס | — | ‏ברירת-מחדל ‏עם `??=`; ‏המשתמש יכול `PORT=4001`. ‏לתעד ב-help. |

> 3 ‏שתמיד נשכחים: 1. Hebrew→i18n ✓ (‏לעיל). 2. Reactivity — ‏לא רלוונטי (‏אין FE code). 3. OneCLI placeholder — ‏לא רלוונטי (‏לא נוגעים ב-bridge spawn).

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את Tama:

- ‏ה-server **‏לא** ‏עולה on-import ‏כפי שה-brief מניח (‏יש `startServer()` ‏או guard שלא ‏זוהה) — ‏עצור, ‏ה-API skeleton ‏של Commit 0 ‏לא תקף.
- ‏ה-`data/` cwd-relative ‏issue חוסם הרצה מ-cwd ‏אחר (DoD #6) — ‏escalate, ‏אל תוסיף `DATA_DIR` ‏לבד (‏מחוץ ל-scope).
- ‏ה-FE build serving ‏מצל על route של `/api` ‏או `/proxy` ‏או `/ws` — ‏עצור (‏סדר הרישום ב-server.ts ‏אמור למנוע, ‏אם לא — ‏בעיה ארכיטקטונית).
- ‏אתה רוצה לסטות מ-bunx ‏לכיוון bundling/node — ‏זו החלטה ארכיטקטונית, ‏עצור.
- ‏Brief סותר את עצמו / ‏צריך לשנות את `server.ts`.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏Streaming/real-time (‏רק regression-check ‏על WS ‏קיים, ‏לא בונים) | +0 |
| Refactor של קוד קיים (server.ts ‏לא משתנה) | +0 |
| >5 files ‏ב->2 packages (‏~3 קבצים, ‏backend+root) | +0 |
| ‏ספרייה חיצונית חדשה | +0 |
| Greenfield, ‏אין call sites קיימים ל-bin | -1 |
| ‏entry חדש שמרים server (runtime risk, IO) | +2 |
| Cross-platform (Windows) paths | +1 |
| Deploy ‏לפרודקשן מיד | +0 (‏local run) |

**Score**: 2/10 (‏מעוגל כלפי מעלה ל-3 ‏בשל runtime serving + Windows)

**Tier**: 0-3 → `calev` (light) ‏בלבד.

**‏Verifier-phase ‏אחרי commit**: ‏אין (‏light בלבד). ‏כלב מאמת DoD ‏בסוף.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | `data/` ‏נוצר יחסית ל-cwd — ‏להחצין ל-`DATA_DIR`? | ‏לא ב-slice הזה. ‏מתועד כ-known issue ל-slice-npm-publish. | ❌ |
| 2 | ‏שם ה-bin — `drive-coding`? (‏מתנגש עם שם ה-root package) | `drive-coding`. ‏ה-package המתפרסם ‏יוגדר ב-slice ההמשך. | ❌ |
| 3 | preflight — ‏לבדוק רק `opencode` ‏או את כל ה-CLI_KINDS? | ‏רק ‏ברירת-המחדל (opencode); claude/codex ‏מורדים דרך npx ‏ולא צריכים PATH. | ❌ |
| 4 | ‏האם `start` ‏צריך לבנות גם את ה-BE? | ‏לא — Bun ‏מריץ TS ‏ישירות, ‏אין build step ל-BE. ‏רק FE. | ❌ |

> ‏אין שאלה חוסמת. ‏ברירות-המחדל מספיקות ל-dispatch.

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- (‏אין עדיין)

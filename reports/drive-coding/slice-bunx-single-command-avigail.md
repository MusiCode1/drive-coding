---
project: "drive-coding"
slice: "slice-bunx-single-command"
verifier: "avigail"
date: "2026-06-16"
verdict: "USABLE-AFTER-FIX"
findings:
  - id: 1
    severity: "confusion"
    category: "type-error"
    summary: "bin/drive-coding.ts sits outside tsconfig include (rootDir src, include src/**) — pnpm typecheck silently skips it, false-positive DoD #1"
    source_brief: "§4 Commit 0 Verification / §5 DoD #1"
    source_code: "packages/backend/tsconfig.json:6-9"
    cost_estimate: "15-30min"
  - id: 2
    severity: "confusion"
    category: "type-error"
    summary: "await import(../src/server.js) in an un-included file is never type-checked by tsc; resolution correctness rests only on Bun runtime"
    source_brief: "§4 Commit 0 line 150-153"
    source_code: "packages/backend/tsconfig.json:9"
    cost_estimate: "5-10min"
  - id: 3
    severity: "confusion"
    category: "unique"
    summary: "All §4/§5 verification commands are bash-only (curl, sleep, rm -rf, kill %1, &, /dev/null, PATH=) but dev tip + DoD #7 are Windows/PowerShell — executor cannot run them verbatim"
    source_brief: "§4 all Verification blocks / §5 DoD"
    source_code: "env: win32 PowerShell"
    cost_estimate: "10-20min"
  - id: 4
    severity: "minor"
    category: "outdated-risk"
    summary: "backend package.json already has a start script (bun src/server.ts); brief implies only root lacks start — true but worth noting to avoid executor confusion"
    source_brief: "§0 Reading list / §4 Commit 1"
    source_code: "packages/backend/package.json:9"
    cost_estimate: "2min"
---

# Plan Verification — slice-bunx-single-command

> **Brief**: docs/plans/slice-bunx-single-command.md
> **Base tip**: 161bd94 (dev)
> **Verdict**: 🟡 USABLE-AFTER-FIX
> **אומדן זמן executor confusion אם לא תוקן**: 30-50 דק'

הערה: כל ההנחות הארכיטקטוניות הקריטיות של ה-brief אומתו ונכונות. אין blocker ואין regression. הבעיות הן פערי-אימות (verification gaps) — ה-brief מציג פקודות אימות שייתנו false-positive או לא ירוצו על סביבת ה-dev.

## בעיות שנמצאו

### 🔴 Blocker / Regression risk

אין. כל ה-symbols וההנחות אומתו.

### 🟡 Confusion / Type error / Outdated

| # | בעיה | מקור | הצעה |
|---|------|------|------|
| 1 | **typecheck blind-spot.** `packages/backend/tsconfig.json` מכיל `"rootDir": "./src"` + `"include": ["src/**/*"]`. הקובץ החדש `packages/backend/bin/drive-coding.ts` יושב **מחוץ** ל-`src/`, ולכן `pnpm typecheck` (DoD #1 + Commit 0 Verification — שער ה-gate המרכזי) **פשוט ידלג עליו**. type-error בקובץ ה-bin יעבור בשקט. זה false-positive: ה-brief מציג typecheck כמאמת את Commit 0, אבל הוא לא מאמת את הקובץ הנבנה. | brief §4 Commit 0 + §5 DoD #1 / `packages/backend/tsconfig.json:6-9` | מרדכי: או להוסיף `bin/**/*` ל-`include` (וייתכן להרחיב `rootDir`), או להחליף את שלב הtypecheck ל-`bun build`/`tsc --noEmit bin/drive-coding.ts` ישיר. צריך החלטה לפני dispatch. |
| 2 | **import לא-מאומת.** ה-`await import("../src/server.js")` בקובץ שלא ב-include — tsc לעולם לא יאמת את הנתיב/הטיפוסים. ההערה ב-brief ("Bun פותר ל-.ts") נכונה ב-runtime, אבל אין רשת-ביטחון סטטית. נובע מ-#1. | brief §4 Commit 0 שורות 150-153 / `packages/backend/tsconfig.json:9` | לתעד שהאימות היחיד הוא runtime (curl), לא typecheck. נובע מתיקון #1. |
| 3 | **פקודות אימות bash-only על dev Windows.** כל בלוקי ה-Verification ב-§4 ו-§5 משתמשים ב-`curl`, `sleep 2`, `rm -rf`, `kill %1`, `&` (background), `/dev/null`, `PATH=""`, `OPENCODE_BIN=... bun ...` — כולם bash-isms. ה-dev tip הוא Windows (win32/PowerShell), ו-DoD #7 **מפורשות דורש אימות על Windows**. ה-executor לא יוכל להריץ אותם verbatim ב-PowerShell. | brief §4 (כל בלוק Verification) + §5 DoD / env: win32 | מרדכי: לציין מקבילות PowerShell (`Invoke-WebRequest`/`curl.exe`, `Start-Sleep`, `Remove-Item`, `Start-Job`/`Start-Process`, `$null`, `$env:VAR=...`), או לציין מפורשות "הרץ דרך Bash tool / WSL". |

### 🟢 Minor

| # | בעיה | מקור |
|---|------|------|
| 4 | `packages/backend/package.json` כבר מכיל `"start": "bun src/server.ts"` (שורה 9). ה-brief מתייחס רק ל-root `start` (שבאמת חסר — אומת), אבל כדאי לציין שה-backend-level start קיים כדי שה-executor לא יתבלבל בין השניים. אין קונפליקט. | brief §0/§4 Commit 1 / `packages/backend/package.json:9` |

## Spot-check שעבר (לא מצא בעיה)

- ✅ **ההנחה הקריטית #1 — self-starting on-import**: `server.ts:113` קורא `serve({ fetch, port })` ב-top-level, אין `startServer()`/guard, אין export. ה-API skeleton של Commit 0 **תקף**. (זו ההנחה שהיתה שוברת הכל אם שגויה — נכונה.)
- ✅ **env on-import**: `server.ts` קורא `FE_STATIC_DIR` (שורה 81), `PORT` (111), `CORS_ORIGINS` (51) ב-top-level → חובת הסדר "env ואז import" שב-brief נכונה.
- ✅ **FE_STATIC_DIR block**: `server.ts:81-89` (brief טען ~78-89; הקומנט מתחיל ב-78, הקוד ב-81 — מדויק מספיק).
- ✅ **סדר routes**: `/api`+`/proxy` נרשמים `server.ts:66-76`, ה-serveStatic + SPA fallback ב-86-87 (אחריהם), WS upgrade ב-115+. ה-fallback לא מצל את ה-API. DoD #4 ניתן לאימות.
- ✅ **data/cache + data/recordings cwd-relative**: `server.ts:56-57` (`path.resolve("data/cache")`, `path.resolve("data/recordings")`) — בדיוק כפי שטוען §6/§9 Q1.
- ✅ **frontend build קיים**: `packages/frontend/build/index.html` + `_app/` קיימים.
- ✅ **svelte adapter-static + fallback**: `svelte.config.js:8-13` — `adapter-static`, `fallback: "index.html"`.
- ✅ **frontend filter name**: `@drive-coding/frontend-v2` — אומת ב-`packages/frontend/package.json:2`.
- ✅ **plugin file:// rationale**: `packages/backend/plugins/prompt-injector.ts` קיים; `plugins/README.md` מאשר טעינה דרך `file://` ב-Bun → מצדיק bunx (לא bundling).
- ✅ **CLI_SPECS**: `packages/core/src/schemas/agent.ts:30-43` — opencode bin `"opencode"` (צריך PATH), claude/codex דרך `npx` → מצדיק preflight רק על opencode (§9 Q3).
- ✅ **tsconfig flags**: `tsconfig.base.json` — `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true`, `noUncheckedIndexedAccess: true`. ה-imports עם `.js` עקביים.
- ✅ **import.meta.dirname precedent**: בשימוש כבר ב-`plugin-config.ts:24-27` תחת Bun → השימוש המתוכנן ב-bin תקין.
- ✅ **נתיב יחסי Commit 0**: bin ב-`packages/backend/bin/` → `../../frontend/build` ל-FE (backend→packages→frontend/build ✓) ו-`../src/server.js` ל-server (bin→backend/src ✓). שניהם נכונים.
- ✅ **root start חסר**: `package.json` (root) — אין `start` (grep ריק). Commit 1 שמוסיף אותו לא מתנגש.
- ✅ **depends_on=[]**: ה-slice משתמש רק ברכיבים קיימים ב-dev (server.ts, frontend/build, plugins, CLI_SPECS) — כולם נוכחים ב-tip 161bd94. `depends_on=[]` **נכון**.
- ✅ **אין סתירות פנימיות**: שמות symbols (`FE_STATIC_DIR`, `drive-coding`, `@drive-coding/frontend-v2`) עקביים בכל ה-brief.

## Verdict

🟡 **USABLE-AFTER-FIX** — אין blocker ואין regression; כל ההנחות הארכיטקטוניות הקריטיות נכונות (במיוחד self-starting-on-import — אומתה). אבל שני פערי-אימות אמיתיים: (1) `pnpm typecheck` נותן false-positive על קובץ ה-bin כי הוא מחוץ ל-tsconfig include, ו-(3) פקודות האימות bash-only בעוד ה-dev הוא Windows + DoD #7 דורש Windows. ~30 דק' תיקון של מרדכי (לקבוע איך לאמת את ה-bin ב-typecheck, ולספק מקבילות PowerShell / להפנות ל-Bash tool) יהפכו את ה-brief ל-READY.

# Slice — release package (bundled, bunx-compatible) — ‏תוכנית

> **‏תאריך**: 2026-06-17
> **‏סטטוס**: **הושלם** (3 commits; calev light ← ממתין לאחר commit זה)
> **Complexity**: 5/10 (verifier: light + phase על Commit 1)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי על dev (‏ה-bin מ-slice-bunx-single-command ‏כבר merged)
> **‏Base**: `dev` @ `870ea02`
> **‏Dev tip**: `870ea02`

---

## §0 — Pre-flight

### ‏רקע — ‏למה package נפרד (‏ולמה זורקים את slice-npm-publish)

‏slice-npm-publish ‏ניסה לארוז את **‏backend עצמו** ל-npm עם `bundledDependencies`. ‏זה ‏(א) ‏נשבר עם bun (`bun add`/`bunx` ‏מתעלמים מ-bundledDependencies, ‏מנסים לפתור מחדש `@drive-coding/core@workspace:*` ‏ו-`provider-contract@git+...` ‏פרטי → ‏כשל); ‏(ב) ‏דרש לגעת ב-`package.json` ‏של backend ‏(הסרת deps), ‏מה שהמשתמשת ‏לא רוצה — ‏ה-monorepo ‏הנוכחי **‏זמני** ‏(core/provider-contract ‏יהפכו ל-public ‏בעתיד).

‏**‏ההכרעה**: ‏ליצור **package נפרד וייעודי** (`packages/release/`) ‏שכל תפקידו להיות ה-artifact ‏שעולה ל-npm. ‏הוא **‏צורך** ‏את backend/core/provider-contract ‏**‏בזמן build בלבד** (`bun build` ‏מטמיע אותם), ‏ולא מצהיר עליהם כ-runtime deps. ‏ה-packages ‏הקיימים **‏לא נגעים** (‏פרט לנגיעה אחת קטנה ב-bin — ‏ראה §2). ‏Additive, ‏הפיך (‏מחק תיקייה), ‏בלי decision-reversal על backend.

‏**‏slice-npm-publish ‏נזרק** (`git worktree remove` + `branch -D` ‏ע"י מרדכי, ‏לא merged) — ‏מוחלף ע"י slice זה.

### ‏ראיות-spike (‏בוצעו לפני כתיבת ה-brief — empirical)

1. `bun build packages/backend/src/bin/drive-coding.ts --target=bun --external pino --external pino-pretty` → **282 modules, 1.21MB**, ‏shebang נשמר, `await import("../server.js")` ‏נעקב (server אינליין), core+provider-contract ‏אינליין.
2. **‏build מ-cwd חיצוני ל-workspace** (‏מדמה release package) → ‏עובד: ‏module resolution ‏עוקב אחרי ה-**entry file**, ‏לא ה-cwd. core+provider-contract ‏אינליין גם משם.
3. **‏סימולציית release package מלאה**: ‏layout = `dist/drive-coding.js` + `frontend-dist/` + `plugins/` + `package.json` ‏עם deps={pino,pino-pretty}; `bun install` (‏2 packages); ‏הרצה עם `env -u FE_STATIC_DIR`: `feStaticDir → release/frontend-dist`, `GET /` = 200, ‏asset FE = 200, `/api/agents` = 200, ‏plugin path → `release/plugins/prompt-injector.ts` ✓. **‏עבד מקצה לקצה.**
4. **‏גילוי קריטי**: ‏ה-cascade ‏הנוכחי ב-bin (`../../frontend-dist`, ‏שתי רמות) ‏**‏לא מתאים** ‏ל-layout של ה-release (`dist/` → frontend-dist ‏רמה אחת). ‏אומת ש-cascade דו-מועמדי `["../frontend-dist", "../../../frontend/build"]` ‏עובד ל**‏שני** ‏ה-layouts (release-bundle ‏ו-dev-src). ‏זו הנגיעה ב-bin (§2).
5. **‏גילוי**: ‏`FE_STATIC_DIR=` ‏ריק **‏אינו** ‏מפעיל את ה-cascade (`??=` ‏לא דורס מחרוזת ריקה — ‏רק unset). ‏ב-verify ‏השתמש ב-`env -u FE_STATIC_DIR`, ‏לא ב-`FE_STATIC_DIR=`.

### Worktree

```bash
cd /home/user/projects/drive-coding/dev
git worktree add /home/user/projects/drive-coding/.worktrees/slice-release-package \
  -b slice-release-package dev
cd .worktrees/slice-release-package
pnpm install && pnpm hooks:install
```

### ‏סביבה

‏**Linux / zsh**. ‏server ברקע = `run_in_background`. ‏פורטים **4000/4001 תפוסים** (staging) → `PORT=4003+`, ‏בדוק `ss -tln`. `bun` ‏ב-`~/.bun/bin`. ‏קבצים זמניים ב-`/tmp`. ‏לוג ב-dev ‏מייצא `FE_STATIC_DIR` ‏שמצביע ל-`main` — ‏ב-verify ‏השתמש ב-`env -u FE_STATIC_DIR`.

### ‏איך להריץ

- **‏בנייה**: `cd packages/release && bun run build` (‏או `npm pack` ‏שמריץ prepack) → `dist/drive-coding.js` + ‏assets.
- **‏אימות bunx**: ‏ראה Commit 2.
- **Typecheck/Tests/Lint**: ‏כרגיל מהשורש.

### Reading list

**must-read**:
- `packages/backend/src/bin/drive-coding.ts` — ‏ה-entry שמבונדל; ‏ה-cascade ל-FE (‏ישונה ל-2-candidate).
- `packages/backend/src/server.ts` — ‏עולה on-import; ‏קורא `FE_STATIC_DIR`/`PORT` env.
- `packages/backend/plugins/README.md` — ‏plugin נטען `file://` ‏ע"י תהליך opencode הנפרד (‏לא import סטטי → ‏לא מבונדל; ‏נשלח כקובץ).
- `packages/backend/src/plugin-config.ts:27` — `path.resolve(import.meta.dirname, "../plugins/prompt-injector.ts")` — ‏מ-`dist/` ‏זה נפתר ל-`<pkg>/plugins` (‏אומת בספייק 3).
- `packages/core/src/log/index.ts:37` — `target: "pino-pretty"` (worker → ‏חייב external).
- `pnpm-workspace.yaml` (‏root) — ‏ה-workspace glob (finding avigail #4: ‏ב-`pnpm-workspace.yaml`, **‏לא** ‏ב-root package.json). ‏**‏אומת**: ‏הוא `packages/*` → ‏מכסה את `packages/release` ‏אוטומטית, ‏אין צורך להוסיף ידנית. ‏(‏גרסאות pino ב-core ‏אומתו: `^10.3.1`/`^13.1.3` — ‏תואם ה-brief.)

---

## §1 — ‏מטרה

‏package חדש `packages/release/` (‏name: `drive-coding`) ‏שה-`npm pack`/`bun pm pack` ‏שלו מייצר tarball עם **‏קובץ JS מבונדל יחיד** (core+provider-contract+כל ה-pure-JS deps ‏אינליין), `plugins/`, `frontend-dist/`, ‏ו-`dependencies` = ‏**‏רק `pino`+`pino-pretty`**. ‏התקנה דרך **`bunx`** (`bun add <tgz>` + `bunx drive-coding`) ‏מרימה את האפליקציה על :4000 ‏ומגישה FE — ‏על bun, ‏בלי הריפו/workspace/git. ‏ה-packages הקיימים ‏(backend/core/provider-contract) ‏**‏נשארים כמות-שהם**.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏package חדש `packages/release/` (package.json: name drive-coding, bin, deps=pino+pino-pretty) | ✅ | ‏בslice הזה |
| ‏build script (`packages/release/scripts/build.mjs`): FE build + ‏copy frontend-dist/plugins + `bun build` ‏את ה-bin | ✅ | ‏בslice הזה |
| `prepack` ‏ב-release/package.json ‏שמריץ את ה-build | ✅ | ‏בslice הזה |
| ‏**‏נגיעה יחידה ב-backend**: ‏cascade ל-FE ב-`src/bin/drive-coding.ts` → 2-candidate (`../frontend-dist`, `../../../frontend/build`) | ✅ | ‏בslice הזה |
| ‏אימות bunx end-to-end (boot+serve+WS) | ✅ | ‏בslice הזה |
| `npm publish` ‏בפועל | ❌ | ‏צעד אנושי אחרון |
| ‏שינוי deps/bundledDeps ‏ב-backend/core | ❌ | ‏לא נוגעים (‏זו כל הנקודה) |
| ‏מעבר ל-Node target | ❌ | slice עתידי |

> ‏**‏הבהרה לגבי הנגיעה ב-backend**: ‏זו אינה מחיקת תלויות — ‏זה שיפור path-resolution **‏כללי ובטוח** ‏שעובד גם לדev, ‏גם ל-backend packaging ‏עתידי, ‏וגם ל-release. ‏אם המשתמשת מעדיפה אפס-נגיעה ב-backend → ‏ראה §9 Q2 (release-own bin shim).

---

## §3 — Architecture diagram

```
packages/release/                      ← package חדש, name: drive-coding
  package.json   (bin→dist/drive-coding.js, deps={pino,pino-pretty})
  scripts/build.mjs:
    1. pnpm --filter @drive-coding/frontend-v2 build  → packages/frontend/build
    2. cpSync frontend/build      → packages/release/frontend-dist/
    3. cpSync backend/plugins     → packages/release/plugins/
    4. rmSync packages/release/dist; bun build \
         ../backend/src/bin/drive-coding.ts \
         --target=bun --external pino --external pino-pretty --sourcemap=linked \
         --outfile dist/drive-coding.js          ← core+provider-contract אינליין
  dist/drive-coding.js   (~1.2MB, shebang נשמר)
  frontend-dist/**   plugins/**

  npm pack (prepack=build):
  ┌─────────────────────────────────────────────┐
  │ drive-coding-0.1.0.tgz                        │
  │  package.json · dist/ · frontend-dist/ · plugins/ │
  │  (אין node_modules · אין workspace · אין git) │
  └─────────────────────────────────────────────┘
   + deps מ-registry בזמן install: pino, pino-pretty (ציבוריים)
        │  bun add <tgz>  →  bunx drive-coding
        ▼
  dist/drive-coding.js: import.meta.dirname = <pkg>/dist
    FE cascade → ../frontend-dist = <pkg>/frontend-dist ✓
    plugin     → ../plugins       = <pkg>/plugins ✓
    serve :4000 + FE

backend / core / provider-contract  ← לא נגעים, נשארים workspace/git/private
```

---

## §4 — Commits ‏בסדר

### Commit 0 — ‏scaffold ה-release package (approach: integration)

**‏קבצים חדשים**:
- `packages/release/package.json`:
  ```json
  {
    "name": "drive-coding",
    "version": "0.1.0",
    "description": "AI-powered coding assistant — single-command server + CLI",
    "license": "MIT",
    "type": "module",
    "bin": { "drive-coding": "./dist/drive-coding.js" },
    "files": ["dist", "plugins", "frontend-dist"],
    "scripts": {
      "bundle": "node scripts/build.mjs",
      "prepack": "node scripts/build.mjs"
    },
    "dependencies": { "pino": "^10.3.1", "pino-pretty": "^13.1.3" }
  }
  ```
  > ‏**‏לא** `private`. ‏**‏אין** workspace/git deps.
  > **(finding avigail #2) ‏השם `bundle`, ‏לא `build`**: ‏root `pnpm build` = `pnpm -r run build` ‏(`package.json` root). ‏לו ה-script נקרא `build`, ‏כל `pnpm build` ‏ברפו ‏היה מפעיל FE-build + bun-build כבד ‏בלי כוונה. ‏`bundle` ‏מתפעל **‏רק** ‏ידנית ‏או דרך `prepack` (‏אוטומטי לפני `npm pack`). ‏אמת ש-`pnpm -r run build` ‏**‏לא** ‏נכנס ל-release (DoD #1).
  > **‏גרסאות pino (‏אמת! finding avigail-r1 ‏פוטנציאלי)**: ‏העתק את הטווחים המדויקים מ-`packages/core/package.json` (`dependencies.pino`, `dependencies["pino-pretty"]`). ‏`^10.3.1`/`^13.1.3` ‏הם מה-spike — ‏אם core ‏מצהיר אחרת, ‏ה-core ‏הוא מקור-האמת.
- `packages/release/.gitignore` (‏או root) — `dist/`, `frontend-dist/`, `plugins/` ‏(build artifacts ‏מועתקים; ‏לא ב-git).

> ‏ה-package ייכלל ב-pnpm workspace (`packages/*`). ‏`pnpm install` ‏יתקין pino/pino-pretty. ‏אמת ש-`pnpm typecheck`/`pnpm test` ‏עדיין ירוקים (‏ה-package ‏ריק מ-TS).

**Verification**: `pnpm install` ‏מצליח; `pnpm -r typecheck` ‏ירוק; ‏אין שינוי ב-backend/core package.json (`git diff --stat` ‏מראה רק packages/release/* + ‏ה-bin).

### Commit 1 — build script + ‏cascade ב-bin (approach: integration; verifier-phase ‏אחרי)

**‏קבצים חדשים**:
- `packages/release/scripts/build.mjs` — ‏Node script, ‏cross-platform (`node:fs` cpSync/rmSync, `node:child_process` execFileSync):
  1. `execFileSync("pnpm", ["--filter","@drive-coding/frontend-v2","build"], {cwd: repoRoot, stdio:"inherit"})`.
  2. `rmSync(release/frontend-dist, {recursive,force})`; `cpSync(frontend/build → release/frontend-dist, {recursive})`.
  3. `rmSync(release/plugins, {recursive,force})`; `cpSync(backend/plugins → release/plugins, {recursive})`.
  4. `rmSync(release/dist, {recursive,force})`; `execFileSync("bun", ["build", <backend>/src/bin/drive-coding.ts, "--target=bun", "--external","pino", "--external","pino-pretty", "--sourcemap=linked", "--outfile", release/dist/drive-coding.js], {stdio:"inherit"})`.
  - ‏נתיבים יחסית ל-`import.meta.url` ‏של ה-script (‏`packages/release/scripts` → repoRoot=‏שלוש רמות מעלה).

**‏קבצים שמשתנים (‏הנגיעה היחידה ב-backend)**:
- `packages/backend/src/bin/drive-coding.ts` — ‏**‏מצב נוכחי ב-dev (finding avigail #1)**: ‏ה-bin ‏הוא ה-single-line ‏המקורי של slice-bunx — ‏שורה 9: `const feBuildDir = path.resolve(import.meta.dirname, "../../../frontend/build")` (‏layout dev בלבד). ‏ה-imports: `execFileSync` ‏מ-`node:child_process`, `path` ‏מ-`node:path` — **‏אין `existsSync`**. (‏ה-dual-layout `packagedFe`/`devFe` ‏היה תוספת של slice-npm-publish ‏שנזרק — ‏לא קיים ב-dev.)
  - **(א)** ‏הוסף import: `import { existsSync } from "node:fs"` (finding avigail #3).
  - **(ב)** ‏החלף את שורת ה-`feBuildDir` ‏היחידה ב-cascade דו-מועמדי:
    ```ts
    const feBuildDir =
      [
        path.resolve(import.meta.dirname, "../frontend-dist"),        // bundled: <pkg>/dist → <pkg>/frontend-dist
        path.resolve(import.meta.dirname, "../../../frontend/build"), // dev: src/bin → packages/frontend/build
      ].find(existsSync) ?? path.resolve(import.meta.dirname, "../../../frontend/build")
    ```
  - ‏עדכן את הערת-ה-layout מעל (‏שורות 6-8). ‏שאר ה-bin ‏(preflight, ‏URL, `await import("../server.js")`) ‏לא משתנה. ‏(‏לוגיקת ה-cascade אומתה בספייק 3-4 ‏ל-release-bundle ‏ול-dev; ‏ה-fallback ‏שונה ל-`../../../frontend/build` ‏כי זה ה-dev path ‏הנכון כשאף מועמד לא קיים.)

**Verification** (verifier-phase):
```bash
cd packages/release && npm pack 2>&1 | tail
head -1 dist/drive-coding.js                       # #!/usr/bin/env bun
tar -tzf drive-coding-0.1.0.tgz | grep -E 'dist/drive-coding.js|frontend-dist/index.html|plugins/'
tar -tzf drive-coding-0.1.0.tgz | grep -E 'node_modules|\.pnpm|provider-abstraction' && echo LEAK || echo "no leak ✓"
# dev path עדיין עובד (backend bin):
env -u FE_STATIC_DIR PORT=4003 bun ../backend/src/bin/drive-coding.ts &  # run_in_background
sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:4003/  # 200
```

### Commit 2 — end-to-end: ‏`bunx` ‏נקי (approach: manual)

**‏קובץ חדש**: `packages/release/scripts/verify-pack.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."             # packages/release
npm pack
TGZ="$(pwd)/drive-coding-0.1.0.tgz"
tar -tzf "$TGZ" | grep -q 'package/dist/drive-coding.js'     || { echo FAIL:bundle; exit 1; }
tar -tzf "$TGZ" | grep -q 'package/frontend-dist/index.html' || { echo FAIL:fe;     exit 1; }
tar -tzf "$TGZ" | grep -q 'package/plugins/'                 || { echo FAIL:plugins;exit 1; }
tar -tzf "$TGZ" | grep -qE 'node_modules|\.pnpm|provider-abstraction' && { echo FAIL:leak; exit 1; } || true
TMP="$(mktemp -d)"; cd "$TMP"; bun init -y >/dev/null
bun add "$TGZ"                                      # exit 0 — אין workspace/git
test -e node_modules/.bin/drive-coding || { echo FAIL:bin; exit 1; }
env -u FE_STATIC_DIR PORT=4003 bunx drive-coding &  # run_in_background בפועל
sleep 3
curl -fsS -o /dev/null -w "GET / %{http_code}\n" http://localhost:4003/      # 200
curl -fsS http://localhost:4003/api/agents; echo                             # {"agents":...}
```
> ‏**‏שים לב (spike #5)**: ‏`env -u FE_STATIC_DIR` ‏(unset), ‏**‏לא** `FE_STATIC_DIR=` ‏(ריק) — ‏ה-`??=` ‏לא דורס מחרוזת ריקה.

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + tests ‏כמו dev (‏אין regression) | `pnpm typecheck; pnpm test` |
| 2 | lint:i18n ‏עובר | `pnpm lint:i18n` |
| 3 | backend/core ‏package.json ‏לא נגעו | `git diff dev -- packages/backend/package.json packages/core/package.json` → ‏ריק |
| 4 | release package ‏בונה bundle | `cd packages/release && npm pack` → `dist/drive-coding.js` ‏קיים, ‏שורה ראשונה shebang |
| 5 | tarball self-contained, ‏ללא leak | `tar -tzf *.tgz`: ‏יש dist/frontend-dist/plugins; ‏אין node_modules/.pnpm/git |
| 6 | **`bun add <tgz>` ‏מצליח** | exit 0, `node_modules/.bin/drive-coding` ‏קיים |
| 7 | **`bunx drive-coding` ‏עולה ומגיש** | `env -u FE_STATIC_DIR PORT=4003 bunx drive-coding`: `GET /` = 200 + HTML, ‏asset FE = 200, `/api/agents` = 200, ‏WS echo → hello |
| 8 | dev path ‏לא נשבר (‏cascade) | `env -u FE_STATIC_DIR bun packages/backend/src/bin/drive-coding.ts` ‏מגיש FE ‏מ-`packages/frontend/build` |
| 9 | plugin path ‏תקין בבאנדל | ‏בדיקה ש-`buildOpencodeConfigContent` ‏מפיק `file://<pkg>/plugins/prompt-injector.ts` ‏(‏מ-`dist/`) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| ‏`bun build` ‏מ-release ‏לא פותר workspace deps | resolution | ‏**‏נסגר** — ‏ספייק 2 ‏הריץ build מ-cwd חיצוני, ‏core+provider-contract ‏אינליין (resolution ‏לפי entry-file, ‏לא cwd). |
| shebang ‏אובד | bun build | ‏**‏נסגר** — ‏ספייק 1 (‏שורה ראשונה = shebang). DoD #4. |
| ‏dep נוסף עם worker/dynamic-require ‏קורס בבאנדל | spike ‏בדק happy-path | ‏אם bunx ‏קורס על dep אחר → ‏הוסף ל-`--external` (‏ציבורי, ‏ייפתר מ-registry) + ‏הוסף ל-deps. ‏תעד. |
| ‏FE cascade ‏לא תופס ב-release layout | spike #4 | ‏**‏נסגר** — `../frontend-dist` (‏רמה אחת) ‏אומת ל-release-bundle ‏ול-dev. DoD #7+#8. |
| ‏`FE_STATIC_DIR=` ‏ריק מנטרל cascade | spike #5 (`??=`) | ‏ב-verify ‏השתמש ב-`env -u FE_STATIC_DIR`. ‏מתועד ב-Commit 2. |
| ‏plugin path ‏שגוי בבאנדל | `plugin-config.ts:27` | ‏**‏נסגר** — ‏ספייק 3: `dist/`→`../plugins`=`<pkg>/plugins` ‏וה-קובץ קיים. DoD #9. |
| ‏release package ‏נכלל ב-pnpm workspace ‏ומבלבל build-all | `packages/*` glob | ‏ה-scripts ‏שלו (`build`/`prepack`) ‏ייעודיים; ‏אין `dev`/`test`. ‏אמת `pnpm -r` ‏לא נשבר (DoD #1). |
| ‏plugins/frontend-dist ‏מועתקים stale | build.mjs | ‏build.mjs ‏עושה `rmSync` ‏לפני כל copy (‏צעדים 2-4). |

---

## §7 — Escalation triggers

- ‏`bun build` ‏נכשל לבנדל core/provider-contract (‏circular/TS resolution) — ‏עצור.
- ‏bunx ‏קורס על dep ‏שאינו pino/pino-pretty ‏גם אחרי external סביר — ‏עצור.
- ‏ה-cascade ‏הדו-מועמדי שובר את ה-dev path ‏הקיים (DoD #8 ‏נכשל) — ‏עצור (‏לא אמור, ‏אומת בספייק).
- ‏ה-plugin ‏לא נטען בפועל ע"י opencode ‏מהחבילה המותקנת — ‏בעיה ארכיטקטונית, ‏עצור.
- ‏נדרש לשנות `server.ts`/core/provider-contract/backend-deps — ‏מחוץ ל-scope.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏package + build-script חדשים (greenfield) | +2 |
| `bun build` ‏עם externals + sourcemap + shebang | +1 |
| ‏נגיעה אחת ב-bin (path cascade) | +1 |
| ‏Runtime risk (‏boot של artifact מבונדל) | +2 |
| ‏לא נוגע ב-deps/server קיימים | 0 |
| ‏מבוסס על 3 spikes ‏מאומתים | -1 |

**Score**: 5/10 → `calev` (light) + **verifier-phase ‏אחרי Commit 1**.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏שם ה-package `drive-coding` — ‏מתנגש עם root `drive-coding` (‏private)? | ‏לא בעיה — ‏root ‏הוא private ‏ולא מתפרסם; ‏רק ה-release ‏מתפרסם בשם הזה. | ❌ |
| 2 | ‏נגיעה ב-bin של backend, ‏או release-own bin shim (‏אפס נגיעה)? | ‏נגיעה ב-bin (cascade ‏כללי+בטוח, ‏מבונדל מקבל preflight+URL ‏חינם). shim ‏היה משכפל לוגיקה. ‏אם המשתמשת רוצה אפס-נגיעה — ‏נעבור ל-shim. | ❌ |
| 3 | sourcemap ‏ב-tarball? | ‏כן (`--sourcemap=linked`) — ‏זול ל-debug. | ❌ |
| 4 | ‏להחזיק את build artifacts ‏ב-`packages/release/` ‏(gitignored) ‏או temp? | ‏ב-package (gitignored) — ‏prepack ‏בונה בזמן pack. | ❌ |

> ‏אין שאלה חוסמת.

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

- **--sourcemap=linked הושמט**: bun@1.3.14 עם `--outfile` + `--sourcemap=linked` לא כותב קבצים כשstdio מנותב (pipe mode). ה-brief ציין sourcemap כ-optional (§9 Q3: "זול ל-debug"). הוחלט להוריד. bundle עובד תקין ללא sourcemap.
- **npm pack 2>&1 הוסר מ-verify-pack.sh**: bun build subprocess לא כותב קבצים כש-stdout מנותב לpipe. script מיועד להרצה ידנית בterminal (TTY). הבדיקה ידנית בוצעה ואומתה בsteps.

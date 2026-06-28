# Slice — npm publish packaging — ‏תוכנית

> **‏תאריך**: 2026-06-16
> **‏סטטוס**: ‏מאושר (‏אביגיל r2 = READY) — ‏dispatch ‏חסום תזמונית עד שה-base branch (‏תלות) ‏קיים
> **Complexity**: 7/10 (verifier: light + phase על Commit 1-2)
> **‏תלויות (`depends_on`)**: [slice-bunx-single-command] — ‏בונה על ה-bin entry
> **‏Base**: ‏branch `slice-bunx-single-command` (‏עדיין לא merged ל-dev)
> **‏Dev tip**: `161bd94`

---

## §0 — Pre-flight

### ‏תלויות (‏חובה!)

‏slice זה **‏מבוסס על** slice-bunx-single-command (status: brief-ready / plan-verified, ‏טרם merged):
- ‏הוא מספק את `packages/backend/src/bin/drive-coding.ts` (‏ה-bin entry שמגדיר `FE_STATIC_DIR`+`PORT` ‏ומייבא את server.ts) ‏ואת ה-`bin` field. **‏slice זה אורז אותו ל-npm.**
- ‏בלי ה-bin אין מה לפרסם. **`base` ‏חייב להיות ה-branch של slice-bunx-single-command**, ‏לא dev.

> **🚦 GATE ‏תזמוני (finding #2) — ‏קרא לפני worktree**: ‏נכון ל-tip 161bd94 **‏ה-branch `slice-bunx-single-command` ‏עדיין לא קיים** (‏התלות טרם בוצעה). ‏פקודת ה-worktree למטה **‏תיכשל** (`fatal: invalid reference`) ‏עד ש**‏אחד מהשניים** ‏קורה:
> 1. ‏ה-slice התלוי **‏בוצע** ‏וה-branch `slice-bunx-single-command` ‏קיים → ‏השתמש בו כ-base (‏הפקודה למטה).
> 2. ‏ה-slice התלוי **‏נמרג ל-dev** → ‏עדכן ‏ל-`base: dev` ‏והרץ `git worktree add .worktrees/slice-npm-publish -b slice-npm-publish dev`.
>
> ‏**‏אל תתחיל את ה-slice הזה לפני אחד מאלה.** ‏זו תלות-מוצהרת תקינה (depends_on), ‏לא באג ב-brief.

> **‏הערה (finding #3 — Mode 1)**: ‏אין `state.json` ‏ב-repo (‏לא Mode 2 ‏לילי). ‏מקור-האמת ל-`depends_on` ‏הוא ה-frontmatter של ה-brief הזה (`[slice-bunx-single-command]`). ‏אין מה לאמת מכנית מול orchestration state.

### Worktree

```bash
cd d:\UserProjects\AI\drive-coding\dev
# base = branch של התלות (שרשור)
git worktree add .worktrees/slice-npm-publish -b slice-npm-publish slice-bunx-single-command
cd .worktrees/slice-npm-publish
pnpm install && pnpm hooks:install
```

### ‏איך להריץ

- **‏בניית tarball**: `cd packages/backend && bun pm pack` (‏או `npm pack`) → ‏מייצר `drive-coding-<version>.tgz`
- **‏אימות התקנה נקייה** (DoD ‏עיקרי): ‏התקן את ה-tgz ל-temp dir ‏והרץ `bunx`. ‏ראה Commit 2.
- **Typecheck**: `pnpm typecheck`
- **Tests**: `pnpm test`
- **Lint**: `pnpm lint && pnpm lint:i18n`
- ‏הרצה ישירה (dev, ‏מ-slice הקודם): `bun packages/backend/src/bin/drive-coding.ts`

### Browser

‏אימות serving: ‏דפדפן/`Invoke-WebRequest` על `http://localhost:4000/` ‏מתוך ה-temp install.

### ‏Shell

‏סביבת dev = **Windows / PowerShell**. ‏פקודות אימות ב-PowerShell. ‏הרצת server ברקע = `run_in_background`.

### ‏מה ה-slice **‏לא** ‏עושה

- **‏לא** ‏מריץ `npm publish` / `bun publish` ‏ל-registry בפועל. ‏זה צעד אנושי אחרון (‏credentials + ‏אישור שם + ‏אישור משתמש). ‏ה-slice מגיע עד **tarball שמתקין ורץ**.
- **‏לא** ‏מפרסם את `@drive-coding/core` / `provider-contract` ‏כ-packages נפרדים — ‏הם נארזים פנימה (bundledDependencies).
- **‏לא** ‏מעביר ל-Node runtime — ‏עדיין bunx (‏ראה slice-bunx-single-command §0).

### Reading list

**must-read**:
- `docs/plans/slice-bunx-single-command.md` — ‏ה-bin שאנחנו אורזים.
- `packages/backend/package.json` — ‏ה-deps (‏כולל `provider-contract` ‏git, `@drive-coding/core` ‏workspace), `private: true`, `version: 0.0.0`, ‏שם `@drive-coding/backend`.
- `packages/core/package.json` — ‏exports ‏ל-`src/*.ts` (‏TS ‏ישיר — ‏מתאים ל-bunx).

**reference**:
- `packages/backend/plugins/README.md` §"Production notes" — ‏plugins/ ‏חייב להיכלל ב-tarball (file:// ‏ב-runtime).
- `packages/backend/src/bin/drive-coding.ts` — ‏נתיב ה-FE שצריך לתמוך גם ב-packaged layout.

---

## §1 — ‏מטרה

‏אחרי ה-slice, ‏ריצת `bun pm pack` ‏ב-`packages/backend` ‏מייצרת tarball בודד (`drive-coding-0.1.0.tgz`) ‏שמכיל **‏הכל** ‏שצריך כדי לרוץ: ‏ה-bin, ‏קוד ה-BE, ‏ה-`@drive-coding/core` ‏וה-`provider-contract` ‏(bundled), ‏ה-plugins, ‏וה-FE הבנוי. ‏התקנת ה-tarball ב-temp dir נקי ‏(`bun add ./drive-coding-0.1.0.tgz`) ‏והרצת `bunx drive-coding` ‏מרימה את ה-app ‏ומגישה את ה-FE על :4000 — **‏בלי הריפו, ‏בלי git, ‏בלי workspace**. ‏זה מוכיח שהחבילה self-contained ‏ומוכנה ל-`npm publish` ‏(‏הצעד האנושי הבא).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏שם package ‏פרסומי `drive-coding` + `version` + ‏הסרת `private` | ✅ | ‏בslice הזה |
| `files[]` manifest (src, plugins, FE build) | ✅ | ‏בslice הזה |
| `bundledDependencies`: core + provider-contract | ✅ | ‏בslice הזה |
| `prepack`: ‏בניית FE + ‏העתקה לתוך החבילה | ✅ | ‏בslice הזה |
| ‏עדכון ה-bin ‏לפתור FE ‏גם ב-packaged layout | ✅ | ‏בslice הזה |
| ‏אימות tarball: install ל-temp + bunx ‏עולה | ✅ | ‏בslice הזה |
| `npm publish` ‏ל-registry בפועל | ❌ | ‏צעד אנושי אחרון (‏אחרי merge) |
| ‏פרסום core/provider-contract ‏כ-packages נפרדים | ❌ | ‏לא נדרש (bundled) |
| CI workflow ל-publish אוטומטי | ❌ | slice עתידי |

---

## §3 — Architecture diagram

```
‏בזמן pack (prepack hook):
  pnpm --filter @drive-coding/frontend-v2 build
        │  → packages/frontend/build/
        ▼
  ‏העתק → packages/backend/frontend-dist/   ← ‏בתוך החבילה (gitignored)

  bun pm pack ‏ב-packages/backend:
  ┌──────────────────────────────────────────────┐
  │ drive-coding-0.1.0.tgz                        │
  │  package.json (name: drive-coding, bin)       │
  │  src/**            ← ‏BE + bin (‏מ-slice קודם)  │
  │  plugins/**        ← file:// ‏ב-runtime        │
  │  frontend-dist/**  ← ‏ה-FE הבנוי               │
  │  node_modules/                                │
  │    @drive-coding/core/**  ← bundledDependency │
  │    provider-contract/**   ← bundledDependency │
  └──────────────────────────────────────────────┘
   + dependencies (‏מ-registry בזמן install):
     hono, ai, @hono/node-server, ws, ...        ‏(‏של backend)
     pino, pino-pretty, marked                   ← ‏של core (finding #1)
        │
        ▼  bun add ./drive-coding-0.1.0.tgz  (temp dir נקי)
  ┌──────────────────────────────────────────────┐
  │ node_modules/drive-coding/                    │
  │   bunx drive-coding →                         │
  │     src/bin/drive-coding.ts                   │
  │       FE_STATIC_DIR = <packaged frontend-dist>│ ← ‏ה-bin בוחר packaged path
  │       import ../server.js → serve :4000       │
  └──────────────────────────────────────────────┘
```

---

## §4 — Commits ‏בסדר

### Commit 0 — package metadata ‏פרסומי + transitive deps (approach: integration)

**‏קבצים שמשתנים**:

‏(1) `packages/backend/package.json`:
  - `"name": "@drive-coding/backend"` → `"name": "drive-coding"` (‏כדי ש-`bunx drive-coding` ‏יעבוד)
  - `"version": "0.0.0"` → `"0.1.0"`
  - ‏הסר `"private": true`
  - ‏הוסף `"files": ["src", "plugins", "frontend-dist"]`
  - ‏הוסף `"bundledDependencies": ["@drive-coding/core", "provider-contract"]`
  - **(finding #1) ‏הוסף ל-`dependencies` ‏את ה-runtime deps ‏הטרנזיטיביים של core ‏שחסרים ב-backend**: `"pino"`, `"pino-pretty"`, `"marked"`. ‏(arktype, neverthrow, @agentclientprotocol/sdk, provider-contract — ‏כבר ב-backend deps; ‏אל תשכפל.) ‏השתמש באותן טווחי-גרסה כמו ב-`packages/core/package.json`.
  - ‏הוסף `"repository"`, `"license"`, `"description"` (‏מטא-דאטה ל-npm)
  - ‏ה-`bin` ‏כבר קיים ‏מ-slice הקודם (`"drive-coding": "./src/bin/drive-coding.ts"`) — ‏לא לשנות.

‏(2) `packages/core/package.json` — **(finding #4)** ‏הסר `"private": true`, ‏שנה `"version": "0.0.0"` → `"0.1.0"`. ‏סיבה: `npm pack` ‏מסרב לארוז bundledDependency ‏שהוא `private`. ‏(‏אנחנו **‏לא** ‏מפרסמים את core ‏בנפרד — ‏רק מאפשרים ל-pack לארוז אותו פנימה.) ‏אל תיגע ב-exports (‏שמצביע ל-`src/*.ts` — ‏נכון ל-bunx).

> **‏למה הכרזת deps ‏ולא bundling רקורסיבי (finding #1)**: `bundledDependencies` ‏אורז את **‏קבצי** core (`src/`) ‏אבל **‏לא** ‏את עץ ה-deps שלו. core ‏מייבא `pino`+`pino-pretty` (`src/log/index.ts`) ו-`marked` (`src/ui/markdown.ts`), ו-backend ‏צורך `@drive-coding/core/log` ‏ב-hot path. ‏בלי הכרזה — ‏התקנה נקייה קורסת ב-boot עם `Cannot find module 'pino'`. ‏הכרזתם כ-deps ‏ישירים = ‏הם יותקנו מ-registry בזמן `bun add`.

> **‏אזהרה ל-executor (rename safety)**: ‏שינוי שם ה-package מ-`@drive-coding/backend`. ‏לפני השינוי — `grep -r "@drive-coding/backend"` ‏בכל ה-repo. ‏אביגיל אימתה שכל ההימצאויות הן `pnpm --filter @drive-coding/backend` ‏(build tooling/docs) ‏ולא imports אמיתיים — **‏אבל אמת שוב ב-worktree שלך**. ‏אם יש import/tsconfig reference אמיתי — ‏עצור ו-escalate (§7).

**Verification** (PowerShell):

```powershell
pnpm typecheck
cd packages/backend
bun pm pack --dry-run    # ‏מציג את רשימת הקבצים שייכנסו ל-tarball
# ‏וודא: src/, plugins/, frontend-dist/ (‏עדיין ריק — Commit 1), bin ‏מופיע,
#        ‏ו-node_modules/@drive-coding/core/src/ ‏נכלל (‏finding #4 — core לא-private עכשיו)
cd ../..
```

### Commit 1 — prepack: ‏בניית FE + ‏העתקה פנימה + ‏פתרון נתיב ב-bin (approach: integration)

**‏קבצים חדשים**:
- `packages/backend/scripts/prepack.mjs` — (א) `pnpm --filter @drive-coding/frontend-v2 build`; (ב) ‏מחק `packages/backend/frontend-dist/` ‏אם קיים; (ג) ‏העתק את `packages/frontend/build/` ‏אל `packages/backend/frontend-dist/`. cross-platform (`node:fs` `cpSync({recursive:true})`).

**‏קבצים שמשתנים**:
- `packages/backend/package.json` — ‏הוסף `"prepack": "node scripts/prepack.mjs"` ‏ל-scripts. (npm/bun ‏מריצים `prepack` ‏אוטומטית לפני `pack`/`publish`.)
- `packages/backend/src/bin/drive-coding.ts` — ‏עדכן את פתרון נתיב ה-FE ‏לתמוך **‏בשני** ‏ה-layouts:

```ts
import { existsSync } from "node:fs"
import path from "node:path"

// packaged layout: <pkg>/frontend-dist  (‏ה-bin ב-<pkg>/src/bin → ../../frontend-dist)
// dev layout:      packages/frontend/build (../../../frontend/build)
const packagedFe = path.resolve(import.meta.dirname, "../../frontend-dist")
const devFe = path.resolve(import.meta.dirname, "../../../frontend/build")
const feBuildDir = existsSync(packagedFe) ? packagedFe : devFe

process.env.FE_STATIC_DIR ??= feBuildDir
process.env.PORT ??= "4000"
await import("../server.js")
```

- `.gitignore` (root ‏או backend) — ‏הוסף `packages/backend/frontend-dist/` (‏build artifact, ‏לא ב-git).

**Verification** (PowerShell):

```powershell
cd packages/backend
bun pm pack    # ‏מריץ prepack → ‏בונה FE, ‏מעתיק, ‏ואורז
# ‏וודא ש-frontend-dist/index.html קיים אחרי prepack:
Test-Path frontend-dist/index.html      # True
# ‏וודא שה-tgz מכיל frontend-dist + node_modules/@drive-coding/core + provider-contract:
tar -tzf drive-coding-0.1.0.tgz | Select-String -Pattern "frontend-dist/index.html|@drive-coding/core|provider-contract" | Select-Object -First 5
cd ../..
```

### Commit 2 — end-to-end: ‏install ל-temp + bunx ‏עולה (approach: manual)

‏אין שינוי קוד — ‏זהו commit אימות (‏אפשר לתעד את ה-script ‏ב-`packages/backend/scripts/verify-pack.ps1` ‏לשחזור).

**Verification** (PowerShell):

```powershell
cd packages/backend
bun pm pack
$tgz = (Resolve-Path drive-coding-0.1.0.tgz).Path
$tmp = Join-Path $env:TEMP "dc-pack-test"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory $tmp | Out-Null
Push-Location $tmp
bun init -y | Out-Null
bun add $tgz                              # ‏מתקין מה-tarball בלבד — ‏בלי הריפו
# ‏הרם ברקע (run_in_background): bunx drive-coding
Start-Sleep -Seconds 3
(Invoke-WebRequest http://localhost:4000/ -UseBasicParsing).StatusCode          # 200
(Invoke-WebRequest http://localhost:4000/ -UseBasicParsing).Content -match '<!doctype html'   # True
(Invoke-WebRequest http://localhost:4000/api/agents -UseBasicParsing).StatusCode # API ‏חי
# ‏עצור את ה-server, Pop-Location, ‏נקה $tmp
Pop-Location
cd ../..
```

---

## §5 — DoD verifiable

‏(PowerShell; ‏server ברקע = `run_in_background`)

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + tests | `pnpm typecheck; pnpm test` |
| 2 | lint + i18n | `pnpm lint; pnpm lint:i18n` |
| 3 | `bun pm pack` ‏מצליח ‏ומריץ prepack | ‏קיים `drive-coding-0.1.0.tgz` + `frontend-dist/index.html` |
| 4 | ה-tarball self-contained | `tar -tzf *.tgz` ‏מכיל `frontend-dist/`, `plugins/`, `node_modules/@drive-coding/core/`, `node_modules/provider-contract/` |
| 5 | ‏install נקי + bunx ‏עולה | ‏temp dir, `bun add <tgz>`, `bunx drive-coding` → `iwr :4000/` = 200 + ‏HTML |
| 6 | regression: ‏API/SPA ‏מה-install | `iwr :4000/api/agents` ‏מחזיר API (‏לא index.html) |
| 7 | ‏dev path ‏לא נשבר | `bun packages/backend/src/bin/drive-coding.ts` ‏(‏מהריפו) ‏עדיין מגיש FE (‏ה-bin בוחר devFe ‏כש-frontend-dist חסר) |
| 8 | ‏שם backend לא שבר כלום | `pnpm typecheck` ‏עובר אחרי שינוי השם; `grep "@drive-coding/backend"` ‏ריק (‏או escalated) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **‏(‏טופל — finding #1) transitive deps של core** — pino/pino-pretty/marked ‏אינם נארזים ע"י bundledDependencies | core/package.json | ‏הוכרזו כ-`dependencies` ‏של ה-package ב-Commit 0 → ‏מותקנים מ-registry. DoD #5 ‏מאמת boot נקי. |
| **bundledDependencies על pnpm symlink (‏שתי רמות)** — `node_modules/@drive-coding/core` ‏ו-`provider-contract` ‏הם symlinks ל-`.pnpm/...`; ‏pack ‏עלול לא לעקוב | pnpm workspace (finding #5) | ‏אמת **‏מוקדם** (Commit 0 dry-run): `tar -tzf` ‏מכיל `node_modules/@drive-coding/core/src/` ‏ו-`node_modules/provider-contract/dist/`. ‏אם חסר — escalate (§7). ‏הסיבה הסבירה לכישלון היא `private:true` ‏של core (‏טופל) ‏או אי-מעקב symlink. |
| **provider-contract git+בנוי** — ‏ה-dist שלו חייב להיכלל | git dep | ‏אומת: `node_modules/provider-contract/dist` ‏קיים (version 0.1.0, ‏לא-private, `files:["dist"]`); bundled מעתיק אותו. |
| **core exports ל-`src/*.ts`** — ‏עובד רק תחת Bun (TS ‏ישיר), ‏לא Node | core/package.json | ‏עקבי עם הכרעת bunx. ‏אם מישהו ינסה npx/node — ‏ייכשל; ‏מתועד. |
| **`prepack` ‏לא רץ עם bun** — bun ‏אולי לא מריץ prepack lifecycle | bun ‏behavior | ‏אמת ש-`bun pm pack` ‏הריץ prepack (frontend-dist נוצר). ‏אם לא — ‏הרץ prepack ‏ידנית ‏לפני pack, ‏או השתמש ב-`npm pack`. escalate אם חוסם. |
| ‏Hardcoded Hebrew ‏ב-prepack/scripts | dev-conventions | hook חוסם; ‏הודעות באנגלית. |
| ‏`data/` cwd-relative (‏מ-slice קודם) — ‏ב-temp install ‏ייווצר ב-cwd ‏של ה-temp | server.ts:56-57 | ‏מקובל לאימות; known issue ‏פתוח (slice-bunx §9 Q1). |
| ‏Windows `tar`/`cpSync` | win32 | `tar` ‏קיים ב-Windows 10+; `fs.cpSync` ‏cross-platform. |

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את Tama:

- ‏משהו מייבא `@drive-coding/backend` ‏(‏ה-grep ב-Commit 0 ‏לא ריק) — ‏שינוי השם שובר אותו.
- `tar -tzf` ‏מראה ש-`@drive-coding/core` ‏**‏לא** ‏נכלל ב-tarball (‏בעיית symlink/bundling) — ‏זו ההנחה המרכזית; ‏אם נשברה, ‏ארכיטקטורת ה-bundledDependencies לא תקפה.
- `bun pm pack` ‏לא מריץ `prepack` ‏ו-frontend-dist נשאר ריק — ‏צריך מנגנון build ‏אחר.
- ‏ה-install ה-temp דורש git/רשת (‏provider-contract ‏לא bundled כמו שצריך) — ‏מנוגד למטרת self-contained.
- ‏אתה רוצה לפרסם ל-registry בפועל — ‏זה **‏לא** ‏ב-scope; ‏צעד אנושי.
- ‏אתה רוצה לסטות ל-Node/bundling במקום bunx.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏Refactor של קוד קיים (package.json, bin path) | +1 |
| >5 files ‏ב->2 packages (backend pkg, bin, prepack, gitignore, frontend) | +1 |
| ‏מנגנון build/packaging חדש (prepack, bundledDependencies) | +2 |
| ‏ספרייה/כלי חיצוני חדש (bun pm pack lifecycle) | +2 |
| Cross-platform (Windows pack/install) | +1 |
| ‏תלוי ב-slice לא-merged (‏שרשור) | +1 |
| Greenfield (‏אין call sites ל-packaging) | -1 |

**Score**: 7/10

**Tier**: 4-7 → `calev` (light) + `verifier-phase` ‏על Commit 1 ‏ו-Commit 2 (‏ה-pack + ה-install — ‏הלב המסוכן).

**‏Verifier-phase**: ‏אחרי Commit 1 (‏אימות שה-tarball self-contained) ‏ואחרי Commit 2 (‏install נקי).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏שם ה-package — `drive-coding` ‏(unscoped) ‏או `@drive-coding/cli`? | `drive-coding` ‏(unscoped, ‏פשוט ל-`bunx`). ‏אם תפוס ב-npm — ‏escalate בזמן publish. | ❌ |
| 2 | ‏ה-package המתפרסם = `packages/backend` ‏(‏שינוי שם) ‏או package CLI ‏חדש? | `packages/backend` — ‏הוא כבר מחזיק את ה-bin + ‏כל ה-deps; ‏package נפרד = ‏עוד שכבת bundling. | ❌ |
| 3 | provider-contract — bundled ‏או ‏להשאיר git dep? | bundled (self-contained, ‏בלי git ‏למשתמש קצה). | ❌ |
| 4 | `version` ‏התחלתי | `0.1.0`. | ❌ |
| 5 | ‏האם להחצין `DATA_DIR` ‏כאן (‏ה-temp install ‏יוצר data/ ב-cwd)? | ‏לא — known issue נפרד; ‏לא חוסם packaging. | ❌ |

> ‏אין שאלה חוסמת. ‏ברירות-המחדל מספיקות ל-dispatch. ‏שם ה-package (Q1) ‏ייסגר סופית בזמן ה-publish האנושי.

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- (‏אין עדיין)

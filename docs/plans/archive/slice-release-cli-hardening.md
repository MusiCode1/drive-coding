# Slice — release CLI hardening (fixtures strip + flags + --help) — ‏תוכנית

> **‏תאריך**: 2026-06-21
> **‏סטטוס**: ✅ **הושלם** — 2 commits על branch `slice-release-cli-hardening` (base: 7444c85); calev light: GO (11/11 DoD, 1 finding pre-existing)
> **Complexity**: 4/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [] — ‏ה-release package כבר מוזג ל-dev (`slice-release-package`, 2026-06-18). ‏אין תלות לא-merged.
> **‏Base**: `dev`
> **‏Dev tip**: `7444c85`

> **🔴 ‏הערת-תיקון חשובה (‏מ-r1)**: ‏הגרסה הקודמת של ה-brief כללה "Commit 0 — ‏תיקון FE path resolution" ‏בטענה שה-package שבור למשתמש קצה (404 ‏מהתקנה נקייה). **‏זה היה שגוי.** ‏אביגיל r1 ‏תפסה ש-`import.meta.dirname` ‏בבאנדל נפתר נכון ל-`dist/`. ‏אומת אמפירית עד הסוף: ‏ה-404 ‏נבע **‏אך ורק** ‏מכך שה-session של מרדכי מייצא `FE_STATIC_DIR=.../dev/packages/frontend/build` (‏מסקריפט הרצת dev), ‏שדלף לכל בדיקת install-נקי. ‏עם `env -u FE_STATIC_DIR` ‏ועץ dev מוסתר → ‏ה-package מגיש את ה-`frontend-dist` ‏הארוז עם **200**. ‏**‏ה-package עובד ומוכן לפרסום כמו שהוא.** ‏ה-slice הזה = ‏שיפורים בלבד (‏fixtures + CLI), ‏לא תיקון blocker.

---

## §0 — Pre-flight

### ‏סביבה (‏קרא קודם!)

- **‏סביבת ההרצה היא Linux** (‏לא Windows/PowerShell כמו ב-briefs ישנים). ‏כל פקודות האימות ב-**bash**.
- **bun** `1.3.14` ‏ב-`/home/user/.bun/bin/bun`.
- **pnpm** ‏ו-**node** ‏זמינים; ‏ב-worktree חדש — ‏הרץ `pnpm install`.
- ‏ה-package המתפרסם: `packages/release/` — ‏שם `drive-coding`, ‏גרסה `0.1.0`. ‏מבונדל ע"י `bun build` ‏ל-`dist/drive-coding.js`.
- **⚠️ ‏זיהום-env בבדיקות (‏לקח מ-r1)**: ‏ה-session מייצא `FE_STATIC_DIR`, `PORT`, `OPENCODE_BIN`, `CORS_ORIGINS` (‏בדוק `env | grep -E "FE_STATIC|CORS|OPENCODE"`). ‏**‏כל בדיקת install-נקי חייבת לאפס אותם**: `env -u FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN ...`. ‏אחרת תקבל תוצאות-שווא (‏כמו ה-404 ‏המדומה ב-r1).

### Worktree

```bash
cd /home/user/projects/drive-coding/dev
git worktree add .worktrees/slice-release-cli-hardening -b slice-release-cli-hardening dev
cd .worktrees/slice-release-cli-hardening
pnpm install && pnpm hooks:install
```

### ‏איך להריץ / ‏לאמת

- **‏בניית ה-release bundle**: `cd packages/release && node scripts/build.mjs` (‏~40s, ‏בונה FE → ‏מעתיק → `bun build`).
- **‏אריזה**: `cd packages/release && npm pack` → `drive-coding-0.1.0.tgz`.
- **‏אימות install נקי**: ‏install ל-temp dir + boot — ‏**‏תמיד עם `env -u FE_STATIC_DIR ...`** ‏(‏ראה אזהרת זיהום-env).
- **Typecheck**: `pnpm typecheck` · **Tests**: `pnpm test` · **Lint**: `pnpm lint && pnpm lint:i18n` (‏i18n hook ‏חוסם עברית בקוד — **‏help text באנגלית בלבד**).
- ‏הרצה ישירה (dev): `bun packages/backend/src/bin/drive-coding.ts`.

### ‏מה ה-slice **‏לא** ‏עושה

- **‏לא** ‏מריץ `npm publish` ‏ל-registry — ‏צעד אנושי אחרון (‏אישור משתמשת + login).
- **‏לא** ‏נוגע ב-FE path resolution / `import.meta.dirname` — **‏זה עובד** (‏ראה הערת-תיקון). ‏אין כאן blocker.
- **‏לא** ‏מוסיף config-file ‏ממשי (JSON/TOML). ‏ה"config" = env vars; ‏ה-slice מוסיף **‏flags** ‏כשכבת-קדימות מעל env vars.
- **‏לא** ‏מתקן את `data/` ‏cwd-relative (server.ts:80) — ‏issue נפרד.

### Reading list

**must-read**:
- `packages/backend/src/bin/drive-coding.ts` — ‏ה-bin שאליו מוסיפים arg parsing (‏~42 ‏שורות).
- `packages/release/scripts/build.mjs` — ‏ה-build (‏הוספת strip ל-fixtures). ‏משתנים רלוונטיים: `releaseFrontendDist`, `frontendBuild`, ‏ייבוא `rmSync`+`existsSync`.
- `packages/release/package.json` — `bin`, `version: 0.1.0`, `files: ["dist/drive-coding.js","plugins","frontend-dist"]`.
- `packages/release/README.md` + `README.he.md` — ‏מתעדכנים עם ה-flags.

**reference**:
- `packages/backend/src/server.ts` — ‏קורא `PORT` (`:143`), `FE_STATIC_DIR` (`:109`), `CORS_ORIGINS` (`:72`) ‏מ-env בזמן import. **‏לא נוגעים בו** — ‏ה-bin מגדיר env ‏לפני `import("../server.js")`.
- `packages/backend/src/acp/cli-config.ts:68` — ‏קורא `OPENCODE_BIN`.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts:1085-1087` — ‏ה-fixture loader (`fetch("/fixtures/...")`, DEV-only). *(‏תוקן מ-r1: 1085-1087, ‏לא 1082.)*
- `packages/frontend/src/routes/+page.svelte:88` — `MOCK_FIXTURES = import.meta.env.DEV ? ... : []` (‏ריק ב-production). *(‏תוקן מ-r1: שורה 88.)*

---

## §1 — ‏מטרה

‏שתי מטרות:

1. **‏אין דליפת דאטה/נפח ל-package הציבורי.** ‏היום `frontend-dist/fixtures/` (~2MB ‏sessions מוקלטים, ‏כולל קבצים שנשמעים אישיים: `salary-attendance.json`, `salary-prev.json`) ‏נכנס ל-tarball (‏אומת ב-`npm pack --dry-run`). ‏הם DEV-only — `MOCK_FIXTURES` ‏מאחורי `import.meta.env.DEV` (‏ריק ב-prod), ‏וה-loader נקרא רק מ-UI ‏של dev. ‏אחרי ה-slice: ‏מוחרגים מה-release frontend-dist.
2. **‏CLI ‏שמיש.** ‏היום config = env vars בלבד. ‏אחרי ה-slice: ‏flags (`--port`, `--opencode-bin`, `--fe-static-dir`, `--cors-origins`), `--help`, `--version` — ‏עם קדימות `flag > env > default`.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|------|------|------|
| ‏החרגת `fixtures/` ‏מה-release frontend-dist | ✅ | Commit 0 |
| ‏flags: `--port/-p`, `--opencode-bin`, `--fe-static-dir`, `--cors-origins` | ✅ | Commit 1 |
| `--help/-h` + `--version/-V` | ✅ | Commit 1 |
| ‏עדכון README (EN + HE) ‏עם ה-flags | ✅ | Commit 1 |
| ‏תיקון FE path resolution | ❌ | ‏אין באג (‏הופרך ב-r1) |
| `npm publish` ‏ל-registry | ❌ | ‏צעד אנושי |
| ‏config-file (JSON/TOML) | ❌ | ‏מחוץ ל-scope |
| ‏הוספת dependency ל-arg parsing | ❌ | ‏built-in `node:util` `parseArgs` |

---

## §3 — Architecture / ‏קדימות config

```
‏סדר הפעולות ב-bin (קריטי לקדימות flag > env > default):

  1. parseArgs(process.argv)                → values
  2. if values.help    → print help, exit 0
     if values.version → print version, exit 0
  3. flag → env mapping (flag דורס env):
       values.port            → process.env.PORT = ...
       values["opencode-bin"] → process.env.OPENCODE_BIN = ...
       values["fe-static-dir"]→ process.env.FE_STATIC_DIR = ...   ← לפני ה-??= למטה!
       values["cors-origins"] → process.env.CORS_ORIGINS = ...
  4. feBuildDir = [.../frontend-dist, .../frontend/build].find(existsSync) ?? ...
     process.env.FE_STATIC_DIR ??= feBuildDir     ← ??= מכבד flag/env שכבר נקבע
  5. process.env.PORT ??= "4000"
  6. preflight (which/where agentBin)
  7. await import("../server.js")   ← server קורא את ה-env שנקבע

‏קדימות מתקבלת: flag (שלב 3) דורס env (כי מציב ערך) → env קיים שורד (??= לא דורס) → default (??=).
```

---

## §4 — Commits ‏בסדר

### Commit 0 — ‏החרגת dev fixtures ‏מה-release frontend-dist — approach: integration

**‏קובץ שמשתנה**: `packages/release/scripts/build.mjs`

‏אחרי Step 2 (`cpSync(frontendBuild, releaseFrontendDist, ...)`), ‏הוסף הסרת תיקיית ה-fixtures **‏מהעותק של ה-release בלבד** (‏לא מ-`packages/frontend/build` ‏של dev):

```js
// Step 2b: strip DEV-only fixtures from the release copy (privacy + ~2MB bloat).
// MOCK_FIXTURES is gated behind import.meta.env.DEV (+page.svelte) → prod never fetches them.
const releaseFixtures = path.join(releaseFrontendDist, "fixtures")
if (existsSync(releaseFixtures)) {
  rmSync(releaseFixtures, { recursive: true, force: true })
  console.log("[build] Step 2b: stripped DEV fixtures from release frontend-dist")
}
```

‏(`existsSync` ‏ו-`rmSync` ‏כבר מיובאים ב-build.mjs — ‏אמת זאת; ‏אם לא, ‏הוסף ל-import.)

**Verification (bash):**

```bash
cd packages/release && node scripts/build.mjs
test ! -d frontend-dist/fixtures && echo "OK: fixtures stripped" || echo "FAIL"
npm pack --dry-run 2>&1 | grep -c "fixtures/"     # MUST be 0
test -f frontend-dist/index.html && echo "OK: index still present"
# dev build לא נפגע:
test -d ../frontend/build/fixtures && echo "OK: dev fixtures intact"
```

### Commit 1 — ‏CLI flags + --help + --version — approach: manual

**‏קובץ שמשתנה**: `packages/backend/src/bin/drive-coding.ts`

‏הוסף parsing עם `node:util` `parseArgs` **‏בראש** ‏ה-bin (‏אחרי ה-imports, ‏לפני חישוב feBuildDir). ‏הקדימות: ‏ראה §3.

```ts
import { parseArgs } from "node:util"
import { readFileSync } from "node:fs"   // בנוסף ל-existsSync הקיים

let values: Record<string, string | boolean | undefined>
try {
  ({ values } = parseArgs({
    options: {
      port:            { type: "string", short: "p" },
      "opencode-bin":  { type: "string" },
      "fe-static-dir": { type: "string" },
      "cors-origins":  { type: "string" },
      help:            { type: "boolean", short: "h" },
      version:         { type: "boolean", short: "V" },
    },
    allowPositionals: false,
  }))
} catch (err) {
  console.error(`[drive-coding] ${(err as Error).message}\n`)
  console.error(HELP)          // HELP מוגדר למטה
  process.exit(1)
}
```

**`HELP` ‏constant** (‏**‏אנגלית בלבד** — ‏i18n hook):

```ts
const HELP = `drive-coding — single-command server + web UI for ACP coding agents

Usage:
  drive-coding [options]

Options:
  -p, --port <n>            Port to listen on            (env: PORT, default: 4000)
      --opencode-bin <bin>  Agent binary to look for     (env: OPENCODE_BIN, default: opencode)
      --fe-static-dir <dir> Override served web-UI dir   (env: FE_STATIC_DIR)
      --cors-origins <list> Comma-separated CORS origins  (env: CORS_ORIGINS)
  -h, --help                Show this help and exit
  -V, --version             Show version and exit

Precedence: flag > environment variable > default.

Examples:
  drive-coding --port 4100
  drive-coding --opencode-bin /opt/opencode/bin/opencode`
```

**`--help`** (‏אם `values.help`): `console.log(HELP); process.exit(0)`.

**`--version`** (‏אם `values.version`): ‏קרא `version` ‏מ-`package.json`. ‏השתמש ב-`import.meta.dirname` (‏עובד — ‏ראה הערת-תיקון; ‏בבאנדל נפתר ל-`dist/`):

```ts
// release: dist/ → ../package.json (release, 0.1.0)
// dev:     src/bin → ../../package.json (backend, 0.0.0 — מקובל)
const pkgCandidates = [
  path.resolve(import.meta.dirname, "../package.json"),
  path.resolve(import.meta.dirname, "../../package.json"),
]
const pkgPath = pkgCandidates.find(existsSync)
const version = pkgPath
  ? ((JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string }).version ?? "unknown")
  : "unknown"
console.log(version)
process.exit(0)
```

> **‏הערה (r1 finding 🟢)**: ‏בהרצת dev ‏ישירה (`bun src/bin/drive-coding.ts`) ‏`--version` ‏ידפיס `0.0.0` (‏גרסת backend). ‏מהתקנת ה-package — `0.1.0` (‏גרסת release). ‏זה מקובל; DoD #6 ‏בודק מההתקנה.

**‏ולידציית `--port`** (‏finding 🟢 r2): `parseArgs` ‏מחזיר string; ‏ערך לא-מספרי → `Number()` ב-server.ts:143 = NaN → bind שקט לפורט אקראי. ‏אמת לפני המיפוי:

```ts
if (values.port !== undefined && !/^\d+$/.test(values.port as string)) {
  console.error(`[drive-coding] invalid --port "${values.port as string}" (expected a number)\n`)
  console.error(HELP)
  process.exit(1)
}
```

**‏מיפוי flag → env** (‏אחרי help/version + ‏ולידציה, ‏**‏לפני** ‏חישוב feBuildDir + ה-`??=`):

```ts
if (values.port)             process.env.PORT = values.port as string
if (values["opencode-bin"])  process.env.OPENCODE_BIN = values["opencode-bin"] as string
if (values["fe-static-dir"]) process.env.FE_STATIC_DIR = values["fe-static-dir"] as string
if (values["cors-origins"])  process.env.CORS_ORIGINS = values["cors-origins"] as string
```

‏שאר ה-bin (‏חישוב feBuildDir, `??=`, preflight, `import("../server.js")`) ‏ללא שינוי.

**‏קבצים שמשתנים**: `packages/release/README.md` + `README.he.md` — ‏הוסף סעיף "CLI flags" ‏עם טבלה מקבילה ל-env vars (‏ב-README.he.md ‏שמרי RLM ‏בשורות שמתחילות בלועזית).

**Verification (bash — ‏עם env נקי!):**

```bash
cd packages/release && node scripts/build.mjs && npm pack
TMP=/tmp/dc-flagtest && rm -rf "$TMP" && mkdir "$TMP" && cd "$TMP"
bun init -y >/dev/null && bun add "$OLDPWD/drive-coding-0.1.0.tgz"
RUN() { env -u FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN "$@"; }

RUN bun x drive-coding --help;    echo "help exit: $?"      # usage, exit 0
RUN bun x drive-coding --version; echo "ver  exit: $?"      # 0.1.0, exit 0
RUN bun x drive-coding --bogus;   echo "bogus exit: $?"     # err+help, exit 1

# flag דורס + מאזין: --port
RUN bun x drive-coding --port 4571 > b.log 2>&1 &
sleep 5; curl -s -o /dev/null -w "port-flag → %{http_code}\n" http://localhost:4571/   # 200
pkill -f drive-coding; sleep 1

# precedence flag > env: PORT=4572 env אבל --port 4573
RUN env PORT=4572 bun x drive-coding --port 4573 > b2.log 2>&1 &
sleep 5
curl -s -o /dev/null -w "4573(flag) → %{http_code}\n" http://localhost:4573/   # 200
curl -s -o /dev/null -w "4572(env)  → %{http_code}\n" http://localhost:4572/   # 000
pkill -f drive-coding
```

---

## §5 — DoD verifiable (bash; ‏server ברקע = `run_in_background`; ‏**‏תמיד `env -u FE_STATIC_DIR ...`** ‏בבדיקות install)

| # | ‏בדיקה | ‏איך |
|---|------|------|
| 1 | typecheck + tests | `pnpm typecheck && pnpm test` |
| 2 | lint + i18n | `pnpm lint && pnpm lint:i18n` (‏help באנגלית) |
| 3 | fixtures ‏מוחרגים | `npm pack --dry-run \| grep -c fixtures/` = 0 |
| 4 | ‏regression: ‏install נקי עדיין מגיש FE | env נקי, install, `curl :PORT/` = 200 ‏מ-`frontend-dist` ‏הארוז |
| 5 | `--help` | usage, exit 0 |
| 6 | `--version` | `0.1.0`, exit 0 (‏מההתקנה) |
| 7 | flag ‏לא מוכר | ‏שגיאה + help, exit 1 |
| 8 | `--port` ‏עובד + ‏דורס env | ‏מאזין על port ‏של ה-flag, ‏לא ה-env |
| 9 | dev path ‏לא נשבר | `bun packages/backend/src/bin/drive-coding.ts` ‏עדיין מגיש FE |
| 10 | API חי מההתקנה | `curl :PORT/api/agents` = 200 |
| 11 | `--port abc` ‏נדחה | ‏שגיאה + help, exit 1 (‏לא bind שקט) |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|------|------|----------|
| **‏תוצאות-שווא בבדיקה ‏בגלל env מזוהם** (‏הלקח מ-r1!) | ‏ה-session מייצא FE_STATIC_DIR/CORS/OPENCODE_BIN | ‏**‏כל** ‏בדיקת install ‏עם `env -u FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN`. ‏זה כתוב ב-§0/§4/§5. |
| ‏הסרת fixtures שוברת dev | build.mjs | ‏ההסרה ‏רק מ-`releaseFrontendDist`, ‏לא מ-`packages/frontend/build`. ‏DEV-only (import.meta.env.DEV). Commit 0 verification ‏מאמת dev intact. |
| ‏`--fe-static-dir` ‏flag לא דורס בגלל `??=` | bin ‏סדר | §3 + §4: ‏מיפוי flags **‏לפני** ‏ה-`??=`. executor ‏מוודא בקריאת-קוד. |
| `parseArgs` strict זורק על unknown | node:util | try/catch → help + exit 1 (DoD #7). |
| `bun x` ‏מריץ עותק שגוי מ-cache | bun resolution | ‏אם feStaticDir ‏לא מצביע על ה-install ‏של ה-temp — ‏הרץ `./node_modules/.bin/drive-coding` ‏ישירות. |
| Hardcoded Hebrew ‏ב-help | i18n hook | ‏כל הטקסט באנגלית. |

---

## §7 — Escalation triggers

> ‏אם X — ‏עצור ושאל את מרדכי:

- ‏אחרי החרגת fixtures, ‏ה-FE לא נטען מהתקנה נקייה (‏עם env ‏נקי) — ‏ה-fixtures היו דרושים ב-prod (‏מנוגד למיפוי).
- `parseArgs` ‏לא זמין ב-runtime (‏לא אמור — node≥22.5 + bun).
- ‏רוצה config-file ‏ממשי / publish / ‏לגעת ב-FE path resolution — ‏מחוץ ל-scope.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|------|------|
| ‏מנגנון חדש (CLI arg parsing, help/version) | +2 |
| >2 ‏files (bin, build.mjs, README ×2) | +1 |
| ‏Cross-platform (fs) | +1 |
| ‏ספרייה/כלי חיצוני חדש | 0 (built-in) |
| ‏אין blocker / ‏אין refactor מסוכן | 0 |

**Score**: 4/10 → `calev` (light), ‏end-of-slice בלבד (‏אין phase-gate).

> **‏לכלב**: ‏בדיקות install **‏חייבות** `env -u FE_STATIC_DIR -u CORS_ORIGINS -u OPENCODE_BIN`. ‏בלי זה — ‏ה-env של ה-session מזהם את התוצאה (‏זה מה שיצר "blocker" מדומה ב-r1).

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|------|----------|------|
| 1 | ‏אילו flags? | `--port`, `--opencode-bin`, `--fe-static-dir`, `--cors-origins`, `--help`, `--version`. ‏debug envs (`LOG_WIRE`/`WIRE_RECORD`) ‏נשארים env-only. | ❌ |
| 2 | short flags | `-p`/`-h`/`-V` ‏בלבד. | ❌ |
| 3 | `--version` ‏מקור | `package.json` ‏יחסית ל-`import.meta.dirname` (‏עובד). | ❌ |

> ‏אין שאלה חוסמת.

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה ‏מה-brief ‏ולמה.

- (‏אין עדיין)

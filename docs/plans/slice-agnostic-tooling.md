# Slice agnostic-tooling — סקריפטים PM/runtime-אגנוסטיים — תוכנית

> **תאריך**: 2026-07-08
> **סטטוס**: טיוטה
> **Complexity**: 3/10 (verifier: light)
> **תלות**: אין (`depends_on: []`). מבוסס על שכבת-ה-install הbun-native שכבר על dev (codex-acp→npm, `cce234c`).

## §0 — Pre-flight

### Worktree
```bash
cd /home/user/Projects/drive-coding/dev
git worktree add ../.worktrees/agnostic-tooling -b slice/agnostic-tooling dev
cd ../.worktrees/agnostic-tooling
bun install          # ‏השרת bun-only — install דרך bun, לא pnpm
```
> ‏branch: `slice/agnostic-tooling` | dir: `.worktrees/agnostic-tooling` (בלי קידומת `slice/`).
> ‏**אין `pnpm install`** — הסביבה bun-only. `bun install` קורא את `bun.lock` הקיים.

### Run (‏אחרי השינוי — ‏זה בדיוק ה-DoD)
- ‏Build הכל: `bun run build`
- ‏Dev הכל (parallel): `bun run dev`  (‏BE על 4000 + FE Vite)
- ‏Build FE בלבד (atomic): `bun run fe:build`
- ‏Launch (build-if-stale + BE): `bun run start`

### ‏סביבה
- ‏`bun` ב-`~/.bun/bin`, ‏גרסה 1.3.14. ‏**אין `pnpm`, ‏אין `node` אמיתי** ב-PATH.
- ‏מתחת ל-`bun run <script>`, ‏bun מזריק **shim** ‏של `node` (‏symlink→bun) ל-PATH הזמני → ‏`node foo.mjs` ‏בתוך סקריפט **עובד** (‏מריץ bun). ‏אומת: `bun run fe:build` ‏הגיע ל-`node scripts/dc-build-fe.mjs` ‏והדפיס פלט.

### Reading list
**must-read לפני**:
- `AGENTS.md` §Stack §Commands — ‏להבין ש-BE רץ על bun (`bun --watch src/server.ts`) ‏ו-FE על vite.
- ‏הקובץ הזה §4 (‏Commits) — ‏החתימה של `scripts/pm.mjs`.

**reference**:
- `scripts/dc-launch.mjs` · `scripts/dc-build-fe.mjs` — ‏הקבצים שמשתנים.
- `scripts/lint-no-hebrew-in-code.test.mjs` — ‏סגנון-בית לטסט (vitest, `.test.mjs`).
- `scripts/vitest.config.ts` — ‏**‏כאן** ‏יושב `include: ["*.test.mjs"]` (`name:"scripts"`); ‏ה-root `vitest.config.ts` ‏רק **‏מפנה** אליו דרך `projects: [..., "scripts"]`. ‏לכן `pm.test.mjs` ‏נלכד אוטומטית ב-`bun run test` (‏אל תחפש `include` ב-root — ‏הוא לא שם).

---

## §1 — מטרה

‏על שרת **bun-only** (‏אין pnpm/node), ‏ארבע הפקודות `bun run build`, `bun run dev`,
‏`bun run fe:build`, ‏`bun run start` ‏עובדות end-to-end. ‏היום כולן קורסות כי הן כבולות
‏ל-`pnpm`/`node` literals (`pnpm -r run build`, ‏`node scripts/...`). ‏הפתרון: **בורר-אחד**
‏`scripts/pm.mjs` ‏שמזהה את מנהל-החבילות (‏דרך `npm_config_user_agent`) ‏ואת ה-runtime
‏(‏דרך `process.execPath`), ‏וכל סקריפט קורא לו במקום literals. ‏התוצאה: ‏אותם סקריפטים
‏רצים זהה תחת **bun** (‏שרת) ‏ותחת **pnpm** (‏מכונת-פיתוח), ‏בלי לשכפל לוגיקה.

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏4 הסקריפטים ב-DoD (`build`/`dev`/`fe:build`/`start`) + ‏`pm.mjs` ‏חדש | ✅ | ‏הסלייס הזה |
| ‏`dc-launch.mjs` + ‏`dc-build-fe.mjs` (‏literals פנימיים) | ✅ | ‏הסלייס הזה |
| ‏`scripts/bump-version.mjs` (‏טקס-מיזוג, ‏מכונת-dev בלבד, ‏pure `node:fs`) | ❌ | ‏out-of-scope — ‏רץ ידנית ע"י מרדכי על dev; ‏לא בפני-השטח `bun run` |
| ‏`packages/release` (`node scripts/build.mjs`, ‏npm-publish) | ❌ | ‏out-of-scope — ‏publish על מכונת-dev |
| ‏הסרת `packageManager`/`engines.pnpm` מ-root package.json | ❌ | ‏לא נוגעים — ‏שומר תאימות pnpm על dev; ‏bun מתעלם מהשדות ב-`run` |
| ‏המרת lockfiles / ‏שינוי install | ❌ | ‏כבר bun-native (`cce234c` על dev) |

## §3 — Architecture

```
package.json (root) scripts
  ├─ build     → node scripts/pm.mjs run-all build           ← משתנה
  ├─ dev       → node scripts/pm.mjs run-all-parallel dev     ← משתנה
  ├─ fe:build  → node scripts/dc-build-fe.mjs                 (‏string בלי שינוי)
  └─ start     → node scripts/dc-launch.mjs                   (‏string בלי שינוי)

scripts/pm.mjs                 ← חדש (‏בורר: detect + arg-builders + CLI)
   ├─ detectPm(ua?)            → "bun" | "pnpm" | "npm" | "yarn"
   ├─ runAllArgs(script,{parallel})   → [cmd, args[]]
   ├─ runFilterArgs(pkg,script)       → [cmd, args[]]
   └─ CLI: run-all | run-all-parallel | run-filter
scripts/pm.test.mjs            ← חדש (‏vitest, ‏arg-builders טהורים)
   └─ נלכד ע"י scripts/vitest.config.ts (include:["*.test.mjs"]) → רץ ב-`bun run test`

scripts/dc-build-fe.mjs        ← משתנה: execFileSync("pnpm",...) → runFilterArgs(...)
scripts/dc-launch.mjs          ← משתנה: execFileSync("node",...) → process.execPath
                                  spawn("bun", binEntry) ← נשאר literal (‏BE חייב bun)
```

## §4 — Commits

### Commit 0 — `scripts/pm.mjs` + טסט (approach: TDD)

**קבצים חדשים**:
- `scripts/pm.mjs`
- `scripts/pm.test.mjs`

**API skeleton** (`scripts/pm.mjs`):
```js
// @ts-check
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

/** @typedef {"bun"|"pnpm"|"npm"|"yarn"} Pm */

/**
 * מזהה את מנהל-החבילות מ-`npm_config_user_agent` (‏שכל PM מזריק).
 * ‏דוגמאות: "bun/1.3.14 npm/? node/v24 ..." · "pnpm/10.0.0 npm/? node/v22 ...".
 * ‏fallback: ‏runtime bun → "bun", ‏אחרת "pnpm" (‏ברירת-מחדל היסטורית של הפרויקט).
 * @param {string} [ua]
 * @returns {Pm}
 */
export function detectPm(ua = process.env.npm_config_user_agent ?? "") {
  if (ua.startsWith("bun")) return "bun"
  if (ua.startsWith("pnpm")) return "pnpm"
  if (ua.startsWith("yarn")) return "yarn"
  if (ua.startsWith("npm")) return "npm"
  return process.versions.bun ? "bun" : "pnpm"
}

/**
 * ‏[cmd, args] ‏להרצת `script` ‏בכל חבילות ה-workspace (‏מדלג על חבילה בלי הסקריפט).
 * @param {string} script
 * @param {{ parallel?: boolean, pm?: Pm }} [opts]
 * @returns {[string, string[]]}
 */
export function runAllArgs(script, { parallel = false, pm = detectPm() } = {}) {
  switch (pm) {
    case "bun":  return ["bun", ["run", "--filter", "*", script]]           // bun מריץ filtered במקביל
    case "pnpm": return ["pnpm", parallel ? ["-r", "--parallel", "run", script] : ["-r", "run", script]]
    case "yarn": return ["yarn", ["workspaces", "foreach", "-A", ...(parallel ? ["-pi"] : []), "run", script]]
    default:     return ["npm", ["run", script, "--workspaces", "--if-present"]]
  }
}

/**
 * ‏[cmd, args] ‏להרצת `script` ‏בחבילת-workspace יחידה (‏לפי שם מלא, e.g. "@drive-coding/frontend").
 * ‏**‏מניח שהחבילה-היעד מכילה את הסקריפט.** ‏שלא כמו `runAllArgs("*")` ‏(‏שמדלג בחן על חבילה
 * ‏חסרת-סקריפט), ‏`bun run --filter <single-pkg> <missing-script>` ‏נכשל: `No packages matched` → exit 1.
 * ‏בסלייס זה נקרא רק על `@drive-coding/frontend build` ‏שקיים → ‏בטוח.
 * @param {string} pkg
 * @param {string} script
 * @param {Pm} [pm]
 * @returns {[string, string[]]}
 */
export function runFilterArgs(pkg, script, pm = detectPm()) {
  switch (pm) {
    case "bun":  return ["bun", ["run", "--filter", pkg, script]]
    case "pnpm": return ["pnpm", ["--filter", pkg, script]]
    case "yarn": return ["yarn", ["workspace", pkg, "run", script]]
    default:     return ["npm", ["run", script, "--workspace", pkg]]
  }
}

/**
 * ‏spawn סינכרוני, ‏stdio inherit; ‏מחזיר exit code (‏זורק על ENOENT).
 * @param {string} cmd
 * @param {string[]} args
 * @param {import("node:child_process").SpawnSyncOptions} [opts]
 * @returns {number}
 */
export function runPm(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts })
  if (r.error) throw r.error
  return r.status ?? 0
}

// --- CLI: `pm.mjs <verb> ...` ---
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  const [verb, a, b] = process.argv.slice(2)
  /** @type {[string, string[]] | undefined} */
  let plan
  if (verb === "run-all") plan = runAllArgs(a)
  else if (verb === "run-all-parallel") plan = runAllArgs(a, { parallel: true })
  else if (verb === "run-filter") plan = runFilterArgs(a, b)
  if (!plan) {
    console.error(`pm.mjs: unknown verb '${verb}' (run-all | run-all-parallel | run-filter)`)
    process.exit(1)
  }
  process.exit(runPm(plan[0], plan[1]))
}
```

**טסט** (`scripts/pm.test.mjs`) — ‏arg-builders טהורים, ‏PM מוזרק במפורש (‏לא תלוי-env):
```js
// @ts-check
import { describe, expect, it } from "vitest"
import { detectPm, runAllArgs, runFilterArgs } from "./pm.mjs"

describe("detectPm", () => {
  it("bun UA → bun",  () => expect(detectPm("bun/1.3.14 npm/? node/v24 linux x64")).toBe("bun"))
  it("pnpm UA → pnpm",() => expect(detectPm("pnpm/10.0.0 npm/? node/v22 linux x64")).toBe("pnpm"))
  it("npm UA → npm",  () => expect(detectPm("npm/10.0.0 node/v22 linux x64")).toBe("npm"))
  it("empty UA → runtime fallback", () =>
    expect(detectPm("")).toBe(process.versions.bun ? "bun" : "pnpm"))
})

describe("runAllArgs", () => {
  it("bun → filter '*'",  () => expect(runAllArgs("build", { pm: "bun" })).toEqual(["bun", ["run", "--filter", "*", "build"]]))
  it("pnpm seq → -r run", () => expect(runAllArgs("build", { pm: "pnpm" })).toEqual(["pnpm", ["-r", "run", "build"]]))
  it("pnpm parallel → -r --parallel", () =>
    expect(runAllArgs("dev", { parallel: true, pm: "pnpm" })).toEqual(["pnpm", ["-r", "--parallel", "run", "dev"]]))
})

describe("runFilterArgs", () => {
  it("bun",  () => expect(runFilterArgs("@drive-coding/frontend", "build", "bun")).toEqual(["bun", ["run", "--filter", "@drive-coding/frontend", "build"]]))
  it("pnpm", () => expect(runFilterArgs("@drive-coding/frontend", "build", "pnpm")).toEqual(["pnpm", ["--filter", "@drive-coding/frontend", "build"]]))
})
```

**Verification**:
```bash
bun run test 2>&1 | grep -E "pm\.test|scripts"      # ‏הטסט החדש עובר
node scripts/pm.mjs run-filter @drive-coding/core build   # ‏CLI חי → core נבנה (exit 0)
```

### Commit 1 — ‏אימוץ הבורר בסקריפטים (approach: manual + live)

**קבצים שמשתנים**:

1. **`package.json` (root)** — ‏שתי שורות בלבד:
   ```diff
   -    "dev": "pnpm -r --parallel run dev",
   +    "dev": "node scripts/pm.mjs run-all-parallel dev",
   -    "build": "pnpm -r run build",
   +    "build": "node scripts/pm.mjs run-all build",
   ```
   > ‏`start`/`fe:build` ‏**‏לא משתנים** ב-package.json (‏נשארים `node scripts/...`; ‏ה-`node` עובד דרך ה-shim / ‏node אמיתי). ‏השינוי הפנימי שלהם בקבצים למטה.

2. **`scripts/dc-build-fe.mjs`** — ‏החלפת ה-`pnpm` ‏הפנימי (‏החסם האמיתי, ‏שורה ~77):
   ```diff
   -import { execFileSync } from "node:child_process"
   +import { execFileSync } from "node:child_process"
   +import { runFilterArgs, runPm } from "./pm.mjs"
   ...
   -  execFileSync("pnpm", ["--filter", "@drive-coding/frontend", "build"], {
   -    stdio: "inherit",
   -    cwd: repoRoot,
   -    env: { ...process.env, FE_BUILD_OUT: ".build-staging" },
   -  })
   +  const [cmd, args] = runFilterArgs("@drive-coding/frontend", "build")
   +  const code = runPm(cmd, args, {
   +    cwd: repoRoot,
   +    env: { ...process.env, FE_BUILD_OUT: ".build-staging" },
   +  })
   +  if (code !== 0) throw new Error(`[dc-build-fe] FE build failed (exit ${code})`)
   ```
   > ‏`FE_BUILD_OUT` ‏חייב להישאר ב-env → ‏מגיע לתסריט-בנייה של frontend דרך ההרשה (‏vite קורא אותו). ‏`execFileSync("git", ...)` ‏בחישוב-הגרסה **‏נשאר** (‏git זמין).

3. **`scripts/dc-launch.mjs`** — ‏שני שינויים:
   ```diff
   -execFileSync("node", [dcBuildFe, "--if-stale"], { stdio: "inherit", cwd: repoRoot })
   +execFileSync(process.execPath, [dcBuildFe, "--if-stale"], { stdio: "inherit", cwd: repoRoot })
   ```
   > ‏`process.execPath` = ‏ה-runtime הנוכחי (bun על השרת, node על dev) → ‏מריץ את תסריט-הבנייה באותו runtime, ‏בלי לדרוש `node` ב-PATH.
   >
   > **`spawn("bun", [binEntry, ...])` ‏(שורה ~23) ‏נשאר literal `"bun"` — ‏בכוונה.** ‏ה-BE bin הוא `#!/usr/bin/env bun` ‏ומשתמש ב-`Bun.*` ‏ב-`server.ts` → ‏חייב runtime bun תמיד, ‏ללא תלות במי ששיגר את ה-wrapper. ‏(‏אם היינו משתמשים ב-`process.execPath` ‏ומריצים תחת pnpm/node — ‏ה-BE היה קורס.) ‏`bun` ‏מותקן ‏גם על dev (‏ה-BE כבר רץ `bun --watch` ‏שם).

**Verification** (‏חי, ‏על bun-only):
```bash
bun run build      # ‏כל החבילות נבנות, exit 0 (‏בלי "pnpm: command not found")
bun run fe:build   # [dc-build-fe] done — build/ updated
bun run start &    # ‏build-if-stale (‏מדלג אם עדכני) → BE עולה על 4000
sleep 4 && curl -sf localhost:4000/api/health >/dev/null && echo "BE OK"; kill %1
timeout 12 bun run dev   # ‏BE + FE שניהם מתחילים (‏עד timeout — dev לא יוצא)
```

## §5 — DoD

| ‏בדיקה | ‏איך |
|---|---|
| `bun run build` ‏עובד end-to-end | ‏רץ עד exit 0, ‏בלי `pnpm: command not found`; ‏`packages/frontend/build/index.html` ‏קיים |
| `bun run fe:build` ‏עובד | ‏מדפיס `[dc-build-fe] done`; ‏swap אטומי הצליח (build/ ‏מעודכן) |
| `bun run start` ‏עובד | ‏BE עולה על 4000; ‏`curl localhost:4000/api/health` → 200 |
| `bun run dev` ‏עובד | ‏BE **‏ו**-FE שניהם מתחילים במקביל (‏לוג של שניהם תוך ~10ש') |
| ‏טסט הבורר עובר | `bun run test` — ‏`pm.test.mjs` ‏ירוק, **‏בלי כשל *‏חדש* שהסלייס גרם**. ⚠️ **‏ה-suite לא-ירוק ב-baseline** (‏לא קשור לסלייס — ‏הסלייס נוגע רק בסקריפטי-תשתית, ‏אפס קוד תחת-טסט). ‏**‏אל תפעל לפי מונה קבוע** — ‏במקום זה: (‏א) **‏לפני** ‏כל שינוי, ‏על ה-tip הנקי, ‏הרץ `bun run test 2>&1 \| tail -5` ‏ושמור את שורות ה-`Test Files … failed` / `Tests … failed` ‏כ-baseline; (‏ב) ‏אחרי השינוי — ‏אותו מונה בדיוק. ‏הכשלים ה-pre-existing הידועים (‏environmental, ‏**‏לא לגעת, ‏לא לחקור**): `http-options.test.ts` (`os.tmpdir()`/hardcoded-`/tmp`) · `formatting.test.ts` ("‏לפני 2 דקות" he) · `https-serve.test.ts` (‏מקודד-קשיח נתיב Windows `D:/…bun.exe` → ‏`ENOENT posix_spawn` ‏על linux; ‏Windows-only, ‏same-class כמו spawn-ENOENT known-bug ב-roadmap). ‏הפלט יראה `Test Files 3 failed` + traceback של `D:/…bun.exe` — ‏**‏זה ה-baseline, ‏לא רגרסיה שלך.** |
| ‏אין רגרסיה ל-typecheck | `bun run typecheck` — exit 0 |
| ‏i18n hook | `bun run lint:i18n` — ‏אין עברית בקוד (‏הערות מותרות) |
| **pnpm-parity (‏לא-נבדק כאן)** | ‏על מכונה עם node+pnpm: ‏`pnpm run build`/`dev`/`fe:build`/`start` ‏עדיין עובדים (‏אותו `pm.mjs` ‏מזהה pnpm) — ‏**‏לאימות ידני על dev**, ‏אי-אפשר על שרת bun-only |

## §6 — Risks

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏`bun run --filter '*' build` ‏לא שומר סדר טופולוגי (core לפני frontend) | ‏חשש-בנייה | ‏**‏אומת חי**: `bun run --filter '*' build` ‏רץ ירוק end-to-end (‏tsc `--build` + ‏vite פותרים deps מהמקור). ‏אם ייכשל — ‏escalate |
| ‏`FE_BUILD_OUT` ‏לא מגיע ל-vite דרך `runPm` | ‏regression atomic-build | ‏מועבר ב-`env` ‏ל-`spawnSync` → ‏מוריש לתהליך-הבן; ‏בדיקת-DoD `bun run fe:build` ‏מוודאת swap |
| ‏החלפת `spawn("bun")` ‏ב-execPath בטעות | ‏regression — ‏BE קורס תחת node | ‏מסומן מפורשות ב-Commit 1: ‏**‏לא לגעת** ב-`spawn("bun")` |
| ‏הסתמכות על bun node-shim ל-`node scripts/pm.mjs` | ‏שבירות | ‏אומת: ‏ה-shim פעיל תחת `bun run` (`fe:build` ‏הדפיס פלט). ‏על node אמיתי — ‏`node` ‏אמיתי. ‏שני המקרים מכוסים |
| ‏עברית ב-`pm.mjs`/`pm.test.mjs` ‏חוסמת pre-commit | learnings (‏i18n hook) | ‏קוד+הודעות באנגלית בלבד; ‏הערות עברית מותרות. ‏`bun run lint:i18n` ‏ב-DoD |

## §7 — Escalation triggers

- ‏`bun run --filter '*' build` ‏נכשל בסדר-בנייה (‏frontend לפני core) → ‏עצור, ‏שאל מרדכי (‏אולי צריך `-r` topo-safe פר-PM).
- ‏`bun run dev` ‏לא מריץ את שני התהליכים במקביל (‏רק אחד) → ‏עצור (‏אולי `--filter '*' dev` ‏סדרתי ב-bun).
- ‏ה-BE bin לא עולה תחת `bun run start` ‏למרות `spawn("bun")` → ‏בעיה מחוץ ל-scope (‏install/boot), ‏escalate.

## §8 — Complexity score

- ‏commits: 2 (‏נמוך)
- ‏שכבות חדשות: 1 (`scripts/pm.mjs`) (‏נמוך)
- ‏APIs חיצוניים: 0
- ‏streaming/async: 0
- ‏state-model refactor: 0
- ‏protocol BE↔FE: 0

**Score: 3/10 → verifier: light (`calev`).**

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏לתמוך ב-yarn? | ‏כן, ‏best-effort (‏זול — ‏עוד `case`); ‏לא נבדק חי | ❌ |
| 2 | ‏להסיר `packageManager: pnpm` ‏מ-root? | ‏לא — ‏שומר dev; ‏bun מתעלם ב-`run` | ❌ |
| 3 | ‏לתקן גם `bump-version.mjs`/`release`? | ‏לא — ‏out-of-scope (‏dev-only, ‏pure fs) | ❌ |

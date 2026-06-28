# Slice — binary-dist: cross-compile + flags + GitHub Releases — תוכנית

> **תאריך:** 2026-06-27 · **סטטוס:** brief טיוטה — **טרם אביגיל סופית** (ראה אזהרה למטה)
> **Complexity:** 6/10 (calev-heavy — בינארי פר-platform)
> **depends_on:** [binary-core] — מרחיב את `build-binary.mjs` ואת ה-bin שנוצרו שם
> **Base:** `slice/binary-core` (שרשור)
> **רקע:** `docs/plans/slice-single-binary-prebrief.md` §5 + §6.1 (flags audit).

> ⚠️⚠️ **חובה — אימות אביגיל מחודש לפני dispatch:**
> brief זה נכתב על בסיס `binary-core` ש**טרם בוצע**. כל ה-claims על קבצים/symbols שהוא יוצר
> (`build-binary.mjs`, `bin/drive-coding.ts` flags, `isBinary()`, `__IS_BINARY__`) הם **מתוכננים
> ולא מאומתים מול קוד**. אביגיל הראשונה (עכשיו) בודקת רק את החלקים המבוססים על dev הנוכחי
> (flags audit מול env, CLI_SPECS). **אחרי ש-`binary-core` מבוצע ומוזג — מרדכי חייב להריץ
> אביגיל מחדש** על brief זה מול הקוד בפועל, לעדכן line-numbers/symbols, ורק אז dispatch.
> plan-gate על binary-dist = READY מהאימות **המחודש**, לא מהראשון.

---

## §0 — Pre-flight

### Worktree (שרשור על binary-core)
```bash
cd d:\UserProjects\AI\drive-coding\dev
git worktree add .worktrees/binary-dist -b slice/binary-dist slice/binary-core
cd .worktrees/binary-dist
pnpm install && pnpm hooks:install
```

### סביבה
**Windows / PowerShell.** `bun` 1.3.12. cross-compile מ-Windows ל-linux/mac נתמך (`--target`).
GitHub: `gh` CLI. בדיקת בינארי linux — דרך `ssh cli-agents` (drive-coding פרוס שם).

### איך להריץ
- **build כל ה-targets:** `node packages/release/scripts/build-binary.mjs --all` (מורחב מ-binary-core).
- **flags:** `drive-coding --help` (מורחב), `drive-coding --state-dir <p> --log-level debug`.
- **release:** `gh release create` / workflow.

### Reading list (must-read — **לאמת מחדש אחרי binary-core**)
- `packages/release/scripts/build-binary.mjs` — מ-binary-core (compile target יחיד → להרחיב ל-loop).
- [`packages/backend/src/bin/drive-coding.ts:11-88`](../../packages/backend/src/bin/drive-coding.ts) — `HELP` + `parseArgs` (4 flags קיימים → להוסיף).
- `docs/plans/slice-single-binary-prebrief.md` §6.1 — טבלת ה-flags audit.
- [`packages/backend/src/acp/cli-config.ts:76`](../../packages/backend/src/acp/cli-config.ts) (`OPENCODE_ARGS`), `cli-config-file.ts` (`CLI_SPECS_FILE`), [`http-history.ts:139`](../../packages/backend/src/delivery/http-history.ts) (`FS_BROWSE_ALLOWED_BASE`), [`core/log/config.ts`](../../packages/core/src/log/config.ts) (`LOG_LEVEL`/`LOG_NS`/`LOG_FORMAT`).
- `paths.ts` (state-dir) — `getStateDir()` (ל-`--state-dir` override).

---

## §1 — מטרה

הבינארי מופץ: (א) נבנה ל-3 פלטפורמות (`bun-windows-x64`, `bun-linux-x64`, `bun-darwin-arm64`);
(ב) כל env var של production נחשף גם כ-flag (audit §6.1); (ג) GitHub Releases מעלה את הבינארים.
משתמש קצה מוריד בינארי לפלטפורמה שלו, מריץ, ושולט בכל הקונפיג דרך flags או env.

---

## §2 — Scope

| פיצ'ר | כן/לא |
|------|------|
| `build-binary.mjs` per-target loop (win-x64, linux-x64, darwin-arm64) | ✅ |
| flags חדשים: `--state-dir`, `--cli-specs`, `--log-level`, `--fs-browse-base`, `--opencode-args` | ✅ |
| `getStateDir()` מכבד `--state-dir`/`DRIVE_CODING_STATE` (override) | ✅ |
| עדכון `HELP` + audit table מלא (flag/env-only/both) | ✅ |
| GitHub Releases — workflow או script (`gh release create`) | ✅ |
| CLI detection (אילו CLIs מותקנים) | ❌ — הוצא לפרויקט provider (27/06) |
| `bytecode`/`--minify` | 🟡 nice-to-have (§9 Q2) |
| npm publish של ה-bunx package | ❌ — נפרד (release-publish ישיר) |

---

## §3 — Architecture

```
build-binary.mjs --all:
  for t in [bun-windows-x64, bun-linux-x64, bun-darwin-arm64]:
    bun build --compile --target=$t --define __IS_BINARY__=true \
      --asset-naming="[dir]/[name].[ext]" <bin> \
      --outfile dist/drive-coding-$t[.exe]

bin/drive-coding.ts (HELP + parseArgs מורחב):
  --state-dir → DRIVE_CODING_STATE → getStateDir() override
  --cli-specs → CLI_SPECS_FILE
  --log-level → LOG_LEVEL ; --fs-browse-base → FS_BROWSE_ALLOWED_BASE
  --opencode-args → OPENCODE_ARGS

paths.ts: getStateDir() = process.env.DRIVE_CODING_STATE ?? join(getHomeDir(), ".config", "drive-coding")

GitHub Releases: gh release create v<ver> dist/drive-coding-*  (workflow .github/ או script)
```

---

## §4 — Commits (טיוטה — לאמת אחרי binary-core)

### Commit 0 — flags audit + HELP (approach: integration)
הוספת flags ל-`parseArgs` + מיפוי ל-env (אחרי ה-4 הקיימים), עדכון `HELP`. כל flag → `process.env.X ??=`.
`--state-dir` → `process.env.DRIVE_CODING_STATE`. עדכון `paths.ts:getStateDir()` לכבד אותו.
**Verification:** `integration` — `drive-coding --log-level debug --state-dir /tmp/x` → state ב-/tmp/x, לוג debug. `--help` מציג הכל.

### Commit 1 — build-binary per-target loop (approach: manual)
`build-binary.mjs` → loop על 3 targets, `--outfile dist/drive-coding-<target>`.
**Verification:** `manual` — `node build-binary.mjs --all` → 3 קבצים; הרצת win מקומית, הרצת linux דרך `ssh cli-agents`.

### Commit 2 — GitHub Releases (approach: manual)
script/workflow: `gh release create v<ver> dist/drive-coding-*` (+ checksums).
**Verification:** `manual` — dry-run / release ל-tag בדיקה.

---

## §5 — DoD verifiable (טיוטה)

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + lint:i18n | `pnpm typecheck; pnpm lint:i18n` |
| 2 | כל env של production יש flag (או env-only מתועד) | audit table ב-§6.1 prebrief — כל שורה מסומנת |
| 3 | `--state-dir` override עובד | `drive-coding --state-dir /tmp/x` → recordings ב-/tmp/x |
| 4 | `--help` מציג את כל ה-flags | `drive-coding --help` |
| 5 | 3 בינארים נבנים | `node build-binary.mjs --all` → 3 קבצים |
| 6 | בינארי linux רץ (cross-compile) | `ssh cli-agents` → הרצה → GET / = 200 |
| 7 | GitHub Release מעלה בינארים | `gh release view` |

---

## §6 — Risks + mitigations (טיוטה)

| סיכון | מיטיגציה |
|------|----------|
| cross-compile linux/mac נכשל מ-Windows | `--target` נתמך (docs); אם נכשל — build על cli-agents (linux) או CI |
| flag override שובר env precedence קיים | לשמור על `??=` (flag > env > default), כמו ה-4 הקיימים |
| `--state-dir` לא מכובד ע"י cli-config-file (נטען מוקדם) | לוודא ש-`getStateDir()` הוא single source וקורא env ב-call-time |
| Windows metadata flags (icon) לא ב-cross-compile | לא בשימוש (§9 Q3) |
| **line-numbers/symbols מ-binary-core השתנו** | **אימות אביגיל מחודש (אזהרה בראש)** |

---

## §7 — Escalation triggers
- cross-compile נכשל גם על cli-agents — עצור.
- flag חדש דורש שינוי עמוק ב-server/core מעבר ל-env mapping — עצור.
- binary-core שינה את ה-bin/build-binary בצורה שמבטלת הנחות brief זה — עצור, דווח (זה בדיוק מה שה-re-verification תופס).

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| cross-compile + per-target build | +2 |
| flags audit (5 flags + env mapping) | +1 |
| CI/Releases | +1 |
| runtime risk (בינארי פר-platform, linux דרך ssh) | +2 |
| מבוסס על binary-core (לא עצמאי) | +1 |
| אין logic חדש מורכב (רובו wiring/config) | -1 |

**Score:** 6/10 → `calev-heavy` (בינארי פר-platform + cross-compile חי).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | אילו targets לבנות? | win-x64, linux-x64, darwin-arm64 (arm64-linux/mac אם יש ביקוש) | ❌ |
| 2 | `--minify --bytecode`? | כן ל-prod (זמן-עליה), אחרי שהבסיס עובד | ❌ |
| 3 | Windows metadata (icon/title)? | לא עכשיו (לא ב-cross-compile) | ❌ |
| 4 | גרסה — מאיפה? | `packages/release/package.json` version (אחיד עם ה-npm package) | ❌ |
| 5 | Release ידני (`gh`) או workflow אוטומטי (`.github/`)? | script ידני קודם; workflow אם יציב | ❌ |

> ⚠️ כל ה-§4/§5/§6 כפופים לאימות מחודש אחרי binary-core (אזהרה בראש).

---

## סטיות מהתכנון (executor ממלא)
- (אין עדיין)

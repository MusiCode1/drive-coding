# Slice — state-dir: תיקיית state מאוחדת `~/.config/drive-coding/` — תוכנית

> **תאריך:** 2026-06-27 · **סטטוס:** brief (טרם אביגיל)
> **Complexity:** 4/10 (calev light)
> **depends_on:** [] — בנוי ישירות על dev
> **Base:** `dev` @ `88d447b`
> **רקע:** `docs/plans/slice-single-binary-prebrief.md` §5.1 (foundation לבינארי). הוכרע 27/06.

---

## §0 — Pre-flight

### Worktree
```bash
cd d:\UserProjects\AI\drive-coding\dev
git worktree add .worktrees/state-dir -b slice/state-dir dev   # branch: slice/state-dir | dir: .worktrees/state-dir
cd .worktrees/state-dir
pnpm install && pnpm hooks:install
```
> FE build חסר ב-worktree חדש (gitignored) — לא רלוונטי כאן (אין FE serving בבדיקות; אם צריך, junction או build).

### סביבה
**Windows / PowerShell.** server ברקע = `run_in_background`. פורט BE 4000 (פנוי? `Get-NetTCPConnection -LocalPort 4000`). `bun` ב-`~/.bun/bin`.

### איך להריץ
- **Tests:** `pnpm test --filter backend` (vitest). **Typecheck:** `pnpm typecheck`. **Lint:** `pnpm lint; pnpm lint:i18n`.
- **server (לאימות ידני):** `cd packages/backend; bun src/server.ts` (port 4000). בדוק ש-`~/.config/drive-coding/` נוצר.

### Reading list (must-read)
- [`packages/backend/src/server.ts`](../../packages/backend/src/server.ts) **שורות 78-117** — 4 ה-`path.resolve("data/...")`: wireRecorder (80), projectsRegistry/cache (84), recordingsStore (85), proxy (104).
- [`packages/backend/src/delivery/http-options.ts:75-77`](../../packages/backend/src/delivery/http-options.ts) — `getHomeDir()` הקיים (`HOME` / `USERPROFILE` / `os.homedir()`).
- [`packages/backend/src/acp/cli-config-file.ts:29`](../../packages/backend/src/acp/cli-config-file.ts) — `join(homedir(), ".config", "drive-coding", "cli-specs.jsonc")` — התקדים הקיים שאליו מתיישרים.
- [`packages/backend/tests/cli-config-file.test.ts`](../../packages/backend/tests/cli-config-file.test.ts) + `http-options.test.ts` — תבנית בדיקת paths (mock env).

---

## §1 — מטרה

כל נתיבי ה-state של ה-BE (recordings, cache, proxy-cache, wire-recordings) מצביעים לתיקייה
**יציבה ואחידה** — `~/.config/drive-coding/` — במקום `data/` יחסית ל-cwd. helper מרכזי אחד
(`getStateDir()`) מאחד את הלוגיקה, מיישר עם `cli-specs.jsonc` שכבר שם, ועובד אחיד בכל
פלטפורמה. זו תשתית ל-`bunx`/בינארי שרצים מ-cwd אקראי (היום מזהמים אותו ב-`data/`).
**חל בכל מצב** (dev + release + binary), לא רק בינארי.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| `getStateDir()` helper (`join(getHomeDir(), ".config", "drive-coding")`) | ✅ | בslice הזה |
| יצירת התיקייה אם חסרה (`mkdirSync recursive`) | ✅ | בslice הזה |
| חיווט 4 הנתיבים ב-server.ts → `getStateDir()` | ✅ | בslice הזה |
| `cli-config-file.ts` משתמש ב-`getStateDir()` (במקום inline) | ✅ | בslice הזה |
| **migration** מ-`data/` ישן | ❌ | אין recordings חיים, cache לא קריטי (הוכרע 27/06) |
| **plugin extraction** (חילוץ prompt-injector) | ❌ | `slice-binary-core` (רלוונטי רק בבינארי) |
| flag `--state-dir` override | ❌ | `slice-binary-dist` (flags audit) — אבל ראה §9 Q2 |
| הבינארי / FE serving / pino | ❌ | slices אחרים |

> ה-`getStateDir()` קורא `getHomeDir()` (env > homedir) — אז `--state-dir`/env override יתווסף בקלות אח"כ.

---

## §3 — Architecture

```
‏היום:                         ‏אחרי:
path.resolve("data/cache")     getStateDir() = <home>/.config/drive-coding
  → <cwd>/data/cache             ├─ cli-specs.jsonc   (קיים)
path.resolve("data/recordings") ├─ cache/  (+ cache/proxy/)
  → <cwd>/data/recordings       ├─ recordings/
path.resolve("data/wire-...")   └─ wire-recordings/
  → <cwd>/data/wire-recordings

‏מקור יחיד: getStateDir()  ← getHomeDir() (env HOME/USERPROFILE > os.homedir)
‏server.ts + cli-config-file.ts ‏שניהם צורכים אותו.
```

---

## §4 — Commits

### Commit 0 — `getStateDir()` helper (approach: tdd)
**קובץ חדש:** `packages/backend/src/paths.ts`:
```ts
import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { getHomeDir } from "./delivery/http-options.js"   // ‏(או העברת getHomeDir לכאן — ראה §9 Q1)

/** ‏תיקיית ה-state היציבה: <home>/.config/drive-coding. אחיד פר-OS. */
export function getStateDir(): string {
  return join(getHomeDir(), ".config", "drive-coding")
}
/** ‏מחזיר נתיב תת-תיקייה תחת ה-state dir, ‏ויוצר אותו אם חסר. */
export function ensureStateSubdir(...segments: string[]): string {
  const p = join(getStateDir(), ...segments)
  mkdirSync(p, { recursive: true })
  return p
}
```
**Verification:** `tdd` — בדיקה (mock `HOME`/`USERPROFILE`): `getStateDir()` מחזיר `<home>/.config/drive-coding`; `ensureStateSubdir("recordings")` יוצר ומחזיר נתיב. ‏על Windows: `USERPROFILE`.

### Commit 1 — חיווט server.ts + cli-config-file (approach: integration)
**משתנים:**
- `server.ts` — 4 ההחלפות:
  - `:80` → `process.env.WIRE_RECORD ? ensureStateSubdir("wire-recordings") : null`
  - `:84` → `createProjectsRegistry(ensureStateSubdir("cache"))`
  - `:85` → `createRecordingsStore(ensureStateSubdir("recordings"))`
  - `:104` → `registerProxyHttp(app, { cacheBaseDir: ensureStateSubdir("cache", "proxy") })`
- `cli-config-file.ts` — שורה 29 → `e.CLI_SPECS_FILE ?? join(getStateDir(), "cli-specs.jsonc")`.
  - **ניקוי imports (finding avigail #1):** הסר `import { homedir } from "node:os"` (שורה 13) ו-`import { join } from "node:path"` (שורה 14 — path's `join` משמש **רק** בשורה 29; ה-`.join` בשורה 47 הוא `Array.prototype.join`). הוסף `import { getStateDir } from "../paths.js"`. בלי זה Biome `noUnusedImports` + `verbatimModuleSyntax` יכשילו lint/typecheck.
  - ⚠️ **ההתנהגות משתנה (finding avigail #2):** `os.homedir()` → `getHomeDir()` (מעדיף `HOME`/`USERPROFILE`). זהה כש-`HOME==os.homedir`, אבל **שונה** במכונה שבה `HOME` מוגדר אחרת (git-bash/onecli — כפי ש-docstring של `getHomeDir` מציין). **עדכן את `cli-config-file.test.ts:33-38`** שמשווה ל-`path.join(os.homedir(), ...)` → להשוות ל-`getStateDir()` (או mock `HOME`/`USERPROFILE` ל-tmpdir, כמו `http-options.test`), **לא** ל-`os.homedir()` ישירות.
**Verification:** `integration` — הרץ `bun src/server.ts`, ודא ש-`~/.config/drive-coding/{cache,recordings}` נוצרו; `GET /api/agents` = 200; `pnpm test --filter backend` ירוק (כולל cli-config-file המעודכן).

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests ירוקים | `pnpm typecheck; pnpm test --filter backend` |
| 2 | lint:i18n עובר | `pnpm lint:i18n` |
| 3 | `getStateDir()` מחזיר `<home>/.config/drive-coding` (Win+POSIX) | unit test עם mock env |
| 4 | server יוצר `~/.config/drive-coding/{cache,recordings}` בעלייה | `bun src/server.ts` → `Test-Path ~/.config/drive-coding/cache` |
| 5 | recordings/proxy נכתבים שם (לא ב-cwd/data) | POST recording → קובץ תחת state dir; `data/` ב-cwd לא נוצר |
| 6 | `cli-specs.jsonc` נטען מ-`getStateDir()` (זהה ל-cwd-home כש-`HOME==os.homedir`) | טסט `cli-config-file.test.ts:33-38` **מעודכן** ל-`getHomeDir()`/`getStateDir()` (לא `os.homedir` ישיר) ועובר. **שים לב: ההתנהגות השתנתה** (finding #2) |
| 7 | אין regression ב-tests של recordings/projects | `pnpm test --filter backend` ירוק. (טסטים אלה מזריקים `tmpdir()` ל-store/registry ולא נוגעים ב-server.ts — לא מושפעים מהשינוי) |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| **טסט `cli-config-file.test.ts:33-38`** משווה ל-`os.homedir()` ישירות → יישבר כש-`HOME != os.homedir` (git-bash/onecli) | finding avigail #2 / `cli-config-file.test.ts:33-38` | עדכן את הטסט להשוות ל-`getStateDir()`/`getHomeDir()`, או mock `HOME`/`USERPROFILE` ל-`tmpdir` (תבנית מ-`http-options.test`) |
| ~~טסטי recordings/projects מניחים `data/`-cwd~~ — **לא נכון** (finding #3) | — | הם מזריקים `tmpdir()` מפורשות ולא נוגעים ב-server.ts. **אל תחפש טסט-`data/` שלא קיים** — רק `cli-config-file` מושפע |
| `getHomeDir` ב-delivery/, import מ-acp/ | cross-folder | בסדר ארכיטקטונית (shell→shell). אם מפריע — §9 Q1 (העברה ל-paths.ts) |
| ריצה ראשונה: התיקייה לא קיימת | mkdir | `ensureStateSubdir` עושה `mkdirSync recursive` — idempotent |
| `import.meta.dirname` / ESM path | — | `join` + `node:path` cross-platform, נבדק ב-cli-config-file הקיים |

---

## §7 — Escalation triggers

- טסט קיים נשבר באופן שמרמז ש-`data/` cwd-relative הוא הנחה עמוקה במקום אחר — עצור, דווח.
- `getHomeDir` מחזיר ריק/לא-צפוי בסביבת CI/test — עצור.
- צריך לגעת ב-`recordings-store`/`projects-registry` internals (לא רק ב-base path) — מחוץ ל-scope.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| helper חדש + 4 call-site swaps | +1 |
| IO (mkdir, נתיבי home) | +1 |
| נוגע ב-server.ts boot path | +1 |
| אין migration, אין data חי | 0 |
| greenfield helper, אין call sites קודמים | -1 |
| cross-platform (Win+POSIX) | +1 |

**Score:** 4/10 → `calev` (light).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | `getStateDir`/`getHomeDir` — מודול אחד (`paths.ts`) או import מ-`http-options`? | `paths.ts` מייבא מ-`http-options` (מינימלי, לא מזיז קוד קיים). אם אביגיל רואה coupling — להעביר את `getHomeDir` ל-`paths.ts` ו-`http-options` מייבא ממנו. | ❌ |
| 2 | env override ל-state-dir כבר עכשיו (`DRIVE_CODING_STATE`)? | לא — `getHomeDir` כבר מכבד `HOME`/`USERPROFILE`. flag/env ייעודי ב-`binary-dist` (flags audit). | ❌ |
| 3 | ליצור את **כל** התת-תיקיות בעלייה, או lazy פר-שימוש? | lazy — `ensureStateSubdir` יוצר ברגע הצורך (כל consumer קורא). פשוט ובטוח. | ❌ |

> אין שאלה חוסמת. ברירות-המחדל מספיקות.

---

## סטיות מהתכנון (executor ממלא)

1. **Commit 0 — paths.test.ts: import סטטי במקום dynamic**: `vi.stubEnv` מספיק כי `getHomeDir()` קורא `process.env` בזמן ריצה. mock `node:child_process` הוסף (http-options מריץ execFileSync בimport).

2. **Commit 1 — `join` נשאר ב-cli-config-file.ts**: ה-brief אמר להסיר, אבל `join` משמש ב-`resolveCliSpecsPath` לביצוע `join(getStateDir(), "cli-specs.jsonc")` — cross-platform. הסרתו תשבור typecheck.

3. **Commit 1 — cli-config-file.ts CRLF**: biome `--write` תיקן CRLF→LF (safe fix, side effect מינורי).

4. **cli-config-file.test.ts — mock node:child_process**: נדרש כי paths.ts → http-options.ts → execFileSync בimport-time.

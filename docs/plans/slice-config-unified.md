# Slice — config-unified — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: טיוטה (טרם אביגיל)
> **Complexity**: 7/10 (verifier: heavy)
> **תלויות (`depends_on`)**: []
> **Base**: dev
> **Dev tip**: `5df7459`

---

## §0 — Pre-flight

### תלויות (חובה!)

slice זה **בנוי ישירות על dev** (אין תלות ב-slice אחר). בנוי מעל התשתית שמוזגה זה עתה:
- `slice-state-dir` (merged) — `getStateDir()` / `ensureStateSubdir()` ב-`packages/backend/src/paths.ts`. הקונפיג-קובץ ברירת-המחדל יושב תחת `getStateDir()`.
- `slice-binary-core` (merged) — `isBinary()` gate. לא נדרש ישירות כאן, אבל ה-slice הזה הוא הבסיס לבינארי-המפיץ.

### Worktree

```bash
cd D:/UserProjects/AI/drive-coding
git worktree add D:/UserProjects/AI/drive-coding/.worktrees/config-unified -b slice/config-unified dev
cd D:/UserProjects/AI/drive-coding/.worktrees/config-unified
pnpm install && pnpm hooks:install
```

### איך להריץ

- BE (dev): `cd packages/backend && bun src/server.ts` (port 4000; אם תפוס — `PORT=4001 bun src/server.ts`).
- Tests: מה-root — `npx vitest run packages/core/... packages/backend/...` (config root ברמת ה-workspace; **אל תריץ vitest מתוך `packages/backend`** — ה-projects-config מצביע יחסית ל-root ונשבר).
- typecheck: `pnpm typecheck` (מה-root).
- lint i18n: `bash ./scripts/lint-no-hebrew-in-code.sh` (ב-Windows ה-`pnpm lint:i18n` נשבר על ה-wrapper — הרץ ישיר).

### Browser

לא נדרש browser ל-slice הזה (קונפיג boot-path בלבד, אין שינוי FE).

### OneCLI agent

לא נדרש להרצת ה-slice. **חשוב לתאימות:** ה-slice חייב לא לשבור את מסלול ה-OneCLI הקיים (ראה §6) — אבל אין צורך להריץ OneCLI כדי לאמת אותו.

### Reading list

**must-read** (לפני שמתחילים):
- `packages/backend/src/bin/drive-coding.ts` — נקודת ה-entry, דפוס `parseArgs → flag → process.env → import server`. **כל הקונפיג נפתר ל-env כאן.**
- `packages/backend/src/acp/cli-config-file.ts` — טוען `cli-specs.jsonc` (JSONC), memoized, `resolveCliSpecsPath` + `validateOverride`. נרחיב כאן ל-inline JSON.
- `packages/backend/src/acp/cli-config.ts` — `getCliCommand`/`getCliSpec`, מיזוג override מעל `CLI_SPECS`. **כאן יושב ה-precedence הקיים `override.bin > OPENCODE_BIN` (D7).**
- `packages/core/src/schemas/agent.ts` — `CliSpec` + `CLI_SPECS` (מקור-אמת ל-CLIs). `CliSpecOverride` ב-cli-config-file.
- `packages/core/src/log/config.ts:40-60` — דפוס parse של env ב-core (רפרנס לסגנון).

**reference** (בזמן עבודה):
- `packages/backend/src/server.ts:73,110` — צריכת `CORS_ORIGINS` (`parseCorsOrigins`) ו-`FE_STATIC_DIR`.
- `packages/backend/src/delivery/http-proxy.ts` — ה-proxy. **לא נוגעים בו ב-slice הזה** (הזרקת מפתחות = slice-voice-keys-direct). כאן רק מוודאים שהמפתחות נכתבים ל-env.

---

## §1 — מטרה

אחרי ה-slice: אפשר להגדיר את **כל** הקונפיגורציה של drive-coding משלושה מקורות — **קובץ** (`--config app.jsonc` / ברירת-מחדל `~/.config/drive-coding/config.jsonc`), **JSON ישיר** (`--config-json '{…}'`), ו**משתני-סביבה/flags** — עם precedence ברור וצפוי (`flag > env > קובץ > ברירת-מחדל`). בנוסף אפשר לטעון **קובץ env נפרד** (`--env-file keys.env`) לסודות. זו התשתית שעליה ייסגרו הזרקת-המפתחות (slice הבא) וה-HTTPS המקומי. אין שינוי בחוויית הדפדפן — זה boot-path בלבד.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|------|------|------|
| סכמת-על `DriveCodingConfig` (ArkType) | ✅ | ה-slice הזה |
| `resolveConfig(layers)` טהור + precedence (D7) | ✅ | ה-slice הזה |
| parser ל-env-file (`KEY=VALUE`) | ✅ | ה-slice הזה |
| `loadConfig()` (IO) ב-backend + wiring ב-bin → `process.env` | ✅ | ה-slice הזה |
| flags חדשים: `--config`, `--config-json`, `--env-file` + per-setting | ✅ | ה-slice הזה |
| back-compat: `cli-specs.jsonc` ממוזג + `CLI_SPECS_JSON` inline | ✅ | ה-slice הזה |
| **הזרקת מפתחות ל-upstream ב-proxy** | ❌ | slice-voice-keys-direct |
| **שרת HTTPS / createSecureServer / cert-gen** | ❌ | slice-https-local |
| שינוי FE / settings UI לקונפיג | ❌ | לא בתוכנית |

> השדות `https` ו-`voice.*keys` **כן** בסכמה ונכתבים ל-env — אבל אין להם **צרכן** ב-slice הזה (השרת/proxy עדיין לא קוראים אותם). זה תקין: ה-slice הזה הוא הצנרת; הצרכנים בשני ה-slices הבאים.

---

## §3 — Architecture

```
                     ┌──────────────────────────────────────────┐
  argv (parseArgs)──▶│  bin/drive-coding.ts                      │
  process.env ──────▶│  1. --env-file? → parseEnvFile → env      │  ← משתנה
  config file (JSONC)│     (non-overriding)                      │
  --config-json  ───▶│  2. loadConfig({ argv, env, fileText })   │
                     └───────────────┬──────────────────────────┘
                                     │ Partial<DriveCodingConfig> ×3 layers
                                     ▼
                     ┌──────────────────────────────────────────┐
                     │  core/config/resolve.ts (PURE)            │  ← חדש
                     │  resolveConfig([file, env, flag])         │
                     │  precedence: flag > env > file > default  │
                     │  validate via ArkType DriveCodingConfig   │  ← חדש (core/config/schema.ts)
                     └───────────────┬──────────────────────────┘
                                     │ resolved DriveCodingConfig
                                     ▼
                     ┌──────────────────────────────────────────┐
                     │  bin: map resolved → process.env          │  ← משתנה
                     │  PORT, CORS_ORIGINS, FE_STATIC_DIR,        │
                     │  OPENCODE_BIN, LOG_*, ELEVENLABS_API_KEY,  │
                     │  GEMINI_API_KEY, CLI_SPECS_JSON, …         │
                     └───────────────┬──────────────────────────┘
                                     ▼
                     server.ts (קורא env כמו היום — ללא שינוי)
                     cli-config-file.ts (ענף CLI_SPECS_JSON inline — net-new, ממוזג מעל cli-specs.jsonc)
```

---

## §4 — Commits בסדר

### Commit 0 — core: schema + resolveConfig (approach: tdd)

**קבצים חדשים**:
- `packages/core/src/config/schema.ts`
- `packages/core/src/config/resolve.ts`
- `packages/core/tests/config-resolve.test.ts`

**קבצים שמשתנים**:
- `packages/core/package.json` — הוסף `"./config/*": "./src/config/*.ts"` ל-`exports`.

**API skeleton**:

```ts
// schema.ts — ArkType. כל השדות אופציונליים (Partial-friendly).
import { type } from "arktype"
export const DriveCodingConfig = type({
  "port?": "number",
  "corsOrigins?": "string[]",
  "feStaticDir?": "string",
  "opencodeBin?": "string",
  "wireRecord?": "boolean",
  "fsBrowseBase?": "string",
  "log?": { "level?": "string", "ns?": "string", "format?": "'pretty'|'json'|'both'" },
  "voice?": { "elevenLabsKey?": "string", "geminiKey?": "string" },
  // https + cliSpecs: ערכים מורכבים — ראה הערות מימוש
  "https?": type("boolean").or({ key: "string", cert: "string" }),
  "cliSpecs?": "Record<string, unknown>",   // ולידציה פר-CliSpecOverride נשארת ב-cli-config-file
})
export type DriveCodingConfig = typeof DriveCodingConfig.infer

// resolve.ts — טהור, אין IO.
// layers בסדר עולה-עדיפות: [fileLayer, envLayer, flagLayer].
// merge: כל שדה top-level נפתר ע"י ה-layer הגבוה ביותר שמגדיר אותו.
//   - אובייקטים (log, voice, https-object) — override wholesale (לא deep).
//   - cliSpecs — merge פר-מפתח (cliKind) חוצה layers (כדי לאפשר הרחבה).
// מחזיר Result<DriveCodingConfig, string[]> (neverthrow) — שגיאות ולידציה מצטברות.
export function resolveConfig(
  layers: ReadonlyArray<Partial<DriveCodingConfig>>,
): import("neverthrow").Result<DriveCodingConfig, string[]>
```

**Verification**:
```bash
pnpm typecheck
npx vitest run packages/core/tests/config-resolve.test.ts
```
טסטים חייבים לכסות: precedence (flag>env>file), override wholesale של אובייקט, merge פר-מפתח של cliSpecs, שדה לא-תקין → Err, layer ריק, כל ה-layers ריקים → config ריק תקין.

### Commit 1 — core: env-file parser (approach: tdd)

**קבצים חדשים**:
- `packages/core/src/config/env-file.ts`
- `packages/core/tests/env-file.test.ts`

**API skeleton**:
```ts
// טהור. parse בלבד — לא נוגע ב-process.env.
// תומך: KEY=VALUE, מתעלם משורות ריקות ומשורות שמתחילות ב-#, trim של key,
// VALUE עם = בתוכו (split על ה-= הראשון), הסרת מרכאות עוטפות "…"/'…'.
export function parseEnvFile(text: string): Record<string, string>
```

**Verification**:
```bash
npx vitest run packages/core/tests/env-file.test.ts
```
כיסוי: `#` comment, שורה ריקה, value עם `=`, מרכאות, key עם רווחים, שורה בלי `=` (דילוג).

### Commit 2 — backend: loadConfig + wiring ב-bin (approach: integration)

**קבצים חדשים**:
- `packages/backend/src/config/load-config.ts`
- `packages/backend/tests/load-config.test.ts`

**קבצים שמשתנים**:
- `packages/backend/src/bin/drive-coding.ts` — הוסף flags, קרא loadConfig, מפה ל-env.

**API skeleton**:
```ts
// load-config.ts — ה-IO shell. קורא קובץ (אם קיים), מפעיל env-file, אוסף layers, קורא resolveConfig.
export type RawArgs = Record<string, string | boolean | undefined>  // מ-parseArgs
export function loadConfig(opts: {
  argv: RawArgs            // ערכי flags
  env: NodeJS.ProcessEnv   // בד"כ process.env
}): {
  config: DriveCodingConfig
  // מפת ערכים לכתיבה חזרה ל-process.env (string-ified). ה-bin כותב אותם.
  envPatch: Record<string, string>
  warnings: string[]       // קלט שבור / flag-secret-visible / וכו'
}
```

**רצף ב-bin/drive-coding.ts** (חייב לקרות **לפני** `await import("../server.js")`):
1. הרחב את `parseArgs.options`: `config:{type:"string"}`, `config-json:{type:"string"}`, `env-file:{type:"string"}`, `elevenlabs-key:{type:"string"}`, `gemini-key:{type:"string"}`, `log-level:{type:"string"}` (+ הקיימים).
2. אם `--env-file` → `parseEnvFile(read)` → כתוב ל-`process.env` **רק מפתחות שלא קיימים** (real-env > env-file).
3. `const { envPatch, warnings } = loadConfig({ argv: values, env: process.env })`.
4. הדפס warnings (`console.warn`). אם flag-secret נמסר → warn "visible in process list".
5. כתוב `envPatch` ל-`process.env` (override — אלה כבר הערכים המנצחים אחרי precedence).
6. השאר את הלוגיקה הקיימת (FE cascade, port default, preflight) **אחרי** הכתיבה.

**מיפוי field → env** (envPatch):
| field | env var |
|---|---|
| port | `PORT` |
| corsOrigins | `CORS_ORIGINS` (join `,`) |
| feStaticDir | `FE_STATIC_DIR` |
| opencodeBin | `OPENCODE_BIN` |
| log.level/ns/format | `LOG_LEVEL`/`LOG_NS`/`LOG_FORMAT` |
| voice.elevenLabsKey | `ELEVENLABS_API_KEY` (חדש — צרכן ב-slice הבא) |
| voice.geminiKey | `GEMINI_API_KEY` (חדש — צרכן ב-slice הבא) |
| cliSpecs | `CLI_SPECS_JSON` (חדש — `JSON.stringify`, צרכן ב-Commit 3) |
| wireRecord | `WIRE_RECORD` |
| fsBrowseBase | `FS_BROWSE_ALLOWED_BASE` |
| https | `DRIVE_CODING_HTTPS` (חדש — צרכן ב-slice-https-local; כאן רק נכתב) |

**precedence flags**: לכל flag קיים (`--port` וכו') — ה-flag הוא ה-layer העליון, לכן `values.port` נכנס ל-flagLayer. ה-env layer נקרא מ-`process.env` הנוכחי (כולל env-file). ה-file layer מ-`--config`/`--config-json`/ברירת-מחדל.

**עדכן את HELP** עם הדגלים החדשים + שורת precedence.

**Verification**:
```bash
pnpm typecheck
npx vitest run packages/backend/tests/load-config.test.ts
# manual: בנה 3 קבצים ובדוק precedence
echo '{"port":4100}' > /tmp/c.json
PORT=4200 bun packages/backend/src/bin/drive-coding.ts --config /tmp/c.json --port 4300 --help   # רק שלא קורס; precedence נבדק ב-unit
```

### Commit 3 — back-compat: CLI_SPECS_JSON + מיזוג cli-specs (approach: integration)

**קבצים שמשתנים**:
- `packages/backend/src/acp/cli-config-file.ts` — ב-`loadCliSpecsOverride`: **לפני** ענף הקובץ, אם `CLI_SPECS_JSON` קיים → `JSON.parse` → אותו `validateOverride` פר-מפתח. precedence: inline-JSON (מהקונפיג המאוחד) **ממוזג מעל** הקובץ `cli-specs.jsonc` (per-key). שמור memoization.
- `packages/backend/tests/cli-config-file.test.ts` — הוסף כיסוי ל-`CLI_SPECS_JSON`, מיזוג עם קובץ, JSON שבור → התעלם + warning.

**D7 — שני סדרי-עדיפות אורתוגונליים (הוכרע — אין שינוי ב-`cli-config.ts`)**:
- **(א) סדר מקורות** `flag > env > file > default` — קובע *איך נדלה הערך של כל מפתח קונפיג* (כולל `opencodeBin` → נכתב ל-`OPENCODE_BIN` ב-Commit 2). זה נפתר כולו ב-`resolveConfig` + bin, **לפני** ש-cli-config רואה משהו.
- **(ב) specificity פר-CLI** — `cli-config.ts:62-71` שומר `override.bin (פר-CLI) > OPENCODE_BIN (גלובלי) > spec.bin`. זו שאלה **נפרדת**: override ספציפי-ל-CLI מנצח env גלובלי. **לא נוגעים בלוגיקה הזו.**
- **תוצאה**: `cli-config.ts` נשאר **ללא שינוי**. הטסט `cli-config.test.ts:170-189` (#4 — `override.bin` מ-cli-specs גובר על `OPENCODE_BIN`) **נשאר ירוק**. אין regression, אין double-precedence. ה-Commit הזה **רק מוסיף** את ענף ה-`CLI_SPECS_JSON` (net-new) ב-`loadCliSpecsOverride`.

**Verification**:
```bash
pnpm typecheck
npx vitest run packages/backend/tests/cli-config-file.test.ts
bash ./scripts/lint-no-hebrew-in-code.sh
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|------|------|
| 1 | typecheck + tests | `pnpm typecheck` נקי · `npx vitest run packages/core packages/backend` ירוק (חדשים + קיימים) |
| 2 | lint:i18n | `bash ./scripts/lint-no-hebrew-in-code.sh` → exit 0 |
| 3 | precedence flag>env>file | unit ב-config-resolve.test: 3 layers על אותו שדה → flag מנצח |
| 4 | קובץ JSONC נטען | קובץ עם הערות `//` + `port` → נקרא, port מוחל |
| 5 | `--config-json` inline | JSON ישיר ב-flag → מוחל, גובר על קובץ |
| 6 | `--env-file` | קובץ `KEY=VALUE` → ה-keys ב-process.env, **לא דורסים** env קיים |
| 7 | קלט שבור לא קורס | JSON שבור / שדה לא-תקין → warning + ברירת-מחדל, התהליך עולה |
| 8 | regression: flags קיימים | `--port`/`--cors-origins`/`--fe-static-dir`/`--opencode-bin` עדיין עובדים (ערך נכנס ל-env המתאים) |
| 9 | regression: BE עולה ב-dev | `bun src/server.ts` → `GET /api/agents` 200, `GET /` 200 |
| 10 | cli-specs back-compat | `cli-specs.jsonc` קיים → override עדיין מוחל; `CLI_SPECS_JSON` → ממוזג מעליו |
| 11 | secret-in-flag warning | `--gemini-key x` → warning על חשיפה ב-process list |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|------|------|----------|
| **regression על boot-path** (PORT/CORS/FE נשברים → כל ה-BE לא עולה) | זהו השינוי המסוכן ביותר | DoD #8/#9 חובה; שמור את הלוגיקה הקיימת של ה-bin אחרי כתיבת envPatch; שנה רק את ה-**מקור** של הערכים, לא את הצרכנים |
| **שבירת מסלול OneCLI** | AGENTS.md — מפתחות מוזרקים ע"י OneCLI | ה-slice הזה **לא** מזריק מפתחות. כשאין `ELEVENLABS_API_KEY`/`GEMINI_API_KEY` — שום דבר לא משתנה ב-proxy. אמת: בלי המפתחות ה-env לא מקבל אותם |
| **double-precedence ב-opencodeBin** (D7) | `cli-config.ts` כבר עושה precedence משלו | **הוסר ע"י ההכרעה** — `cli-config.ts` נשאר ללא שינוי (specificity פר-CLI אורתוגונלי ל-flag>env>file). ראה §4 Commit 3 + §9 Q1 |
| Hardcoded Hebrew strings | i18n hook | HELP + warnings באנגלית בלבד (הקוד חוסם עברית); `pnpm hooks:install` |
| memoization של loadCliSpecsOverride מסתיר שינוי env בטסטים | cli-config-file.ts:136 `_cached` | טסטים מנקים cache דרך `vi.resetModules()` (דפוס קיים ב-cli-config-file.test) |
| ArkType על union (`https: boolean | {key,cert}`) | סכמה מורכבת | טסט ולידציה לשני הענפים; אם ArkType מסרבל — `https` יכול להישאר `unknown` ולעבור ולידציה ב-slice-https-local |

---

## §7 — Escalation triggers

- ה-precedence ב-D7 (§9 Q1) מתברר כסותר התנהגות שמסתמכים עליה במקום אחר → עצור ושאל את מרדכי.
- ArkType לא מצליח לבטא את הסכמה בצורה סבירה (union/record) → עצור.
- מתברר שצרכן env קיים קורא את המשתנה **בזמן import** לפני שה-bin הספיק לכתוב envPatch (סדר טעינה) → עצור ושאל (זו בעיית-סדר עדינה).
- רוצה לסטות מ-testing strategy (tdd ב-0/1, integration ב-2/3) → עצור.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|------|------|
| Protocol/contract חדש (סכמת קונפיג) | +2 |
| Refactor של קוד קיים (bin entry, cli-config-file) | +1 |
| >5 files ב->2 packages (core + backend) | +1 |
| Deploy-critical / boot-path (regression מפיל הכל) | +2 |
| Pure logic בליבה (resolve/env-file) | -2 |
| TDD מלא ב-Commit 0/1 | -1 |

**Score**: 7 / 10 → **heavy** (boot-path regression + back-compat + precedence עדין).

**Verifier-phase**: מומלץ phase-check אחרי **Commit 2** (ה-wiring ב-bin — הנקודה שבה boot-path משתנה).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|----------|------|
| 1 | **הוכרע (אחרי אביגיל r1).** D7: שני סדרים אורתוגונליים — (א) `flag>env>file` למקור-של-כל-מפתח; (ב) override פר-CLI > `OPENCODE_BIN` גלובלי (specificity) נשאר ללא שינוי. `cli-config.ts` לא משתנה, טסט #4 נשאר ירוק. | — | ✅ הוכרע — לא חוסם |
| 2 | האם `https` בסכמה כבר עכשיו, או רק ב-slice-https-local? | בסכמה עכשיו (נכתב ל-env, בלי צרכן) | ❌ |
| 3 | deep-merge ל-`log`/`voice` או override wholesale? | wholesale (פשוט, צפוי) | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (אין עדיין)

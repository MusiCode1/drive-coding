# Slice — cli-availability — סינון ספקים לפי זמינות מקומית

> **תאריך**: 2026-07-11
> **סוג מסמך**: בריף ביצועי לסלייס
> **סטטוס**: טיוטה
> **אימות אביגיל**: לא מאומת
> **Dispatch**: מותר לאליעזר רק אם `אימות אביגיל = READY`
> **Complexity**: 3/10 (verifier: light + phase אחרי commit 1)
> **תלויות (`depends_on`)**: [cursor-acp] — הסלייס מוסיף את `cursor` ל-`CLI_SPECS`; רוצים שגילוי הזמינות יכלול אותו מייד
> **Base**: dev (אחרי מיזוג cursor-acp)
> **Dev tip**: `<after-cursor-acp-merge>`
>
> ⚠️ **Dispatch חסום** עד ש-`cursor-acp` מוזג ל-`dev` ו-`dev_tip` מתעדכן ל-hash האמיתי של אותו base.
>
> Worktree בלינוקס:
> ```bash
> cd /home/user/Projects/drive-coding
> git --git-dir=.bare worktree add .worktrees/cli-availability -b slice/cli-availability dev
> cd .worktrees/cli-availability
> pnpm install && pnpm hooks:install
> ```

---

## §0 — Pre-flight

### תלויות

slice זה **מבוסס על**:
- `cursor-acp` (status: בביצוע / ימוזג ל-dev) — מוסיף את `cursor` ל-`CLI_SPECS` ול-routing; הסלייס הזה צריך לכלול אותו בגילוי הזמינות.

> אביגיל בודקת שסעיף זה עקבי עם `depends_on` ב-state.json.

### Worktree

```bash
cd /home/user/Projects/drive-coding
git --git-dir=.bare worktree add .worktrees/cli-availability -b slice/cli-availability dev
cd .worktrees/cli-availability
pnpm install && pnpm hooks:install
```

### איך להריץ

- BE: `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun src/server.ts`
- FE dev: `pnpm --filter @drive-coding/frontend dev`
- Tests: `pnpm typecheck && pnpm test`
- Production-like: `pnpm --filter @drive-coding/frontend build` ואז `FE_STATIC_DIR="<abs>/packages/frontend/build" PORT=4000 bun packages/backend/src/server.ts`

### Browser

Preview מקומי `http://localhost:4000` (localhost מספיק — secure-context APIs עובדים).

### OneCLI agent

`voice-acp` — מזריק מפתחות ל-proxy של TTS (ElevenLabs, Google).

### Reading list

**must-read**:
- `packages/core/src/schemas/agent.ts` — `CLI_SPECS`, `CLI_KINDS`
- `packages/core/src/cli-resolve.ts` — `resolveCliBinary` (resolver קיים)
- `packages/provider/src/config/cli-config.ts` — `getCliCommand`, `getCliSpec`
- `packages/backend/src/delivery/http-agents.ts` — דפוס רישום endpoint
- `packages/frontend/src/routes/+page.svelte` — dropdown הספקים

**reference**:
- `dev/docs/plans/slice-cursor-acp.md` — מה נוסף ב-cursor-acp
- `dev/docs/plans/slice-single-binary-prebrief.md` §6.2 — ה-gap הותיק

---

## §1 — מטרה

אחרי הסלייס, במסך הפתיחה (`/`) יופיעו ב-dropdown של הספקים **רק ה-CLIs שזמינים בסביבת הריצה של המשתמש**. ספק שלא מותקן לא יוצג כברירת מחדל, כדי למנוע בחירות שמסתיימות ב-`ENOENT` או ב-npx download בלתי צפוי.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|--------|--------|-----|
| פונקציית גילוי זמינות ב-core עבור כל `CLI_KINDS` | ✅ | commit 0 |
| Endpoint `GET /api/cli-availability` | ✅ | commit 1 |
| FE מסנן dropdown לפי תוצאת endpoint | ✅ | commit 2 |
| Fallback ל"Show all" כשה-Backend לא מדווח זמינות | ✅ | commit 2 |
| שינוי CLI specs מ-npx לבינארי מקומי | ❌ | נשאר כיום; רק גילוי |
| התקנת CLI חסר אוטומטית | ❌ | out of scope |
| בדיקת זמינות גרסה / מודלים | ❌ | slice עתידי |
| Cache בין סשנים | ❌ | הרצה בכל טעינת `/` |

---

## §3 — Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  FE (browser)                                               │
│  +page.svelte                                               │
│    ├─ fetch GET /api/cli-availability                       │
│    └─ Select options ← filter CLI_KINDS by available[]      │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP
┌──────────────────────────────▼──────────────────────────────┐
│  BE (Hono)                                                  │
│  GET /api/cli-availability                                  │
│    ├─ iterate CLI_KINDS                                     │
│    ├─ getCliCommand(kind) → {bin, args}                     │
│    └─ resolveCliBinary({bin}) or which/where                │
└─────────────────────────────────────────────────────────────┘
```

---

## §4 — Commits בסדר

### Commit 0 — גילוי זמינות ב-core (approach: tdd)

**קבצים חדשים**:
- `packages/core/src/cli-availability.ts` — `detectAvailableClis(specs, env?, overrideKinds?)`: מקבלת מיפוי `specs: Readonly<Record<CliKind, CliSpec>>` (ברירת מחדל `CLI_SPECS`), `env` אופציונלי, ו-`overrideKinds` אופציונלי (מערך של ספקים שה-bin שלהם מגיע מ-override). מחזירה `{ available: CliKind[], details: Record<CliKind, CliAvailabilityDetails> }`.
- `packages/core/src/cli-availability.test.ts` — unit tests עם PATH מזויף (co-located לצד `cli-resolve.test.ts`)

**קבצים שמשתנים**:
- `packages/core/src/cli-resolve.ts` — שנה חתימה ל-`resolveCliBinary(spec, env?)` כאשר `env?: NodeJS.ProcessEnv`. כשמועבר, **כל** הקריאות ל-`process.env` בפונקציה ובעוזרים (`getCandidateExtensions`, `getPmGlobalBinDirs`, `getNpmGlobalBin`) יוחלפו ב-`env` (כולל `PATH`, `PATHEXT`, `envVar`, `npm_config_prefix`). ברירת מחדל: `process.env`.
- `packages/core/src/schemas/agent.ts` — הוסף שדה אופציונלי `envVar?: string` ל-`CliSpec`. הגדר `opencode: { envVar: "OPENCODE_BIN" }` כדי שגילוי הזמינות יכבד את דריסת ה-bin דרך env (D14).
- `packages/provider/src/config/cli-config.ts` — שנה את `getCliSpec` כך שישמר גם את `envVar` מה-base (בנוסף ל-`bin`, `args`, `supportsModelFlag`, `unsetEnv`, `setEnv`).
- `packages/backend/src/acp/cli-config.ts` — העתק זהה של `cli-config.ts`; עדכן גם אותו (או ודא שהוא נסרק/מסונכרן אוטומטית).

**API skeleton**:

```ts
export interface CliAvailabilityDetails {
  found: boolean
  path?: string
  source: "path" | "override" | "not-found"
}

export interface CliAvailabilityResult {
  available: readonly CliKind[]
  details: Readonly<Record<CliKind, CliAvailabilityDetails>>
}

export function detectAvailableClis(
  specs: Readonly<Record<CliKind, CliSpec>> = CLI_SPECS,
  env?: NodeJS.ProcessEnv,
  overrideKinds?: readonly CliKind[],
): CliAvailabilityResult
```

**לוגיקה**:
1. עבור כל `(kind, spec)` ב-`specs`:
   - אם `overrideKinds?.includes(kind)`:
     - קרא `resolveCliBinary({ bin: spec.bin }, env)` (ללא `envVar`, כדי ש-override.bin יקבל עדיפות ראשונה כמו ב-`getCliCommand`).
     - `source = found ? "override" : "not-found"`.
   - אחרת:
     - קרא `resolveCliBinary({ bin: spec.bin, envVar: spec.envVar }, env)`.
     - `source = found ? "path" : "not-found"`.
   - `found = !!path`.
2. אל תנסה להריץ את ה-CLI — רק לבדוק קיום בינארי.

**הסבר**: `getCliCommand` נותן עדיפות ל-`override.bin` על פני `OPENCODE_BIN`. הגילוי חייב לשקף אותו סדר כדי שלא יסנן ספק שניתן להריץ דרך override.

**הערה**: ה-backend יטען את ה-override דרך `loadCliSpecsOverride()`, ימזג עם `CLI_SPECS` בעזרת `getCliSpec`, ויספור אילו `kind`-ים קיבלו `override.bin`. את המיפוי הממוזג ואת מערך `overrideKinds` הוא יעביר ל-`detectAvailableClis`. כך core נשאר pure וללא תלות ב-provider.

**Verification**:

```bash
pnpm typecheck
pnpm test -- packages/core/src/cli-availability.test.ts packages/core/src/cli-resolve.test.ts
```

---

### Commit 1 — endpoint ב-BE (approach: integration)

**קבצים חדשים**:
- `packages/backend/src/delivery/http-cli-availability.ts` — רישום `GET /api/cli-availability`. ייבא `getCliSpec` מ-`@drive-coding/provider` (ה-consumerים האחרים ב-backend משתמשים ב-provider; אל תייבא מ-`../acp/cli-config.js` אלא אם כבר יש precedent ברור)..
- `packages/backend/tests/http-cli-availability.test.ts` — בדיקת endpoint עם env מזויף (לצד שאר ה-HTTP tests ב-`tests/`)

**קבצים שמשתנים**:
- `packages/backend/src/server.ts` — ייבא את `registerCliAvailabilityHttp` מ-`./delivery/http-cli-availability.js` והוסף קריאה `registerCliAvailabilityHttp(app)` לצד שאר registrars (למשל אחרי `registerUsageHttp`). הקונבנציה בפרויקט היא רישום ישיר ב-`server.ts`, לא דרך `http.ts`.

**לוגיקה ב-endpoint**:
1. עבור כל `kind` ב-`CLI_KINDS`:
   - `const spec = getCliSpec(kind)` — ממזג `CLI_SPECS[kind]` עם override מ-`cli-specs.jsonc`.
   - אם `spec === undefined` (לא אמור לקרות כשיש base), דלג.
   - אם `spec.bin !== CLI_SPECS[kind].bin`, הוסף את `kind` ל-`overrideKinds`.
   - הוסף את `spec` ל-`mergedSpecs`.
2. קרא `detectAvailableClis(mergedSpecs, process.env, overrideKinds)`.
3. החזר את התוצאה כ-JSON.

כך override file נלקח בחשבון (source ידווח כ-`override` כשה-bin מגיע מ-override). `noUncheckedIndexedAccess` מוגן כי `CLI_SPECS[kind]` ידוע ו-`getCliSpec` מחזיר base כשאין override.

**Response shape**:

```ts
{
  available: ["opencode", "cursor"],
  details: {
    opencode: { found: true, path: "/usr/local/bin/opencode", source: "path" },
    claude: { found: false, source: "not-found" },
    // ...
  }
}
```

**Verification**:

```bash
pnpm typecheck
pnpm test -- packages/backend/tests/http-cli-availability.test.ts
# manual:
PORT=4000 bun packages/backend/src/server.ts &
curl http://localhost:4000/api/cli-availability
```

---

### Commit 2 — FE מסנן dropdown (approach: integration + manual)

**קבצים חדשים**:
- `packages/frontend/src/lib/adapters/cli-availability.ts` — `fetchCliAvailability(): Promise<CliAvailabilityResult>`
- `packages/frontend/src/lib/view-models/cli-availability.svelte.ts` — VM שמחזיק state (loading/error/result)

**קבצים שמשתנים**:
- `packages/frontend/src/routes/+page.svelte`:
  - טען זמינות ב-`$effect` או `onMount`.
  - העבר `Select options` מ-`CLI_KINDS.map(...)` ל-filtered array.
  - אם עדיין אין תוצאה → disabled עם spinner; אם error → fallback ל"Show all" (כל ה-`CLI_KINDS`).
  - שמור על `cliKind` נבחר גם אם הוא לא available (למקרה reconnect), אך הצג אותו כ-option רק אם available.

**Verification**:

```bash
pnpm typecheck
pnpm test -- packages/frontend
# manual:
pnpm --filter @drive-coding/frontend build
FE_STATIC_DIR="<abs>/packages/frontend/build" PORT=4000 bun packages/backend/src/server.ts
# פתח http://localhost:4000, ודא שרק CLIs מותקנים מופיעים
```

---

### Commit 3 — i18n + docs (approach: manual)

**קבצים שמשתנים**:
- `packages/core/src/i18n/keys.ts` — הוסף מפתחות: `connect.cli.loading`, `connect.cli.showAll`. זה קובץ parallel-safe משותף — הוסף keys בסוף הקטגוריה `connect.cli` (או בסוף הקובץ) עם section header, אל תשנה keys קיימים. ר' `docs/conventions/parallel-safe-code.md`.
- `packages/core/src/i18n/catalogs/he.ts` — ערכים בעברית
- `packages/core/src/i18n/catalogs/en.ts` — placeholders
- `docs/running-locally.md` — פסקה: "רק ספקים מותקנים מופיעים ב-dropdown"

**Verification**:

```bash
pnpm lint:i18n
pnpm typecheck
```

---

## §5 — DoD verifiable

| # | בדיקה | איך |
|---|--------|-----|
| 1 | typecheck + tests | `pnpm typecheck && pnpm test` |
| 2 | lint:i18n | `pnpm lint:i18n` |
| 3 | endpoint מחזיר זמינות | `curl http://localhost:4000/api/cli-availability` → JSON עם `available` |
| 4 | dropdown מסונן | פתח `/`, ראה רק CLIs שמותקנים במחשב |
| 5 | fallback עובד | שנה endpoint לכישלון (kill BE) → dropdown מציג הכול |
| 6 | cursor כלול | ודא ש-`cursor` מופיע ברשימה כש-`agent` ב-PATH |
| 7 | regression opencode | חיבור opencode עדיין עובד |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|--------|------|----------|
| `resolveCliBinary` לא מכסה נתיבי Windows מלאים | cli-resolve.ts | בדוק עם `override.bin` ועם PATHEXT |
| npx-based CLIs נראים כ"לא זמינים" כשהבינארי `npx` נמצא אבל החבילה לא | התנהגות npx | ברירת מחדל: `npx` זמין = CLI זמין; תיעוד ב-decisions |
| FE מסתיר ספק שהמשתמש רוצה להריץ דרך npx install | UX | כפתור/קישור "Show all" ב-dropdown |
| עברית בקוד | i18n hook | כל מחרוזות UI ב-catalogs |
| Race: dropdown נטען לפני endpoint | Svelte | state initialized ל-`CLI_KINDS` עד שמתקבלת תשובה |

---

## §7 — Escalation triggers

- `detectAvailableClis` צריכה לגשת לקבצים או ל-`loadCliSpecsOverride` — שבירת שכבות. המענה: ה-backend מטפל ב-override וה-core מקבל מיפוי specs מוכן.
- `resolveCliBinary` זקוק לשינוי חתימה משמעותי.
- 3+ ניסיונות לבדוק זמינות ב-Windows נכשלים → דווח עם stderr/PATH.

---

## §8 — Complexity score + verifier tier

| פרמטר | ניקוד |
|--------|--------|
| Cross-package (core + backend + frontend) | +2 |
| Protocol contract חדש (HTTP endpoint) | +1 |
| Refactor של קוד קיים (dropdown) | +1 |
| TDD מתוכנן | -1 |
| State machine / async coordination | +1 |
| Pure logic ב-core | -1 |

**Score**: 3/10

**Tier**: calev light + **verifier-phase אחרי commit 1** (BE endpoint + FE wiring — החיבור ביניהם הוא הנקודה העדינה).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|------|------------|--------|
| Q1 | איך `detectAvailableClis` מכירה override? | ה-backend ממזג specs עם override דרך `getCliSpec` ומעביר מיפוי מוכן ל-core. core לא נוגע בקבצים. | ❌ |
| Q2 | האם לכלול `cursor` בגילוי מיידית? | כן, אחרי מיזוג cursor-acp. | ❌ |
| Q3 | האם fallback מראה הכול או מראה הודעת שגיאה? | מראה הכול + אינדיקציה חלשה. | ❌ |
| Q4 | האם לתמוך ב-override file (`cli-specs.jsonc`) בגילוי? | כן — אם יש `override.bin`, לבדוק אותו. | ❌ |

---

## סטיות מהתכנון (מתעדכן ע"י executor)

- (ריק)

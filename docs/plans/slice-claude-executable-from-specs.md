# Slice — claude-executable-from-specs — תוכנית

> **תאריך**: 2026-07-05
> **סטטוס**: מאושר (אביגיל READY r1 — 3 findings 🟡🟡🟢 דיוקי-נוסח תוקנו)
> **Complexity**: 3/10 (verifier: light / calev)
> **תלות**: אין (base=dev)

## רקע — למה ה-slice הזה קיים

claude רץ **in-process**: ה-BE מריץ את ה-adapter `@agentclientprotocol/claude-agent-acp@0.52.0`,
שקורא ל-`query()` של ה-SDK `@anthropic-ai/claude-agent-sdk@0.3.191`, וה-SDK spawns את `claude.exe`
עצמו כ-child. **איזה** `claude.exe` — נקבע ב-adapter (`dist/acp-agent.js:2445`):

```js
pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE ?? (await claudeCliPath()),
```

- ‏אם `process.env.CLAUDE_CODE_EXECUTABLE` מוגדר → משתמש בו (claude המקומי-העדכני, 2.1.200 → Sonnet 5).
- ‏אחרת → `claudeCliPath()` = ה-native binary **המבונדל** של ה-SDK (`claude-agent-sdk-win32-x64@0.3.191` → Sonnet 4.6).

**הבעיה**: המשתמש הגדיר `CLAUDE_CODE_EXECUTABLE` ב-`cli-specs.jsonc` תחת `claude.setEnv`, אבל זה
עובר דרך `claude-env-override.ts` ל-`_meta.claudeCode.options.env` — שהוא ה-env של **ה-child**,
**לא** של תהליך ה-BE. השורה 2445 קוראת `process.env` של **ה-BE**, ולכן ה-setEnv לא משפיע על
בחירת ה-executable. אומת חי (2026-07-05): הגדרת `CLAUDE_CODE_EXECUTABLE` בסביבת ה-BE ידנית →
claude רץ Sonnet 5. ה-slice הופך את זה לאוטומטי מתוך `cli-specs.jsonc`.

> **הכרעת-עיצוב (הנחיית משתמשת 2026-07-05)**: הקוד המחיל את זה הוא **claude-specific** →
> חייב לחיות במסלול claude (`claude-env-override.ts` / `connect-in-process.ts`), **לא** בקוד
> הכללי (`server.ts` / `cli-config.ts` / `connection-registry.ts`). אפס נגיעה בכללי.

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/claude-executable-from-specs -b slice/claude-executable-from-specs dev
cd .worktrees/claude-executable-from-specs
pnpm install && pnpm hooks:install
```

### Run
- ‏BE (claude דורש in-process; OneCLI ל-TTS): `cd packages/backend && PORT=4000 onecli run --agent voice-acp -- bun --watch src/server.ts`
- ‏FE: `pnpm --filter @drive-coding/frontend dev` (port OS-assigned, מגשר ל-BE 4000)
- ‏Tests: `pnpm --filter @drive-coding/provider test` · `pnpm --filter @drive-coding/backend test`
- ‏Typecheck: `pnpm typecheck`

### Browser
- ‏Chrome מקומי (`http://localhost:<vite>`), או linux-gui לפי סביבת ההרצה.

### OneCLI agent
- ‏שם: `voice-acp` · שימוש: הזרקת מפתחי ElevenLabs/Google ל-BE (לא נוגע ל-claude auth).

### Reading list
**must-read לפני**:
- ‏`packages/provider/src/connection/claude-env-override.ts` — כל הקובץ (claude-specific env-shaping; כאן הפונקציה החדשה).
- ‏`packages/provider/src/connection/connect-in-process.ts` שורות 140-166 — נקודת-החיבור (שורה 145).
- ‏הרקע למעלה (השורה `acp-agent.js:2445`).

**reference בזמן עבודה**:
- ‏`packages/core/src/schemas/agent.ts:13-28` — טיפוס `CliSpec` (`setEnv?: Readonly<Record<string,string>>`).
- ‏`packages/backend/src/delivery/http-options.ts` — ל-Commit 2 (מחיקת dead code).
- ‏`packages/frontend/src/lib/adapters/options.ts` — טיפוס `ServerOptions` (ל-Commit 2).

---

## §1 — מטרה

המשתמש מגדיר `CLAUDE_CODE_EXECUTABLE` פעם אחת ב-`~/.config/drive-coding/cli-specs.jsonc`
(תחת `claude.setEnv`), וה-BE מחיל אותו על `process.env` שלו אוטומטית בזמן חיבור claude —
כך ש-claude in-process רץ עם ה-executable המקומי-העדכני (Sonnet 5) במקום ה-native binary
המבונדל (Sonnet 4.6), **בלי** לזכור flag בכל הרצה.

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| ‏`applyClaudeExecutablePath` (claude-specific) | ✅ | Commit 0 |
| ‏חיווט ב-`connect-in-process.ts:145` | ✅ | Commit 1 |
| ‏מחיקת `MODEL_FALLBACKS` המת + `models` מ-`/api/options` | ✅ | Commit 2 |
| ‏גשר גנרי לכל `setEnv`→`process.env` | ❌ | **מסוכן** — `NO_PROXY` ישבור את ה-TTS proxy. **רק** `CLAUDE_CODE_EXECUTABLE`. |
| ‏קוד בחירת-executable בקוד הכללי (`server.ts`/`cli-config`) | ❌ | claude-specific → מסלול claude בלבד |
| ‏שדרוג ה-SDK `0.3.191` / שינוי ה-adapter | ❌ | out-of-scope (upstream) |
| ‏UI לבחירת executable | ❌ | future |

---

## §3 — Architecture

```
packages/provider/src/connection/
  claude-env-override.ts        ← claude-specific (קיים)
    buildClaudeEnvOverride()      (קיים — לא נוגעים)
    applyClaudeExecutablePath()   ← חדש (Commit 0)
  connect-in-process.ts         ← claude in-process (נקודת-חיבור, Commit 1)
    שורה 145: getCliSpec("claude") → applyClaudeExecutablePath(spec) לפני buildClaudeEnvOverride

packages/backend/src/delivery/
  http-options.ts               ← מחיקת MODEL_FALLBACKS + listOpencodeModels + models (Commit 2)
packages/frontend/src/lib/adapters/
  options.ts                    ← הסרת models מ-ServerOptions type (Commit 2)

לא נוגע (קוד כללי): server.ts · cli-config.ts · connection-registry.ts · agent-orchestrator.ts
```

---

## §4 — Commits

### Commit 0 — `applyClaudeExecutablePath` (approach: **TDD**)

**קובץ שמשתנה**: `packages/provider/src/connection/claude-env-override.ts` (הוספת export).
**קובץ טסט**: `packages/provider/src/connection/claude-env-override.test.ts` (הוספת describe).

**API skeleton** (חתימה מדויקת — executor לא משנה):
```ts
/**
 * Applies the claude CliSpec's CLAUDE_CODE_EXECUTABLE onto process.env, so the
 * claude-agent-acp adapter (which reads process.env.CLAUDE_CODE_EXECUTABLE at
 * query() time, acp-agent.js:2445) picks the user's local claude.exe over the
 * SDK's bundled native binary.
 *
 * claude-specific by design — lives in the claude env-shaping module, never in
 * generic bootstrap. Applies ONLY this one key (NOT the whole setEnv — NO_PROXY
 * etc. must never leak onto the BE process env, which would break the TTS proxy).
 * Does NOT overwrite an already-set process.env value (explicit env wins over config).
 *
 * @param spec  the merged claude CliSpec (from getCliSpec("claude", env)), or undefined
 * @param env   target env (default process.env) — param for testability
 */
export function applyClaudeExecutablePath(
  spec: CliSpec | undefined,
  env: NodeJS.ProcessEnv = process.env,
): void
```

**התנהגות** (טסטים נדרשים):
1. ‏`spec.setEnv.CLAUDE_CODE_EXECUTABLE` קיים + `env.CLAUDE_CODE_EXECUTABLE` ריק → `env.CLAUDE_CODE_EXECUTABLE` מוגדר לערך ה-spec.
2. ‏`env.CLAUDE_CODE_EXECUTABLE` **כבר** מוגדר → **לא נדרס** (explicit wins).
3. ‏`spec.setEnv` מכיל גם `NO_PROXY`/`ANTHROPIC_API_KEY` → **לא** מוחלים על `env` (רק ה-key הספציפי).
4. ‏`spec === undefined` או `setEnv` חסר / בלי ה-key → no-op (env לא משתנה).

**Verification**:
```bash
pnpm --filter @drive-coding/provider test claude-env-override
pnpm typecheck
```

### Commit 1 — חיווט ב-`connect-in-process.ts` (approach: **manual**)

**קובץ שמשתנה**: `packages/provider/src/connection/connect-in-process.ts` (סביב שורה 145).

**Before**:
```ts
const envOverride = buildClaudeEnvOverride(getCliSpec("claude", process.env))
```
**After**:
```ts
const claudeSpec = getCliSpec("claude", process.env)
// claude-specific: point the SDK at the user's local claude.exe (cli-specs setEnv)
// before any query() runs. Must precede session/new (which triggers query()).
applyClaudeExecutablePath(claudeSpec)
const envOverride = buildClaudeEnvOverride(claudeSpec)
```
+ ‏עדכון ה-import מ-`./claude-env-override.js` (הוספת `applyClaudeExecutablePath`).

**Verification**:
```bash
pnpm --filter @drive-coding/provider test
pnpm typecheck
```

### Commit 2 — מחיקת `MODEL_FALLBACKS` המת (approach: **manual**)

**רקע**: אף צרכן ב-FE לא קורא `ServerOptions.models` — רק `homeDir`/`projects` נצרכים
(`routes/+page.svelte`, `FolderPickerDialog`). `MODEL_FALLBACKS` הוא שריד-scaffolding מ-Slice 5-8.

**קבצים שמשתנים**:
- ‏`packages/backend/src/delivery/http-options.ts` — מחיקת `MODEL_FALLBACKS` ו-`listOpencodeModels`, והסרת `models` מגוף תגובת ה-route (`c.json(...)` בתוך `registerHttpOptions` — הפונקציה עצמה מחזירה `void`; היא רק רושמת את ה-route `/api/options`). התגובה נשארת `c.json({ projects, homeDir })`. הסרת import מיותר (`execFileSync`).
- ‏`packages/frontend/src/lib/adapters/options.ts` — הסרת `models` מטיפוס `ServerOptions`.
- ‏`packages/backend/tests/http-options.test.ts` — מחיקת **כל** ~5 הטסטים שבודקים `models` (זו קבוצה, לא טסט בודד — ה-DoD ירוק רק אחרי הסרת כולם). טסטי `projects`/`homeDir` נשארים.

**Verification**:
```bash
pnpm --filter @drive-coding/backend test http-options
pnpm --filter @drive-coding/frontend typecheck
pnpm typecheck
# ודא שאין צרכן שנשבר:
grep -rn "\.models" packages/frontend/src/lib/adapters packages/frontend/src/routes || echo "no consumers"
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| ‏`applyClaudeExecutablePath` מגדיר מ-`setEnv` | טסט Commit 0 #1 ירוק |
| ‏לא דורס env מפורש | טסט Commit 0 #2 ירוק |
| ‏לא מדליף keys אחרים (`NO_PROXY`) ל-process.env | טסט Commit 0 #3 ירוק |
| ‏אימות חי — cli-specs בלבד (בלי flag) → Sonnet 5 | ודא שה-cli-specs.jsonc **המקומי** (`~/.config/drive-coding/cli-specs.jsonc`, **לא** `deploy/cli-specs.jsonc` שב-repo — הוא מכיל רק `NO_PROXY`) מכיל `claude.setEnv.CLAUDE_CODE_EXECUTABLE`=נתיב ל-claude מקומי-עדכני; הרם BE **בלי** flag `CLAUDE_CODE_EXECUTABLE` בשורת-ההרצה; חבר claude; שאל "which model are you" → Sonnet 5 (לא 4.6). (למשתמשת: הקובץ המקומי כבר מכיל את המפתח מ-2026-07-05.) |
| ‏ה-TTS proxy עדיין עובד (NO_PROXY לא דלף) | TTS בבועה מנגן (ElevenLabs/Gemini) — 200, לא 401/proxy-error |
| ‏`/api/options` לא מחזיר `models` | `curl -sk https://localhost:4000/api/options \| jq 'has("models")'` → `false` |
| ‏typecheck נקי | `pnpm typecheck` → 0 |
| ‏tests ירוקים | `pnpm --filter @drive-coding/provider test` + backend |

---

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ‏דחיפת **כל** `setEnv` ל-`process.env` תשבור את ה-TTS proxy (`NO_PROXY` על ה-BE) | deploy/cli-specs.jsonc מכיל `NO_PROXY` ל-claude child | **whitelist** — הפונקציה מחילה **רק** `CLAUDE_CODE_EXECUTABLE`. טסט #3 שומר על זה. |
| ‏דריסת flag מפורש של המשתמש | הרצה ידנית עם `CLAUDE_CODE_EXECUTABLE=...` | guard `!env.CLAUDE_CODE_EXECUTABLE` (explicit > config). טסט #2. |
| ‏מחיקת `MODEL_FALLBACKS` שוברת טסטים/type | `http-options.test.ts` בודק `models`; `ServerOptions.models` בטיפוס | Commit 2 מעדכן טסטים + type. grep מוודא 0 צרכנים. |
| ‏protocol-drift: adapter 0.52.0 מול claude 2.1.200 | executable חדש בהרבה מה-bundled | **אומת חי ידנית ע"י המשתמשת (2026-07-05) — עבד**. calev יאמת שוב חי. אם שובר → §7. |
| ‏Hebrew-in-code / i18n | pre-commit hook | הקוד הזה BE/provider — אין מחרוזות UI. אין סיכון. |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי ב-parent task אם:
- ‏claude 2.1.200 שובר את ה-ACP bridge (protocol-drift: initialize/session-shape נכשל) — אולי צריך pin ל-executable ביניים או שדרוג ה-adapter.
- ‏`applyClaudeExecutablePath` מתגלה כלא-מספיק (ה-adapter קורא `process.env` במקום/זמן אחר ממה שהונח).
- ‏מסתבר שיש צרכן ל-`ServerOptions.models` שלא נמצא ב-grep (אז Commit 2 משתנה).

---

## §8 — Complexity score

- ‏commits: 3 (נמוך)
- ‏שכבות חדשות: 0 (פונקציה בקובץ claude-specific קיים)
- ‏APIs חיצוניים: 0
- ‏streaming/async: 0
- ‏state refactor: 0
- ‏protocol BE↔FE: מחיקת `models` מ-`/api/options` (+1, מחיקה בלבד)

**Score ≈ 3/10 → verifier: light (calev)**. אימות חי חובה (executable selection + TTS proxy regression).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל מוצעת | חוסם? |
|---|---|---|---|
| 1 | מיקום הפונקציה — להרחיב `claude-env-override.ts` או קובץ claude חדש? | להרחיב `claude-env-override.ts` (כבר claude-specific env-shaping מ-`CliSpec`) | ❌ |
| 2 | מחיקת `models` מ-`/api/options` — מלאה (endpoint+type+listOpencodeModels) או רק `MODEL_FALLBACKS.claude`? | מלאה — הכל dead | ❌ |
| 3 | explicit env מנצח cli-specs? | כן (explicit > config, guard `!env[key]`) | ❌ |
| 4 | האם צריך להחיל גם ב-`connect-codex-in-process` וכו'? | לא — codex לא קורא `CLAUDE_CODE_EXECUTABLE`; claude-only | ❌ |

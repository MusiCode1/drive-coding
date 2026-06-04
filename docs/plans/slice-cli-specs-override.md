# Slice: cli-specs-override — קובץ קונפיג חיצוני שדורס/מרחיב CLI_SPECS

> ‏**מרדכי → אליעזר**. ‏Brief זה עוקב אחר `docs/plans/README.md`.
> ‏**depends_on**: `[]` (עצמאי, base = `dev`)

---

## §0 — Pre-flight

- **Worktree**: `git worktree add .worktrees/cli-specs-override -b cli-specs-override dev`
  ואז `cd .worktrees/cli-specs-override && pnpm install && pnpm hooks:install`.
- **Base**: `dev` (אין תלות בסליסים אחרים).
- **איך להריץ tests**:
  - core: `pnpm --filter @drive-coding/core test`
  - backend: `pnpm --filter @drive-coding/backend test`
  - typecheck: `pnpm typecheck`
  - lint: `pnpm lint && pnpm lint:i18n`
- **איך לבדוק ידנית מול CLI אמיתי** (החלק החשוב — זה הבאג שמתקנים):
  - הסליס נולד כי **gemini נשבר תחת OneCLI**: ה-BE רץ דרך `onecli run`,
    שמזריק `HTTP(S)_PROXY` + `NODE_EXTRA_CA_CERTS` המנתבים את כל תעבורת
    ה-child דרך ה-MITM gateway. gemini-cli מנסה OAuth refresh מול Google,
    זה נשבר, והוא נופל ל-login אינטראקטיבי שמדפיס escape-codes + OAuth URL
    ל-stdout ומזהם את ערוץ ה-ACP.
  - **הוכחה מאומתת** (הרץ בעצמך לאימות לפני/אחרי):
    ```bash
    printf '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}\n{"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/home/user","mcpServers":[]}}\n' > /tmp/acp_in.txt

    # נשבר (login flow):
    onecli run --agent voice-acp -- gemini --acp < /tmp/acp_in.txt | head -c 200

    # עובד (ACP נקי) — עם הסרת proxy/CA מה-child:
    onecli run --agent voice-acp -- env -u HTTP_PROXY -u HTTPS_PROXY \
      -u http_proxy -u https_proxy -u NODE_EXTRA_CA_CERTS -u SSL_CERT_FILE \
      -u REQUESTS_CA_BUNDLE -u CURL_CA_BUNDLE -u DENO_CERT -u GIT_SSL_CAINFO \
      -u NODE_USE_ENV_PROXY gemini --acp < /tmp/acp_in.txt | head -c 200
    ```
- **OneCLI agent**: `voice-acp`. ה-BE עצמו **חייב** להמשיך לרוץ דרך OneCLI
  (ל-proxy של ElevenLabs/TTS). רק ה-**child** (ה-CLI subprocess) מקבל env מסונן.
- **Reading list**:
  - **must-read**: `packages/core/src/schemas/agent.ts` (CLI_SPECS, CliSpec),
    `packages/backend/src/acp/cli-config.ts` (getCliCommand),
    `packages/backend/src/acp/bridge-manager.ts:47-79` (spawnInternal + envWithPlugin).
  - **reference**: `AGENTS.md` §"No adapters in core" + §"Backend MUST run through OneCLI".

---

## §1 — מטרה

‏משתמש (או מפעיל) יכול ליצור קובץ JSONC חיצוני שדורס ו/או מרחיב את `CLI_SPECS`
‏המובנה — ‏לשנות `bin`/`args` של CLI קיים, להוסיף CLI חדש לגמרי, ולציין פר-CLI
‏אילו משתני-סביבה לנקות (`unsetEnv`) או להוסיף (`setEnv`) ב-spawn של ה-child.
‏המקרה המיידי: ‏ניקוי משתני ה-proxy/CA של OneCLI עבור gemini, כדי שהאימות
‏מול Google יעבוד. ‏**בלי הקובץ — ‏ההתנהגות זהה להיום בדיוק** (opt-in מפורש).

---

## §2 — Scope

| בכוונה לא נוגעים | למה / איפה |
|---|---|
| ברירת-מחדל מובנית ל-unsetEnv | ❌ נדחה במפורש ע"י המשתמשת — "ישבש אנשים שלא יבינו למה". בלי קובץ = התנהגות היום. |
| סינון ב-`ws-agent.ts` (drop non-JSON-RPC) | גישה חלופית שנדחתה. לא בסליס הזה. |
| שינוי ב-FE (dropdown CLIs) | CLI שנוסף דרך הקובץ לא יופיע ב-FE dropdown — מחוץ ל-scope. CLI חדש שכן רוצים ב-UI = רשומה ב-core. |
| הזרקת `OPENCODE_CONFIG_CONTENT` | קיים כבר ב-bridge-manager, לא נוגעים בלוגיקה שלו. |
| hot-reload של הקובץ | נטען פעם אחת (lazy, memoized). שינוי קובץ דורש restart BE. |

---

## §3 — Architecture

```
core (טהור, ללא IO)                 backend (IO — קריאת קובץ, spawn)
─────────────────────              ──────────────────────────────────
schemas/agent.ts                   acp/cli-config-file.ts   ← חדש
  CliSpec {                          loadCliSpecsOverride(): מקובץ JSONC
    bin, args,                       (readFileSync + JSON parse + validate)
    supportsModelFlag,
    unsetEnv?  ← חדש (אופציונלי)    acp/cli-config.ts        ← משתנה
    setEnv?    ← חדש (אופציונלי)      getCliCommand: ממזג override לתוך CLI_SPECS
  }                                   getCliSpec(kind): CliSpec הממוזג (חדש, ל-env)
  CLI_SPECS (מובנה, ללא שינוי
    ערכים — רק הטיפוס מורחב)        acp/bridge-manager.ts    ← משתנה
                                      spawnInternal: בונה env עם unsetEnv/setEnv
```

‏**עיקרון** (AGENTS): ‏הטיפוס + ‏הסכמה ב-core (טהור). ‏קריאת-הקובץ + ‏המיזוג +
‏עיצוב-ה-env הם IO → ‏ב-backend בלבד. ‏core **לא** קורא קבצים.

---

## §4 — Commits

### Commit 0 — core: הרחבת הטיפוס CliSpec (TDD לא נדרש — type-only)

**Approach**: `manual` (שינוי טיפוס בלבד, אין לוגיקה).

**משתנה**: `packages/core/src/schemas/agent.ts`

- מוסיף שני שדות אופציונליים לטיפוס `CliSpec`:

```ts
export type CliSpec = {
  readonly bin: string
  readonly args: readonly string[]
  readonly supportsModelFlag: boolean
  /** משתני-סביבה להסרה מה-child לפני spawn (למשל proxy/CA של OneCLI). */
  readonly unsetEnv?: readonly string[]
  /** משתני-סביבה להוספה/דריסה ב-child לפני spawn. */
  readonly setEnv?: Readonly<Record<string, string>>
}
```

- **לא** משנים את ערכי `CLI_SPECS` המובנה (נשאר בדיוק כמו היום — `satisfies` עדיין עובר).

**Verification**:
```bash
pnpm --filter @drive-coding/core typecheck   # CLI_SPECS still satisfies CliSpec
```

---

### Commit 1 — backend: טעינת קובץ override (TDD)

**Approach**: `TDD` — פונקציה דטרמיניסטית (קלט: תוכן-קובץ/נתיב, פלט: override map או null).

**חדש**:
- `packages/backend/src/acp/cli-config-file.ts`
- `packages/backend/tests/cli-config-file.test.ts` — **שים לב**: טסטים ב-backend
  חיים ב-`packages/backend/tests/` (19 קבצי-טסט שם), **לא** ליד הקוד ב-src/acp/.

**API skeleton**:
```ts
import type { CliSpec } from "@drive-coding/core"

/** ערך override — כל השדות אופציונליים (merge חלקי לתוך spec קיים). */
export type CliSpecOverride = Partial<CliSpec>

/** מפת override: cliKind → override. כולל גם CLIs חדשים (מפתח שלא ב-CLI_SPECS). */
export type CliSpecsOverride = Record<string, CliSpecOverride>

/**
 * נתיב ברירת-המחדל לקובץ ה-override.
 * env CLI_SPECS_FILE דורס. אחרת ~/.config/drive-coding/cli-specs.jsonc.
 */
export function resolveCliSpecsPath(env?: NodeJS.ProcessEnv): string

/**
 * טוען ומפענח את קובץ ה-override.
 * - קובץ לא קיים → מחזיר {} (אין override, התנהגות היום). בלי warning.
 * - JSON/JSONC שבור → log warning + מחזיר {} (לא קורס).
 * - תקין → מחזיר את ה-map.
 * memoized — נקרא פעם אחת לכל תהליך (lazy).
 */
export function loadCliSpecsOverride(env?: NodeJS.ProcessEnv): CliSpecsOverride
```

הערות מימוש לאליעזר:
- **JSONC**: יש להסיר הערות לפני `JSON.parse`. אין תלות JSONC בפרויקט —
  השתמש ב-strip פשוט (regex להסרת `//` ו-`/* */`) **או** בדוק אם
  `import { parse } from "node:..."` זמין; אם לא — strip ידני. **אם אתה מסתבך
  עם strip של JSONC (edge cases של `//` בתוך מחרוזת) — עצור ושאל את מרדכי**
  (escalation §7). פתרון פשוט מקובל: regex שמתעלם מ-`//` בתוך מחרוזות הוא קשה;
  עדיף strip שמרני של שורות שה-trim שלהן מתחיל ב-`//`, + בלוקים `/* */`.
- ולידציה: ערך override חייב להיות אובייקט; אם `bin` קיים → string; `args` → string[];
  `unsetEnv` → string[]; `setEnv` → Record<string,string>; `supportsModelFlag` → boolean.
  ערך לא תקין בשדה בודד → דלג על השדה + warning (לא לזרוק).
- `resolveCliSpecsPath`: `env.CLI_SPECS_FILE ?? join(homedir(), ".config/drive-coding/cli-specs.jsonc")`.
  השתמש ב-`os.homedir()` כמו `http-history.ts:113`.

**טסטים (TDD — כתוב לפני)**:
1. קובץ לא קיים → `{}`, אין throw, אין warning.
2. JSONC תקין עם הערות → נפענח נכון (override ל-gemini עם unsetEnv).
3. JSON שבור → `{}` + warning (mock logger / spy).
4. `CLI_SPECS_FILE` env דורס את ברירת-המחדל.
5. שדה לא תקין (`args` שהוא string במקום array) → השדה מדולג, השאר נשמר.
6. CLI חדש (מפתח שלא קיים ב-CLI_SPECS) → נשמר במפה.

> **קלט-לטסט**: כדי לבדוק קריאת-קובץ אמיתית, כתוב קובץ זמני ב-`/tmp` ו-set
> `CLI_SPECS_FILE` אליו. נקה אחרי (afterEach). אל תיגע ב-`~/.config`.

---

### Commit 2 — backend: מיזוג override ב-getCliCommand + getCliSpec (TDD)

**Approach**: `TDD`.

**משתנה**:
- `packages/backend/src/acp/cli-config.ts`
- `packages/backend/tests/cli-config.test.ts` — **קובץ קיים** (106 שורות, suite של
  getCliCommand). מוסיפים אליו את הטסטים החדשים. **לא** יוצרים קובץ חדש.

- `getCliCommand` ממזג את ה-override לתוך ה-spec לפני בניית הפקודה:
  - bin: `override.bin ?? spec.bin` (ועדיין: opencode → `OPENCODE_BIN` קודם).
  - args: `override.args ?? spec.args` (ואז הוספת `--model` לפי הלוגיקה הקיימת).
  - **תאימות-לאחור**: CLI מובנה בלי override → תוצאה זהה להיום בדיוק.
  - **חתימה נשארת `getCliCommand(kind: BridgeKind, ...)` ללא שינוי.** ה-FE שולח
    רק CliKind חוקי (ArkType enum ב-http-agents). אין fallback ל-CLI-לא-ב-enum
    כאן — ראה הערת scope למטה.
- מוסיף `getCliSpec` שמחזיר את ה-spec הממוזג (כולל `unsetEnv`/`setEnv`),
  לשימוש ב-bridge-manager ל-env shaping:

```ts
/** spec ממוזג (CLI_SPECS + override) — כולל unsetEnv/setEnv. ל-env shaping. */
export function getCliSpec(kind: string, env?: NodeJS.ProcessEnv): CliSpec | undefined
```

הערות:
- `kind` כ-`string` (לא `BridgeKind`) כי הקובץ יכול **להגדיר** override למפתח
  כלשהו. `getCliSpec` משמש **רק** ל-env-shaping ב-spawn — לא ל-resolution של
  פקודת-הרצה דרך ה-API.
- **CLI חדש מהקובץ אינו runnable דרך ה-UI/API** (מחוץ ל-scope — §2). הסיבה:
  `POST /api/agents` מוודא `cliKind` דרך ArkType `CliKind` enum (`http-agents.ts:12`),
  אז kind שלא ב-enum מקבל 400 **לפני** ה-spawn. לכן `getCliCommand` **לא** נופל
  ל-override עבור kind לא-מוכר — הוא זורק כמו היום (`Unsupported BridgeKind`).
  `getCliSpec` כן מחזיר override ל-kind כלשהו, אבל זה רלוונטי רק ל-CLIs שכבר
  ב-enum (כמו gemini) שמקבלים unsetEnv. ⚠️ ראה §9 Q3 (האם להוסיף runnability
  בעתיד — slice נפרד עם הרחבת ה-enum-validation + FE).

**טסטים** (נוספים ל-`tests/cli-config.test.ts` הקיים):
1. אין override → `getCliCommand("gemini")` זהה להיום (`{bin:"gemini",args:["--acp"]}`).
2. override ל-gemini עם `args:["--acp","--foo"]` → args דרוסים.
3. override ל-gemini עם `bin:"/custom/gemini"` → bin דרוס.
4. opencode עם `OPENCODE_BIN` env **וגם** override.bin → מי גובר? **ברירת-מחדל מוצעת**:
   override.bin גובר על OPENCODE_BIN (הקובץ מפורש יותר). ⚠️ ראה §9 Q2.
5. `getCliSpec("gemini")` עם override.unsetEnv → מחזיר spec עם unsetEnv.
6. modelOverride + supportsModelFlag עדיין מוסיף `--model` אחרי args הדרוסים.

---

### Commit 3 — backend: יישום unsetEnv/setEnv ב-spawn (manual)

**Approach**: `manual` (IO — spawn; נבדק באינטגרציה ב-§5, לא ב-unit).

**משתנה**: `packages/backend/src/acp/bridge-manager.ts` (spawnInternal, ~63-79)

- אחרי בניית `envWithPlugin` הקיים, להחיל את ה-env shaping מה-spec הממוזג:

```ts
// אחרי envWithPlugin הקיים:
const spec = getCliSpec(input.cliKind, process.env)
const childEnv: NodeJS.ProcessEnv = { ...envWithPlugin }
for (const key of spec?.unsetEnv ?? []) {
  delete childEnv[key]
}
if (spec?.setEnv) {
  Object.assign(childEnv, spec.setEnv)
}
// spawn משתמש ב-childEnv במקום envWithPlugin:
child = spawn(cli.bin, [...cli.args], { cwd: input.cwd, env: childEnv, stdio: [...] })
```

- import של `getCliSpec` מ-`./cli-config.js`.
- **שמור על הסדר**: opencode קודם מקבל `OPENCODE_CONFIG_CONTENT` (קיים),
  ואז unsetEnv/setEnv מוחל מעליו. (ל-opencode אין unsetEnv אלא אם יוגדר בקובץ.)

**Verification**:
```bash
pnpm --filter @drive-coding/backend typecheck
pnpm --filter @drive-coding/backend test
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| core typecheck — CLI_SPECS עדיין satisfies | `pnpm --filter @drive-coding/core typecheck` |
| כל הטסטים החדשים ירוקים | `pnpm --filter @drive-coding/backend test` |
| תאימות-לאחור: בלי קובץ override, getCliCommand זהה להיום | טסט Commit2 #1 + הרצת BE בלי קובץ → gemini מתנהג כמו היום |
| typecheck + lint + lint:i18n נקיים | `pnpm typecheck && pnpm lint && pnpm lint:i18n` |
| **אינטגרציה ידנית — gemini תחת OneCLI עובד עם הקובץ** | ראה למטה ★ |
| קובץ JSONC עם הערות נטען נכון | טסט Commit1 #2 |
| JSON שבור לא מקריס את ה-BE | טסט Commit1 #3 |

★ **אינטגרציה ידנית (הבדיקה האמיתית)**:
1. צור `~/.config/drive-coding/cli-specs.jsonc`:
   ```jsonc
   {
     // נקה proxy/CA של OneCLI מ-gemini כדי שה-OAuth מול Google יעבוד
     "gemini": {
       "unsetEnv": ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy",
                    "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE",
                    "CURL_CA_BUNDLE", "DENO_CERT", "GIT_SSL_CAINFO", "NODE_USE_ENV_PROXY"]
     }
   }
   ```
2. הרץ BE מה-worktree דרך OneCLI:
   `PORT=4001 onecli run --agent voice-acp -- bun --watch packages/backend/src/server.ts`
3. `curl -s -X POST localhost:4001/api/agents -H 'Content-Type: application/json' -d '{"cliKind":"gemini","cwd":"/home/user"}'`
4. התחבר ל-WS (`ws://localhost:4001/ws/agent/<id>`), שלח `initialize`,
   ואמת שהתגובה היא JSON-RPC נקי **בלי** escape-codes או OAuth URL.
   (כלי בדיקה: ה-probe ב-§0; או linux-gui Chrome מול tunnel — ראה handoff.)
5. **בקרת-נגד**: הסר את הקובץ → restart → אמת ש-gemini **כן** נשבר שוב
   (login flow). זה מוכיח שהקובץ הוא מה שתיקן, לא משהו אחר.

---

## §6 — Risks

- **JSONC parsing** (גוטשה ידועה — אין ספריית JSONC בפרויקט): strip ידני של
  הערות מסוכן עם `//` בתוך מחרוזות. **mitigation**: strip שמרני (שורות שה-trim
  מתחיל ב-`//` + בלוקי `/* */`), ואם זה לא מספיק — escalate (§7). אל תכניס
  dependency חדש בלי אישור מרדכי.
- **תאימות-לאחור** (סיכון רגרסיה ראשי): כל שינוי ב-getCliCommand חייב להשאיר
  את ההתנהגות ללא-קובץ זהה. **mitigation**: טסט Commit2 #1 הוא בדיוק זה +
  בקרת-נגד ב-DoD ★5.
- **הערות בקוד בעברית** (convention voice-acp, memfs `2026-06-01`): כתוב הערות
  בעברית. ה-linter `lint-no-hebrew-in-code.mjs` **מתיר הערות תמיד** ויש allowlist
  ל-`tests/`, אז אין סיכון אמיתי כאן. סתם הרץ `pnpm lint:i18n` לפני commit כרגיל.
- **os.homedir() בסביבת systemd**: ב-BE החי `HOME=/home/user` (אומת). תקין.

---

## §7 — Escalation triggers

עצור ושאל את מרדכי אם:
- strip של JSONC נתקל ב-edge case של `//` בתוך מחרוזת ואין פתרון פשוט נקי.
- מתעורר צורך ב-dependency חדש (ספריית JSONC).
- מתברר ש-getCliCommand נקרא ממקום נוסף שלא תועד כאן (grep מצא צרכן שלישי).
- ה-env shaping ב-bridge-manager מתנגש עם `OPENCODE_CONFIG_CONTENT` באופן לא צפוי.
- gemini עדיין נשבר אחרי הקובץ — סימן שהשורש שונה ממה שמופה.

---

## §8 — Complexity score + verifier

- commits: 4 (0-3) → סביר
- שכבות חדשות: 1 (קובץ cli-config-file חדש ב-backend) → נמוך
- APIs חיצוניים: 0 (אין קריאה חדשה ל-API; gemini הוא subprocess קיים)
- streaming/async: 0
- state model refactor: 0
- protocol BE↔FE: 0

**Score: 3** → `calev` (mode: light) מספיק. לא heavy.

> דגש ל-calev: ה-DoD הקריטי הוא **★ האינטגרציה הידנית** (gemini תחת OneCLI
> עם/בלי קובץ) — לא רק הטסטים. ה-unit tests מכסים את הלוגיקה; ה-runtime-truth
> הוא ש-gemini מתחבר נקי. כלול בקרת-נגד (הסרת קובץ → נשבר שוב).

---

## §9 — שאלות פתוחות

1. **שם env var לנתיב**: `CLI_SPECS_FILE` (מוצע) או `DRIVE_CODING_CLI_SPECS`?
   ברירת-מחדל מוצעת: `CLI_SPECS_FILE`. לא חוסם — אליעזר יבחר את המוצע.
2. **override.bin מול OPENCODE_BIN** (opencode בלבד): מי גובר?
   ברירת-מחדל מוצעת: **override.bin גובר** (הקובץ מפורש יותר מ-env כללי).
   לא חוסם, אבל אם יש דעה אחרת — מרדכי מחליט. (תיעוד בהערה ליד הקוד.)
3. **שם הקובץ**: `cli-specs.jsonc` (מוצע) תחת `~/.config/drive-coding/`.
   לא חוסם.
4. **CLI חדש מהקובץ — runnable בעתיד?** כרגע override יכול להגדיר CLI חדש
   ל-env-shaping בלבד; הוא **לא** ניתן-להרצה דרך ה-UI/API (ArkType enum חוסם
   ב-400). להפוך אותו runnable דורש הרחבת ה-enum-validation + FE dropdown —
   **slice נפרד** אם וכאשר יידרש. לא חוסם את הסליס הזה (ה-use-case המיידי הוא
   gemini, שכבר ב-enum). החלטה: מרדכי, בעתיד.

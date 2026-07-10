# Slice — claude in-process מכבד cli-config env — תוכנית

> **תאריך**: 2026-07-03
> **סטטוס**: אומת מלא — ממתין לאישור merge (branch @ 6b4dfe3; §8a calev GO 7/7 · §8b+§8c GO חי על טלפון/termux 2026-07-03)
> **Complexity**: 5/10 (verifier: light — `calev`; אבל runtime-gate דורש מכונת-deploy, ר' §8)
> **תלות**: אין (`depends_on: []`, base=dev). provider cutover v0.8.0 כבר ב-dev.
> **מבטל**: `scripts/claude-direct-be.sh` (untracked) + עטיפת ה-`ExecStart` ב-`deploy/systemd/voice-acp-{dev,main}.service`

---

## §רקע (למה הסבב קיים)

drive-coding מריץ את ה-BE תחת שער OneCLI (סוכן `voice-acp`), שמזריק
`ANTHROPIC_API_KEY=<placeholder>` + `HTTP(S)_PROXY` לכל host. הסוכן **בכוונה לא מקבל את סוד
ה-Anthropic** (מניעת שחיקת-יתרה — `docs/roadmap.md` "billing risk"). אחרי provider cutover v0.8.0
**claude רץ in-process**: ה-Claude Agent SDK מ-spawn את ה-claude CLI, שיורש את `process.env` של
ה-BE → קריאתו ל-`api.anthropic.com` מנותבת לשער OneCLI → **401**. צריך ש-claude ידבר עם Anthropic
ישירות דרך ה-OAuth של המנוי (`~/.claude`).

היום זה "נפתר" בעקיפה: `scripts/claude-direct-be.sh` (untracked) עוטף את `ExecStart` ב-systemd ומעצב
את **כל** `process.env` (`unset ANTHROPIC_API_KEY` + `NO_PROXY=api.anthropic.com`). זו הגישה הלא-נכונה —
imperativ, לא-tracked, ומשנה את env ה-BE כולו. הסבב מחליף אותה במנגנון ה-cli-spec **המוצהר** הקיים,
scoped לתת-תהליך claude בלבד.

---

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/claude-inprocess-cli-env -b slice/claude-inprocess-cli-env dev
cd .worktrees/claude-inprocess-cli-env
pnpm install && pnpm hooks:install
```

### Run / test
- טסטים (פס-ליבה): `pnpm --filter @drive-coding/provider test`
- typecheck: `pnpm typecheck` · lint: `pnpm lint` · i18n: `pnpm lint:i18n`
- **BE חי — runtime-gate בלבד, על deploy**: ר' §8. **לא** רץ על Windows המקומי; דורש OneCLI + claude
  אמיתי + OAuth מחובר ב-`~/.claude`.

### Browser
אין FE בסבב. runtime-gate = שיחת-claude חיה + השמעת-TTS מה-FE הקיים.

### OneCLI agent
`voice-acp` — רלוונטי **רק** ל-runtime-gate (הוא זה שמזריק את ה-placeholder + proxy שאותם מנטרלים
עבור api.anthropic.com, ואת ה-keys של ElevenLabs/Google שחייבים להישאר).

### Reading list
**must-read לפני קוד**:
- `packages/provider/src/connection/connect-in-process.ts` — נקודת ההזרקה. שים לב ל-`injectModelOverride`
  (שורות 46-67) ולהחלתו ב-`session.new` (שורה 154) — **התבנית שנחקה** (אותו נתיב `_meta.claudeCode.options`).
- `packages/provider/src/shared/spawn-core.ts` שורות 92-103 — כך opencode/codex מקבלים env shaping
  (`for (unsetEnv) delete; Object.assign(base, setEnv)`). הסבב מביא את **אותה סמנטיקה** ל-in-process,
  בערוץ אחר (SDK env), כי אין לנו גישה ל-spawn של ה-child.
- `packages/provider/src/config/cli-config.ts` `getCliSpec()` — מחזיר spec ממוזג (CLI_SPECS + override
  מהקובץ) כולל `unsetEnv`/`setEnv`.

**reference בזמן עבודה**:
- `packages/provider/src/config/cli-config-file.ts` — **זה הקובץ ש-connect-in-process צורך** (דרך getCliSpec).
  תומך ב-`CLI_SPECS_FILE` + ברירת-מחדל `~/.config/drive-coding/cli-specs.jsonc` בלבד — **לא** ב-`CLI_SPECS_JSON`.
  (ה-inline `CLI_SPECS_JSON` קיים רק ב-mirror של ה-backend `packages/backend/src/acp/cli-config-file.ts` — לא בנתיב שלנו.)
- `packages/core/src/schemas/agent.ts` שורות 13-44 — טיפוס `CliSpec` (unsetEnv/setEnv); ל-claude אין default env.
- `scripts/claude-direct-be.sh` (untracked, בשורש) — ה-workaround שמבוטל; מבטא בדיוק את ה-spec המבוקש.
- SDK types: `node_modules/.pnpm/@anthropic-ai+claude-agent-sdk-*/…/sdk.d.ts` — לאופציית `env` של query
  (`env?: { [k:string]: string | undefined }`, "not merged with process.env").

---

## §1 — מטרה

claude שרץ **in-process** יכבד את `unsetEnv`/`setEnv` שהוגדרו ל-`claude` בקובץ ה-cli-spec. כך אפשר להביע
**הצהרתית** את החרגת-Anthropic — הסרת `ANTHROPIC_API_KEY` והוספת `NO_PROXY=api.anthropic.com` — כך
שה-claude יאמת מול Anthropic דרך OAuth המנוי (`~/.claude`) במקום דרך שער OneCLI (401). ההחרגה חלה **רק
על תת-תהליך ה-claude**, לא על תהליך ה-BE — ולכן ה-proxy של ElevenLabs/Google (TTS) נשאר שלם. בסיום,
ה-workaround הצדדי נזרק לטובת קונפיג מוצהר (`deploy/cli-specs.jsonc` + `CLI_SPECS_FILE`).

---

## §2 — Scope

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| env shaping ל-claude in-process (unsetEnv/setEnv → SDK env) | ✅ | הסבב הזה |
| החלה על **כל** נתיבי יצירת-session שמ-spawn-ים claude (new/load/resume/fork) | ✅ | §4 commit 2 |
| retire של `claude-direct-be.sh` + עטיפת systemd | ✅ | §4 commit 3 |
| שינוי `drivecodingShapeEnv` (backend) או חיווט `shapeEnv` ל-connect-in-process | ❌ | לא נדרש — connect-in-process קורא `getCliSpec` ישירות (§9 Q2). shapeEnv הוא ערוץ ה-spawn-path |
| env shaping ל-codex in-process | ❌ | codex לא צורך cli-spec env; slice נפרד אם יידרש |
| שינוי מנגנון הטעינה של cli-specs (`loadCliSpecsOverride`) | ❌ | קיים ועובד; רק **צורכים** אותו |
| הרחבת `injectModelOverride` ל-load/resume/fork | ❌ | מחוץ ל-scope; רק `injectEnvOverride` מוחל על כל הארבעה |
| model-picker / thinkingTokens | ❌ | כבר עובדים in-process |

---

## §3 — Architecture

```
FE (ACP client)
  │  session/new · session/load · session/resume · session/fork   (JSON-RPC over wire)
  ▼
connect-in-process.ts  (agentApp handlers)
  │  ctx.params
  │  ┌───────────────────────────────────────────────────────────────┐
  │  │ injectModelOverride(params, modelOverride)    ← קיים (רק new)  │
  │  │ injectEnvOverride(params, envOverride)         ← חדש (4 nתיבים)│
  │  │   envOverride = buildClaudeEnvOverride(getCliSpec("claude"))   │  ← חדש: claude-env-override.ts
  │  │   → כותב ל-_meta.claudeCode.options.env                        │
  │  └───────────────────────────────────────────────────────────────┘
  ▼
ClaudeAcpAgent (@agentclientprotocol/claude-agent-acp)  createSession(params)
  │  userProvidedOptions = params._meta.claudeCode.options
  │  options.env = { ...process.env, ...userProvidedOptions.env, ...createEnvForGateway(∅), CLAUDE_CODE_EMIT…}
  ▼
@anthropic-ai/claude-agent-sdk  query(options)
  │  initialize():  env: c = this.options.env        (ללא re-merge של process.env)
  ▼
spawn(claude CLI, { env: c })
  │  ANTHROPIC_API_KEY: undefined  →  Node משמיט את המפתח  →  claude נופל ל-OAuth (~/.claude)
  │  NO_PROXY=api.anthropic.com    →  claude עוקף את שער OneCLI ומדבר ישירות מול Anthropic
  ▼
api.anthropic.com  (OAuth מנוי — לא 401)

תהליך ה-BE עצמו:  process.env  ← לא נגוע  →  TTS proxy (ElevenLabs/Google) שלם
```

**ממצאי-אימות מרכזיים** (אומתו מ-node_modules לפני כתיבת ה-brief — לא הנחות):
1. `@agentclientprotocol/claude-agent-acp` `createSession` (`dist/acp-agent.js:2422-2428`, גרסה 0.52.0) בונה
   `env: { ...process.env, ...userProvidedOptions?.env, ...createEnvForGateway(this.gatewayAuthRequest), CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS:"1" }`,
   כאשר `userProvidedOptions = params._meta?.claudeCode?.options` — **אותו ערוץ שדרכו מוזרק `model` היום.**
   `userProvidedOptions.env` ממוזג **אחרי** `process.env` → ערכינו מנצחים.
2. `createEnvForGateway(request)` מחזיר `{}` כש-`request?._meta` נפל (`dist/acp-agent.js:2712`). `gatewayAuthRequest`
   נקבע רק מ-`authenticate` עם gateway-meta — drive-coding לא שולח (OneCLI = שכבת-רשת, לא gateway של claude).
   ⇒ אין הזרקה-חוזרת של `ANTHROPIC_BASE_URL`/auth שתבטל את ההחרגה.
3. `@anthropic-ai/claude-agent-sdk` (`sdk.mjs`, `initialize()`) עושה `env: c = this.options.env` (default
   `{...process.env}` **רק** אם `env` undefined) ומעביר `env:c` ל-`spawn` **verbatim** — **אין** re-merge
   שני של `process.env` שהיה מחזיר את `ANTHROPIC_API_KEY`. (מתועד גם ב-`sdk.d.ts`: "not merged with process.env".)
4. **Node semantics (נבדק אמפירית בסבב זה):** ערך env של `undefined` ב-`child_process.spawn` ⇒ המפתח
   **נשמט** מ-env של ה-child (זהה ל-`delete`; לא הופך למחרוזת `"undefined"`). ⇒ unset עובד ע"י ערך `undefined`.
5. כל ארבעת ה-handlers מגיעים ל-`createSession`: `newSession`→`createSession(params)`; `unstable_forkSession`
   ו-`getOrCreateSession` (עבור load+resume) מעבירים `_meta: params._meta` (`dist/acp-agent.js:435-475, 2257-2281`).

---

## §4 — Commits

### Commit 1 — `claude-env-override.ts`: שתי פונקציות טהורות (approach: **TDD**)

**קובץ חדש**: `packages/provider/src/connection/claude-env-override.ts`
**קובץ טסט חדש**: `packages/provider/src/connection/claude-env-override.test.ts`

**API skeleton** (executor **לא** משנה חתימות):
```ts
import type { CliSpec } from "@drive-coding/core"

/**
 * מתרגם spec.unsetEnv/setEnv לאובייקט env-override לערוץ ה-SDK (_meta.claudeCode.options.env).
 * unsetEnv → מפתח עם ערך undefined (Node משמיט אותו ב-spawn ⇒ unset).
 * setEnv   → מפתח עם ערך string (דורס את process.env בתוך ה-SDK).
 * סדר: unsetEnv קודם, ואז setEnv — כדי ש-setEnv ינצח בהתנגשות (זהה ל-spawn-core: delete ואז assign).
 * מחזיר undefined אם אין unsetEnv ולא setEnv (אין מה להזריק).
 */
export function buildClaudeEnvOverride(
  spec: CliSpec | undefined,
): Record<string, string | undefined> | undefined

/**
 * ממזג envOverride לתוך params._meta.claudeCode.options.env, בלי לדרוס _meta/claudeCode/options/env קיימים.
 * מחזיר את params ללא שינוי אם envOverride נפל (undefined).
 * מבנה זהה ל-injectModelOverride (אותו נתיב _meta.claudeCode.options).
 */
export function injectEnvOverride<T extends Record<string, unknown>>(
  params: T,
  envOverride: Record<string, string | undefined> | undefined,
): T
```

**מקרי-טסט חובה** (`buildClaudeEnvOverride`):
- spec `undefined` → `undefined`.
- spec בלי unsetEnv ובלי setEnv → `undefined`.
- רק `unsetEnv:["ANTHROPIC_API_KEY"]` → ודא שהמפתח **קיים עם ערך undefined**:
  `expect("ANTHROPIC_API_KEY" in result).toBe(true)` **וגם** `expect(result.ANTHROPIC_API_KEY).toBeUndefined()`.
- רק `setEnv:{NO_PROXY:"api.anthropic.com"}` → `{ NO_PROXY:"api.anthropic.com" }`.
- שניהם (התרחיש האמיתי) → `{ ANTHROPIC_API_KEY:undefined, NO_PROXY:"…", no_proxy:"…" }`.
- התנגשות (`unsetEnv:["X"]` + `setEnv:{X:"v"}`) → `{ X:"v" }` (setEnv מנצח).

**מקרי-טסט חובה** (`injectEnvOverride`):
- envOverride undefined → params זהה.
- params ריק → `params._meta.claudeCode.options.env` שווה ל-envOverride.
- params עם `_meta.claudeCode.options.model` קיים → ה-model **נשמר** וה-env מתווסף לצידו (אי-דריסה).

**Verification**:
```bash
pnpm --filter @drive-coding/provider test claude-env-override
pnpm typecheck
```

---

### Commit 2 — חיווט ל-connect-in-process (approach: mixed — wiring + structural test)

**קובץ שמשתנה**: `packages/provider/src/connection/connect-in-process.ts`
- ייבוא: `getCliSpec` מ-`../config/index.js`; `buildClaudeEnvOverride, injectEnvOverride` מ-`./claude-env-override.js`.
- **חישוב פעם אחת** בתוך `connectInProcess`, לפני בניית ה-agentApp:
  ```ts
  const envOverride = buildClaudeEnvOverride(getCliSpec("claude", process.env))
  ```
  (getCliSpec→loadCliSpecsOverride ממומואזים per-process — קריאה זולה.)
- החל `injectEnvOverride(params, envOverride)` בכל ארבעת ה-handlers שמ-spawn-ים claude:
  - `session.new` — **הרכב** עם `injectModelOverride` הקיים (env אחרי model; שניהם ל-`_meta.claudeCode.options`).
    ה-cast ל-`NewSessionRequest` נשמר:
    ```ts
    // before:
    const params = injectModelOverride(ctx.params, opts.modelOverride) as NewSessionRequest
    // after:
    const withModel = injectModelOverride(ctx.params, opts.modelOverride)
    const params = injectEnvOverride(withModel, envOverride) as NewSessionRequest
    ```
  - `session.load` — `claudeAgent.loadSession(injectEnvOverride(ctx.params, envOverride))`.
  - `session.resume` — `claudeAgent.resumeSession(injectEnvOverride(ctx.params, envOverride))`.
  - `session.fork` — `claudeAgent.unstable_forkSession(injectEnvOverride(ctx.params, envOverride))`.
- **הערת-קוד** מעל ה-handlers (2-3 שורות): `_meta.claudeCode.options.env` הוא הערוץ; ה-SDK ממזג אותו מעל
  `process.env` (createSession) ו-Node משמיט ערכי-undefined ב-spawn ⇒ unset. תיעוד ליד הקוד.

**קובץ טסט שמשתנה**: `packages/provider/src/connection/connect-in-process.test.ts`
- טסט קל: כתוב קובץ jsonc זמני (`os.tmpdir()`) עם `{"claude":{"unsetEnv":["ANTHROPIC_API_KEY"],"setEnv":{...}}}`,
  הצבע אליו `process.env.CLI_SPECS_FILE`, ואמת ש-`connectInProcess` נבנה ללא-קריסה.
  ⚠️ **חובה `vi.resetModules()` לפני** (loadCliSpecsOverride ממומואז per-process, `cli-config-file.ts`), וניקוי
  `CLI_SPECS_FILE` + מחיקת הקובץ אחרי.
  ⚠️ **אל תשתמש ב-`CLI_SPECS_JSON`** — ה-provider's `cli-config-file.ts` (הנתיב שלנו) לא תומך בו; רק `CLI_SPECS_FILE`+default-path.
  אם אפשר לרגל על ה-params שמגיעים ל-agent — אמת נוכחות `_meta.claudeCode.options.env`; אם קשה (SDK in-process) —
  ההזרקה כבר מכוסה ברמת-יחידה ב-Commit 1. **אל תבנה טסט חי מול claude אמיתי** (אין claude ב-CI/JSDOM).

**קבצים חדשים (כלי אימות-מנגנון — משרתים את §8b)**: `scripts/claude-env-sinkhole.mjs` + `scripts/claude-env-proxy-logger.mjs`
> ESM בלבד (`.mjs`; אין CommonJS — AGENTS.md). כלי-אבחון: מוכיחים שה-env שהוזרק הגיע לתת-תהליך claude,
> על כל מכונה עם claude — **בלי OneCLI/OAuth/שריפת-יתרה**. ר' §8b לתוכן המלא ולהרצה.

**Verification**:
```bash
pnpm --filter @drive-coding/provider test connect-in-process
pnpm typecheck && pnpm lint
node --check scripts/claude-env-sinkhole.mjs && node --check scripts/claude-env-proxy-logger.mjs
```

---

### Commit 3 — retire ה-workaround + קונפיג מוצהר מתועד (approach: manual)

**קובץ חדש (tracked)**: `deploy/cli-specs.jsonc`
```jsonc
// cli-specs.jsonc — CLI env shaping per cliKind (נצרך ע"י loadCliSpecsOverride דרך CLI_SPECS_FILE).
// claude in-process: החרג את api.anthropic.com מ-OneCLI (proxy + key placeholder),
// כדי שה-claude יאמת דרך OAuth המנוי (~/.claude) ולא דרך השער (401).
// חל רק על תת-תהליך ה-claude — ה-BE (TTS proxy של ElevenLabs/Google) לא נגוע.
{
  "claude": {
    "unsetEnv": ["ANTHROPIC_API_KEY"],
    "setEnv": { "NO_PROXY": "api.anthropic.com", "no_proxy": "api.anthropic.com" }
  }
}
```

**קבצים שמשתנים**: `deploy/systemd/voice-acp-dev.service`, `deploy/systemd/voice-acp-main.service`
> ⚠️ **מצב-בסיס מעודכן (2026-07-03)**: ה-`ExecStart` ה-**tracked** כבר **נקי** — אין בו עטיפת `claude-direct-be.sh`
> (העטיפה הייתה עריכה מקומית לא-מקומיטת בעץ-העבודה של `dev`; מעולם לא נכנסה ל-git — `git log -S claude-direct-be` ריק).
> לכן **אין מה להסיר מ-ExecStart** — רק להוסיף את ה-`Environment` ולעדכן הערה. (`dc-launch-version-check` כבר מוזג —
> ExecStartPre עבר ל-`--if-stale`; אנחנו נוגעים בשורה אחרת → אין conflict.)
- **הוסף** מעל שורת ה-`ExecStart`, בשני הקבצים: `Environment=CLI_SPECS_FILE=<WorkingDirectory>/deploy/cli-specs.jsonc`:
  - dev: `/home/user/projects/drive-coding/dev/deploy/cli-specs.jsonc`
  - main: `/home/user/projects/drive-coding/main/deploy/cli-specs.jsonc`
- **הוסף הערת-הסבר** מעל ה-`ExecStart` (2 שורות): claude in-process מאמת דרך OAuth המנוי; ההחרגה של
  api.anthropic.com מ-OneCLI מוגדרת הצהרתית ב-`deploy/cli-specs.jsonc` (`CLI_SPECS_FILE`), scoped לתת-תהליך
  claude בלבד — ה-BE (TTS proxy) לא נגוע.

**מחיקה (מחוץ ל-worktree — פעולת-deploy, לא git)**: `scripts/claude-direct-be.sh` untracked וקיים רק בעץ-העבודה
של `dev` הראשי (לא ב-worktree) → ציין ב-walkthrough שיש למחוק אותו ידנית + לוודא שאין עריכת-`ExecStart` מקומית
עם ה-wrapper בסביבות ה-deploy (MiniPC). אין פעולת-git ב-worktree.

**docs**: פסקה קצרה ל-`docs/deploy-local-service.md` — "claude in-process auth: החרגת api.anthropic.com
דרך `deploy/cli-specs.jsonc` + `CLI_SPECS_FILE`, לא דרך wrapper".

**Verification**:
```bash
grep -rn "claude-direct-be" deploy/systemd/*.service            # 0 מופעים
grep -rn "CLI_SPECS_FILE" deploy/systemd/*.service              # 2 מופעים (dev+main)
test -f deploy/cli-specs.jsonc && echo "config committed"
# JSONC תקין (אחרי strip comments):
node -e "const fs=require('fs');const t=fs.readFileSync('deploy/cli-specs.jsonc','utf8').replace(/\/\*[\s\S]*?\*\//g,'').split('\n').map(l=>l.trimStart().startsWith('//')?'':l).join('\n');console.log(JSON.stringify(JSON.parse(t)))"
```

---

## §5 — DoD

| בדיקה | איך |
|---|---|
| `buildClaudeEnvOverride` נכון בכל 6 המקרים | `pnpm --filter @drive-coding/provider test claude-env-override` ירוק |
| unset מיוצג כמפתח-עם-undefined (לא היעדר-מפתח) | טסט: `"ANTHROPIC_API_KEY" in result === true && result.ANTHROPIC_API_KEY === undefined` |
| `injectEnvOverride` לא דורס model קיים | טסט Commit 1 |
| env מוזרק בכל 4 ה-handlers | code-review: new/load/resume/fork קוראים `injectEnvOverride` |
| אין רגרסיה ב-connect-in-process | `pnpm --filter @drive-coding/provider test connect-in-process` ירוק |
| typecheck + lint + i18n | `pnpm typecheck && pnpm lint && pnpm lint:i18n` ירוקים |
| **[local — mechanism]** ה-env המוזרק מגיע לתת-תהליך claude | §8b — sinkhole מדפיס `HIT` (בלי OneCLI). GO לפני deploy |
| workaround הוסר | `grep -rn "claude-direct-be" deploy/systemd/*.service` = 0; הקובץ נמחק |
| קונפיג מוצהר קיים ותקין | `deploy/cli-specs.jsonc` קיים + עובר JSON.parse אחרי strip |
| **[runtime — deploy]** claude חי מדבר עם Anthropic (לא 401) | ר' §8c — כלב על מכונת-deploy |
| **[runtime — deploy]** TTS (ElevenLabs/Google) עדיין דרך proxy | ר' §8c |

---

## §6 — Risks

| סיכון | מקור | מיטיגציה |
|---|---|---|
| ה-SDK מבצע zod-validate ל-`options.env` ופוסל ערך `undefined` | חשד מ-`env:l.record(l.string())` ב-sdk.mjs | אומת: נתיב ה-ACP-adapter מבצע destructure ישיר (`initialize(): env:c=this.options.env`) **בלי** re-parse של env. אם בכל-זאת ייכשל ב-runtime — fallback: לייצג unset כערך `""` (עדכון `buildClaudeEnvOverride` בלבד), **רק** אם runtime-gate מוכיח צורך. ברירת-מחדל: **undefined** |
| ההחרגה שוברת את ה-TTS proxy (ElevenLabs/Google) | אזהרת מרדכי #1 | הזרקה scoped ל-**תת-תהליך claude בלבד** דרך `_meta.claudeCode.options.env`; `process.env` של ה-BE **לא נגוע** → TTS שלם. **בטוח יותר** מה-wrapper הישן (ששינה את כל env ה-BE). runtime-gate מאמת את שני הצדדים |
| `createEnvForGateway` מזריק בחזרה `ANTHROPIC_BASE_URL`/auth ומבטל את ההחרגה | קוד SDK | מחזיר `{}` כשאין gateway-auth-meta; drive-coding לא שולח authenticate עם gateway-meta. אם runtime-gate יראה הזרקה — escalate |
| memoization של `loadCliSpecsOverride` תופס override ישן בטסטים | `cli-config-file.ts:136` (`_cached`) | `vi.resetModules()` לפני קריאה עם env שונה (תבנית קיימת ב-provider tests) |
| Hardcoded Hebrew ב-קוד | pre-commit hook | אין מחרוזות UI; רק הערות עברית ליד קוד (מותר) + אנגלית ב-`.jsonc`/`.service` |
| התנגשות merge עם `dc-launch-version-check` | שני הסבבים נוגעים ב-`voice-acp-{dev,main}.service` | שורות **שונות** (הוא: `ExecStartPre`; אנחנו: `ExecStart`+`Environment`). conflict נמוך. תיאום merge-order — §9 Q4 |

---

## §7 — Escalation triggers

עצור ושאל את מרדכי (parent task) אם:
- runtime-gate מראה 401 גם אחרי הסרת `ANTHROPIC_API_KEY` — ייתכן שצריך גם unset של `HTTP(S)_PROXY`
  (רחב יותר מ-`NO_PROXY`), או ש-`createEnvForGateway` פועל בניגוד לצפי.
- ערך env `undefined` **כן** מגיע ל-child כמחרוזת `"undefined"` או מפיל את ה-SDK (בניגוד לאימות) — הכרעת fallback.
- ה-TTS proxy נשבר אחרי השינוי (escalation מיידי — נגענו במשהו גלובלי בטעות).
- `getCliSpec("claude", …)` מחזיר `undefined` בסביבת-deploy (הקובץ לא נטען דרך `CLI_SPECS_FILE`).

---

## §8 — Complexity score + verifier

**Score: 5/10** —
- commits: 3 (נמוך) · שכבות חדשות: 1 (מודול טהור קטן) · API חיצוני: ניצול ערוץ env קיים של ה-SDK (+0)
- streaming/async: אין · state-refactor: אין · protocol BE↔FE: אין
- **+2** על עדינות: תלות בהתנהגות SDK/Node לא-מתועדת (unset ע"י undefined) + השלכת-auth שקטה אם שוגים.

**verifier**: `calev` (light). האימות מתפצל ל-3 שערים — **§8a קוד** (בכל מקום) → **§8b מנגנון-חי מקומי**
(בכל מכונה עם claude, בלי OneCLI) → **§8c התנהגות-auth** (deploy בלבד). §8b מוציא את ליבת-האימות
(האם ה-env מגיע לתת-התהליך) מהתלות ב-deploy.

#### §8a — code-gate (calev light, בכל מקום)
`pnpm typecheck && pnpm lint && pnpm lint:i18n` ירוקים · `pnpm --filter @drive-coding/provider test` ירוק ·
code-review ש-`injectEnvOverride` מוחל ב-4 ה-handlers.

#### §8b — local mechanism-gate (חי, בכל מכונה עם claude — **בלי OneCLI/OAuth**)
מוכיח שה-env שהזרקנו (`_meta.claudeCode.options.env`) **באמת מגיע לתת-תהליך claude**, ע"י משתנה-claude
נצפה (`ANTHROPIC_BASE_URL`) שמפנה ל-sinkhole מקומי. אותו נתיב-קוד של הפרודקשן (spawn-env → HTTP client
של claude), רק host נצפה במקום החרגה. **לא צורך OneCLI, לא OAuth, לא שורף יתרה.**

1. spec-בדיקה זמני (temp jsonc; `CLI_SPECS_FILE` מצביע אליו):
   ```jsonc
   { "claude": { "setEnv": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:9999" } } }
   ```
2. הפעל sinkhole (`scripts/claude-env-sinkhole.mjs`):
   ```js
   // claude-env-sinkhole.mjs — נקודת-קצה מזויפת של Anthropic ל-mechanism-gate.
   // מוכיח ש-ANTHROPIC_BASE_URL (שהוזרק דרך cli-spec) הגיע לתת-תהליך claude:
   // אם בקשה נוחתת כאן — ההזרקה עובדת. אין forwarding; לא צריך תשובה תקינה.
   import { createServer } from "node:http"
   const port = Number(process.env.SINK_PORT ?? 9999)
   let hits = 0
   createServer((req, res) => {
     console.log(`HIT #${++hits}`, req.method, req.url, "host:", req.headers.host)
     res.writeHead(401, { "content-type": "application/json" })
     res.end('{"error":"sinkhole"}')
   }).listen(port, "127.0.0.1", () => console.log(`sinkhole on http://127.0.0.1:${port}`))
   ```
   `node scripts/claude-env-sinkhole.mjs`
3. הפעל BE (**בלי** OneCLI — כאן זה לא נדרש): `CLI_SPECS_FILE=<temp> bun packages/backend/src/server.ts`,
   פתח session של claude מה-FE ושלח prompt כלשהו.
   - ✅ **GO**: ה-sinkhole מדפיס `HIT POST /v1/messages` (host `127.0.0.1:9999`) → ה-env הגיע לתת-התהליך.
     **המנגנון מאושר-חי.** (claude יקרוס אח"כ על תשובת-הזבל — לא אכפת; ה-HIT כבר הוכיח.)
   - ❌ **NO-GO**: שקט ב-sinkhole / claude פנה ל-`api.anthropic.com` → ההזרקה לא מגיעה ל-child → תקן לפני deploy.

> **וריאנט B (אופציונלי — נאמן-יותר ל-proxy)**: במקום base-URL, `setEnv: { "HTTPS_PROXY": "http://127.0.0.1:9999" }`
> + `scripts/claude-env-proxy-logger.mjs` — proxy מינימלי שמלוגג `CONNECT api.anthropic.com:443` ומנהרר הלאה
> (הבקשה עדיין יכולה להשלים). מדמה את דינמיקת ה-proxy-routing עצמה, אך מיותר ל-mechanism-gate (וריאנט A מספיק).
> ```js
> // claude-env-proxy-logger.mjs — proxy מלוגג-CONNECT ל-mechanism-gate (וריאנט B).
> import { createServer } from "node:http"
> import { connect } from "node:net"
> const port = Number(process.env.PROXY_PORT ?? 9999)
> const srv = createServer((_req, res) => { res.writeHead(405); res.end() })
> srv.on("connect", (req, client, head) => {
>   console.log("CONNECT", req.url) // api.anthropic.com:443
>   const [host, p] = req.url.split(":")
>   const up = connect(Number(p) || 443, host, () => {
>     client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
>     up.write(head); up.pipe(client); client.pipe(up)
>   })
>   up.on("error", () => client.end())
> })
> srv.listen(port, "127.0.0.1", () => console.log(`proxy-logger on http://127.0.0.1:${port}`))
> ```

> ⚠️ **מגבלת §8b**: מוכיח **injection+set** (ה-env מגיע ומשפיע על routing). **לא** מוכיח את התנהגות ה-**unset**
> הספציפית (`ANTHROPIC_API_KEY` נעלם → נפילה ל-OAuth) ולא את bypass ה-`NO_PROXY` מול OneCLI — אלה ב-§8c.
> אם claude לא נטען בכלל על Windows המקומי (בעיית spawn ידועה) — §8b יורץ על deploy/termux (עדיין זול מ-§8c: בלי OneCLI).

#### §8c — deploy runtime-gate (התנהגות-auth — **deploy בלבד**)
> ✅✅ **§8b+§8c אומתו חי end-to-end על הקוד המוממש** (טלפון/termux, 2026-07-03): הרצנו את ה-live test
> `connect-in-process.live.test.ts` (RUN_LIVE=1, `onecli` עם token-דמה מוזרק, `CLAUDE_CODE_EXECUTABLE`=termux-claude).
> **Control** (בלי `CLI_SPECS_FILE`): `× prompt → claude responds` — **timeout 60s** (dummy token → claude נתקע).
> **Fix** (`CLI_SPECS_FILE=deploy/cli-specs.jsonc`): `✓ prompt → claude responds with DRIVE_OK_5678` — **3.3s, 4/4 passed**.
> אותו env בדיוק; ההבדל היחיד = ה-cli-spec שהקוד קורא ומזריק דרך `_meta`. מוכיח את המנגנון (§8b) **וגם** ההתנהגות (§8c).
> **runtime-gate = GO.** (הבדיקות למטה נשמרות לתיעוד נתיב-ה-FE המלא; הליבה כבר אומתה.)
> ✅ **ההתנהגות אומתה חי מוקדם** (טלפון/termux, 2026-07-03, לפני מימוש): עם token-דמה מוזרק ב-OneCLI,
> `claude -p` הגולמי (אותו נתיב-auth כמו ה-SDK-spawned) **נתקע** בברירת-מחדל, ו-`env -u ANTHROPIC_API_KEY
> NO_PROXY=…` החזיר **OK** (OAuth). כלומר §8c מאשר את **המנגנון המחווט** (שה-`_meta`-injection מייצר את אותה
> צורת-env) — ההתנהגות עצמה כבר ידועה-עובדת. הדימנשן הקריטי = `unset ANTHROPIC_API_KEY`; `NO_PROXY` הגנתי.
1. פרוס את ה-branch למכונת-deploy (או termux) עם OneCLI + claude + `~/.claude` מחובר (OAuth מנוי).
2. ודא `CLI_SPECS_FILE` → `deploy/cli-specs.jsonc` (או קובץ ב-`~/.config/drive-coding/cli-specs.jsonc`).
   **הערה**: ה-provider קורא רק `CLI_SPECS_FILE`+default-path — לא `CLI_SPECS_JSON`.
3. הפעל BE **בלי** ה-wrapper: `onecli run --agent voice-acp -- bun packages/backend/src/server.ts`.
4. שיחת claude חיה → prompt.
   - ✅ **GO**: התשובה זורמת; ב-`WIRE_RECORD=1`/לוג — **אין** 401 מ-`api.anthropic.com`.
   - ❌ **NO-GO**: 401 / הודעת-auth.
5. באותה סביבה: TTS (השמעת-בועה) → ✅ ElevenLabs/Google עובד (proxy שלם; אין `TTS failed: 401`).

מרדכי לא ממזג עד **§8c=GO**. §8b הוא תנאי-מקדים חי שמאשר את המנגנון לפני deploy; כלב מריץ §8a+§8b (וגם §8c אם על deploy).

---

## §9 — שאלות פתוחות

| # | שאלה | ברירת מחדל | חוסם? |
|---|---|---|---|
| 1 | לייצג unset ע"י `undefined` או `""` ? | **`undefined`** — אומת: Node משמיט; SDK לא מ-validate בנתיב זה. מעבר ל-`""` רק אם runtime-gate מוכיח כשל | ❌ (fallback ידוע) |
| 2 | שכבה: provider (connect-in-process קורא `getCliSpec`) או backend (`drivecodingShapeEnv`+חיווט shapeEnv)? | **provider** — מקביל ל-spawn-core (שגם קורא `getCliSpec`), בלי לגעת ב-hook ה-spawn-path. הזרקה דרך `_meta` (לא env-mutation) — provider-טהור, בטוח ל-BE | ❌ (הוכרע) |
| 3 | להזריק env גם ב-load/resume/fork, או רק ב-new? | **כל הארבעה** — כל אחד מ-spawn claude דרך `createSession`; 401 ב-reattach = UX גרוע. אומת ש-4 ה-handlers מעבירים `_meta` | ❌ (הוכרע) |
| 4 | merge-order מול `dc-launch-version-check` (שניהם ב-`.service`) | שורות שונות (ExecStartPre מול ExecStart+Environment). מי שממזג שני — rebase טריוויאלי. מרדכי מתאם | ❌ |
| 5 | לקבע את `deploy/cli-specs.jsonc` (tracked) או להשאיר ב-`~/.config` (user)? | **tracked** (`CLI_SPECS_FILE`) — declarative, ב-git, ליד ה-unit; לא משפיע על dev מקומי (שלא מגדיר `CLI_SPECS_FILE`). ⚠️ `CLI_SPECS_JSON` אינו אופציה — ה-provider לא קורא אותו | ❌ (הוכרע) |

---

## §10 — הערות לביצוע

- **אל תיגע ב-`process.env` גלובלית.** כל השינוי דרך `_meta.claudeCode.options.env` (scoped לתת-תהליך claude).
- `injectModelOverride` כרגע מוחל **רק** ב-`session.new` — הסבב לא מרחיב אותו; רק `injectEnvOverride` מוחל על כל הארבעה.
- הפונקציות ב-`claude-env-override.ts` הן ליבה נטולת-IO → TDD מלא. החיווט ב-connect-in-process הוא glue → אימות מבני קל + runtime-gate.
- **מגבלה ידועה (אביגיל 🟢)**: `getOrCreateSession` על session **חי** עם fingerprint תואם מחזיר מוקדם **בלי** `createSession`
  (`dist/acp-agent.js:2258-2266`) → env-override חסר-אפקט שם. זה **תקין** — ה-env נחוץ ב-spawn הראשון בלבד (session/new
  או load/resume שמפעיל createSession בפועל). אין תרחיש שבו claude נוצר-לראשונה בלי לעבור createSession.

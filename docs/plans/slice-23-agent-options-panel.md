# Slice 23 — Agent Options Panel — ‏תוכנית

> **‏תאריך**: 2026-06-01
> **‏סטטוס**: ‏הושלם ✅ (2026-06-01, אליעזר)
> **Complexity**: 4/10 (verifier: light)
> **‏תלויות (`depends_on`)**: [] — ‏בנוי ישירות על `dev`
> **‏Base**: dev
> **‏Dev tip**: `62b41a0dcdb039bcdd09dba99f97238496f2924b`

---

## §0 — Pre-flight

> ‏אם אתה executor חדש: קרא את [`EXECUTOR_DISPATCH.md`](./EXECUTOR_DISPATCH.md) לפני כל דבר אחר.

### ‏תלויות (חובה)

‏slice זה **מבוסס על dev בלבד**. כל הסמלים שצוינים להלן קיימים ב-dev tip:

- `packages/frontend/src/routes/chat/+page.svelte` — layout הצ'אט: `ChatHeader`, `ChatBubbles`, `ChatInput`.
- `packages/frontend/src/lib/components/chat/ChatHeader.svelte` — header קיים עם status, cwd, audio toggle, disconnect, ⚙️.
- `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — `AgentSession` עם `attach`, `loadSession`, `status`, `#client`, `#sessionId`.
- `packages/core/src/acp/client.ts` — `AcpClient` עם `newSession`, `loadSession`, `prompt`, `cancel`, `close`.
- `@agentclientprotocol/sdk@0.21.1` — `ClientSideConnection.setSessionConfigOption`, `setSessionMode`, `unstable_setSessionModel`, types: `SessionConfigOption`, `SessionModeState`, `SessionModelState`.
- `packages/core/src/i18n/keys.ts` + `catalogs/{he,en}.ts` — append-only i18n.

`depends_on: []`.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-23-agent-options-panel -b slice-23-agent-options-panel dev
cd .worktrees/slice-23-agent-options-panel
pnpm install
pnpm hooks:install
```

### ‏איך להריץ

| ‏מה | ‏פקודה |
|---|---|
| ‏BE | `cd packages/backend && LOG_WIRE=ws PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev` |
| ‏Typecheck | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| ‏כללי | `pnpm typecheck && pnpm lint:i18n` |

‏אם port 4001 תפוס — עבור ל-4002+. **אל תהרוג** שירותים קיימים.

### Browser

‏Chrome רגיל. אין מיקרופון בסלייס הזה — אין צורך ב-HTTPS/tunnel.

### OneCLI

```bash
onecli run --agent voice-acp -- bun --watch src/server.ts
```

### Reading list

**must-read**:

1. `packages/frontend/AGENTS.md` — 5 חוקי הזהב + מבנה 5 שכבות.
2. `packages/frontend/src/routes/chat/+page.svelte` — ה-layout שמשתנה.
3. `packages/frontend/src/lib/components/chat/ChatHeader.svelte` — header שמשתנה.
4. `packages/frontend/src/lib/view-models/agent-session.svelte.ts` — VM שמורחב.
5. `packages/core/src/acp/client.ts` — ACP client שמורחב.
6. `docs/conventions/parallel-safe-code.md` §1–§4.

**reference**:

- `node_modules/.pnpm/@agentclientprotocol+sdk@0.21.1_zod@4.4.3/node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` — `SessionConfigOption`, `SessionModeState`, `SessionModelState`, `SetSessionConfigOptionRequest` (discriminated union!).
- זיכרון: `gotcha-opencode-acp-doesn-t-accept-m-model-flag` — לא להעביר `--model`/`--agent` ל-`opencode acp`.

---

## §1 — ‏מטרה

‏אחרי שהמשתמשת מתחברת ונכנסת לצ'אט, מופיע ווידג'ט מתקפל שמאפשר לשנות מודל, סוכן/mode, ואפשרויות config נוספות — **על הסשן הפתוח**. ה-dropdowns מאוכלסים מהנתונים האמיתיים שה-agent החזיר ב-`session/new`/`session/load`. שינוי מוחל מיד דרך `session/set_config_option`. לא צריך cache, לא צריך ניחושים — תמיד מה שה-agent תומך.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏ווידג'ט בצ'אט להחלת model/mode בסשן פתוח | ✅ | ‏הסלייס הזה |
| ‏Dropdowns ממולאים מ-`session.configOptions`/`models`/`modes` | ✅ | ‏הסלייס הזה |
| ‏תמיכה גנרית ב-`configOptions` מסוג `select` | ✅ | ‏הסלייס הזה |
| ‏תמיכה גנרית ב-`configOptions` מסוג `boolean` | ✅ | ‏הסלייס הזה |
| ‏החלה מיידית דרך `setSessionConfigOption` | ✅ | ‏הסלייס הזה |
| ‏Capture של `configOptions`/`models`/`modes` מ-session response | ✅ | ‏הסלייס הזה |
| ‏Settings cache של אפשרויות לפי cwd | ❌ | ‏לא נדרש — תמיד יש real data בסשן |
| ‏בחירת מודל/סוכן **לפני** פתיחת session | ❌ | ‏future slice (אם בכלל) |
| ‏MCP servers UI | ❌ | ‏future |
| ‏Provider config UI | ❌ | ‏future |
| ‏הרשאות auto-approve/ask | ❌ | ‏client policy, future |
| ‏VoicePicker בתוך הווידג'ט | ❌ | ‏נשאר במסך החיבור |
| ‏Persistence של בחירות ב-localStorage | ❌ | ‏future, אחרי שמבינים use-case |

---

## §3 — Architecture diagram

```text
routes/chat/+page.svelte
  ├── ChatHeader (קיים)
  ├── AgentOptionsPanel ← חדש (מוסיף בין ChatHeader ל-ChatBubbles)
  ├── ChatBubbles (קיים)
  └── ChatInput (קיים)

AgentOptionsPanel (component leaf)
  ├── reads: session.configOptions / session.models / session.modes
  └── calls: session.applyConfigOption(configId, value) → setSessionConfigOption

AgentSession (view-model)
  ├── new $state fields: configOptions, models, modes
  ├── captureSessionConfig(result) — קרוא מ-attach/loadSession אחרי newSession/loadSession
  └── applyConfigOption(configId, value) — public method → setSessionConfigOption/setSessionMode/setSessionModel

AcpClient
  └── new methods: setSessionConfigOption, setSessionMode, setSessionModel

ACP truth:
  session/new response    = { sessionId, configOptions?, models?, modes? }
  session/set_config_option { sessionId, configId, value }
```

### ‏כלל ארכיטקטורה מחייב

‏לא מוסיפים `--model`/`--agent` ל-`opencode acp`. כל שינוי דרך ACP בלבד, על סשן קיים.

---

## §4 — Commits ‏בסדר

### Commit 1 — ACP client methods (approach: integration)

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/core/src/acp/client.ts` | ‏הוסף 3 methods ל-`AcpClient` |

**API skeleton**:

```ts
import type {
  SetSessionConfigOptionResponse,
  SetSessionModeResponse,
  SetSessionModelResponse,
} from "@agentclientprotocol/sdk"

export type AcpClient = {
  // ─── existing ───
  conn: ClientSideConnection
  newSession(opts: { cwd: string }): ...
  loadSession(opts: { cwd: string; sessionId: string }): ...
  listSessions(): ...
  prompt(sessionId: string, text: string): ...
  cancel(sessionId: string): ...
  close(): void

  // ─── session config (slice 23) ───
  setSessionConfigOption(opts: {
    sessionId: string
    configId: string
    value: string | boolean
  }): Promise<SetSessionConfigOptionResponse>

  setSessionMode(opts: {
    sessionId: string
    modeId: string
  }): Promise<SetSessionModeResponse>

  setSessionModel(opts: {
    sessionId: string
    modelId: string
  }): Promise<SetSessionModelResponse>
}
```

**Implementation**:

> ⚠️ `SetSessionConfigOptionRequest` הוא discriminated union:
> boolean דורש `{ type: "boolean", value: boolean }`;
> string דורש `{ value: string }` בלי `type`.

```ts
async setSessionConfigOption(opts) {
  if (typeof opts.value === "boolean") {
    return conn.setSessionConfigOption({
      sessionId: opts.sessionId,
      configId: opts.configId,
      type: "boolean" as const,
      value: opts.value,
    })
  }
  return conn.setSessionConfigOption({
    sessionId: opts.sessionId,
    configId: opts.configId,
    value: opts.value,
  })
},

async setSessionMode(opts) {
  return conn.setSessionMode({ sessionId: opts.sessionId, modeId: opts.modeId })
},

async setSessionModel(opts) {
  return conn.unstable_setSessionModel({ sessionId: opts.sessionId, modelId: opts.modelId })
},
```

**Verification**:

```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 2 — AgentSession captures + exposes session config (approach: integration)

**‏מטרה**: ‏לשמור את ה-`configOptions`/`models`/`modes` שה-agent מחזיר, ולחשוף method ציבורית לשינוי config.

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/frontend/src/lib/view-models/agent-session.svelte.ts` | ‏3 שדות state חדשים + `captureSessionConfig` + `applyConfigOption` |

**API skeleton**:

```ts
import type { SessionConfigOption, SessionModeState, SessionModelState } from "@agentclientprotocol/sdk"

export class AgentSession {
  // ─── state ─── (existing fields not shown)
  // ─── session config (slice 23) ───
  configOptions = $state<SessionConfigOption[]>([])
  models        = $state<SessionModelState | null>(null)
  modes         = $state<SessionModeState | null>(null)

  /**
   * מחיל שינוי config על הסשן הפתוח. קורא ל-setSessionConfigOption עם
   * discriminated fallback ל-setSessionModel/setSessionMode.
   * זורק אם הסשן לא connected.
   */
  applyConfigOption = async (configId: string, value: string | boolean): Promise<void> => { ... }
}
```

**Algorithm — captureSessionConfig** (private helper):

```ts
// קרא מ-attach ומ-loadSession אחרי קבלת תגובת session/new/load:
#captureSessionConfig(result: {
  configOptions?: SessionConfigOption[] | null
  models?: SessionModelState | null
  modes?: SessionModeState | null
}): void {
  this.configOptions = result.configOptions ?? []
  this.models = result.models ?? null
  this.modes = result.modes ?? null
}
```

‏נקרא ב-`attach` — **עריכת קוד קיים**, לא החלפה:

> ⚠️ `sessionResult` כבר מוגדר בשורה ~109 של `attach()`. **אל תכתוב `const sessionResult` שוב.**
> רק הוסף קריאת `#captureSessionConfig` אחרי `this.#sessionId = sessionResult.sessionId ?? null`:

```ts
// שורה קיימת (109): const sessionResult = await this.#client.newSession({ cwd: input.cwd })
// שורה קיימת (110): this.#sessionId = (sessionResult as ...).sessionId ?? null
this.#captureSessionConfig(sessionResult)   // ← הוסף שורה אחת כאן
```

‏ב-`loadSession` — ה-return value הנוכחי **נזרק** בתוך `try/finally` (שורות ~213–218 בקוד):

```ts
// לפני (קוד קיים):
this.isLoadingHistory = true
try {
  await this.#client.loadSession({ sessionId: input.sessionId, cwd: input.cwd })
} finally {
  this.isLoadingHistory = false
}

// אחרי (שמור return value ב-try, לפני ה-finally):
this.isLoadingHistory = true
try {
  const loadResult = await this.#client.loadSession({ sessionId: input.sessionId, cwd: input.cwd })
  this.#captureSessionConfig(loadResult)   // ← חדש — sessionId מ-input, לא מה-response
} finally {
  this.isLoadingHistory = false
}
```

**Algorithm — applyConfigOption** (public):

```ts
applyConfigOption = async (configId: string, value: string | boolean): Promise<void> => {
  if (this.status !== "connected" && this.status !== "thinking") return
  if (!this.#client || !this.#sessionId) return

  // מסלול 1: option קיים ב-configOptions לפי id
  const optById = this.configOptions.find((o) => o.id === configId)
  if (optById) {
    const res = await this.#client.setSessionConfigOption({
      sessionId: this.#sessionId, configId, value,
    })
    this.configOptions = res.configOptions
    return
  }

  // מסלול 2: fallback key "model"/"mode" — חפש לפי category
  if (configId === "model" && typeof value === "string") {
    const byCat = this.configOptions.find((o) => o.category === "model")
    if (byCat) {
      const res = await this.#client.setSessionConfigOption({
        sessionId: this.#sessionId, configId: byCat.id, value,
      })
      this.configOptions = res.configOptions
      return
    }
    // fallback — לא מחזיר configOptions חדשים; עדכן models ידנית למניעת UI desync
    await this.#client.setSessionModel({ sessionId: this.#sessionId, modelId: value })
    if (this.models) this.models = { ...this.models, currentModelId: value }
    return
  }
  if (configId === "mode" && typeof value === "string") {
    const byCat = this.configOptions.find((o) => o.category === "mode")
    if (byCat) {
      const res = await this.#client.setSessionConfigOption({
        sessionId: this.#sessionId, configId: byCat.id, value,
      })
      this.configOptions = res.configOptions
      return
    }
    // fallback — לא מחזיר modes חדשים; עדכן ידנית
    await this.#client.setSessionMode({ sessionId: this.#sessionId, modeId: value })
    if (this.modes) this.modes = { ...this.modes, currentModeId: value }
    return
  }

  // מסלול 3: לא נמצא — skip בשקט (selection לא רלוונטית לסשן הזה)
  console.warn(`[AgentSession] configId "${configId}" not available — skipping`)
}
```

> ‏שים לב: `status` = "thinking" מאפשר שינוי גם תוך כדי תגובת הסוכן — זה intentional.
> ‏OpenCode תומך ב-`session/set_config_option` בכל עת.

**Verification**:

```bash
pnpm typecheck
pnpm --filter @drive-coding/frontend-v2 typecheck
```

---

### Commit 3 — AgentOptionsPanel UI + i18n (approach: manual)

**‏מטרה**: ‏ווידג'ט מתקפל בצ'אט שמציג model/agent + כל configOptions, עם החלה מיידית.

**‏קבצים חדשים**:

| ‏קובץ | ‏תפקיד |
|---|---|
| `packages/frontend/src/lib/components/chat/AgentOptionsPanel.svelte` | ‏רכיב leaf — מציג config, קורא `session.applyConfigOption` |

**‏קבצים משתנים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `packages/frontend/src/routes/chat/+page.svelte` | ‏הוסף `<AgentOptionsPanel />` אחרי `<ChatHeader>` |
| `packages/core/src/i18n/keys.ts` | ‏keys חדשים `agentOptions.*` |
| `packages/core/src/i18n/catalogs/he.ts` | ‏תרגום עברית |
| `packages/core/src/i18n/catalogs/en.ts` | ‏תרגום אנגלית |

**AgentOptionsPanel props skeleton**:

```ts
// אין props — component leaf שקורא getContext ישירות (כמו ChatHeader)
const session = getSession()
const t = getI18n().t
```

**Rendering rules**:

> ‏הרכיב מציג ב-3 מסלולים לפי מה שה-agent החזיר:
>
> **Model dropdown** (עדיפות):
> 1. אם `session.models?.availableModels?.length` → `<select>` מ-`availableModels`.
>    - כל option: `value={m.modelId}` (שדה `ModelInfo.modelId`), label: `m.name`.
>    - `selected={session.models.currentModelId}`.
>    - בעת שינוי: `session.applyConfigOption("model", e.target.value)`.
> 2. אחרת אם `const m = session.configOptions.find(o => o.category === "model")` קיים → `<select>` מ-`flattenSelectOptions(m)`.
>    - כל option: `value={o.value}`, label: `o.name`.
>    - `selected` לפי `(m as SessionConfigSelect).currentValue`.
>    - בעת שינוי: `session.applyConfigOption(m.id, e.target.value)`.
> 3. אחרת — לא מוצג.
>
> **Agent/Mode dropdown** (עדיפות):
> 1. אם `session.modes?.availableModes?.length` → `<select>` מ-`availableModes`.
>    - כל option: `value={m.id}` (שדה `SessionMode.id`), label: `m.name`.
>    - `selected={session.modes.currentModeId}`.
>    - בעת שינוי: `session.applyConfigOption("mode", e.target.value)`.
> 2. אחרת אם `const m = session.configOptions.find(o => o.category === "mode")` קיים → `<select>` מ-`flattenSelectOptions(m)`.
>    - `selected` לפי `(m as SessionConfigSelect).currentValue`.
>    - בעת שינוי: `session.applyConfigOption(m.id, e.target.value)`.
> 3. אחרת — לא מוצג.
>
> **שאר configOptions** (לא category model/mode):
> - `type: "select"` → `<select>`, בעת שינוי: `applyConfigOption(opt.id, value)`.
> - `type: "boolean"` → checkbox, בעת שינוי: `applyConfigOption(opt.id, checked)`.
>
> **אם אין שום config** (configOptions ריק + models null + modes null):
> → לא מציגים את הווידג'ט כלל (מוסתר). לא כפתור toggle ריק.

**Flatten helper**:

```ts
type SelectOpt = { value: string; name: string; description?: string | null }

function flattenSelectOptions(option: SessionConfigOption): SelectOpt[] {
  if (option.type !== "select") return []
  const sel = option as Extract<SessionConfigOption, { type: "select" }>
  return sel.options.flatMap((item) => ("options" in item ? item.options : [item]))
}
```

**Toggle behavior**: כפתור/heading פשוט שפותח/סוגר. אין persistence — פותח כברירת מחדל כשיש content, סגור כברירת מחדל כשאין.

**CSS חובה**: הפאנל חייב `flex-shrink: 0` (כמו `ChatHeader`). ה-`.chat-page` הוא `flex-column height:100dvh` — בלי `flex-shrink:0` הפאנל יתכווץ כשהבועות ממלאות את המסך.

**i18n keys** — הוסף תחת `// ─── agent-options ─── (slice 23)`:

```ts
| "agentOptions.title"
| "agentOptions.model.label"
| "agentOptions.agent.label"
```

| key | he | en |
|---|---|---|
| `agentOptions.title` | ‏הגדרות סשן | Session options |
| `agentOptions.model.label` | ‏מודל | Model |
| `agentOptions.agent.label` | ‏סוכן | Agent |

**Route change** (additive):

```svelte
<!-- chat/+page.svelte — בין ChatHeader ל-ChatBubbles -->
<ChatHeader {onDisconnect} />
<AgentOptionsPanel />   <!-- ← חדש -->
<ChatBubbles />
```

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm lint:i18n
pnpm typecheck
```

Manual:
1. ‏התחבר ל-opencode בתיקייה כלשהי.
2. ‏ודא שהווידג'ט מופיע עם dropdowns מאוכלסים.
3. ‏בחר מודל אחר → ודא ב-`LOG_WIRE=ws` שנשלח `session/set_config_option` לפני `session/prompt` הבא.
4. ‏שלח פרומפט — ודא שה-config שנבחר פעיל (OpenCode אמור להשתמש במודל החדש).
5. ‏regex עם gemini/claude: וודא שהווידג'ט מסתגל לפי מה שה-agent מחזיר.

---

### Commit 4 — Docs + status (approach: manual)

**‏קבצים**:

| ‏קובץ | ‏שינוי |
|---|---|
| `docs/walkthrough.md` | ‏רשומת ביצוע |
| `docs/plans/slice-23-agent-options-panel.md` | ‏עדכון סטטוס + סטיות |

```bash
pnpm typecheck
pnpm lint:i18n
pnpm --filter @drive-coding/frontend-v2 build
```

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏Typecheck ירוק | `pnpm typecheck` |
| 2 | ‏Frontend typecheck ירוק | `pnpm --filter @drive-coding/frontend-v2 typecheck` |
| 3 | ‏Build ירוק | `pnpm --filter @drive-coding/frontend-v2 build` |
| 4 | ‏אין עברית קשיחה | `pnpm lint:i18n` |
| 5 | ‏Dropdowns מאוכלסים מהסשן | ‏בדיקה ידנית — לא שדות ריקים |
| 6 | ‏שינוי model → `session/set_config_option` בלוגים | `LOG_WIRE=ws`, שלח פרומפט |
| 7 | ‏אחרי שינוי, הפרומפט הבא רץ עם config חדש | ‏ידנית — בדוק תגובת OpenCode |
| 8 | ‏Regression: ChatHeader, ChatBubbles, ChatInput | ‏עובדים כרגיל |
| 9 | ‏אם agent לא מחזיר config — הווידג'ט מוסתר | ‏agent ללא configOptions/models/modes — אין UI |
| 10 | ‏loadSession — config מ-loadSession response מוצג | ‏בחר session קיים, התחבר, ודא dropdowns |

---

## §6 — Risks + mitigations

| ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|
| ‏`opencode acp` לא מקבל `--model`/`--agent` | ‏gotcha בזיכרון | ‏לא לגעת ב-cli-config.ts; רק ACP לאחר `sessionId` |
| ‏`configOptions`/`models`/`modes` יכולים להיות null | ‏ACP — nullable fields | ‏`?? []` / `?? null` ב-`#captureSessionConfig` |
| ‏`LoadSessionResponse` אין לה `sessionId` | ‏שונה מ-`NewSessionResponse` | ‏`this.#sessionId = input.sessionId` (לא מה-response) |
| ‏`loadSession` בקוד הקיים זורק את ה-return value | ‏שורה ~215 ב-agent-session.svelte.ts | ‏לשמור: `const loadResult = await this.#client.loadSession(...)` |
| ‏`SetSessionConfigOptionRequest` discriminated union | ‏boolean דורש `type:"boolean"` | ‏branch לפי `typeof opts.value` |
| ‏category vs id — `id` הוא arbitrary | ‏ACP spec | ‏זיהוי לפי `o.category`, apply לפי `o.id` |
| ‏`setSessionConfigOption` response מחזיר configOptions מעודכנים | ‏agent יכול לשנות אפשרויות אחרות בתגובה | ‏לעדכן `this.configOptions = res.configOptions` אחרי כל קריאה |
| ‏מחרוזות עברית | ‏pre-commit hook | ‏i18n keys בלבד |
| ‏`chat/+page.svelte` כבר דק (52 שורות) | ‏כלל route ≤150 שורות | ‏תוספת של 2 שורות בלבד (`import` + instance) |

---

## §7 — Escalation triggers

- ‏`setSessionConfigOption` לא עובד מול OpenCode בפועל.
- ‏אתה רוצה לשנות את signature של `attach`/`loadSession` בצורה invasive.
- ‏הווידג'ט דורש state/logic שאינו ב-`AgentSession`.
- ‏brief סותר את עצמו.

---

## §8 — Complexity score + verifier tier

| ‏פרמטר | ‏ניקוד |
|---|---:|
| ‏Protocol contract חדש: ACP `setSessionConfigOption` | +2 |
| ‏>3 files, 2 packages | +1 |
| ‏Async coordination קלה | +1 |
| ‏ללא ספרייה חדשה | 0 |
| ‏ללא streaming/audio | 0 |
| ‏ללא Settings cache | -1 |
| ‏UI פשוט, route לא משתנה מהותית | -1 |

**Score**: 4/10

**Tier**: `calev` mode: light בסוף.

**Phase verifier**: לא נדרש — 4 commits, flow ישיר.

---

## §9 — ‏שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏אם agent לא מחזיר config — להסתיר לחלוטין או להציג placeholder? | ‏להסתיר | ❌ |
| 2 | ‏האם לשמור בחירה אחרונה ב-localStorage (hint לחיבור הבא)? | ‏לא ב-slice הזה | ❌ |
| 3 | ‏מיקום מדויק: מתחת ל-ChatHeader או בתוכו? | ‏מתחת, כ-collapsible bar | ❌ |

---

## ‏סטיות מהתכנון (מתעדכן ע"י executor תוך כדי)

- `SessionConfigBoolean.currentValue` (לא `.value`) — הtype ב-SDK שונה ממה שה-brief הנח. תוקן בזמן typecheck.
- `core/dist/index.d.ts` missing אחרי worktree add — נדרש `--force` build. gotcha קיים, לא חריגה.
- ה-brief ב-dev לא copied לworktree (expected) — brief נשאר ב-dev/docs/plans.

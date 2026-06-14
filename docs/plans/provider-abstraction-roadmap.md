# Roadmap — הפרדת הפרויקט מ-ACP ותמיכה בספקים נוספים

> **תאריך**: 2026-06-08
> **כותב**: מרדכי (planner)
> **סטטוס**: טיוטה (roadmap — לא brief בודד)
> **תוצר מבוקש**: הפיכת ACP מ"הפרוטוקול היחיד" ל"ספק אחד מבין כמה", כדי לחבר
> פרוטוקולי-agent נוספים מעל stdio (Codex app-server, פרוטוקול פנימי של Claude Code).

---

## §A — תמונת מצב: כמה ACP מושרש (מבוסס חקירת קוד 2026-06-08)

הצימוד ל-ACP **מבודד היטב**. כל לוגיקת הפרוטוקול חיה ב-FE + core; ה-BE כבר אגנוסטי לחלוטין.

### היכן ACP SDK נוגע בקוד (6 קבצי-מקור בלבד)

| קובץ | מה מיובא מ-`@agentclientprotocol/sdk` | תפקיד |
|------|----------------------------------------|-------|
| `core/src/acp/client.ts:28-29` | `ClientSideConnection`, `ndJsonStream`, `SetSession{ConfigOption,Mode,Model}Response`, `SessionNotification` | בניית החיבור + קריאות RPC |
| `core/src/acp/client-impl.ts:13` | `Client`, `SessionNotification` | callbacks של ה-Client (permission, sessionUpdate) |
| `core/src/ports.ts:1` | `PromptResponse`, `SessionNotification` (re-export) | טיפוסים ל-BE ports (ישן — Slice 4, לא בשימוש פעיל ב-FE flow) |
| `core/src/schemas/agent.ts:34` | מחרוזת בלבד (`@agentclientprotocol/claude-agent-acp` ב-args) | פקודת spawn של claude |
| `frontend/.../agent-session.svelte.ts:13-18` | `SessionNotification`, `SessionConfigOption`, `SessionModeState`, `SessionModelState` | צריכת notifications + session config |
| `frontend/.../SessionOptionsPanel.svelte:23` | `SessionConfigOption` | type-hint ל-dropdown |

### היכן ה-ACP client **נבנה** (3 אתרים, כולם FE)

- `frontend/.../agent-session.svelte.ts:138` (attach) ו-`:252` (loadSession)
- `frontend/.../adapters/sessions.ts:50` (listSessionsForCwd — סוכן חד-פעמי)

### מה כבר אגנוסטי (אין מה לגעת)

- **Backend — 100%.** `bridge-manager.ts`, `cli-config.ts`, `ws-agent.ts`, `agent-orchestrator.ts` רק spawn-ים CLI ומעבירים bytes גולמיים מעל WS. אפס תלות ב-ACP SDK. ספק חדש מעל stdio "פשוט עובד" ב-BE.
- **`AcpTransport`** (`core/src/acp/transport.ts`) — הפשטת bytes טהורה (readable/writable/close/onClose). אפס תלות ב-SDK. כל פרוטוקול stdio ישתמש בה כמו שהיא.
- **`WsAcpTransport`** (`frontend/.../engines/ws-transport.ts`) — תלוי רק ב-`AcpTransport` interface. אגנוסטי.
- **CLI_SPECS** (`core/src/schemas/agent.ts`) — כבר מנגנון multi-CLI (bin/args/supportsModelFlag), אבל **כל הרשומות מדברות ACP** (`args: ["acp"]` / `["--acp"]`).

### המסקנה האדריכלית

"העבודה האמיתית" אינה לקרוע את הקוד אלא **להגדיר מודל פנימי מנורמל** + **interface אחיד לספק**, ולהסיט את ACP מאחוריהם כמימוש אחד. זה refactor ב-FE+core בלבד; ה-BE לא משתנה (פרט להעברת שדה `protocol` במטא-דאטה של הסוכן, אם בכלל).

---

## §B — הארכיטקטורה היעד

שני חצאים משלימים של אותה הפשטה, ב-`packages/core/src/protocol/` (חדש):

### חצי 1 — מודל אירועים מנורמל (נתיב קריאה / inbound)

במקום ש-`agent-session` יפרק `SessionNotification` של ACP ישירות, ה-VM צורך `ProviderEvent` מנורמל:

```ts
// core/src/protocol/events.ts (חדש)

export type ToolContent =            // protocol-level (הוזז מ-bubble.ts)
  | { type: "text"; text: string }
  | { type: "diff"; path: string; oldText?: string; newText: string }
  | { type: "terminal"; terminalId: string }
  | { type: "other"; raw: unknown }
export type ToolLocation = { path: string; line?: number }

export type ToolStatus = "pending" | "in_progress" | "completed" | "failed"

export type ProviderEvent =
  | { kind: "message_chunk"; role: "assistant" | "thought" | "user"; text: string; messageId: string | null }
  | { kind: "tool_call"; toolCallId: string; title?: string; toolKind?: string;
      rawInput?: unknown; rawOutput?: unknown; status?: ToolStatus;
      content?: ToolContent[]; locations?: ToolLocation[] }
  | { kind: "tool_call_update"; toolCallId: string; title?: string; toolKind?: string;
      rawInput?: unknown; rawOutput?: unknown; status?: ToolStatus;
      content?: ToolContent[] | null; locations?: ToolLocation[] | null }

// session config מנורמל (מוחזר מ-newSession/loadSession ומ-setConfigOption)
export type ConfigOption = { id: string; category: string; /* ... שדות מנורמלים */ }
export type ModeState = { currentModeId: string; modes: Array<{ id: string; name: string }> }
export type ModelState = { currentModelId: string; models: Array<{ id: string; name: string }> }
export type SessionConfig = { options: ConfigOption[]; models: ModelState | null; modes: ModeState | null }
```

המיפוי ACP→מנורמל יושב במודול **טהור** `core/src/protocol/acp-mapper.ts` (TDD מלא — input ידוע, output ידוע). כל לוגיקת הפירוק שכרגע ב-`#onSessionUpdate` / `#handleToolCall` / `#mapToolContent` / `#mapLocations` עוברת לשם.

> **חלוקת inbound לשני slices** (החלטת scope 2026-06-08): נתיב ה-**streaming**
> (`ProviderEvent`: message/thought/user + tool_call/update) מנורמל ב-**P1**.
> נתיב ה-**session config** (`SessionConfigOption`/`SessionModeState`/`SessionModelState`
> → `ConfigOption`/`ModeState`/`ModelState`) מנורמל ב-**P2**, יחד עם ה-`ProviderSession`
> interface שמחזיר אותו — כי `SessionOptionsPanel.svelte` נשען על ~15 גישות לשדות
> בצורת ACP (`availableModels.modelId`, `availableModes`, select `options`, `category`),
> וכתיבתו מחדש היא concern נפרד שלא צריך לחסום את נתיב ה-streaming. אחרי P1,
> `agent-session` עדיין מייבא את 3 טיפוסי ה-config מ-ACP SDK — רק `SessionNotification`
> מוסר. P2 מסיר גם אותם.

### חצי 2 — interface אחיד לספק (נתיב כתיבה + בנייה / outbound)

> **שמות יושרו ל-CodeNomad** (החלטה 2026-06-08): `ProviderSession` (היה `AgentProvider`),
> `ProviderEvent` (היה `SessionEvent`), `ProviderRegistry`, `ProviderDefinition`,
> `ProviderType` (היה `ProtocolKind`). השמות זהים ל-CodeNomad לקרבה חוצת-פרויקטים;
> **הצורה (shape) שלנו עשירה יותר** משלהם (ראה §G.4 — אנו שומרים tool_call/config).

במקום `AcpClient`, ה-VM תלוי ב-`ProviderSession` אגנוסטי:

```ts
// core/src/protocol/provider.ts (חדש)

export type ProviderType = "acp" | "codex-app-server"   // נוסף בהדרגה. (MCP אינו provider — §G.3)

export type ProviderDefinition = {
  id: string
  type: ProviderType
  name: string
  // command/args/env — נגזרים אצלנו מ-CLI_SPECS (bin/args), לא חוזרים על עצמם כאן
}

export type ProviderCapabilities = { loadSession: boolean; listSessions: boolean; setModel: boolean; setMode: boolean }
export type SessionResult = { sessionId: string; config: SessionConfig }
export type SessionSummary = { sessionId: string; cwd: string; title: string; updatedAt: string }

export interface ProviderSession {
  readonly capabilities: ProviderCapabilities
  /** גבול lifecycle מפורש (לקח CodeNomad): handshake + newSession לפני ה-prompt הראשון. */
  newSession(opts: { cwd: string }): Promise<SessionResult>
  loadSession(opts: { cwd: string; sessionId: string }): Promise<SessionResult>
  listSessions(): Promise<SessionSummary[]>
  prompt(sessionId: string, text: string): Promise<void>
  cancel(sessionId: string): Promise<void>
  setConfigOption(opts: { sessionId: string; configId: string; value: string | boolean }): Promise<SessionConfig>
  setMode(opts: { sessionId: string; modeId: string }): Promise<void>
  setModel(opts: { sessionId: string; modelId: string }): Promise<void>
  close(): void
}

// onEvent מקבל ProviderEvent מנורמל (לא SessionNotification של ACP)
export type ProviderFactory = (
  transport: AcpTransport,
  onEvent: (e: ProviderEvent) => void,
  opts?: { initTimeoutMs?: number },
) => Promise<ProviderSession>
```

```ts
// core/src/protocol/registry.ts (חדש)
export function createProvider(type: ProviderType, transport, onEvent, opts): Promise<ProviderSession>
// dispatch: "acp" → createAcpProvider, "codex-app-server" → createCodexProvider
```

מימוש ACP (`createAcpProvider`) עוטף את `ClientSideConnection` הקיים + ה-mapper מחצי 1. ספקים חדשים = מימוש נוסף של אותו interface.

### בחירת ספק

`CliSpec` (ב-`core/src/schemas/agent.ts`) מקבל שדה `type: ProviderType` (ברירת מחדל `"acp"` — כל הרשומות הקיימות נשארות זהות). ה-FE קורא את ה-`type` של ה-cliKind שנבחר ומעביר ל-`createProvider`.

### זרימה אחרי ההפשטה

```
CLI (פרוטוקול P) → stdout → BE pipe (bytes) → WS → FE WsAcpTransport
  → createProvider(P, transport, onEvent) → ProviderSession
  → onEvent(ProviderEvent מנורמל) → AgentSession בונה Bubble[]   (ללא ידע על P)
```

---

## §C — רצף ה-slices (JIT — נכתב brief מפורט רק ל-slice הבא)

| # | slice | תוצר | תלות | Complexity | verifier |
|---|-------|------|------|-----------|----------|
| **P1** | **normalized-events** | מודל `ProviderEvent` מנורמל (streaming בלבד) + `acp-mapper` טהור (TDD). `agent-session.#onSessionUpdate` צורך `ProviderEvent`. `SessionNotification` יורד מ-`agent-session` (נשאר רק תחת mapper/client). **לא נוגע ב-SessionOptionsPanel ולא ב-session config.** אפס שינוי התנהגות. | — (base=dev) | 7/10 | heavy |
| **P2** | **provider-interface** | `ProviderSession` interface + `ProviderRegistry`/`createProvider` + שדה `type: ProviderType` ב-`CliSpec` + `start()` lifecycle מפורש. `createAcpProvider` עוטף את הקיים. **+ נרמול session config** (`SessionConfig`/`ConfigOption`/`ModeState`/`ModelState`) + כתיבה-מחדש של `SessionOptionsPanel`. `agent-session` + `sessions.ts` תלויים ב-`ProviderSession`. מסיר את 3 טיפוסי ה-config מ-ACP SDK. עדיין ACP בלבד. אפס שינוי התנהגות. | P1 | 8/10 | heavy |
| **P3** | **provider-codex** | **Codex app-server** (נבחר 2026-06-08): מימוש `ProviderSession` לא-ACP ראשון + מיפוי events (Thread/Turn/Item → `ProviderEvent`). רשומת `CLI_SPEC` עם `type:"codex-app-server"` + חיווט בחירה ב-FE. מחקר פרוטוקול בעיקר קיים ב-CodeNomad (§G.3) — נצרף + נאמת. **מוכיח את ההפשטה e2e.** | P2 | 8+/10 | heavy |
| **P4** | **provider-#2** | ספק שני (Claude — ראה החלטה §G.5#3; "פרוטוקול פנימי" כבר נחקר בפרויקט נפרד, נישען עליו). מחדד את ה-interface לפי הלקחים מ-P3. | P3 | 8/10 | heavy |

**עיקרון JIT** (מהשיטה): נכתב brief מפורט ומאומת ל-P1 בלבד. P2 ייכתב אחרי ש-P1 ירוץ ויחזיר GO; P3 ידרוש קודם צעד **מחקר-פרוטוקול** (פורמט ה-wire של codex app-server / claude native) שאני (מרדכי) אבצע לפני כתיבת ה-brief.

### למה הסדר הזה

- **P1 לפני P2**: ה-`onEvent` של ה-interface פולט את המודל המנורמל — לכן המודל המנורמל הוא התלות היסודית. בנוסף, נתיב הקריאה (inbound) הוא החלק הגדול/מסוכן של `agent-session` (פירוק ACP). מבודדים אותו ראשון.
- **P1+P2 = שני refactors של אפס-שינוי-התנהגות** → ניתנים לאימות מול ההתנהגות הקיימת (regression-only). זה בדיוק מה שמוריד סיכון לפני שמוסיפים ספק אמיתי ב-P3.
- **P3 מחדד את ה-interface**: הספק הלא-ACP הראשון תמיד חושף הנחות סמויות שדלפו מ-ACP. עדיף לגלות אותן על ספק אחד לפני שמתחייבים לשניים.

---

## §D — החלטות ארכיטקטוניות (מועמדות ל-D51+ ב-design-principles)

1. **מיקום הטיפוסים המנורמלים**: `core/protocol/` (functional core, D5). `ToolContent`/`ToolLocation` מוזזים מ-`frontend/.../types/bubble.ts` ל-core ומיוצאים-מחדש משם (re-export) — כדי שה-mapper יישאר core טהור ו-TDD-able. השמות זהים → כל הצרכנים מתקמפלים ללא שינוי.
2. **ACP נשאר ספק אחד** (החלטת המשתמש 2026-06-08), לא מוסר. `createAcpProvider` הוא מימוש ברירת המחדל.
3. **ה-BE נשאר byte-pipe אגנוסטי** — אין client של פרוטוקול ב-BE. כל ספק רץ ב-FE מעל `WsAcpTransport`. (עקבי עם D6 + הארכיטקטורה הקיימת.) **שונה מ-CodeNomad** שמריץ stdio בצד-שרת (§G.2).
4. **`protocol`/`type` כברירת-מחדל `"acp"`** ב-`CliSpec` — opt-in, אפס רגרסיה לרשומות קיימות.
5. **שמות interface = שמות CodeNomad** (`ProviderSession`/`ProviderEvent`/`ProviderRegistry`/`ProviderDefinition`/`ProviderType`), לקרבה חוצת-פרויקטים. הצורה שלנו עשירה יותר (tool_call/config).
6. **ספק לא-ACP ראשון = Codex app-server.** MCP אינו provider (tool-bridge בלבד) ולא ייכנס ל-`ProviderType`.

---

## §E — סיכונים ברמת ה-roadmap

| סיכון | מיטיגציה |
|-------|----------|
| `agent-session.svelte.ts` הוא קובץ **משותף** (`parallel-safe-code.md`) — שינוי ה-`$state` types הוא INVASIVE | P1+P2 מבוצעים סדרתית (depends_on), לא במקביל ל-slices אחרים. כל שינוי state מתואם מראש בתוך ה-brief. |
| כלל זהב #5 (אין backward-compat-in-place): אסור לתחזק `SessionNotification` ו-`ProviderEvent` במקביל | כל slice ממיר consumer במלואו באותו commit. ACP types נשארים רק מתחת ל-mapper/provider. |
| ספק לא-ACP עלול לחשוף שדות שאין להם מקבילה מנורמלת (למשל plan/available_commands) | ה-`ProviderEvent` union ניתן להרחבה; P3 יוסיף variants לפי הצורך. אין לחסום את P1 על שלמות עתידית. |
| `ports.ts` עדיין מייצא `SessionNotification`/`PromptResponse` (שרידי Slice 4) | מחוץ ל-scope של P1/P2 (לא בשימוש ב-FE flow). ניקוי אופציונלי ב-slice עתידי. |

---

## §F — מה הלאה

1. **P1 brief**: `docs/plans/slice-provider-1-normalized-events.md` (נכתב, מאומת ע"י אביגיל → מוכן ל-dispatch לאליעזר).
2. אחרי GO על P1 — כתיבת P2 brief (ליישר מול ה-shape של CodeNomad — ראה §G).
3. לפני P3 — מחקר פרוטוקול. **רובו כבר קיים ב-CodeNomad** (ראה §G) — נצרף + נאמת מול הגרסאות הנוכחיות של ה-CLIs.

---

## §G — תובנות מ-CodeNomad (פרויקט אח, אותה הפשטה)

`/home/user/projects/CodeNomad` ביצע **בדיוק** את אותה הפשטה (provider layer אגנוסטי
לפרוטוקול) + **מחקר פרוטוקולים מלא**. סונתז 2026-06-08. מקורות:
`CodeNomad/docs/design/provider-layer-*`, `CodeNomad/docs/plans/slice-{1,2,3}-*`,
`CodeNomad/docs/research/provider-protocols/` (notes פר-פרוטוקול + `analysis/api-action-matrix.md`
+ `analysis/existing-abstractions.md`).

### G.1 — ה-interface של CodeNomad (מאמת את שלנו, כמעט 1:1)

```ts
// CodeNomad: packages/server/src/providers/types.ts
export type ProviderType = "opencode-http" | "acp-stdio"   // נוסף בהדרגה
export interface ProviderDefinition { id; type: ProviderType; name; command?; args?; env? }
export type ProviderEvent =
  | { type: "session.ready"; sessionId }
  | { type: "message.delta"; role: "assistant"; text }
  | { type: "session.done"; reason } | { type: "session.cancelled" }
  | { type: "session.error"; message } | { type: "log"; level; message }
export interface ProviderSession {
  providerId; sessionId
  start(): Promise<void>          // ← חובה לפני sendPrompt הראשון
  sendPrompt(prompt): Promise<void>; cancel(): Promise<void>; stop(): Promise<void>
  onEvent(handler): () => void
}
```

הערה: אימצנו את שמות CodeNomad ישירות (ProviderSession/ProviderEvent/ProviderRegistry/ProviderDefinition) — ראה G.5#1.
`ProviderDefinition`+`ProviderRegistry`≈`protocol` field+`createProvider`.

**לקח לאמץ ב-P2**: `start()` כגבול lifecycle **מפורש** לפני prompt ראשון — אצלנו זה
מתבצע ב-`attach`/`loadSession` (createAgent→WS→handshake→newSession); כדאי לחשוף אותו
מפורשות ב-`ProviderSession`.

### G.2 — סטיית ארכיטקטורה מהותית (לא drop-in!)

CodeNomad מריץ subprocess **בצד-שרת** ועושה JSON-RPC מעל **stdio שם**
(`JsonRpcStdioTransport`). אצל voice-acp **ה-BE הוא byte-pipe** וה-provider רץ
**בדפדפן מעל WS** (`WsAcpTransport`). לכן:
- `JsonRpcStdioTransport` של CodeNomad הוא **reference, לא drop-in**. אצלנו ספק לא-ACP
  יעשה JSON-RPC מעל אותו byte-transport של WS, ב-FE.
- היתרון שלנו: ה-transport כבר מופשט (`AcpTransport`) → ספק חדש לא נוגע ב-BE כלל.

### G.3 — ממצאי מחקר הפרוטוקולים (משנים P3/P4)

| פרוטוקול | transport | session model | מסקנה ל-voice-acp |
|----------|-----------|---------------|-------------------|
| **ACP** | JSON-RPC/stdio (v1 יציב) | `initialize`→`session/new\|load`→`session/prompt`; פלט ב-`session/update` notifications | הספק שיש לנו. v1 בלבד (v2 לא יציב). |
| **Codex app-server** | JSON-RPC/stdio\|ws\|unix | `initialize`→**`initialized`**→`thread/start\|resume`→`turn/start`; פלט ב-notifications `item/*`,`turn/*` | **לא ACP!** Thread/Turn/Item שונים מהותית → **ספק ייעודי**. ה-probe מראה תשובה בלי `jsonrpc`/`protocolVersion`/`agentCapabilities`. |
| **Claude native** | — | — | CodeNomad **ממליץ נגד** הפרוטוקול הפרטי/PTY (שביר, תלוי-גרסה). הדרך היציבה: adapter רשמי `@agentclientprotocol/claude-agent-acp` (**שכבר בשימוש אצלנו**) או `@anthropic-ai/claude-agent-sdk` ישירות. ⚠️ ראה החלטה פתוחה. |
| **OpenCode HTTP** | HTTP+SSE | REST `POST /session` + SSE `/global/event` | רלוונטי רק אם נרצה ספק HTTP (לא stdio) — לא ב-scope הנוכחי. |
| **MCP** | stdio/HTTP | — | **לא provider!** אין לו session/prompt/turn model. הוא tool-bridge. אסור להוסיף `"mcp"` ל-`ProviderType`. |

**`api-action-matrix`**: ACP + OpenCode feature-complete ל-chat; Codex זהה ביכולת אך דורש
ספק נפרד; MCP = bridge.
**`existing-abstractions`**: לעטוף את `@agentclientprotocol/sdk` אך **לא** לאמץ `acp-factory`
כתלות-ליבה.

### G.4 — איפה voice-acp מקדים את CodeNomad

ה-`ProviderEvent` של CodeNomad הוא MVP **טקסט בלבד** (`message.delta`; tool/permission/diff
נדחו). voice-acp **כבר מרנדר** tool calls/thoughts/diffs/terminals (slices 16/22/23). לכן
ה-`ProviderEvent` שלנו (P1) **חייב להישאר עשיר** (tool_call/tool_call_update עם content/locations)
— לא להוריד אותו ל-text-only של CodeNomad.

### G.5 — החלטות (נסגרו 2026-06-08)

1. **שמות ה-interface**: ✅ **אומצו שמות CodeNomad** — `ProviderSession`/`ProviderEvent`/
   `ProviderRegistry`/`ProviderDefinition`/`ProviderType`. הצורה נשארת עשירה משלהם (§G.4).
   הוחל כבר על ה-roadmap ועל ה-brief של P1 (`ProviderEvent`).
2. **ספק ראשון ל-P3**: ✅ **Codex app-server** — פרוטוקול חדש לגמרי (Thread/Turn/Item),
   מוכיח את ההפשטה בצורה החזקה ביותר. מחקר קיים ב-CodeNomad.
3. **"פרוטוקול פנימי של Claude Code"**: המחקר של CodeNomad ממליץ נגד הפרטי/PTY. המשתמש
   ציין ש**הפרוטוקול הפנימי כבר נחקר בפרויקט נפרד** → לא חוקרים מחדש; כש-נגיע ל-P4 נישען
   על המחקר ההוא (📌 לאתר את הפרויקט/מסמך לפני כתיבת brief ל-P4). ברירת-מחדל אם המחקר
   ההוא לא יספיק: ספק מעל `@anthropic-ai/claude-agent-sdk` הרשמי. **לא חוסם את P1–P3.**

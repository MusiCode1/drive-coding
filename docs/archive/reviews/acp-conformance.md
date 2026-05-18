# ACP Conformance Check

**Date:** 2026-05-16
**Range:** Slices 1-5 (commits db1a9f2..9b7c912)
**Reviewer:** Yolo (Sonnet 4-6)
**Spec version:** v1 (כפי שמוצג ב-agentclientprotocol.com, 2026-05-16)

---

## TL;DR

ה-flow הבסיסי (`initialize → newSession → prompt → cancel`) **יעבוד** — פרוטוקול תקין, transport נכון, session/update מטופל. שלוש בעיות בולטות:

1. **`clientCapabilities: {}` — לא blocker אמיתי**, אבל גורם לכך שה-agent (`opencode`) לא יוכל לבצע `fs/read_text_file` ו-`fs/write_text_file`, ולא יתקין terminals. כלומר opencode יעבוד, אבל עם toolset מוגבל — קרוב לוודאי ללא fs-access דרך ACP ולכן פחות יעיל.
2. **`clientInfo` חסר** — spec אומר SHOULD, ב-future version יהיה required.
3. **`requestPermission.optionId` — `"allow_once"` נכון, אבל הבדיקה של `"allow_once"` לעומת מה שopencode שולח בפועל (שם שאולי שונה)** — נקודה שצריך לאמת.

שגיאת ה-`ACP connection closed` שמצוינת בבאג כנראה **אינה** קשורה ל-`clientCapabilities` ריקות, אלא ל-race condition או timeout ב-bridge spawn/attach.

---

## A. Initialization

### מה ה-spec דורש

מתוך [initialization.md](https://agentclientprotocol.com/protocol/initialization):

> Before a Session can be created, Clients **MUST** initialize the connection by calling the `initialize` method with:
> * The latest protocol version supported
> * The capabilities supported
>
> They **SHOULD** also provide a name and version to the Agent.

ה-`InitializeRequest` (מ-`types.gen.d.ts` שורה 1817-1842):
```typescript
export type InitializeRequest = {
    clientCapabilities?: ClientCapabilities;  // אופציונלי (SHOULD not MUST)
    clientInfo?: Implementation | null;        // אופציונלי (SHOULD)
    protocolVersion: ProtocolVersion;          // חובה (MUST)
}
```

`ClientCapabilities` (שורה 567-630):
```typescript
export type ClientCapabilities = {
    auth?: AuthCapabilities;           // UNSTABLE, אופציונלי
    elicitation?: ElicitationCapabilities | null;  // UNSTABLE
    fs?: FileSystemCapabilities;       // אופציונלי — governs fs/read & fs/write
    nes?: ClientNesCapabilities | null; // UNSTABLE
    positionEncodings?: Array<PositionEncodingKind>; // UNSTABLE
    terminal?: boolean;                // אופציונלי — governs terminal/*
}
```

ה-spec מציין: "All capabilities included in the `initialize` request are **OPTIONAL**"

`FileSystemCapabilities` (שורה 1617-1636):
```typescript
export type FileSystemCapabilities = {
    readTextFile?: boolean;
    writeTextFile?: boolean;
}
```

### מה אנחנו עושים

`packages/backend/src/acp/acp-transport.ts` שורה 63-66:
```typescript
const initResult = await conn.initialize({
    protocolVersion: opts.protocolVersion ?? 1,
    clientCapabilities: {},  // ← ריק, אין fs, אין terminal, אין clientInfo
})
```

### Verdict
- ✅ `protocolVersion: 1` — תקין
- ⚠️ `clientCapabilities: {}` — תקין מבחינת spec (all capabilities optional), אבל **מחביא** מהAgent שאין לנו fs/terminal. opencode יראה `readTextFile: undefined`, `writeTextFile: undefined`, `terminal: undefined` — ולפי spec: "Agents **MUST** treat all capabilities omitted as **UNSUPPORTED**". לכן opencode ייכנע לעבוד ללא fs/terminal API, לא ייקרוס.
- ⚠️ `clientInfo` חסר — spec: SHOULD. Future version: required.

### Issues

**Issue A-1 (חשוב):** היות שלנו יש handlers ב-`client-impl.ts` ל-`readTextFile` ו-`writeTextFile`, אבל לא מצהירים על `fs: { readTextFile: true, writeTextFile: true }` — opencode **לעולם לא יקרא/יכתוב קבצים דרך ACP**. הוא יסתמך רק על filesystem access ישיר. זה מגביל את היכולת לראות unsaved editor content.

**Issue A-2 (קטן):** `clientInfo` חסר. לוסיף: `clientInfo: { name: "drive-coding", version: "0.1.0" }`.

---

## B. Authentication

### מה ה-spec דורש

מתוך [initialization.md](https://agentclientprotocol.com/protocol/initialization):

> Once the connection is initialized, if `authMethods` is non-empty, the Client **SHOULD** authenticate.

`authMethods` מגיע ב-`InitializeResponse`. אם ריק — אין צורך. אם יש — לקרוא `authenticate({ methodId })`.

`InitializeResponse` (שורה 1850-1882):
```typescript
export type InitializeResponse = {
    agentCapabilities?: AgentCapabilities;
    agentInfo?: Implementation | null;
    authMethods?: Array<AuthMethod>;  // ← default: []
    protocolVersion: ProtocolVersion;
}
```

### מה אנחנו עושים

`acp-transport.ts` שורה 68-71:
```typescript
const capabilities: AcpCapabilities = {
    loadSession: initResult.agentCapabilities?.loadSession ?? false,
}
```

אנחנו קוראים את ה-`agentCapabilities` אבל **לא בודקים `authMethods`** ולא קוראים `authenticate`.

### Verdict
- 🟦 **deliberate-skip** — opencode ב-local לא דורש auth (הוא מנוהל דרך `opencode auth` ב-CLI). אם `authMethods: []`, שום בעיה.

### Issues

**Issue B-1 (חשוב — latent):** אם opencode מוגדר לדרוש auth (למשל multi-user cloud deployment), ה-`newSession` יחזיר `auth_required` error (code -32800) ואנחנו נפרוק את זה כ-exception רגיל, בלי הודעה מובנת למשתמש. צריך לטפל ב-`RequestError.authRequired`.

---

## C. Session Setup

### מה ה-spec דורש

`NewSessionRequest` (מ-schema.md):
```json
{
    "cwd": "/home/user/project",   // required, absolute path
    "mcpServers": [...]             // required (can be [])
}
```

> The Agent **MUST** respond with a unique Session ID.

ה-spec מציין שה-response **MAY** include `modes`, `configOptions` — הClient אינו חייב לצרוך אותם.

`NewSessionResponse` (type):
```typescript
export type NewSessionResponse = {
    configOptions?: Array<SessionConfigOption> | null;  // optional
    modes?: SessionModeState | null;                    // optional
    sessionId: SessionId;                               // required
}
```

### מה אנחנו עושים

`acp-transport.ts` שורה 73-76:
```typescript
const sessionResult = await conn.newSession({
    cwd: opts.cwd,
    mcpServers: [],
})
```

שורה 78:
```typescript
const sessionId = sessionResult.sessionId
```

`modes` ו-`configOptions` **מתעלמים**.

### Verdict
- ✅ `cwd` — מועבר נכון (המשתמש שולח את הנתיב ב-creation)
- ✅ `mcpServers: []` — תקין לפי spec (empty array מותר)
- ✅ `sessionId` — נשמר ומשמש בהמשך
- ⚠️ `modes` — מתעלמים. אם opencode מחזיר modes (ask/code/architect), אנחנו לא מאפשרים שליטה עליהם

### Issues

**Issue C-1 (important):** `modes` ב-response — opencode מחזיר modes (ask/code/architect). אנחנו לא שומרים אותם ולא מציגים למשתמש. Slice 6+.

**Issue C-2 (future):** `loadSession` מוצהר ב-`capabilities` אבל לא ממומש (`AcpTransport` interface אין `loadSession` method). D24 מציין תמיכה עתידית — בסדר לעכשיו.

---

## D. Prompt Turn

### מה ה-spec דורש

`PromptRequest`:
```typescript
export type PromptRequest = {
    prompt: ContentBlock[];  // required — array of content blocks
    sessionId: SessionId;    // required
}
```

ה-spec: "As a baseline, all Agents **MUST** support `ContentBlock::Text` and `ContentBlock::ResourceLink` in `session/prompt`"

`session/update` notifications — `SessionNotification.update` הוא `SessionUpdate`:
- `agent_message_chunk` — תוכן מה-LLM
- `agent_thought_chunk` — reasoning/thinking
- `user_message_chunk` — echo של הודעת המשתמש
- `tool_call` / `tool_call_update` — tool execution
- `plan` — execution plan
- `current_mode_update`, `available_commands_update`, `config_option_update`

`StopReason` values: `end_turn | max_tokens | max_turn_requests | refusal | cancelled`

### מה אנחנו עושים

`acp-transport.ts` שורה 90-97:
```typescript
const response: PromptResponse = await conn.prompt({
    sessionId,
    prompt: [{ type: "text", text: input.text }],
})
```

`agent-session.ts` שורה 67-101:
```typescript
switch (update.sessionUpdate) {
    case "agent_message_chunk": → broadcast text_chunk (kind: "message")
    case "agent_thought_chunk": → broadcast text_chunk (kind: "thought")
    case "tool_call": → broadcast tool_call event
    default: → silent
}
```

`done` event:
```typescript
broadcast({ type: "done", stopReason: response.stopReason })
```

### Verdict
- ✅ `prompt` format — `[{ type: "text", text }]` תקין
- ✅ `agent_message_chunk` — מטופל
- ✅ `agent_thought_chunk` — מטופל
- ✅ `tool_call` — מטופל (broadcast לUI)
- ✅ `stopReason` — מועבר ל-`done` event
- ⚠️ `tool_call_update` — **לא מטופל** (הclient מקבל `tool_call` שם, אבל לא status updates: `in_progress`, `completed`, `failed`)
- ⚠️ `plan` updates — silent (intentional in Slice 4/5)
- ⚠️ `user_message_chunk` — silent (intentional)
- ⚠️ stopReason `max_tokens`, `refusal` — מועברים ל-`done.stopReason` כ-string, אין טיפול מיוחד. בסדר לMVP.

### Issues

**Issue D-1 (קטן):** `tool_call_update` (status: in_progress/completed/failed) — לא מטופל ב-`handleNotification`. הUI לא יודע מתי tool מסתיים. ב-Slice 6 — להוסיף case.

**Issue D-2 (קטן):** ב-`sendAudioPrompt` בשורה 237, `stopReason` hardcoded ל-`"end_turn"` במקום לקחת מהtransport response. עלול לא לדייק אם הagent עצר מסיבה אחרת.

---

## E. File System (clientCapabilities.fs)

### מה ה-spec דורש

מתוך [file-system.md](https://agentclientprotocol.com/protocol/file-system):

> Before attempting to use filesystem methods, Agents **MUST** verify that the Client supports these capabilities by checking the Client Capabilities in the `initialize` **response** [sic — response מה-agent, שמכיל clientCapabilities שנשלחו ב-initialize request].
>
> If `readTextFile` or `writeTextFile` is `false` or **not present**, the Agent **MUST NOT** attempt to call the corresponding filesystem method.

כלומר: אם אנחנו שולחים `clientCapabilities: {}` (ואין `fs` field כלל) — opencode **MUST NOT** קרוא `fs/read_text_file`. אבל זה לא ייגרם לו לקרוס — הוא פשוט לא יוכל לקרוא קבצים דרך ACP.

ב-`client-impl.ts`:
```typescript
// readTextFile ו-writeTextFile לא ממומשים בclientImpl
// אבל הסיבה לזה: לא הוצהרנו על הcapability
```

### מה אנחנו עושים

`client-impl.ts` — **אין** `readTextFile` ולא `writeTextFile` ב-Client implementation. הם אופציונליים לפי ה-SDK (`readTextFile?` ב-`Client` interface).

### Verdict
- ⚠️ `fs` capability — **לא מוצהרת**, ולכן opencode לא יוכל לגשת לקבצים דרך ACP. אולם: opencode לרוב משתמש ב-filesystem ישיר ולא ב-ACP fs.
- 🟦 `readTextFile`/`writeTextFile` לא ממומשים ב-clientImpl — תואם לכך שהcapability לא מוצהרת.

### Issues

**Issue E-1 (חשוב — future):** אם רוצים opencode לאפשר גישה ל-unsaved editor content, צריך להוסיף `fs: { readTextFile: true, writeTextFile: true }` ל-`clientCapabilities` **ולממש** `readTextFile`/`writeTextFile` ב-`client-impl.ts`.

---

## F. Permissions

### מה ה-spec דורש

מתוך [tool-calls.md](https://agentclientprotocol.com/protocol/tool-calls):

```json
{
    "method": "session/request_permission",
    "params": {
        "options": [
            { "optionId": "allow-once", "name": "Allow once", "kind": "allow_once" },
            { "optionId": "reject-once", "name": "Reject", "kind": "reject_once" }
        ]
    }
}
```

`PermissionOptionKind`: `allow_once | allow_always | reject_once | reject_always`

ה-`optionId` הוא **string שרירותי** שה-agent מספק. ה-`kind` הוא enum.

Response:
```json
{ "outcome": { "outcome": "selected", "optionId": "<same-optionId-from-options>" } }
```
או: `{ "outcome": { "outcome": "cancelled" } }`

### מה אנחנו עושים

`client-impl.ts` שורה 15-23:
```typescript
async requestPermission(params) {
    const allowOnce = params.options.find((o) => o.optionId === "allow_once")
    const chosen = allowOnce ?? params.options[0]
    if (!chosen) {
        return { outcome: { outcome: "cancelled" } }
    }
    return { outcome: { outcome: "selected", optionId: chosen.optionId } }
},
```

### Verdict
- ⚠️ **BUG LATENT:** הקוד מחפש `optionId === "allow_once"` אבל `optionId` הוא **string שרירותי** — לפי ה-spec example הוא `"allow-once"` (עם מקף), ולפי opencode implementation הוא כנראה שונה. ה-`kind` (enum) הוא הדרך הנכונה לזהות. **צריך לחפש לפי `o.kind === "allow_once"` לא לפי `o.optionId === "allow_once"`.** אם opencode שולח `optionId: "allow-once"` (עם מקף) — הבדיקה הנוכחית תיכשל ו-`allowOnce = undefined` → `chosen = params.options[0]` (first option). זה עשוי לעבוד בפועל (first option = allow), אבל לא robust.

### Issues

**Issue F-1 (חשוב):** `client-impl.ts:18` — לשנות `o.optionId === "allow_once"` → `o.kind === "allow_once"`. `optionId` הוא key שרירותי, `kind` הוא ה-typed enum.

---

## G. Terminals

### מה ה-spec דורש

מתוך [terminals.md](https://agentclientprotocol.com/protocol/terminals):

> Before attempting to use terminal methods, Agents **MUST** verify that the Client supports this capability.
> If `terminal` is `false` or not present, the Agent **MUST NOT** attempt to call any terminal methods.

### מה אנחנו עושים

`clientCapabilities: {}` — `terminal` field **חסר**. לכן opencode **MUST NOT** קרוא terminal methods.

### Verdict
- 🟦 **deliberate-skip** — אין terminal capability. opencode יעבד בלי terminal. זה מגביל אבל לא מקרוס.

### Issues

**Issue G-1 (future):** terminal capability היא הדרך שopencode מריץ shell commands. ללא זה opencode מריץ commands ישירות, אבל ה-UI לא יוכל לראות live terminal output.

---

## H. Session Modes + Slash Commands + Plans

### מה ה-spec דורש

`session/update` notifications שה-agent שולח (optional, מה-spec):
- `current_mode_update` — מצב מצב נוכחי
- `available_commands_update` — פקודות זמינות (slash commands)
- `plan` — execution plan
- `config_option_update` — config options

### מה אנחנו עושים

`agent-session.ts` שורה 98-100:
```typescript
// Other update kinds (plan, usage, etc.) — silent in Slice 4/5
default:
    break
```

### Verdict
- 🟦 **deliberate-skip** — כל ה-updates הנ"ל מתעלמים בשקט. אין crash, אין בעיה פרוטוקולית.

### Issues

**Issue H-1 (future/Slice 6):** `plan` updates — opencode שולח אותם בתחילת prompt turn. כדאי לתמוך כדי להציג למשתמש מה הAgent מתכנן.

---

## I. Cancellation

### מה ה-spec דורש

מתוך [prompt-turn.md](https://agentclientprotocol.com/protocol/prompt-turn#cancellation):

> Clients **MAY** cancel via `session/cancel` notification (no response expected).
> Agent **MUST** respond to `session/prompt` with `stopReason: "cancelled"`.
> Client **MUST** respond to all pending `session/request_permission` with `cancelled` outcome.

### מה אנחנו עושים

`acp-transport.ts` שורה 100-102:
```typescript
async cancel() {
    await conn.cancel({ sessionId })
},
```

`agent-session.ts` שורה 240-242:
```typescript
async cancel() {
    await opts.transport.cancel()
},
```

### Verdict
- ✅ `cancel()` — מממש נכון (`CancelNotification` עם sessionId)
- ⚠️ **בעיה latent:** כאשר cancel נקרא, אם יש pending `requestPermission`, ה-SDK אמור לקבל `cancelled` response — אבל בקוד שלנו ב-`client-impl.ts` ה-`requestPermission` לא aware ל-cancel. ה-SDK כנראה מטפל בזה ב-Connection layer. **לא בדוק** — נשאר כ-open question.

### Issues

**Issue I-1 (לבדוק):** האם ה-SDK מטפל אוטומטית ב-pending requestPermission כשcancel נשלח? אם לא — צריך לממש cancellation handling ב-`requestPermission`.

---

## J. Transport (NDJSON)

### מה ה-spec דורש

מ-[architecture.md](https://agentclientprotocol.com/get-started/architecture): "all communication happens over stdin/stdout" (NDJSON over stdio). הSDK מספק `ndJsonStream` לעטוף streams.

### מה אנחנו עושים

`ws-streams.ts` — ממיר WS frames → ReadableStream/WritableStream של bytes.
`acp-transport.ts` שורה 49: `const stream = ndJsonStream(writable, readable)`

**ארכיטקטורה:** stdio-to-ws bridge עוטף את opencode אחד-לאחד, כך שהSDK רואה ביעילות stdio stream דרך WS.

`ws-streams.ts` שורה 32-43 — filtering של `connected`/`heartbeat` frames מ-stdio-to-ws שאינם חלק מה-ACP JSON-RPC.

### Verdict
- ✅ `ndJsonStream` — שימוש נכון
- ✅ NDJSON newline termination — מוסיפים `\n` אם חסר
- ✅ stdio-to-ws filter — מדוייק
- ✅ WS → byte stream → NDJSON → SDK — שרשרת נכונה

### Issues

**Issue J-1 (קטן):** `ws-streams.ts` שורה 33 — ה-filter מסנן רק את ה-message **הראשון**. אם stdio-to-ws שולח `heartbeat` אחרי ה-connection message, הוא לא יסונן. כדאי לבדוק את ה-stdio-to-ws protocol ולסנן לפי type בכל הודעה.

---

## K. Errors

### מה ה-spec דורש

JSON-RPC error codes:
```typescript
export type ErrorCode = 
    -32700  // Parse Error
    -32600  // Invalid Request
    -32601  // Method Not Found
    -32602  // Invalid Params
    -32603  // Internal Error
    -32800  // Auth Required (ACP)
    -32000  // (generic ACP error)
    -32002  // Resource Not Found
    -32042  // (other ACP)
    | number
```

### מה אנחנו עושים

`acp-transport.ts` שורה 112-116:
```typescript
} catch (e) {
    clearTimeout(timeout)
    ws.terminate()
    reject(e)
}
```

`agent-session.ts` שורה 122-127:
```typescript
} catch (e) {
    broadcast({
        type: "error",
        code: "PROMPT_FAILED",
        message: e instanceof Error ? e.message : String(e),
    })
}
```

### Verdict
- ⚠️ **אין טיפול ב-`auth_required` (-32800)** — אם newSession זורק auth_required, הוא נלכד ב-catch ונדחה כ-`reject(e)`, ה-bridge נהרג, ולא מוסבר למשתמש שנדרש auth.
- ⚠️ **אין error-code inspection** — כל error מתורגם ל-`"PROMPT_FAILED"` generic.

### Issues

**Issue K-1 (חשוב):** לזהות `RequestError.code === -32800` ב-catch של `createAcpWsTransport` ולהציג הודעה מובנת "נדרשת אימות — הריצו `opencode auth`".

---

## L. Capabilities שלא ניצלנו

### `image` ב-promptCapabilities

אנחנו שולחים רק text. בסדר — spec אומר text הוא baseline.

### `embeddedContext` (ContentBlock::Resource)

ה-spec ממליץ להשתמש בו כדי להכניס קובץ כ-embedded resource. אנחנו לא שולחים context files בkל. הmissing use-case: אם המשתמש רוצה לשאול שאלה על קובץ ספציפי — כעת אין מנגנון. Slice 6+.

### `loadSession`

`AcpTransport` interface ב-`ports.ts` **אין** `loadSession` method. `acp-transport.ts` שורה 69 מציין `capabilities.loadSession = true/false` אך לא ממש את ה-method.

### `unstable_setSessionModel`

`ClientSideConnection.unstable_setSessionModel` קיים ב-SDK (`acp.d.ts` שורה 369). אנחנו לא קוראים לו. `cli-config.ts` מציין שmodeOverride ל-opencode לא נתמך עדיין. הדרך ל-Slice 6: `conn.unstable_setSessionModel({ sessionId, modelId: "..." })`.

### Verdict
- 🟦 כל אלה — deliberate-skip לMVP/Slice 6+

---

## Summary Table

| תחום | סטטוס | חומרה | תיקון נדרש |
|------|--------|--------|-------------|
| A. Initialization | ⚠️ partial | 🟡 | הוסף `fs` ל-clientCapabilities + clientInfo |
| B. Authentication | 🟦 deliberate-skip | 🟡 | טיפול ב-auth_required error |
| C. Session Setup | ⚠️ partial | 🟢 | שמור modes מה-response |
| D. Prompt Turn | ✅ partial | 🟢 | הוסף tool_call_update + תקן stopReason ב-audio |
| E. File System | ⚠️ partial | 🟡 | הצהרת fs capabilities + impl |
| F. Permissions | ⚠️ bug | 🔴 | שנה `optionId === "allow_once"` ל-`kind === "allow_once"` |
| G. Terminals | 🟦 deliberate-skip | 🟢 | — (Slice 6) |
| H. Session Modes | 🟦 deliberate-skip | 🟢 | Slice 6 |
| I. Cancellation | ✅ | 🟢 | לבדוק pending requestPermission |
| J. Transport | ✅ | 🟢 | תקן heartbeat filter |
| K. Errors | ⚠️ partial | 🟡 | טיפול ב-auth_required |
| L. Capabilities | 🟦 deliberate-skip | — | Slice 6+ |

---

## Critical Findings (חייב לתקן לפני המשך)

### 1. `requestPermission` — חיפוש לפי `optionId` שגוי

**קובץ:** `packages/backend/src/acp/client-impl.ts:18`

**הקוד הנוכחי:**
```typescript
const allowOnce = params.options.find((o) => o.optionId === "allow_once")
```

**הבעיה:** `optionId` הוא string שרירותי שה-agent קובע. opencode עשוי לשלוח `"allow-once"`, `"allow_once"`, `"yes"` וכו'. ה-typed enum `kind: "allow_once"` הוא הדרך הנכונה לזהות.

**תיקון מוצע:**
```typescript
const allowOnce = params.options.find((o) => o.kind === "allow_once")
```

**חומרה:** 🔴 — אם opencode שולח `optionId !== "allow_once"`, כל permission request נבחר לפי `params.options[0]` (blindly). זה כרגע עשוי "לעבוד" אם first option הוא allow, אבל לא מובטח.

---

## Important (לתקן לפני Slice 6)

### 2. חסרה הצהרת `fs` capabilities

**קובץ:** `packages/backend/src/acp/acp-transport.ts:65`

**תיקון:** הוסף `fs: { readTextFile: true, writeTextFile: true }` ל-`clientCapabilities` **ותממש** את `readTextFile` ו-`writeTextFile` ב-`client-impl.ts`. בינתיים opencode פועל ללא ACP fs access.

### 3. `clientInfo` חסר

**קובץ:** `packages/backend/src/acp/acp-transport.ts:63`

**תיקון:** הוסף `clientInfo: { name: "drive-coding", version: "0.1.0" }`.

### 4. `stopReason` hardcoded ב-`sendAudioPrompt`

**קובץ:** `packages/backend/src/app/agent-session.ts:237`

**הבעיה:** `stopReason: "end_turn"` hardcoded — צריך לקחת מה-response של `transport.prompt()`.

---

## Minor / Future

### 5. `tool_call_update` לא מטופל
**קובץ:** `packages/backend/src/app/agent-session.ts` — להוסיף `case "tool_call_update"` עם broadcast ל-UI.

### 6. `heartbeat` filter חלקי
**קובץ:** `packages/backend/src/acp/ws-streams.ts:27` — filter פועל רק על first message. יש לסנן לפי type בכל הודעה (אם stdio-to-ws שולח heartbeats מתמשכים).

### 7. Error codes לא מובחנים
**קובץ:** שניהם — לזהות `auth_required` ו-`resource_not_found` בנפרד.

### 8. `loadSession` לא ממומש
**קובץ:** `packages/core/src/ports.ts` + `acp-transport.ts` — `capabilities.loadSession: true` מוצהר ב-initialize response, אבל אין method לממש אותו. Slice 6+.

---

## אישור או הפרכה של ההיפותזה של Tama

**ההיפותזה:** newSession תקוע כי `clientCapabilities: {}` ריקות → opencode acp לא יכול לקרוא AGENTS.md ב-cwd.

**ממצאי: מפריך — אך עם הסתייגות**

**ראיות:**

1. **ה-spec מפורש:** "All capabilities included in the `initialize` request are **OPTIONAL**. Implementations **MUST** treat all capabilities omitted as **UNSUPPORTED**." — כלומר `clientCapabilities: {}` הוא תקין לחלוטין. opencode לא יקרוס בגללו.

2. **כיצד opencode קורא AGENTS.md:** opencode קורא AGENTS.md **ישירות מה-filesystem**, לא דרך ACP `fs/read_text_file`. ה-`cwd` שנשלח ב-`session/new` מגדיר את ה-working directory, ו-opencode פותח קבצים בו ישירות כ-subprocess. לכן חוסר `fs` capability לא מונע מ-opencode לקרוא AGENTS.md.

3. **opencode behavior:** opencode הוא process שנרוץ עם `cwd` שמוגדר. הוא עושה filesystem access ישיר, לא דרך ACP fs callbacks.

4. **הבעיה האמיתית לחקור:** שגיאת "spawn/attach failed: ACP connection closed" כנראה קשורה ל:
   - race condition: ACP transport timeout (10s) vs bridge spawn time (עד 30s) — `acp-transport.ts:35-40`
   - stdio-to-ws לא מוכן בזמן
   - first-message filter (`isFirstMessage = true`) ב-`ws-streams.ts` — אם stdio-to-ws שולח יותר מhודעה אחת לפני ה-ACP initialize, השניה תועבר ל-SDK כ-ACP message לא חוקי

**מסקנה:** `clientCapabilities: {}` לא גורם ל-newSession להיתקע. הוא מגביל יכולות אבל לא מוביל ל-"connection closed". ה-blocker הסביר יותר הוא race/timeout ב-bridge startup, או בעיית first-message filter ב-ws-streams.

---

## פתוחות לדיון עם Tama

1. **Race condition בין bridge spawn (30s timeout) ל-ACP connection (10s timeout):** ב-`bridge-manager.ts` ה-`portTimeoutMs: 30000` אבל ב-`acp-transport.ts` יש timeout של 10s. אם הbridge לוקח >10s להתחיל (ירידת npm package), ה-ACP transport timeouts ב-10s לפני שה-WS connection נסגר. האם כדאי לסנכרן את הtimeouts?

2. **ws-streams first-message filter:** כרגע `isFirstMessage = true` מסנן רק את ההודעה **הראשונה** מ-stdio-to-ws. אם stdio-to-ws שולח heartbeats נוספים לפני ה-ACP `initialize` response (למשל כשהagent לוקח זמן לעלות), הם יגיעו ל-SDK כ-ACP messages לא חוקיים וגורמים ל-parse error → connection close. **זאת עשויה להיות הסיבה האמיתית לבאג.**

3. **`clientCapabilities.fs` — להוסיף עכשיו או ב-Slice 6?** אם opencode קורא קבצים ישירות (לא דרך ACP), אין דחיפות. אבל אם מישהו ישתמש ב-claude-agent-acp או gemini-acp שסומכים על ACP fs — ייכשל.

4. **`unstable_setSessionModel` — omission עקבי עם D49?** ב-cli-config.ts אנחנו קולטים `modelOverride` אבל מציינים שopencode acp לא תומך ב-`-m`. האם `unstable_setSessionModel` עובד עם opencode? זה מחוץ לscope של בדיקה זו אבל שווה לבדוק.

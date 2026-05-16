# Backend Test Plan — סגירת פערי כיסוי

> **מצב נוכחי:** 19 קבצי src ב-backend, 7 עם tests, 12 בלי.
> כל 3 הבאגים הקשים שנמצאו ב-prod (NDJSON `\n`, warmup timing, `-m` flag) היו בקבצים ללא tests.
>
> **מטרה:** כיסוי של כל ה-12 קבצים החסרים. עדיפות לפי חומרה.
>
> **מבצע:** Yolo (Sonnet 4.6)
> **TDD:** כל test נכתב ראשון, נכשל, אז impl מתוקן אם צריך.

---

## 1. סדר עדיפויות

### 🔴 עדיפות 1 — קריטי (באגים כבר נמצאו כאן)

#### 1.1 `ws-streams.ts` (~15 tests)

**מה הקובץ עושה:** ממיר WebSocket frames ↔ ReadableStream/WritableStream עבור ACP NDJSON.

**מה לבדוק:**

Readable (incoming — WS → Stream):
```
- frame עם `{"jsonrpc":"2.0",...}` → עובר ל-stream as-is
- frame עם `{"type":"connected",...}` → נבלע (לא מגיע ל-stream)
- frame עם `{"type":"heartbeat"}` → נבלע
- frame עם `{"type":"disconnected"}` → נבלע
- frame עם `{"type":"unknown_xyz"}` → נבלע + console.warn
- frame חלקי (חצי JSON) → עובר as-is, בלי הוספת \n
- frame מלא שנגמר ב-\n → עובר as-is (לא מוסיפים \n נוסף)
- frame מלא בלי \n → עובר as-is (לא מוסיפים \n!)
- 2 frames שיחד מרכיבים JSON אחד → שניהם עוברים, ה-SDK מרכיב
- WS close → controller.close() נקרא
- WS error → controller.error() נקרא
```

Writable (outgoing — Stream → WS):
```
- chunk עם `{"jsonrpc":"2.0",...}\n` → נשלח כ-frame עם \n
- chunk עם שתי שורות (`{...}\n{...}\n`) → 2 frames נפרדים
- chunk עם שורה ריקה → לא נשלח frame ריק
- WS כבר סגור → לא זורק (catch שקט)
- close() → ws.close()
- abort(reason) → ws.close(1011, reason)
```

**Mock:** `MockWebSocket` עם `on(event, cb)`, `send(data)`, `close()`, `readyState`.

#### 1.2 `acp-transport.ts` (~12 tests)

**מה הקובץ עושה:** orchestrates WS connection → stdio-to-ws handshake wait → initialize → newSession → returns AcpTransport.

**מה לבדוק:**
```
- WS open + connected frame → ממתין 1500ms → שולח initialize
- WS open + no connected frame within 10s → reject עם error
- initialize response עם agentCapabilities → capabilities נשמרות
- newSession response עם sessionId → sessionId נשמר
- handshake timeout (45s) → reject עם "ACP handshake timeout"
- WS error לפני open → reject עם "ACP WS error"
- prompt() → שולח JSON-RPC prompt ומחזיר response
- prompt() עם onUpdate callback → notifications מגיעות
- cancel() → שולח session/cancel
- shutdown() → ws.close()
- auth_required error → reject עם kind: "auth_required"
- clientCapabilities כולל fs.readTextFile + fs.writeTextFile
- clientInfo כולל name + version
```

**Mock:** `MockWebSocket` שמדמה stdio-to-ws behavior (שולח connected, מחזיר initialize response, וכו').

#### 1.3 `client-impl.ts` (~10 tests)

**מה הקובץ עושה:** implements ACP Client callbacks — permission, sessionUpdate, fs read/write.

**מה לבדוק:**
```
- requestPermission עם option kind=allow_once → בוחר אותה
- requestPermission עם option kind=allow_always (בלי allow_once) → בוחר allow_always
- requestPermission בלי options → returns cancelled
- requestPermission עם kind=reject_once + kind=allow_once → בוחר allow_once (לא reject)
- sessionUpdate → callback נקרא עם הnotification
- readTextFile עם path קיים → מחזיר content
- readTextFile עם line + limit → מחזיר slice
- readTextFile עם path לא קיים → throws (ENOENT)
- writeTextFile → כותב לדיסק, מחזיר {}
```

**Mock:** temp directory (`/tmp/test-client-impl-*`) לfs tests.

---

### 🟡 עדיפות 2 — חשוב (logic שלא נבדק)

#### 2.1 `cli-config.ts` (~8 tests)

**מה לבדוק:**
```
- getCliCommand("opencode") → { bin: "opencode", args: ["acp"] }
- getCliCommand("opencode", "some-model") → same (model ignored for opencode)
- getCliCommand("claude") → npx claude-agent-acp
- getCliCommand("claude", "model-x") → npx ... --model model-x
- getCliCommand("gemini") → npx gemini-cli --experimental-acp
- getCliCommand("codex") → npx codex-acp
- buildStdioToWsArgs(cli, 0) → ["-y", "@rebornix/stdio-to-ws", "opencode acp", "--port", "0", "--persist", "--grace-period", "-1"]
- buildStdioToWsArgs(cli, 12345) → port=12345
```

#### 2.2 `agent-orchestrator.ts` (~8 tests)

**מה לבדוק:**
```
- createAndSpawn success → agent status=ready, session created
- createAndSpawn bridge failure → agent status=crashed, crashReason set
- createAndSpawn ACP failure → agent status=crashed
- deleteAndKill → bridge killed, agent removed, session removed
- getSession for ready agent → returns session
- getSession for non-existent agent → returns null
- crash listener → onBridgeCrash updates status to crashed
- extractProviderError called on stderr when spawn fails
```

**Mock:** mock `bridgeManager`, `registry`, `createAcpWsTransport`.

#### 2.3 `ws-agent.ts` (~10 tests)

**מה לבדוק:**
```
- WS upgrade on /ws/agent/:id → upgrades
- WS upgrade on /ws/agent/nonexistent → error AGENT_NOT_FOUND
- incoming { type: "prompt", text: "hello" } → calls session.sendPrompt
- incoming { type: "cancel" } → calls session.cancel
- incoming { type: "audio", agentId, audioBase64, mimeType } → calls session.sendAudioPrompt
- incoming invalid JSON → sends error message
- incoming unknown type → sends INVALID_MSG error
- session broadcast → sent to all connected WS clients
- WS close → subscriber removed
```

**Mock:** mock Bun.serve upgrade, mock AgentSession.

#### 2.4 `cache-disk.ts` (~8 tests)

**מה לבדוק:**
```
- init() creates directory if not exists
- set(key, data) → writes file
- get(key) for existing → returns data
- get(key) for missing → returns null
- set + get roundtrip → same bytes
- concurrent set on same key → last write wins
- key with special chars → works (sha256 = hex safe)
- directory already exists on init() → no error
```

**Mock:** temp directory.

#### 2.5 `gemini-transcription.ts` (~5 tests)

**מה לבדוק:**
```
- provider.specificationVersion === "v3"
- provider.modelId matches input
- doGenerate with audio bytes → returns { text, segments, ... }
- doGenerate with previousAssistantText → prompt includes context
- doGenerate without previousAssistantText → prompt is generic
```

**Mock:** mock `GoogleGenAI.models.generateContent`.

---

### 🟢 עדיפות 3 — נמוך (minimal logic)

#### 3.1 `http-options.ts` (~4 tests)
```
- GET /api/options returns { models, projects }
- models.opencode is array of strings
- projects contains paths from ~/projects
- fallback when opencode models command fails
```

#### 3.2 `providers.ts` (~3 tests)
```
- STT_REGISTRY has "gemini/flash-context"
- TTS_REGISTRY has "elevenlabs/v3"
- TRANSLATOR_REGISTRY has "gemini/flash-lite"
```

#### 3.3 `ws-echo.ts` (~2 tests)
```
- echo message → returns same message
- ping → pong
```

#### 3.4 `http.ts` (~1 test)
```
- GET /api/health returns { status: "ok" }
```

#### 3.5 `server.ts` (~0 tests)
Wiring only — אין logic לבדוק ב-unit test. נבדק ב-integration/E2E.

---

## 2. סיכום מספרים

| עדיפות | קבצים | tests חדשים | זמן צפוי |
|--------|-------|-------------|----------|
| 🔴 1 | 3 (ws-streams, acp-transport, client-impl) | ~37 | 90 דק |
| 🟡 2 | 5 (cli-config, orchestrator, ws-agent, cache-disk, gemini-transcription) | ~39 | 90 דק |
| 🟢 3 | 4 (http-options, providers, ws-echo, http) | ~10 | 20 דק |
| **סה"כ** | **12** | **~86** | **~200 דק (3.5 שעות)** |

**אחרי:** 236 + 86 = **~322 tests**. כיסוי backend: 19/19 קבצים.

---

## 3. הוראות לסוכן

```
קרא docs/backend-test-plan.md.
עבוד לפי עדיפויות — 🔴 קודם, אז 🟡, אז 🟢.
TDD: כתוב test → red → impl (אם צריך תיקון) → green → next.
commit אחרי כל עדיפות (3 commits).
pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך:
- packages/frontend/src/**
- packages/core/src/**
- docs/**

מותר לערוך:
- packages/backend/tests/** (חדשים)
- packages/backend/src/** (רק אם test חושף bug — תקן ותעד בcommit)
```

---

## 4. הערות מיוחדות

### `ws-streams.ts` — ה-tests הכי חשובים בפרויקט כרגע

שני באגים חמורים נמצאו בקובץ הזה ב-prod:
1. `isFirstMessage` filter שעבד רק על ההודעה הראשונה
2. הוספת `\n` ל-partial frames

ה-tests חייבים לכסות את **שני** הmechanisms שתיקנו, כדי שregression לא יחזור.

### `acp-transport.ts` — MockWebSocket חייב לדמות stdio-to-ws behavior

ה-mock חייב:
1. לשלוח `{"type":"connected","clientId":"..."}` אחרי open
2. לענות ל-initialize JSON-RPC עם capabilities
3. לענות ל-newSession עם sessionId
4. לתמוך ב-prompt → notifications → response flow

### `client-impl.ts` — fs tests צריכים tmp directory

להשתמש ב-`mkdtemp` ולנקות ב-`afterEach`. לא לכתוב ל-paths אמיתיים.

### אם test חושף bug — תתקן

זה חלק מ-TDD. אם כתבת test ל-`ws-streams` שמראה שpartial frame עדיין לא עובד נכון — תקן את `ws-streams.ts` ותעד בcommit.

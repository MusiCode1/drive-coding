# vNext Technical Spec — drive-coding

> **סטטוס:** שכבה 2 (אחרי lint סבב 8, 2026-05-16) — מפרט טכני להתחלת implementation.
> **כותב:** Tama (planner agent).
> **תאריך:** 2026-05-15 (עודכן 2026-05-16).
> **תלות:** `vnext-architecture.md` (החלטות D1-D50), `vnext-research.md` (ממצאים).
> **מטרה:** לתת ל-executor מספיק פרטים כדי להתחיל לכתוב קוד.
>
> **הערה חשובה ל-MVP:** אין identity, אין auth, אין tokens. רץ אצל אבי בלבד. `Authorization` headers ו-`ownerToken` שמופיעים בדוגמאות הם **לא ב-MVP** (D11 [future]).

---

## תוכן עניינים

1. [סקירה — שלושת הפרוטוקולים](#1-סקירה)
2. [Domain Models (ArkType)](#2-domain-models)
3. [Frontend ↔ Backend WS Protocol](#3-fe-be-ws-protocol)
4. [Backend ↔ Bridge WS Protocol](#4-be-bridge-ws-protocol)
5. [HTTP API Spec](#5-http-api-spec)
6. [Ports — interfaces ב-`packages/core`](#6-ports)
7. [Sequence Diagrams](#7-sequence-diagrams)
8. [Slice 1 — concrete first deliverable](#8-slice-1)
9. [פתוחים](#9-פתוחים)

---

## 1. סקירה

יש שלושה פרוטוקולים בשרשרת:

```
Browser ──────WS────── Backend ──────WS────── Bridge ──────stdio────── CLI
        (drive-coding)         (BE↔Bridge)              (ACP JSON-RPC)
        ────────────           ────────────             ──────────────
        §3 כאן                 §4 כאן                    ACP standard
```

- **§3 — Frontend↔Backend** (`drive-coding-ws`): voice events + chat events. שלנו, ייעודי.
- **§4 — Backend↔Bridge** (`drive-coding-bridge-ws`): ACP envelope עטוף ב-WS. internal, פשוט.
- **ACP stdio** (לא בתחום שלנו): Bridge מתחזק את ה-CLI subprocess עם stdio JSON-RPC. זה ה-spec של [agentclientprotocol.com](https://agentclientprotocol.com).

**הפרדה חשובה:**
- ה-Frontend לא יודע מ-ACP. הוא מדבר drive-coding-ws עם voice events.
- ה-Bridge לא יודע מ-voice. הוא מתעסק רק ב-ACP envelope.
- ה-Backend הוא ה-orchestrator שמתרגם בין השניים.

---

## 2. Domain Models

### 2.1 חבילה: `core/src/schemas.ts` — ArkType

הסכמות הללו משותפות ל-backend ול-frontend (frontend יבא מ-`core` כ-workspace dep).

```ts
import { type } from "arktype"

// ─── Agent ───────────────────────────────────────────────
// ב-MVP אין identity. כל ה-agents שייכים ל-instance.
// אם נפתח לכמה משתמשים בעתיד (D11 [future]) — נוסיף ownerId אופציונלי.

export const CliKind = type("'opencode' | 'claude' | 'gemini' | 'codex'")
export type CliKind = typeof CliKind.infer

export const AgentStatus = type(
  "'starting' | 'ready' | 'busy' | 'crashed' | 'closed'"
)
export type AgentStatus = typeof AgentStatus.infer

export const Agent = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
  // bridge details (internal, לא נחשף ל-frontend)
  "bridgePort?": "number",
  "acpConnectionId?": "string",
  "acpSessionId?": "string",
})
export type Agent = typeof Agent.infer

// AgentPublic — מה שה-frontend מקבל (בלי שדות פנימיים)
export const AgentPublic = type({
  id: "string.uuid",
  cliKind: CliKind,
  cwd: "string",
  modelOverride: "string | null",
  status: AgentStatus,
  createdAt: "string.date.iso",
})
export type AgentPublic = typeof AgentPublic.infer

// ─── Voice settings (D38 + D43) ───────────────────────────
// per-user (אחד לכל instance ב-MVP). שמור ב-localStorage.
// sttModel/ttsModel/translatorModel הם keys ב-AI SDK registries
// (לדוגמה: 'gemini/flash-context', 'elevenlabs/v3', 'gemini/flash-lite')

export const Language = type("'he' | 'en'")  // הרחבה בעתיד דרך i18n

export const VoiceSettings = type({
  language: Language,
  sttModel: "string",                  // key ב-STT_REGISTRY
  ttsModel: "string",                  // key ב-TTS_REGISTRY
  translatorModel: "string",           // key ב-TRANSLATOR_REGISTRY
  ttsVoiceId: "string",                // voice id ספציפי לprovider
  "thoughtVoiceId?": "string",         // אופציונלי
})
export type VoiceSettings = typeof VoiceSettings.infer

// ─── Bubble (chat history item) ──────────────────────────

export const BubbleKind = type(
  "'user' | 'assistant' | 'thought' | 'tool_call'"
)

export const Bubble = type({
  id: "string.uuid",
  agentId: "string.uuid",
  kind: BubbleKind,
  text: "string",
  "audioBase64?": "string",            // נשמר רק ל-assistant
  createdAt: "string.date.iso",
})
export type Bubble = typeof Bubble.infer
```

### 2.2 הערה על ArkType + frontend

ה-schemas הללו נצרכים מ-Svelte runes ב-frontend לסידור input forms ו-validation. דוגמה:

```ts
// frontend/src/routes/agent/new/+page.svelte
<script lang="ts">
  import { type } from "arktype"
  import { CliKind } from "@drive-coding/core/schemas"

  let cliKind = $state<typeof CliKind.infer>("opencode")
  let cwd = $state("")
  let modelOverride = $state("")

  const form = type({
    cliKind: CliKind,
    cwd: "string >= 1",
    modelOverride: "string | null",
  })

  function submit() {
    const result = form({ cliKind, cwd, modelOverride: modelOverride || null })
    if (result instanceof type.errors) {
      // show errors
      return
    }
    // POST /api/agents with result
  }
</script>
```

---

## 3. Frontend ↔ Backend WS Protocol

### 3.1 Endpoint

```
WSS /ws/agent/:agentId
```

ב-MVP אין auth. ב-connect, ה-backend בודק:
1. agent קיים ב-Map (in-memory).
2. agent בסטטוס `ready` או `busy`.

אם משהו לא תקין → close code 1008 + reason.

**[future]:** אם נפתח לכמה משתמשים, נוסיף `Authorization: Bearer <token>` header + validation.

### 3.2 Server → Client messages

```ts
import { type } from "arktype"

export const ServerMessage = type(
  // החיבור הצליח, מצב התחלתי
  {
    type: "'connected'",
    agentId: "string.uuid",
    voiceSettings: VoiceSettings,
    historyBubbles: Bubble.array(),       // היסטוריה אם קיימת
  }
).or(
  // STT הסתיים, prompt נשלח, ממתין למודל
  {
    type: "'thinking'",
    transcribedText: "string",
  }
).or(
  // chunk טקסט מהמודל (streaming)
  {
    type: "'text_chunk'",
    kind: "'message' | 'thought' | 'thought_translation'",
    text: "string",
  }
).or(
  // התחלת השמעת קטע אודיו
  {
    type: "'audio_start'",
    bubbleId: "string.uuid",
    kind: "'message' | 'thought' | 'tool_title'",
    mimeType: "string",                   // 'audio/mpeg' / 'audio/opus'
  }
).or(
  // chunk אודיו (base64 MP3/Opus)
  {
    type: "'audio_chunk'",
    bubbleId: "string.uuid",
    data: "string",
  }
).or(
  // סיום קטע אודיו
  {
    type: "'audio_end'",
    bubbleId: "string.uuid",
  }
).or(
  // tool call של המודל
  {
    type: "'tool_call'",
    toolCallId: "string",
    title: "string",
    "narrationText?": "string",           // הקראה מנוסחת ע"י Gemini
  }
).or(
  // bubble נשמר/עודכן (כולל audioBase64 לreplay)
  {
    type: "'bubble_persisted'",
    bubble: Bubble,
  }
).or(
  // turn הסתיים
  {
    type: "'done'",
  }
).or(
  // שגיאה
  {
    type: "'error'",
    code: "string",                       // למשל 'STT_FAILED', 'PROVIDER_ERROR'
    message: "string",
  }
)
export type ServerMessage = typeof ServerMessage.infer
```

### 3.3 Client → Server messages

```ts
export const ClientMessage = type(
  // התחלת הקלטה — ה-frontend מודיע
  {
    type: "'audio_start'",
    mimeType: "string",                   // 'audio/webm', 'audio/wav', וכו'
  }
).or(
  // chunk הקלטה (base64)
  {
    type: "'audio_chunk'",
    data: "string",
  }
).or(
  // סוף הקלטה — backend יעבד את הצברים
  {
    type: "'audio_end'",
  }
).or(
  // ביטול: עוצר model + TTS + מתחיל הקלטה חדשה (Q10 — D19)
  {
    type: "'cancel'",
  }
).or(
  // עדכון voice settings תוך כדי ride
  {
    type: "'update_voice_settings'",
    voiceSettings: VoiceSettings,
  }
).or(
  // ping/keepalive
  {
    type: "'ping'",
  }
)
export type ClientMessage = typeof ClientMessage.infer
```

### 3.4 Multi-tab fan-out

לפי D23 (acp-bridge keeps living after FE disconnect), ולפי האפשרות שיש כמה tabs פתוחים על אותו agent:

- כל WS connection ל-`/ws/agent/:id` מקבל את **כל** ה-events של ה-agent.
- אם user פותח tab שני → tab החדש מקבל `connected` + `historyBubbles` + ימשיך לקבל live events.
- אם user סוגר tab אחד אבל השני נשאר פתוח → ה-agent ממשיך כרגיל.
- אם **כל** ה-tabs נסגרים → ה-bridge ממשיך לרוץ. ה-events מצטברים ב-buffer (size 500).

---

## 4. Backend ↔ Bridge WS Protocol

**עדכון D33:** במקום bridge משלנו, אנחנו spawn-ים את `@rebornix/stdio-to-ws`. הוא מגדיר את ה-protocol — אנחנו רק consumer.

### 4.1 איך עובד `stdio-to-ws`

ה-bridge פותח WS server. כל message שמגיע ב-WS עובר ל-stdin של ה-CLI; כל line מ-stdout של ה-CLI נשלח כ-WS message. ACP משתמש ב-NDJSON, אז framing="line" (default) מתאים בדיוק.

```
Backend ──── WS message (JSON-RPC) ────► stdio-to-ws ────► CLI stdin
Backend ◄──── WS message (JSON-RPC) ──── stdio-to-ws ◄──── CLI stdout
```

**שום פרוטוקול envelope משלנו.** ה-WS payloads הם **JSON-RPC 2.0 גולמי של ACP**.

### 4.2 Endpoint

```
ws://127.0.0.1:<port>/
```

הפורט מודפס ב-stdout של `stdio-to-ws` ב-startup. ה-`BridgeManager` שלנו cap-ר אותו.

### 4.3 שימוש ב-`@agentclientprotocol/sdk` כ-client

ה-SDK הרשמי של ACP מספק `ClientSideConnection` שעוטף את ה-JSON-RPC dispatching. אנחנו עוטפים אותו ב-`AcpTransport` adapter:

```ts
// packages/backend/src/adapters/acp-transport-ws.ts
import { ClientSideConnection } from "@agentclientprotocol/sdk"
import { WebSocket } from "ws"
import type { AcpTransport, AcpCapabilities } from "@drive-coding/core/ports"

export function createAcpWsTransport(wsUrl: string): AcpTransport {
  const ws = new WebSocket(wsUrl)
  // Adapt WebSocket to the SDK's expected ReadableStream/WritableStream
  const conn = new ClientSideConnection(/* streams */, clientImpl)

  return {
    async initialize() {
      const result = await conn.initialize({ /* protocol version, capabilities */ })
      return ok(toAcpCapabilities(result))
    },
    async newSession({ cwd }) {
      const result = await conn.newSession({ cwd, mcpServers: [] })
      return ok({ sessionId: result.sessionId })
    },
    // ...
  }
}
```

ה-`clientImpl` מספק את ה-callbacks ל-`requestPermission`, `fs/*`, `terminal/*`. רובם נסיים ב-`-32601 Method not found` כי frontend-וב לא תומך בהם.

### 4.4 Persistence + Reconnect (לפי `--persist`)

כש-spawn-ים עם `--persist --grace-period -1`:

1. backend מתחבר → `stdio-to-ws` שולח `{"type": "connected", "clientId": "..."}` כ-first frame.
2. backend שומר את ה-`clientId` (בזיכרון או ב-disk).
3. backend נופל → ה-bridge מצבר notifications.
4. backend חוזר → connect שוב עם header `X-Client-Id: <saved>`.
5. ה-bridge עושה replay של ה-notifications שהוא צבר.

זה משתחרר אותנו מלממש את ה-replay buffer בעצמנו — `stdio-to-ws` עושה את זה.

### 4.5 Authentication

אין ב-WS של ה-bridge — חי על `127.0.0.1` בלבד, לא expose מעבר ל-container. ה-backend הוא היחיד שניגש.

**[future]** אם ה-bridge יישלח דרך Dev Tunnel (D33 — `--tunnel-name`) ל-טלפון של אבי, ה-acp-ui מציע pattern: `Authorization: Bearer <token>` כ-WebSocket subprotocol.

---

## 5. HTTP API Spec

כל ה-endpoints מתחת ל-`/api/`. **ב-MVP אין auth** — אין `Authorization` header.

**[future]** Identity endpoint:

```
POST /api/identity/token   # יחזיר anonymous token. דחוי ל-future אם נפתח לכמה משתמשים.
```

### 5.1 Agents

#### `GET /api/agents`

רשימת agents של המשתמש הנוכחי.

**Response 200:**
```json
{ "agents": [AgentPublic, ...] }
```

#### `POST /api/agents`

יצירת agent חדש (spawn bridge + CLI).

**Request:**
```json
{
  "cliKind": "opencode",
  "cwd": "/home/user/projects/foo",
  "model": "claude-sonnet-4"
}
```

**Response 201:**
```json
{ "agent": AgentPublic }
```

**Response 400:** validation errors (cwd לא קיים, cliKind לא נתמך).

**Response 500:** spawn failed (bridge לא עלה תוך timeout).

#### `GET /api/agents/:id`

פרטי agent.

**Response 200:** `{ "agent": AgentPublic }`

**Response 404:** agent לא קיים או לא שייך ל-token.

#### `DELETE /api/agents/:id`

כיבוי agent (graceful — `shutdown` ל-bridge, kill ל-CLI).

**Response 204:** empty.

### 5.2 Providers (D36)

#### `GET /api/providers`

רשימת מודלים זמינים מ-AI SDK registries.

**Response 200:**
```json
{
  "stt": [
    { "id": "gemini/flash-context", "label": "Gemini Flash (Hebrew)" },
    { "id": "openai/whisper-1", "label": "OpenAI Whisper" },
    { "id": "deepgram/nova-3", "label": "Deepgram Nova-3" }
  ],
  "tts": [
    { "id": "elevenlabs/v3", "label": "ElevenLabs v3 (Hebrew)" },
    { "id": "openai/tts-1", "label": "OpenAI TTS" }
  ],
  "translator": [
    { "id": "gemini/flash-lite", "label": "Gemini Flash Lite" },
    { "id": "openai/gpt-4o-mini", "label": "GPT-4o mini" }
  ]
}
```

#### `GET /api/providers/:type/:id/voices`

רשימת voices ל-TTS provider ספציפי (אם רלוונטי — למשל ElevenLabs).

**Response 200:**
```json
{
  "voices": [{ "id": "rachel-he", "name": "Rachel (Hebrew)", "language": "he" }, ...]
}
```

#### `POST /api/providers/tts/preview`

הקראת טקסט קצר לבדיקה (D36).

**Request:**
```json
{
  "ttsModel": "elevenlabs/v3",
  "voiceId": "rachel-he",
  "text": "שלום, זה דגם הקול הזה."
}
```

**Response 200:** `audio/mpeg` stream.

### 5.3 Filesystem (לתמיכת cwd picker)

#### `GET /api/fs/list?path=/home/user`

רשימת תוכן של directory (לתמיכה ב-cwd picker ב-frontend).

**Response 200:**
```json
{
  "path": "/home/user",
  "entries": [
    { "name": "projects", "kind": "dir" },
    { "name": "Downloads", "kind": "dir" }
  ]
}
```

**Response 403:** path מחוץ לאזור מורשה.

### 5.4 Health

#### `GET /api/health`

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "uptime": 12345,
  "agents": { "ready": 2, "busy": 1, "crashed": 0 }
}
```

---

## 6. Ports

**עדכון D38:** במקום ports מותאמים אישית ל-STT/TTS/Translator, אנחנו משתמשים ב-`@ai-sdk/provider` של Vercel AI SDK כסטנדרט. רק ports ייחודיים לנו (ACP, BridgeManager, IdentityStore, AgentRegistry) חיים ב-`core/ports.ts`.

### 6.1 Voice Providers — מאומצים מ-AI SDK

```ts
// אין צורך להגדיר — מתוך @ai-sdk/provider

import type {
  TranscriptionModelV3,
  SpeechModelV3,
  LanguageModelV3,
} from "@ai-sdk/provider"

// ה-models מוגדרים ב-backend/voice/providers.ts:
import { STT_REGISTRY, TTS_REGISTRY, TRANSLATOR_REGISTRY } from "./providers"
```

ה-`TranscriptionModelV3` interface הוא של AI SDK ולא נשלט על-ידינו. רואה https://github.com/vercel/ai/tree/main/packages/provider/src/transcription-model

ה-pipeline משתמש דרך `ai`:

```ts
import { experimental_transcribe as transcribe } from "ai"

const result = await transcribe({
  model: STT_REGISTRY[voiceSettings.sttModel],
  audio: audioBytes,
  abortSignal: controller.signal,
})
// result.text, result.segments, result.language, result.durationInSeconds
```

### 6.2 Custom Provider — `geminiTranscription` (D39)

AI SDK לא תומך ב-Gemini ל-STT (כי Gemini לא חושף Whisper-style endpoint). נכתוב משלנו:

```ts
// packages/backend/src/voice/providers/gemini-transcription.ts

import type { TranscriptionModelV3, TranscriptionModelV3CallOptions } from "@ai-sdk/provider"
import { GoogleGenerativeAI } from "@google/genai"

export function geminiTranscription(modelId: string): TranscriptionModelV3 {
  return {
    specificationVersion: "v3",
    provider: "gemini-custom",
    modelId,

    async doGenerate(options: TranscriptionModelV3CallOptions) {
      const genai = new GoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY })
      const model = genai.getGenerativeModel({ model: modelId })

      // ייחודי שלנו — context מהמסר הקודם
      const previousContext = options.providerOptions?.gemini?.previousAssistantText
      const systemPrompt = buildSystemPrompt(options.providerOptions?.gemini?.languageHint, previousContext)

      const result = await model.generateContent([
        { text: systemPrompt },
        { inlineData: { mimeType: options.mediaType, data: bytesToBase64(options.audio) } },
      ], { abortSignal: options.abortSignal })

      return {
        text: result.response.text(),
        warnings: [],
        // optional: segments, language, durationInSeconds (אם Gemini יחזיר)
      }
    },
  }
}
```

### 6.3 Ports שלנו (נשארים בכוח)

```ts
// packages/core/src/ports.ts

import type { ResultAsync } from "neverthrow"
import type {
  SessionNotification,
  PromptResponse,
} from "@agentclientprotocol/sdk"

// ─── ACP Transport ─────────────────────────────────────────────

export type AcpCapabilities = {
  readonly loadSession: boolean
  readonly fs: { readonly readTextFile: boolean; readonly writeTextFile: boolean }
  readonly terminal: boolean
}

export type AcpError =
  | { readonly kind: "transport"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }
  | { readonly kind: "agent"; readonly message: string }

export interface AcpTransport {
  initialize(): ResultAsync<AcpCapabilities, AcpError>
  newSession(input: { readonly cwd: string }): ResultAsync<{ readonly sessionId: string }, AcpError>
  loadSession(input: { readonly sessionId: string; readonly cwd: string }): ResultAsync<void, AcpError>
  prompt(
    input: { readonly sessionId: string; readonly text: string },
    onUpdate: (n: SessionNotification) => void,
  ): ResultAsync<PromptResponse, AcpError>
  cancel(input: { readonly sessionId: string }): Promise<void>
  shutdown(): Promise<void>
}

// ─── Bridge Manager ───────────────────────────────────────────

export type SpawnInput = {
  readonly cliKind: "opencode" | "claude" | "gemini" | "codex"
  readonly cwd: string
  readonly modelOverride: string | null
}

export type BridgeHandle = {
  readonly id: string
  readonly port: number
  readonly cliKind: string
  readonly cwd: string
}

export interface BridgeManager {
  spawn(input: SpawnInput): ResultAsync<BridgeHandle, { kind: "spawn_failed"; message: string }>
  list(): Promise<ReadonlyArray<BridgeHandle>>
  attach(id: string): ResultAsync<AcpTransport, { kind: "not_found" | "transport"; message: string }>
  kill(id: string): Promise<void>
}

// ─── Cache ────────────────────────────────────────────────────

export interface CacheStore<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T): Promise<void>
  has(key: string): Promise<boolean>
  delete(key: string): Promise<void>
}

// ─── Identity ─────────────────────────────────────────────────
// ב-MVP אין identity. הסעיף הזה ריק. [future] אם נפתח לכמה משתמשים:
//   IdentityStore עם issueToken + validate. ראה D11.

// ─── Agent Registry ───────────────────────────────────────────
// in-memory Map ב-MVP (D8). אין ownerToken (D11).

import type { Agent } from "./schemas"

export interface AgentRegistry {
  create(input: {
    readonly cliKind: Agent["cliKind"]
    readonly cwd: string
    readonly modelOverride: string | null
  }): Promise<Agent>
  list(): Promise<ReadonlyArray<Agent>>
  get(id: string): Promise<Agent | null>
  update(id: string, patch: Partial<Agent>): Promise<Agent>
  delete(id: string): Promise<void>
}
```

---

## 7. Sequence Diagrams

### 7.1 יצירת agent

```
Browser              Backend             BridgeMgr           Bridge              CLI
   │                    │                    │                  │                  │
   │ POST /api/agents   │                    │                  │                  │
   │ {cliKind, cwd}     │                    │                  │                  │
   ├───────────────────>│                    │                  │                  │
   │                    │ create(...)        │                  │                  │
   │                    ├───────────────────>│                  │                  │
   │                    │                    │ spawn process    │                  │
   │                    │                    ├─────────────────>│                  │
   │                    │                    │                  │ spawn cli (stdio)│
   │                    │                    │                  ├─────────────────>│
   │                    │                    │                  │ initialize       │
   │                    │                    │                  ├─────────────────>│
   │                    │                    │                  │<─ capabilities ──┤
   │                    │                    │                  │ session/new      │
   │                    │                    │                  ├─────────────────>│
   │                    │                    │                  │<─ sessionId ─────┤
   │                    │                    │ port=7100        │                  │
   │                    │                    │<─────────────────┤                  │
   │                    │ BridgeHandle       │                  │                  │
   │                    │<───────────────────┤                  │                  │
   │                    │ store in Map<id,A> │                  │                  │
   │ 201 {agent}        │                    │                  │                  │
   │<───────────────────┤                    │                  │                  │
   │                    │                    │                  │                  │
   │ WS /ws/agent/:id   │                    │                  │                  │
   ├───────────────────>│                    │                  │                  │
   │                    │ attach(bridgeId)   │                  │                  │
   │                    ├───────────────────────────────────────>│                  │
   │                    │ ws://127.0.0.1:7100/acp               │                  │
   │                    │<───── ready { capabilities, sessionId }│                  │
   │ 'connected'        │                    │                  │                  │
   │<───────────────────┤                    │                  │                  │
```

### 7.2 Voice round-trip

```
Browser              Backend             Stt              AcpTrans          Tts
   │                    │                  │                 │               │
   │ audio_start        │                  │                 │               │
   ├───────────────────>│                  │                 │               │
   │ audio_chunk × N    │                  │                 │               │
   ├───────────────────>│                  │                 │               │
   │ audio_end          │                  │                 │               │
   ├───────────────────>│                  │                 │               │
   │                    │ transcribe(...)  │                 │               │
   │                    ├─────────────────>│                 │               │
   │                    │<── text ─────────┤                 │               │
   │ 'thinking' {text}  │                  │                 │               │
   │<───────────────────┤                  │                 │               │
   │                    │ prompt(text)     │                 │               │
   │                    ├──────────────────────────────────>│               │
   │                    │                  │                 │               │
   │                    │ ←── sessionUpdate (chunk) ─────────┤               │
   │                    │ ←── sessionUpdate (chunk) ─────────┤               │
   │                    │                  │                 │               │
   │                    │ for each sentence boundary:        │               │
   │                    │   synthesize(sentence)             │               │
   │                    ├────────────────────────────────────────────────>│
   │                    │   ←── audioBytes ─────────────────────────────┤
   │ 'audio_start'      │                  │                 │               │
   │ 'audio_chunk' × N  │                  │                 │               │
   │ 'audio_end'        │                  │                 │               │
   │<───────────────────┤                  │                 │               │
   │ 'text_chunk'       │                  │                 │               │
   │<───────────────────┤                  │                 │               │
   │                    │                  │                 │               │
   │                    │ ←── promptComplete ────────────────┤               │
   │ 'bubble_persisted' │                  │                 │               │
   │ 'done'             │                  │                 │               │
   │<───────────────────┤                  │                 │               │
```

### 7.3 Cancel mid-speech (D19)

```
Browser              Backend             AcpTrans           Tts
   │                    │                  │                  │
   │ (model is speaking)│                  │                  │
   │ ←── audio_chunk ───┤ ←── audio bytes ─┤                  │
   │                    │                  │                  │
   │ 'cancel'           │                  │                  │
   ├───────────────────>│                  │                  │
   │                    │ cancel(...)      │                  │
   │                    ├─────────────────>│                  │
   │                    │ stop tts pipeline                   │
   │                    ├─────────────────────────────────────>│
   │                    │   <── pipeline terminated ──────────┤
   │ 'done' {cancelled} │                  │                  │
   │<───────────────────┤                  │                  │
   │ (browser stops playback locally,                          │
   │  starts new recording)                                    │
```

### 7.4 Disconnect + Reconnect

```
Browser              Backend             Bridge              CLI
   │                    │                  │                   │
   │ (WS open, idle)    │                  │                   │
   │                    │                  │                   │
   │ ─── close tab ─────│                  │                   │
   │                    │ WS closed        │                   │
   │                    │ (bridge stays alive)                 │
   │                    │                  │                   │
   │                    │                  │ session/update    │
   │                    │                  │   (buffered)      │
   │                    │                  │ session/update    │
   │                    │                  │   (buffered)      │
   │                    │                  │                   │
   │ ─── reopen page ───│                  │                   │
   │ WS connect         │                  │                   │
   ├───────────────────>│                  │                   │
   │                    │ attach(bridgeId) │                   │
   │                    ├─────────────────>│                   │
   │                    │ <── ready ───────┤                   │
   │                    │ <── replay buffered events ──────────┤
   │ 'connected' +      │                  │                   │
   │ historyBubbles     │                  │                   │
   │<───────────────────┤                  │                   │
   │ (events stream     │                  │                   │
   │  continues live)   │                  │                   │
```

### 7.5 Multi-tab fan-out

```
Tab A                  Backend                     Bridge
  │                       │                          │
  │ WS /ws/agent/X open   │                          │
  ├──────────────────────>│ subscribe(agentId, A)    │
  │                       │                          │
Tab B                     │                          │
  │ WS /ws/agent/X open   │                          │
  ├──────────────────────>│ subscribe(agentId, B)    │
  │                       │                          │
  │                       │ ←── sessionUpdate ───────┤
  │                       │ broadcast([A, B])        │
  │ ←── 'text_chunk' ─────┤                          │
  │ ←── 'text_chunk' (B) ─┤                          │
  │                       │                          │
  │ Tab A: audio_end (אבי לחץ stop)                  │
  ├──────────────────────>│ cancel                   │
  │                       ├─────────────────────────>│
  │ ←── 'done' (A) ───────┤                          │
  │ ←── 'done' (B) ───────┤  (גם B מקבל)             │
```

> Tab B רואה את כל מה ש-A עושה. אם משתמש מעבר Bluetooth מהטלפון לרכב — כל ה-state עוקב.

---

## 8. Slice 1 — concrete first deliverable ✅ הושלם

### 8.1 מה זה Slice 1

Slice 1 הוא ה-vertical slice הראשון. תוצר: **echo server עובד מהדפדפן עד ה-backend וחזרה.** אין CLI, אין voice, אין ACP. רק תשתית.

**✅ הושלם:** commit `68a2b18` ב-worktree `/home/user/projects/voice-acp-v2` על branch `vnext`. ה-brief המלא ב-`docs/slice-1-brief.md`. סקירת ההישגים והסטיות מ-brief — ב-`docs/agents/planner.md` ביום 2026-05-16.

### 8.2 משימות

| # | משימה | קובץ | משערך זמן |
|---|-------|------|-----------|
| 1 | scaffold worktree `voice-acp-v2` | `git worktree add ../voice-acp-v2 -b vnext` | 5 דק' |
| 2 | scaffold monorepo (Bun workspaces) | root + `packages/core/`, `packages/backend/`, `packages/frontend/` | 30 דק' |
| 3 | `packages/core/src/schemas.ts` עם UserToken + Agent + ClientMessage + ServerMessage (חלקי) | ArkType | 30 דק' |
| 4 | `packages/core/src/ports.ts` עם interfaces ראשונים | TypeScript | 20 דק' |
| 5 | `packages/backend/src/server.ts` — Bun HTTP + WS, endpoint `/api/health` + WS echo (`/ws/echo`) | Bun | 45 דק' |
| 6 | `packages/frontend/` — SvelteKit + adapter-static, page `/` שמתחבר ל-WS ושולח/מקבל ping | SvelteKit | 60 דק' |
| 7 | `Dockerfile` ל-backend + `docker-compose.yml` בסיסי | Docker | 30 דק' |
| 8 | בדיקה ידנית: `bun dev` ב-backend, `bun dev` ב-frontend, פתיחת לdפדפן, שליחת ping, קבלת pong | — | 15 דק' |

**סה"כ Slice 1: ~3.5 שעות.**

### 8.3 Definition of done — Slice 1

- [x] Worktree קיים, branch `vnext`. ✅
- [x] Monorepo רץ עם `pnpm install` ב-root. ✅
- [x] `cd packages/backend && bun dev` מאפיינים HTTP על port 4000 + WS על אותו port. ✅
- [x] `GET /api/health` מחזיר JSON תקף. ✅
- [x] `cd packages/frontend && pnpm dev` מאפיין על port 5173. ✅
- [x] פתיחת `http://localhost:5173` → דף "drive-coding — Slice 1". ✅
- [x] לחיצה על כפתור "Connect" → WebSocket מתחבר ל-backend, שולח `{ type: "ping" }`, מקבל `{ type: "pong" }`. ✅
- [x] `pnpm typecheck` ב-3 ה-packages עובר. ✅
- [x] `pnpm test` רץ (3 בדיקות ב-core). ✅

### 8.4 Slice 1 לא כלל

- ACP, CLI, Bridge.
- STT, TTS, Translator.
- Identity / authentication (אין במ-MVP — D11).
- Agent management (אין `POST /api/agents` עוד — Slice 2).
- UI אמיתי (רק "Connect + Ping" כפתור).
- Cloudflare tunnel (Slice 10).

### 8.5 Slices הבאים (קצר)

| Slice | תוצר |
|-------|------|
| 2 | Identity persistence + dashboard (רשימת agents ריקה) + agent creation flow ב-UI |
| 3 | `BridgeManager` — spawn `npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1`, parse port, manage lifecycle (פשוט מאוד אחרי D33) |
| 4 | `AcpTransport` adapter סביב `ClientSideConnection` של `@agentclientprotocol/sdk`. `/agent/:id` עם chat טקסטואלי בלי voice. **Tests:** loopback `AgentSideConnection` mock (D49) + run acpx conformance suite (D50) נגד test agent שלנו |
| 5 | **Voice pipeline (D38)** — install AI SDK + 5 providers (`openai`, `elevenlabs`, `deepgram`, `google`, custom `gemini-transcription`). registry של STT/TTS/translator. `transcribe()` + `speech()` + `generateText()` integration. voice round-trip עובד עם Gemini STT + ElevenLabs v3 TTS + Gemini Flash translator |
| 6 | Multi-session + disk cache (לפי `text + voice + model` key) + reconnect (משתמשים ב-`--client-id` של bridge) |
| 7 | Drive-first UX מלא — כפתור גדול, state machine, animations, **D35 audio cues** (mp3 ב-static) |
| 8 | **Provider catalog UI (D36)** — `GET /api/providers` עם רשימה דינמית מ-registries. dropdown ב-`/settings` ל-STT/TTS/translator. test buttons. החלפה ב-runtime |
| 9 | i18n infra (גם עברית) + UI text catalogs |
| 10 | Production deploy — Docker compose + Cloudflare tunnel + systemd |

**שינויים משמעותיים:**
- **Slice 3 (אחרי D33)** הצטמצם דרסטית. במקום לכתוב 200 שורות bridge — אנחנו spawn-ים npm package + parsing port. ההמלצה: לאחד את 3+4 ל-Slice יחיד אם הזמן מאפשר.
- **Slice 5 (אחרי D38)** הצטמצם דרסטית. במקום לכתוב 4 adapters (Gemini STT + Gemini translator + ElevenLabs TTS + cache) — `npm install` של 5 packages + 5 שורות registry + ~80 שורות custom Gemini transcription provider.
- **Slice 8 השתנה** מ-"Whisper local + Piper local" ל-"Provider catalog UI". המקור (BYOC עם local models) הוכלל ב-Slice 5 (כל ספק שזמין ב-AI SDK = מתווסף ל-registry בקלות).

---

## 9. פתוחים

שאלות שעוד נצטרך לפתור במהלך ה-implementation:

1. **Bridge crash detection** — איך backend יודע ש-bridge מת? heartbeat (ping) כל 5s? מעקב אחרי process exit code? המלצה: שניהם.
2. **CLI not found** — מה אם המשתמש מבקש `gemini` ואין `gemini` ב-PATH? validation ב-create flow + שגיאה ברורה.
3. **Concurrent prompts על אותו session** — ACP מאפשר רק prompt אחד פעיל. אם המשתמש שולח prompt חדש לפני שהקודם נגמר, צריך cancel אוטומטי ראשית. ראה D19.
4. **TTS streaming vs buffered** — האם לשלוח `audio_chunk` תוך כדי TTS streaming (low latency, מורכב) או לחכות ל-full mp3 (פשוט, latency של ~1s)? המלצה: streaming מההתחלה כמו ב-POC.
5. **Bridge cleanup ב-backend crash** — bridges של agents שאבדו ב-Map הופכים ל-orphans. cron שיהרוג כאלה אחרי N דקות בלי connection? המלצה: כן, חלק מ-Slice 6.

---

> **המשך:** אחרי אישור על המסמך הזה, אבי יכול לפתוח executor ולהעביר אותו ל-Slice 1. אני אהיה זמין לתשובות arch ו-clarification בזמן ה-implementation.

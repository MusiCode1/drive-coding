# vNext Research — מחקר רקע לתכנון

> **סטטוס:** סיכום מחקר ביום 2026-05-15.
> **מטרה:** למפות prior art, ספריות, ודפוסים ארכיטקטוניים לפני שמתחילים לכתוב קוד.
> **מסקנה ראשית:** ❗ נמצאו ממצאים שמשנים החלטות קודמות. ראה §6.

---

## תוכן עניינים

1. [ACP Bridge — הממצא המרכזי](#1-acp-bridge)
2. [Voice CLI prior art](#2-voice-cli-prior-art)
3. [VAD ו-Wake word libraries](#3-vad-ו-wake-word)
4. [Functional TypeScript libraries](#4-functional-ts)
5. [Architectural patterns](#5-architectural-patterns)
6. [המלצות לעדכון `vnext-architecture.md`](#6-recommendations)

---

## 1. ACP Bridge

### 1.1 ❗ קיים adapter רשמי שמיישם בדיוק את הרעיון של אבי

**`@flutur/acp-http-bridge`** (GitHub: [`Alemusica/acp-http-bridge`](https://github.com/Alemusica/acp-http-bridge))

מה זה:
- npm package, TypeScript, Apache-2.0.
- **Bridge ACP stdio agents → WebSocket and HTTP/SSE clients.**
- מבוסס על **RFD רשמית** של ACP: [Streamable HTTP & WebSocket Transport](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/streamable-http-websocket-transport.mdx).

תכונות שכבר ממומשות:
- ✅ WebSocket transport מלא (production-ready)
- ✅ HTTP+SSE alpha
- ✅ **Persistent session** — `sessionId` נשמר ב-disk; ב-restart הbridge קורא `session/load` במקום `session/new`
- ✅ **Multi-tab fan-out** — כל WS clients מקבלים את אותם notifications. tabs חדשים מצטרפים לשיחה חיה
- ✅ Auto-approve mode ל-development
- ✅ 18 בדיקות עוברות

תכונות שעדיין חסרות (roadmap):
- ❌ Interactive `requestPermission` (forward + await מהclient)
- ❌ Multi-session per connection (כרגע session אחד shared per bridge instance)
- ❌ HTTP/2 streamable
- ❌ Cookie-based session affinity
- ❌ MCP-over-ACP

קוד מקור (7 קבצים):
```
src/
├── agent-process.ts    # spawn + manage CLI subprocess
├── bridge.ts           # main bridge logic
├── cli.ts              # entry point
├── index.ts            # public API
├── session-store.ts    # disk persistence של sessionId
├── transport-http.ts   # HTTP+SSE handler
└── transport-ws.ts     # WebSocket handler
```

### 1.2 RFD רשמית — מה זה אומר

יש [RFD רשמית](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/rfds/streamable-http-websocket-transport.mdx) של ACP שמגדירה את הפרוטוקול:

**ה-RFD מציעה:**
- `/acp` endpoint יחיד שתומך גם ב-HTTP וגם ב-WebSocket upgrade.
- שני headers: `Acp-Connection-Id` (לconnection) + `Acp-Session-Id` (לsession).
- POST לכל client→server, GET לפתיחת SSE stream ל-server→client.
- WebSocket upgrade דרך `Upgrade: websocket` על אותו endpoint.
- HTTP/2 נדרש.
- WebSocket חייב להיתמך ע"י כל client. servers יכולים לתמוך רק ב-WebSocket.

**משמעות עבורנו:**
- אנחנו לא צריכים להמציא protocol — יש סטנדרט.
- אנחנו לא צריכים לכתוב bridge — יש implementation שמיישר ל-spec.
- אם נתרום ל-`acp-http-bridge`, נשפר כלי שהקהילה תשתמש בו.

### 1.3 שני alternatives קיימים

**1. `batitrop83434452/claude-acp-server`** (11 stars, 27 days ago)
- TypeScript, ACP bridge ל-Claude Code בלבד.
- WebSocket + HTTP, JSON-RPC, streaming.
- Niche — רק Claude Code. פחות גנרי.

**2. כל ה-SDKs הרשמיים** (Rust, TypeScript, Python, Kotlin, Java)
- כולם stdio-only. ה-typescript SDK ב-173 stars.
- אם נתרום HTTP transport — זה יהיה contribution גדול שמשרת את כל ה-ecosystem.

### 1.4 ❗ עדכון 1: `@flutur/acp-http-bridge` לא בשל

בדיקה שנייה (אבי שאל למה אין כוכבים):
- **`package.json`:** `"version": "0.1.0-alpha.0"` — alpha מוקדם.
- **לא published ב-npm.** ה-README שלהם מטעה ("npm install...") אבל אין שם.
- 0 stars, 17 days old.
- License: Apache-2.0.
- קוד: 7 קבצים, ~200 שורות. פשוט ברובו.

**מסקנה:** ההמלצה הקודמת (use as-is npm dep) **לא ישימה**. במקום זה:

**Option A (חדש):** **לכתוב bridge משלנו** בהשראת הקוד שלהם (Apache 2.0 מאפשר). שליטה מלאה, ~200 שורות שכוללות hexagonal pattern של ה-RFD. מחזיר את `packages/acp-bridge/` ל-monorepo.

**Option B:** להשתמש ב-`@agent-relay/acp-bridge` (Apache-2.0, גרסה 6.0.22, פעיל לפני 11 שעות). יותר בוגר אבל ייעודי ל-"Agent Relay" — צריך לחקור אם API שלו תואם.

**Option C:** לעשות fork של `Alemusica/acp-http-bridge`, לpublish תחת `@drive-coding/acp-bridge`. אבל אז אנחנו אחראים לתחזוקה לקהילה.

**Option D:** לתרום ל-Alemusica — לעזור להם לpublish, להוסיף בדיקות, להוסיף features שאנחנו צריכים. Long-term play.

**המלצה חדשה: A + D.** נכתוב bridge משלנו (פנימי) ל-MVP. במקביל, נפתח issues ב-`Alemusica/acp-http-bridge` להציע help — אם הם רוצים, נמזג. אם לא, השלנו עובד.

### 1.5 ❗❗ עדכון 2: נמצא הפתרון הנכון — `@rebornix/stdio-to-ws`

**אבי הצביע על שיחה אחרת** (`ses_1d1d7e005ffehwl6wIsjsw6wKI`) שבה סוכן אחר מצא את הפתרון הבוגר.

**`@rebornix/stdio-to-ws`** ([GitHub](https://github.com/rebornix/stdio-to-ws), [npm](https://www.npmjs.com/package/@rebornix/stdio-to-ws)):
- **Fork פעיל** של `marimo-team/stdio-to-ws` (19 stars, יציב, v0.2.0).
- **Published ב-npm** (`@rebornix/stdio-to-ws` v0.2.0). ניתן להריץ `npx`.
- License: Apache-2.0.
- Dependencies: `ws`, `minimist`, `string-argv`, **Microsoft Dev Tunnels SDKs** (5 חבילות).
- **תוספות מעבר ל-upstream:**
  - `--persist` — keep child alive during disconnections (קריטי למובייל)
  - `--grace-period <seconds>` (`-1` = infinite)
  - `--tunnel` / `--tunnel-name <name>` — Microsoft Dev Tunnels integration: מקבלים `wss://` URL ציבורי בלי TLS/proxy ידני
  - Client-Id replay buffer ב-reconnect

**שימוש:**
```bash
npx @rebornix/stdio-to-ws "opencode acp" --port 0 --persist --grace-period -1
```

או עם tunnel ל-טלפון/airpods:
```bash
npx @rebornix/stdio-to-ws "opencode acp" --tunnel-name drive-coding-prod --persist
```

**משמש ב-production ע"י:** [`formulahendry/acp-ui`](https://github.com/formulahendry/acp-ui) — 274 stars, web client בוגר ל-ACP. ה-README שלו מציע ב-flow המוצע ל-mobile setup.

**מסקנה: D33 — לא לכתוב bridge משלנו. spawn-ים את `@rebornix/stdio-to-ws` כ-CLI binary.** Slice 3 בroadmap מצטמצם מ-"כתוב bridge ~200 שורות" ל-"spawn npm package + parse port".

### 1.6 ❗❗ עדכון 3: `formulahendry/acp-ui` — web UI בוגר

**מתחרה ישיר נוסף**, עם MIT license (זמין לfork) ו-274 stars.

**מה זה:**
- Vue 3 + Tauri (cross-platform: Windows, macOS, Linux, Android, iOS, **Web**).
- web build חי ב-[acp-ui.github.io](https://acp-ui.github.io/) — אין צורך להתקין.
- **MIT license** ✅
- 274⭐, 27 forks, פעיל (v0.1.15 מ-May 2026).
- 11 agents pre-configured (Copilot, Claude, Gemini, Qwen, Codex, OpenCode, OpenClaw, Kiro, Hermes, Auggie, Qoder).
- WebSocket transport עם session/load + foreground reconnect + $/ping heartbeat.
- אופציה ל-Authorization Bearer ב-WS subprotocol.
- משתמש ב-`@rebornix/stdio-to-ws` כ-bridge (מאשר את העדכון בעדכון 2).

**מה חסר:**
- **Voice — אין.** זה הייחוד הקריטי שלנו.
- **RTL — לא צוין.** Vue אבל לא מובהק.
- **Drive-first UX — לא.** chat UI generic.

**שאלה אסטרטגית — Q-NEW-4:** האם לבנות מאפס (אופציה A), לעשות fork ל-acp-ui ולהוסיף voice + RTL (אופציה B), או היברידי (אופציה C)?
- ההמלצה שלי: **C ≈ A** עם awareness של acp-ui. SvelteKit הוא הבחירה שלך, drive-first הוא הייחוד שלנו, fork ל-Vue היה tax לא-תרומתי. ראה Q-NEW-4 ב-`vnext-architecture.md`.

### 1.7 הקשר רחב — `openclaw/acpx`

**`openclaw/acpx`** (2.7k stars, MIT, npm) — לא bridge, אלא **headless CLI client**. תומך ב-16 agents מובנים, persistent sessions, prompt queueing, named sessions, flows. v0.8.0 (alpha).

**רלוונטיות לנו:** לא ל-bridge. אבל יש שם רעיונות מעניינים — flows (TypeScript workflows), graceful cancel, queue owner TTL — שכדאי ללמוד מהם בעתיד.

---

## 2. Voice CLI prior art

### 2.1 ❗ קיים מתחרה ישיר — `voice-coda` (אבל ללא license)

**`evanstern/voice-coda`** ([GitHub](https://github.com/evanstern/voice-coda), 0 stars, 177 commits, פעיל)

המוצר:
> "Wake with 'Coda,' code by voice. A hands-free voice interface for coding agents — talk through Bluetooth earbuds while your hands are busy, and have the agent work on code, manage repos, and talk back."

**זה בדיוק drive-coding באנגלית.** אבי חייב לקרוא את ה-README שלהם.

⚠️ **License — אין.** בדיקה: ה-LICENSE file חוזר 404, package.json בלי `license` field. **משפטית, בלי license מפורש, הקוד הוא "all rights reserved" כברירת מחדל.** אנחנו לא יכולים:
- לעשות fork.
- להעתיק קוד.
- לשנות ולהריץ.
- אפילו לתרום PR (ה-PR שלנו תהיה תחת unclear terms).

מה שאנחנו **יכולים** לעשות:
- לקרוא ולמהר ידע. מבנים אדריכליים אינם מוגנים copyright.
- לזהות אילו libs הם משתמשים (ראה למטה).
- לפתוח issue ולשאול את evanstern על license. אם הוא משיב MIT/Apache — הכל נפתח.

ארכיטקטורה שלהם:
```
voice-coda/
├── apps/
│   ├── server/         # Hono + tRPC backend (API, WebSocket, tool execution)
│   └── web/            # React Router 7 PWA (mic capture, audio playback)
├── services/
│   └── wake-word/      # openWakeWord service (Python)
├── packages/
│   ├── contracts/      # Shared Zod schemas & types
│   ├── shared/         # Shared utilities
│   └── ui/             # Radix + Tailwind component library
├── docker/             # Dockerfiles
└── models/             # Piper TTS, wake-word models
```

Stack שלהם:
- **Frontend:** React Router 7 PWA (לא SvelteKit), Radix + Tailwind
- **Backend:** Hono + tRPC
- **Monorepo:** pnpm workspaces + Turborepo
- **STT:** OpenAI Whisper API or local whisper-cpp
- **TTS:** OpenAI / Google Cloud / Piper (local, free)
- **AI providers:** Anthropic API direct / Claude Code CLI / OpenCode headless
- **Wake word:** openWakeWord (Python service, custom "Coda" model)
- **Deployment:** Docker Compose with Traefik labels, systemd CLI
- **Config:** dotenv-style env file

**מה הם עושים שאנחנו לא תכננו:**
- ✅ Wake word עם custom "Coda" model — כבר מאומן
- ✅ Piper TTS לוקלי — חיסכון מ-ElevenLabs
- ✅ Mobile background audio (experimental, לא יציב)
- ✅ Traefik reverse proxy ready
- ✅ systemd integration

**מה אנחנו עושים שהם לא:**
- ❌ ACP — הם מדברים ישירות ל-Anthropic API / CLI / OpenCode HTTP, לא דרך ACP. **זו חסרון אצלם** — כל provider דורש adapter ידני.
- ❌ עברית / RTL
- ❌ Drive-first UX (כפתור גדול, drive mode מובחן)
- ❌ Multi-CLI יחד באותו ממשק

**מסקנה:** הם מתחרה אמיתי אבל יש לנו ייחוד ברור (ACP + עברית + drive-first). שווה לקרוא את הקוד שלהם — יש שם הרבה lessons learned.

### 2.2 `pi-voice` — גישה שונה לחלוטין

**`yukukotani/pi-voice`** (53 stars, פעיל)

> "Headless voice interface for the Pi Coding Agent. Hold a key, speak, and pi executes your instructions with voice feedback."

**זה לא web — זה daemon מקומי על המחשב.**
- Push-to-talk עם global hotkey (`Cmd+Shift+I`).
- ספציפי ל-Pi Coding Agent (מ-`badlogic/pi-mono`), לא ACP גנרי.
- Local Whisper (medium model auto-downloaded) + macOS `say` ל-TTS לוקלי.
- אין web UI, אין wake word, אין mobile.

**Lessons:**
- Daemon approach מאוד אלגנטי למקרים מקומיים. לא רלוונטי לdrive coding (אבי רוצה לעבוד מהטלפון).
- Whisper לוקלי עם medium model = פתרון STT חינם וטוב. אופציה ל-Gemini בעתיד אם רוצים cloud.

### 2.3 ממצאים נוספים

- **`kshitizshankar/cli-agents-voice-interface`** — Python, **TTS only** (קורא בקול את ה-output של ה-CLI). לא דו-כיווני, לא רלוונטי.
- **`ToruAI/toris-agent`** — Telegram bot ל-Claude עם קול. גישה שונה (chat platform).
- **`lexgielen1/einstein-ai-coding-agent`** — local-first, Ollama-based. לא רלוונטי.

---

## 3. VAD ו-Wake word

### 3.1 ❗ `@ricky0123/vad-web` — VAD לדפדפן מוכן

**[`ricky0123/vad`](https://github.com/ricky0123/vad)** — 2k stars, פעיל.

- npm: `@ricky0123/vad-web` + `@ricky0123/vad-react`
- מבוסס על **Silero VAD** (state-of-the-art) דרך **ONNX Runtime Web**.
- API פשוט:
```ts
const vad = await MicVAD.new({
  onSpeechStart: () => console.log("speech start"),
  onSpeechEnd: (audio) => { /* Float32Array of audio samples */ },
})
vad.start()
```
- רץ כולו בדפדפן — אין latency של רשת.
- Float32Array פלט = קל לשליחה ל-STT.

**מסקנה:** אם בעתיד נרצה VAD (hands-free mode בלי כפתור), זה הכלי. **לא ב-MVP.** אבל אם אבי מתחיל לסבול מהכפתור, זה ה-upgrade הטבעי.

### 3.2 Wake word — openWakeWord

`voice-coda` משתמשים ב-openWakeWord עם custom "Coda" model.

ה-pipeline שלהם:
```
Passive listen → Wake-word detected → Capture request → STT → AI → TTS → Earbuds → Passive
```

הם רצים את ה-wake word כ-Python service נפרד (`services/wake-word/`), עם WebSocket לדפדפן ששולח 16-bit PCM. הדפדפן מקבל wake events.

**גם זה אופציה לעתיד.** אם בחירה רחבה — אפשר לעשות "drive-coding" ו-wake-word כאחד.

---

## 4. Functional TypeScript

### 4.1 ספריות שראיתי במחקר

| ספרייה | תיאור | רמת מורכבות | ההמלצה שלי |
|--------|-------|-------------|-------------|
| **[Effect-TS](https://effect.website/)** | ecosystem שלם ל-FP — Effect type, schema, streams, deps injection | **גבוהה מאוד** | ❌ overkill, למידה ענקית |
| **fp-ts** | "FP for TypeScript" classic — pipe, Either, Option, Task | גבוהה | ❌ דורש הבנת FP עמוקה |
| **[neverthrow](https://github.com/supermacro/neverthrow)** | `Result<T, E>` type בלבד. קל לאימוץ הדרגתי | נמוכה | ✅ מומלץ — קל וערך גבוה |
| **[Zod](https://zod.dev/)** | Schema validation + type inference | בינונית | ⚠️ סטנדרט אבל אבי מעדיף ArkType |
| **[ArkType](https://arktype.io/)** | Schema validation עם TS-syntax DSL, ~100× מהיר מ-Zod | בינונית | ✅ **מומלץ** — אבי כבר משתמש, ביצועים טובים, syntax קצר |
| **ts-pattern** | Pattern matching ב-TS | בינונית | ✅ אם נרצה — מאוד שימושי ל-state machines |
| **[XState](https://stately.ai/)** | Statecharts library מלא | גבוהה | ⚠️ overkill ל-MVP, אבל מעולה לכפתור הגדול |

### 4.2 ההצעה שלי לאימוץ (מעודכן)

**מינימום (MVP):**
- TypeScript נקי, ESM-only
- **ArkType** ל-schemas (חוצה ל-`core/schemas.ts`, גם backend גם frontend)
- **neverthrow** ל-`Result<T, E>` בlogic functions (חוצה את `core/`)

**אם נצטרך:**
- ts-pattern ל-pattern matching מורכב על ACP messages
- XState רק לכפתור הגדול אם state machine שם נהיה מורכב מדי

**לא:**
- Effect-TS, fp-ts — paradigm shift כבד, ROI נמוך לפרויקט שלנו
- Zod — אבי כבר ב-ArkType, אין סיבה לעבור

---

## 5. Architectural patterns

### 5.1 הדפוסים הנפוצים

| דפוס | מקור | רלוונטי לנו? |
|------|------|--------------|
| **Functional Core, Imperative Shell** | Gary Bernhardt (2012) | ✅ כן — כבר ב-D5 |
| **Hexagonal / Ports & Adapters** | Alistair Cockburn (2005) | ✅ כן — תואם FCIS |
| **Clean / Onion Architecture** | Uncle Bob, Jeffrey Palermo | ⚠️ overkill לפרויקט שלנו |
| **Domain Modeling Made Functional** | Scott Wlaschin (F#, אבל ישים ל-TS) | ✅ ספר מעולה לקריאה |
| **Event Sourcing / CQRS** | Greg Young | ❌ לא רלוונטי — אנחנו stateless |
| **Actor Model** | Erlang, Akka | ⚠️ overkill, אבל ה-bridge דומה ל-actor |

### 5.2 ההמלצה שלי לפרויקט

**Layer 1: Pure functional core** (`packages/core/`)
- כל ה-logic. אין IO, אין side effects.
- פונקציות `(state, event) => newState`.
- בדיקות יחידה מקיפות.

**Layer 2: Ports** (interfaces ב-`packages/core/ports/`)
- `AcpTransport` interface (ה-bridge מתחת)
- `SttProvider`, `TtsProvider`, `TranslatorProvider`
- `CacheStore`
- `AgentRegistry`
- כל אחד הוא interface, לא implementation.

**Layer 3: Adapters** (implementations ב-`packages/backend/adapters/`)
- `BridgeAcpTransport` (משתמש ב-`@flutur/acp-http-bridge`)
- `GeminiSttProvider`, `GeminiTtsProvider`, `GeminiTranslator`
- `ElevenLabsTtsProvider`
- `DiskCacheStore`, `MemoryCacheStore`
- `InMemoryAgentRegistry`

**Layer 4: Application** (`packages/backend/app/`)
- Wire של ports ל-adapters בזמן boot.
- Orchestration של flows (voice round-trip).

**Layer 5: Delivery** (`packages/backend/server/`)
- HTTP routes, WebSocket handlers.
- מתרגם בין wire format ל-application calls.

### 5.3 דוגמה לזרימת voice round-trip

```ts
// Pure core function (packages/core/pipeline/voice-roundtrip.ts)
export type VoiceRoundtripInput = {
  readonly audioBytes: Uint8Array
  readonly mimeType: string
  readonly languageHint: string
  readonly previousAssistantText: string | null
}

export type VoiceRoundtripPlan = {
  readonly steps: ReadonlyArray<PipelineStep>
}

export type PipelineStep =
  | { kind: "stt"; input: { audioBytes: Uint8Array; mimeType: string; languageHint: string; context: string | null } }
  | { kind: "prompt"; input: { text: string } }
  | { kind: "ttsForMessage"; input: { text: string } }

export function planVoiceRoundtrip(input: VoiceRoundtripInput): VoiceRoundtripPlan {
  // Pure decision logic, no IO
  return {
    steps: [
      { kind: "stt", input: { audioBytes: input.audioBytes, mimeType: input.mimeType, languageHint: input.languageHint, context: input.previousAssistantText } },
      // ... etc
    ],
  }
}
```

```ts
// Imperative shell (packages/backend/app/voice-orchestrator.ts)
export async function executeVoiceRoundtrip(
  plan: VoiceRoundtripPlan,
  deps: { stt: SttProvider; acp: AcpTransport; tts: TtsProvider },
) {
  for (const step of plan.steps) {
    switch (step.kind) {
      case "stt":
        const text = await deps.stt.transcribe(step.input)
        // ...
    }
  }
}
```

ה-core ניתן לבדיקה ב-100% בלי IO. ה-shell ניתן לבדיקה עם mocks של ה-ports.

### 5.4 spotlights — דברים שאוהבים שכוחים

- **No singletons.** כל dependency עובר ב-constructor / argument.
- **Errors as values, not exceptions** (neverthrow `Result`).
- **No `null` checks deep ב-logic** — `Option<T>` או `T | null` רק ב-boundary.
- **All inputs immutable** (`readonly`). הקומפיילר עוזר.
- **Side-effects ב-edges, decisions ב-core.**

---

## 6. Recommendations

### 6.1 החלטות חדשות שצריך לעדכן ב-`vnext-architecture.md`

**D25 (חדש):** השתמש ב-`@flutur/acp-http-bridge` כ-npm dependency. בטל את `packages/acp-bridge/` מהמונורפו שלנו. נחזור אליו רק אם הצרכים יתבדלו.

**D26 (חדש):** התאם את ה-WebSocket protocol של ה-backend↔frontend לפי ה-ACP Streamable HTTP & WebSocket RFD. headers: `Acp-Connection-Id`, `Acp-Session-Id`. POST + GET (SSE) או WebSocket upgrade על endpoint יחיד.

**D27 (חדש):** אמץ את ה-stack של `voice-coda` כ-reference למקומות שלא ייחודיים לנו:
- **Zod** ל-schemas (`packages/protocol/`).
- **Radix + Tailwind** ל-UI primitives (אם נרצה — Svelte UI library דומה: `bits-ui` + Tailwind).
- **Whisper local fallback** כאופציה ל-MVP (גם Gemini, גם whisper-cpp).
- **Piper TTS** כאופציה לוקלית ל-MVP (גם ElevenLabs, גם Piper).

**D28 (חדש):** אמץ Hexagonal architecture עם 5 layers (Pure Core / Ports / Adapters / Application / Delivery). ראה §5.

**D29 (חדש):** ספריות support מאומצות:
- **neverthrow** — `Result<T, E>`.
- **Zod** — schemas.
- אין Effect-TS / fp-ts לעת עתה.

**Q-NEW-1:** האם להשתמש ב-`@flutur/acp-http-bridge` as-is, או לפתח עליו (PRs לקהילה), או לעשות fork? המלצה: as-is ל-MVP, PRs ב-slice 6+.

**Q-NEW-2:** האם להוסיף Whisper local + Piper כאופציה ל-MVP (BYOK-friendly), או רק Gemini+ElevenLabs כמו ב-POC?

**Q-NEW-3:** האם להסתכל על voice-coda כ-reference architecture (לא לcopy-paste, אבל ללמוד) או להתעלם וללכת בדרך שלנו?

### 6.2 שינויים שאני מציע ב-monorepo

המבנה החדש (תיקון ל-§8 ב-`vnext-architecture.md`):

```
drive-coding/
├── packages/
│   ├── protocol/          # types משותפים (Zod schemas)
│   │   ├── src/
│   │   │   ├── ws-messages.ts   # FE↔BE WS protocol
│   │   │   ├── api.ts           # HTTP API types
│   │   │   ├── agent.ts         # Agent/Session domain types
│   │   │   └── acp-envelope.ts  # ACP types re-export
│   │   └── package.json
│   │
│   ├── core/              # PURE functional core
│   │   ├── src/
│   │   │   ├── voice/           # pipeline planning, sentence-boundary, etc.
│   │   │   ├── acp/             # ACP message parsing, decisions
│   │   │   ├── cache/           # cache logic (pure, no IO)
│   │   │   ├── i18n/            # message catalogs, formatting
│   │   │   └── ports/           # interfaces (SttProvider, TtsProvider, etc.)
│   │   ├── tests/               # 100% pure unit tests
│   │   └── package.json
│   │
│   ├── backend/
│   │   ├── src/
│   │   │   ├── server.ts        # entry: HTTP + WS
│   │   │   ├── adapters/        # implementations של ports מ-core
│   │   │   │   ├── acp-bridge-transport.ts  # uses @flutur/acp-http-bridge
│   │   │   │   ├── gemini-stt.ts
│   │   │   │   ├── gemini-translator.ts
│   │   │   │   ├── elevenlabs-tts.ts
│   │   │   │   ├── whisper-local-stt.ts     # optional (BYOC)
│   │   │   │   ├── piper-tts.ts             # optional (BYOC)
│   │   │   │   ├── disk-cache.ts
│   │   │   │   └── memory-cache.ts
│   │   │   ├── app/             # application orchestration
│   │   │   │   ├── voice-orchestrator.ts
│   │   │   │   ├── agent-orchestrator.ts
│   │   │   │   └── identity.ts
│   │   │   ├── delivery/        # HTTP routes, WS handlers
│   │   │   │   ├── http-api.ts
│   │   │   │   └── ws-handler.ts
│   │   │   └── boot.ts          # wire ports ↔ adapters
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── frontend/                # SvelteKit
│       └── ...
│
├── docker-compose.yml
└── package.json
```

**שינוי משמעותי:** הסרת `packages/acp-bridge/` (מ-§8 בארכיטקטורה הישנה). אנחנו לא בונים אותו — אנחנו צורכים `@flutur/acp-http-bridge`.

### 6.3 השוואה: drive-coding vs voice-coda

| היבט | drive-coding (אנחנו) | voice-coda (קיים) |
|------|----------------------|--------------------|
| Frontend | SvelteKit | React Router 7 PWA |
| Backend | Bun + WebSocket | Hono + tRPC |
| State management | Svelte runes | Zustand? (לא ידוע) |
| UI | Tailwind + bits-ui | Radix + Tailwind |
| Monorepo | Bun workspaces | pnpm + Turborepo |
| **AI integration** | **ACP (multi-CLI native)** | **Direct API + Anthropic/Claude Code/OpenCode** |
| STT | Gemini (default), Whisper local (optional) | OpenAI Whisper or local whisper-cpp |
| TTS | ElevenLabs (default), Piper (optional) | OpenAI / Google / Piper |
| Wake word | Future (openWakeWord) | ✅ Built-in (custom "Coda" model) |
| **Language** | **עברית (RTL native)** | English only |
| **Drive-mode UX** | **כפתור גדול אחד** | Generic chat UI |
| Deploy | Proxmox + CF Tunnel | Docker Compose + Traefik |
| Open source | TBD | MIT (אני מניח) |

**ה-niche הייחודי שלנו ברור:** **ACP + Hebrew + Drive-first.**

---

## 7. Skills קיימים בסביבה

חיפשתי ב-skills CLI אם יש סקילים relevants ל-functional programming או voice apps. רוב הסקילים הם domain-specific (frontend design, pdf, docx). לא מצאתי skill ייעודי ל:
- Functional architecture
- Voice/audio apps
- ACP

**אם נרצה — נוכל לפתוח skill חדש משלנו** כשנגיע לחלקים שחוזרים על עצמם.

---

## 8. סיכום הממצאים — TL;DR (מעודכן אחרי סבב 3)

1. ❗❗ **`@rebornix/stdio-to-ws` הוא הפתרון** — published ב-npm, Apache-2.0, תומך `--persist`, `--grace-period`, Microsoft Dev Tunnels. בשימוש ע"י acp-ui (274★). **D33: spawn it, don't write it.**
2. ❗❗ **`formulahendry/acp-ui` הוא מתחרה web UI בוגר** — MIT, 274★, Vue+Tauri+Web, 11 agents נתמכים. אופציה אסטרטגית: build vs fork (Q-NEW-4).
3. ~~`@flutur/acp-http-bridge`~~ — לא בשל, מבוטל.
4. ACP RFD רשמית קיימת — אנחנו מיישרים את הפרוטוקול שלנו ל-spec.
5. `voice-coda` ללא license — אסור fork/copy. רק inspiration רעיונית.
6. **ArkType + neverthrow** — לא Zod (אבי כבר ב-ArkType).
7. `@ricky0123/vad-web` ל-VAD בעתיד — לא ב-MVP.
8. openWakeWord ל-wake word — אומת ב-`voice-coda`, custom model אפשרי.
9. **Hexagonal architecture מינימלי** — 2 packages (`core` + `backend`).
10. Whisper לוקלי + Piper לוקלי כאופציה ל-BYOC.
11. `openclaw/acpx` (2.7k★) — CLI client, לא bridge. inspiration ל-flows ו-queue management.

# Slice 10 — FE-Orchestrated Refactor: Research Notes

> ‏מסמך מחקר לפני כתיבת ה-brief. ‏מטרה: ‏לוודא את ה-unknowns ‏לפני implementation.
> ‏Worktree: `/home/user/projects/voice-acp-v3`, branch `vnext-fe-orchestrated`.

---

## 1. ACP SDK בדפדפן — ✅ עובד

### בדיקה

`@agentclientprotocol/sdk@0.21.1` ‏(הגרסה שלנו):

| קובץ | תלויות runtime |
|------|-----------------|
| `dist/acp.js` | `zod`, ‏schemas פנימיים |
| `dist/jsonrpc.js` | none |
| `dist/stream.js` | `TextEncoder`, `TextDecoder`, `ReadableStream`, `WritableStream` |

‏אין `node:*`, ‏אין `Buffer`, ‏אין `process`. ‏‏100% Web Standards. ‏רץ בדפדפן בלי polyfills.

### המלצה

‏לאמץ את ה-SDK ‏ב-FE ‏מבלי לחזור על העבודה של acp-ui ‏(הם בנו JSON-RPC client ידני בגלל גרסה ישנה).

‏הניצחון: ~250 שורות פחות שאנחנו צריכים לתחזק.

```ts
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"

// adapter קצר WebSocket → { readable, writable }
const { readable, writable } = wsToWebStreams(ws)
const stream = ndJsonStream(writable, readable)
const conn = new ClientSideConnection(client, stream)
```

‏צריך לכתוב `wsToWebStreams` — ‏~20 שורות. ‏זה מה ש-`ws-streams.ts` הנוכחי שלנו עושה ב-BE, רק עם API של דפדפן (`new ReadableStream(...)`) במקום `node:stream`.

---

## 2. ‏acp-ui ‏(reference) — תובנות מועילות

‏Repo: https://github.com/formulahendry/acp-ui (Vue + Vite + Tauri, ‏גם web build).

### דברים לאמץ

1. **`$/ping` ‏heartbeat כל 25s** — מ-`websocket.ts:198`. ‏NAT/proxy ‏יכולים להפיל WS idle. JSON-RPC notification (no id) → ‏agent מתעלם. ‏‏מנגנון פשוט וחסון.

2. **No auto-reconnect, prompt UI** — ‏הם מסבירים ב-`websocket.ts:13`: "reconnecting silently can desync session state on the agent side". ‏‏אצלנו היום יש reconnect ב-`agent-session.svelte.ts:484`. ‏‏‏שווה לעבור ל-explicit prompt ("חיבור נפל. ‏רענן?").

3. **NDJSON splitting on receive** — stdio-to-ws ‏יכול לשלוח multiple JSON-RPC frames ‏באותו WS message. ‏‏אנחנו כבר עושים את זה ‏ב-BE `ws-streams.ts`, ‏יעבור ‏ל-FE.

4. **Newline termination on send** — ‏אנחנו כבר ‏יודעים את זה (learnings 2026-05-16).

5. **Traffic monitor store** — ‏debug UI שמראה כל frame, ‏in/out, ‏request/response/notification. ‏שווה ‏הוספה ‏עבור debugging ‏בעתיד; ‏לא ב-MVP.

### דברים לדחות

- ‏**Subprotocols ל-auth** (`bearer.<token>`) — ‏לא רלוונטי. ‏ה-WS שלנו ‏עובר דרך BE שלנו ‏שrunning behind tunnel + cookies. ‏אין צורך ב-auth header.

- ‏**Manual JSON-RPC implementation** — ‏‏לא נצרך. ‏ה-SDK עושה את זה.

---

## 3. ‏core/ — ‏ניתן לשימוש חוזר ב-FE כמעט as-is

### Audit

| Module | LoC | Browser-safe? | משתמש |
|--------|-----|----------------|--------|
| `voice/sentence-boundary.ts` | 23 | ✅ | FE: לחיתוך text_chunks |
| `voice/cache-key.ts` | 8 | ✅ ‏(`crypto.subtle`) | FE+BE: cache lookup |
| `voice/translation-prompt.ts` | 6 | ✅ pure string | FE: לבנות prompt ל-/api/translate |
| `acp/provider-error.ts` | 39 | ✅ pure regex | FE: לחילוץ הודעת שגיאה אם stderr ‏יגיע מ-BE |
| `cache/types.ts` | 12 | ✅ types only | FE+BE |
| `ui/markdown.ts` | 39 | ✅ | FE: render |
| `schemas/ws-messages.ts` | 233 | ✅ ArkType | יצומצם — רוב ה-messages לא יעברו ‏ב-WS |
| `schemas/agent.ts` | ? | ✅ | unchanged |
| `log/index.ts` | — | ❌ uses `process.*` | BE only — יש log/browser.ts מקביל |
| `log/config.ts` | — | ❌ uses `process.env` | BE only |
| `log/browser.ts` | — | ✅ | FE |
| `ports.ts` | — | ⚠️ types | מה ש-FE צריך — לבדוק |

### מסקנה

‏הליבה הלוגית-טהורה (`voice/`, `acp/provider-error`, `cache/types`, `ui/markdown`) ‏עוברת בלי שינוי. ‏זה מאפשר ל-FE ‏לחזור על הלוגיקה ‏של ‏sentence-boundary, ‏‏cache-key חישוב, ‏וכו'.

`log/` ‏‏מפוצל כבר היום — `index.ts` ‏לBE, `browser.ts` ל-FE. ‏ה-tsconfig של core מוודא שהיא לא מערבבת. ‏יישאר ככה.

---

## 4. Streaming TTS — ‏השלכות

### `@ai-sdk/elevenlabs` ‏לא תומך ב-streaming

‏בדיקה ב-`node_modules/.../@ai-sdk/elevenlabs/dist/index.js:326-349`:
‏- ‏ה-endpoint שנקרא: `POST /v1/text-to-speech/{voiceId}` (לא `/stream`)
‏- ‏ה-response handler: `createBinaryResponseHandler()` — ‏מחכה ל-MP3 שלם, ‏מחזיר `Uint8Array` יחיד
‏- ‏`abortSignal` ‏**כן נתמך** — ‏עובר ל-`postJsonToApi` ‏שמעביר ל-`fetch`

‏המסקנה: ‏אם רוצים streaming, ‏ה-SDK לא יעזור. ‏שתי אופציות:

‏**(א) ‏עקיפת ה-SDK ל-TTS** — ‏ב-BE נקרא ‏ישירות:
```ts
const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`, {
  method: "POST",
  headers: { "xi-api-key": key, "Content-Type": "application/json" },
  body: JSON.stringify({ text, model_id: "eleven_v3", voice_settings: {...} }),
  signal: abortSignal,
})
// response.body — ReadableStream<Uint8Array> — מעבירים ל-FE
```

‏**(ב) ‏MVP בלי streaming, ‏מעבר אחרי** — ‏prefetch + cache משיגים ~80% מהrewardled של streaming. ‏ה-SDK works as-is.

### Streaming MP3 → ‏FE

‏אם בוחרים (א), ‏ה-BE צריך לחזיר ‏את ‏ה-stream ל-FE. ‏אופציות:

| שיטה | פרו | קונטרה |
|------|-----|--------|
| ‏SSE (`text/event-stream` עם base64 chunks) | פשוט בBun | overhead של base64 |
| ‏Chunked transfer (`audio/mpeg` raw) | אפס overhead | ‏BE צריך לעטוף ב-fetch ‏פנימי |
| ‏Forward `response.body` directly | המינימלי ‏ביותר | ‏Bun pipe primitives ‏‏צריכים בדיקה |

‏ב-FE, ‏לנגן ‏MP3 chunked ‏ב-`<audio>` ‏עם `MediaSource`:

```ts
const audio = new Audio()
const mediaSource = new MediaSource()
audio.src = URL.createObjectURL(mediaSource)
mediaSource.addEventListener("sourceopen", async () => {
  const sb = mediaSource.addSourceBuffer("audio/mpeg")
  const response = await fetch(`/api/tts?text=...&voiceId=...`, { signal })
  const reader = response.body.getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done) { mediaSource.endOfStream(); break }
    await new Promise(r => { sb.addEventListener("updateend", r, { once: true }); sb.appendBuffer(value) })
  }
})
audio.play()
```

### תאימות דפדפן ל-MediaSource + audio/mpeg

- ‏Chrome / Edge / Firefox: ✅ קבוע
- ‏Safari macOS: ✅ מ-15+
- ‏Safari iOS: ⚠️ **רק 17.1+** (אוקטובר 2023). ‏iOS ישנים — ‏לא יעבדו.

‏עבור drive-coding: ‏אם המכשיר העיקרי הוא iPhone, ‏‏צריך לדעת איזה iOS. ‏בכל מקרה — ‏fallback ‏ל-non-streaming ‏הכרחי.

### עוצמת ה-win של streaming על MVP

‏ניתוח אורכי קריאה ‏‏(נצפה אצלנו, ‏שלם ולא streaming):

| Phase | אורך טיפוסי |
|-------|-------------|
| ‏TTS time-to-first-byte | 200-300ms |
| ‏TTS time-to-complete (משפט ‏5-10 מילים) | 1-2s |
| ‏Audio playback של אותו משפט | 3-5s |

‏עם prefetch של N+1 ‏בזמן ש-N מתחיל: ‏יש 3-5s לסיים TTS של N+1. ‏זה ‏מספיק ‏בכל מקרה. ‏streaming ‏‏מוסיף ~700ms ‏cushion ‏‏‏אבל המספרים כבר ירוקים.

‏‏עבור משפטים ארוכים מאוד (פסקה) או תרגום + TTS משולבים, ‏streaming יותר חשוב. ‏אבל ‏יומיומית — ‏non-streaming + ‏prefetch ‏מספיק.

### החלטה (2026-05-17, ‏אבי)

‏**streaming TTS ‏ב-MVP.** ‏אבי לא משתמש בSafari, ‏‏לא חוסם אצלו. ‏יוצאים ‏עם ‏MediaSource ‏ללא fallback. ‏ה-`/api/tts` ‏יחזיר ‏`audio/mpeg` ‏chunked transfer, ‏ה-FE ‏יקרא עם ‏fetch + body.getReader() + MediaSource.

‏Bypass ל-SDK: ‏ה-BE יקרא ל-`POST https://api.elevenlabs.io/v1/text-to-speech/{voiceId}/stream` ‏ישירות ‏עם fetch, ‏יציג `response.body` ‏ל-Hono כresponse stream. ‏ה-SDK של ElevenLabs נשאר בשימוש ל-STT.

---

## 5. AbortController propagation — ✅ עובד

### בדיקה

‏ב-`@ai-sdk/elevenlabs:doGenerate`:
```ts
abortSignal: options.abortSignal,
fetch: this.config.fetch,
```

‏עובר ‏ישירות ל-`fetch` underlying. ‏מ-`experimental_generateSpeech({ model, text, voice, abortSignal })` ‏ל-ElevenLabs HTTP request — ‏מסלול נקי.

‏ב-`@ai-sdk/google` (translation): ‏אותו ‏pattern. `generateText({ model, prompt, abortSignal })` ‏מעביר ל-fetch.

### Pattern של אבע ב-FE

```ts
const ac = new AbortController()
try {
  const res = await fetch("/api/tts", {
    method: "POST",
    body: JSON.stringify({ text, voiceId }),
    signal: ac.signal,
  })
  const mp3 = new Uint8Array(await res.arrayBuffer())
  return mp3
} catch (e) {
  if (e.name === "AbortError") return null  // cancelled by user
  throw e
}

// משתמש קופץ ל-segment אחר:
ac.abort()
```

‏ב-BE ‏‏ה-endpoint מעביר את ה-signal ל-`generateSpeech` ‏שמעביר ל-fetch ‏שמ-aborts את ה-upstream HTTP. ‏אם ElevenLabs ‏כבר ‏שלח bytes — ‏ה-BE ‏מקבל אותם, ‏‏עדיין יכול לrקאש את התוצאה ‏ב-disk. ‏לא בזבוז לעולם, ‏רק "wasted call" ‏שמשרת hit עתידי.

### Pattern ב-BE לcanceling upstream

```ts
app.post("/api/tts", async (c) => {
  const { text, voiceId } = await c.req.json()
  const cacheKey = await sha256(`${text}|${voiceId}|eleven_v3`)
  const cached = await cache.get(cacheKey)
  if (cached) return new Response(cached, { headers: { "content-type": "audio/mpeg" } })
  
  // forward client abort to upstream
  const signal = c.req.raw.signal  // Hono exposes client AbortSignal
  
  try {
    const { audio } = await generateSpeech({
      model: elevenlabs.speech("eleven_v3"),
      text,
      voice: voiceId,
      abortSignal: signal,
    })
    await cache.set(cacheKey, audio.uint8Array)
    return new Response(audio.uint8Array, { headers: { "content-type": "audio/mpeg" } })
  } catch (e) {
    if (e.name === "AbortError") return new Response(null, { status: 499 })  // Client Closed Request
    throw e
  }
})
```

### Edge case

‏אם ‏ה-cache hit מהיר וה-FE כבר abort-ed לפני שה-response חוזר — אופציה ‏‏‏לוותר ‏(ה-FE ‏יראה AbortError ‏ויתעלם). ‏‏אין נזק.

---

## 6. Bun WS proxy — ✅ פשוט

### בדיקה

‏ב-`ServerWebSocket<T>` ‏(מ-`bun-types@1.3.14`): ‏`send(data: string | BufferSource)` ‏מקבל ‏ישירות גם text ‏גם binary. ‏אין צורך ב-parse.

‏לחיבור outbound ל-stdio-to-ws: ‏`new WebSocket(url)` ‏סטנדרטי (‏`ws` npm package, ‏כמו ‏היום ב-`acp-transport.ts`).

### Pattern לproxy bidirectional

```ts
// /ws/agent/:agentId
websocket: {
  async open(feWs) {
    const port = await orchestrator.getBridgePort(feWs.data.agentId)
    if (!port) {
      feWs.close(1008, "agent not found")
      return
    }
    
    const bridgeWs = new WebSocket(`ws://127.0.0.1:${port}/`)
    feWs.data.bridgeWs = bridgeWs
    
    bridgeWs.on("message", (data) => {
      // bridge → FE — pass through
      try { feWs.send(data instanceof Buffer ? data.toString() : data) }
      catch { /* ws closing */ }
    })
    
    bridgeWs.on("close", () => feWs.close(1011, "bridge closed"))
    bridgeWs.on("error", () => feWs.close(1011, "bridge error"))
    // FE → bridge handled in message()
  },
  
  message(feWs, raw) {
    feWs.data.bridgeWs?.send(typeof raw === "string" ? raw : raw)
  },
  
  close(feWs) {
    feWs.data.bridgeWs?.close()
  },
}
```

### Gotchas

1. **Race: ‏FE שולח לפני שה-bridgeWs פתוח** — ‏ניתן לעשות buffer קצר ב-`open` ‏עד `bridgeWs.on("open")`. ‏או ‏לפתוח את ה-bridge ב-`upgrade` ‏לפני שה-WS מתחבר.

2. **stdio-to-ws ‏‏פולט `{"type":"connected"}` ב-handshake** — ‏פעם FE-orchestrated, ‏FE צריך לבלוע את זה ‏לפני שמתחיל ndJsonStream. ‏זה ‏בעצם מה ש-`ws-streams.ts` ‏עושה ‏היום ב-BE, ‏יעבור as-is ‏ל-FE.

3. **Server-injected events** — ‏אם רוצים לשלב `audio_recording_saved` באותו ‏pipe, ‏צריך לכתוב frame לפני ש-bridgeWs מעביר. ‏מומלץ: ‏לא ב-MVP. ‏ה-`/api/stt` ‏יחזיר recordingId ב-response.

4. **Backpressure** — ‏ל-Bun's send יש return value (`ServerWebSocketSendStatus`). ‏‏ה-stdio-to-ws ‏לא ‏באמת ‏‏אגרסיבי בקצב, ‏אז backpressure ‏לא צפויה בעיה.

### המלצה

‏Implementation פשוט ‏כפי שכתוב למעלה. ‏‏הקוד הפנימי של BE יקרוס ל-~50 שורות (במקום ‏755 ב-`agent-session.ts`).

---

---

## 7. Test strategy

### החלטה

‏שכבות הטסטים:

| שכבה | כלי | כיסוי |
|------|------|--------|
| **Pure logic** (sentence-boundary, playlist sort, prefetch policy) | vitest + happy-dom | unit tests, ‏מהיר |
| **Stores** (Svelte 5 runes) | vitest + happy-dom | state transitions, ‏reactivity |
| **HTTP endpoints** (BE proxies) | vitest + Bun http server | integration: cache hit/miss, abort, errors |
| **WS proxy** (BE → stdio-to-ws) | vitest + mock WS | integration: pipe correctness, close propagation |
| **ACP client over WS** | vitest + mock WS עם NDJSON | integration: SDK + ndJsonStream + ClientSideConnection |
| **E2E voice flow** | Playwright או manual | record → STT → ACP → TTS → play |

### על MediaSource ב-tests

‏‏אם **לא** נכלל streaming TTS ‏ב-MVP (ראה §4), ‏אין צורך ב-MediaSource ב-tests. ‏ה-AudioQueue ‏המבוסס ‏ב-`new Audio()` ‏עם blob URL ‏עובר happy-dom ‏בקלות.

‏‏‏‏אם streaming יתווסף ‏בעתיד — `MediaSource` ‏לא נתמך ב-happy-dom. ‏‏יידרש ‏מעבר ל-Playwright ‏עבור הtests הספציפיים האלה.

### TDD style

‏‏לא ‏per-function strict TDD. ‏‏Outer-loop:

‏‏1. ‏לפני כל Phase: ‏‏כותב 1-3 integration tests ‏שמגדירים את ה-DoD.
‏2. ‏Implementation ‏עד שעוברים.
‏3. ‏Unit tests ‏רק לפונקציות שיש להן edge cases ‏מורכבים ‏(sentence-boundary, ‏prefetch policy, ‏playlist ordering).

‏זה ‏‏מהירות נכונה ‏לrefactor ‏‏‏שלא ‏מוסיף complexity, ‏רק ‏מעביר ‏‏אותו.

---

## 10. Bundle size considerations

### חישוב גס

‏אם FE מייבא:
- ‏`@agentclientprotocol/sdk` — ‏~80 KB minified ‏(מ-zod + schemas)
- ‏`@ai-sdk/elevenlabs` — ‏~30 KB ‏‏(אם משאירים ל-debug)
- ‏Existing FE (SvelteKit + Lucide + ...) — ‏~250 KB

‏‏סך הכל בערך ‏350-400 KB ‏לbundle. ‏לא מטריד.

### Tree-shaking

‏ה-SDK ‏‏מייצא הרבה ‏classes. ‏ייבוא ספציפי: ‏`import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"`. ‏Vite ‏מטריד את השאר ‏(`AgentSideConnection`, ‏`TerminalHandle`).

---

## 11. ‏Implementation phases (תכנון ראשוני, ‏יפורט ב-brief)

‏לאחר המחקר, ‏המבנה ‏המתבקש:

### P1 — BE proxy + endpoints (5-7h)

‏- ‏`/ws/agent/:id` ‏הופך ל-bytes pipe (~50 שורות, ‏מחיקת agent-session.ts ‏רוב התוכן)
‏- ‏`POST /api/stt` — ‏מעטיף ‏את הקיים `transcribeUserAudio`, ‏מחזיר ‏`{recordingId, text}`
‏- ‏`POST /api/translate` — ‏עוטף קיים `translateText`, ‏cache
‏- ‏`POST /api/tts` — ‏עוטף קיים `speakSentence`, ‏cache, ‏מחזיר ‏`audio/mpeg`
‏- ‏`POST /api/narrate` — ‏עוטף קיים `narrateToolCall`, ‏cache
‏- ‏‏Integration tests: ‏curl לכל endpoint, ‏cache hit/miss, ‏abort
‏- ‏Cleanup: ‏‏מוסיר `client-impl.ts`'s ‏fs caps, ‏‏‏מסלק VoiceCallbacks ‏plumbing

### P2 — FE ACP client (5-7h)

‏- ‏`@agentclientprotocol/sdk` ‏ב-FE, ‏`wsToWebStreams` ‏adapter (‏~20 שורות)
‏- ‏`agent-session.svelte.ts` ‏מתחבר ל-`/ws/agent/:id` ‏‏ועובד עם SDK
‏- ‏Client impl: requestPermission auto-allow, ‏sessionUpdate → bubble grouping
‏- ‏‏‏Heartbeat `$/ping` כל 25s
‏- ‏Integration: ‏שיחת ACP מקצה לקצה, ‏prompt + ‏stream notifications

### P3 — FE voice orchestrator (5-7h)

‏- ‏`voice-session.svelte.ts` ‏‏refactor מלא: ‏accumulator → ‏splitIntoSentences → ‏prefetch queue
‏- ‏Calls ל-/api/translate, ‏/api/tts ‏בטור עם abortable
‏- ‏AudioQueue ‏עם blob ‏per segment, ‏prev/next/jump
‏- ‏localStorage state persistence
‏- ‏Integration: ‏voice round-trip e2e

### P4 — Cleanup + parity (3-4h)

‏- ‏הסרת קוד ישן מ-BE
‏- ‏וידוא pari ‏מול vnext (כל הflows הקיימים עובדים)
‏- ‏behaviors-coverage.md ‏update
‏- ‏walkthrough.md ‏entry סיכום

### סה"כ הערכה: ‏18-25h

‏פחות מההערכה הראשונית (15-25h) ‏כי:
- ‏אין צורך לכתוב ACP JSON-RPC client ‏ידני (ה-SDK עובד)
- ‏ה-`core/` ‏ניתן לשימוש חוזר ‏כמעט as-is
- ‏streaming TTS ‏‏מומלץ לדחות

---

## 12. ‏‏unknowns שעוד נשארו

| נושא | סטטוס | פעולה |
|------|--------|--------|
| ‏streaming TTS — האם באמת ב-MVP? | ‏ממליץ no, ‏ממתין להחלטה | ‏אבי יחליט |
| ‏MediaSource ב-Safari iOS המנעו | ‏רלוונטי רק אם streaming | ‏ייבדק ‏בעתיד אם נצרך |
| ‏Bun WS proxy ‏backpressure ‏בעומס | ‏לא צפוי בעיה | ‏בדיקה במידה ויופיע |
| ‏localStorage TTL ‏policy | ‏בlobbying — ‏24h עד אחרת | ‏החלטה ב-spec |
| ‏ACP `session/load` ‏ב-FE — ‏היסטוריה מגיעה כnotifications | ‏‏ידוע — ‏FE צריך לעטוף ב-state machine ‏(isLoadingHistory) | ‏יפורט ב-spec |
| ‏Test runner ל-Svelte 5 runes ‏ב-vitest 4 | ‏עובד היום ב-vnext | ‏ללא שינוי |

---

## 13. סיכום ‏מסקנות

1. **‏ARchitecture אפשרית ו-low-risk.** ‏כל ה-unknowns הקריטיים נסגרו.
2. **‏ה-SDK יחסוך 250 שורות ‏לעומת acp-ui.**
3. **‏ה-core/ ‏עוברת לרוב בלי שינוי.** ‏פיצול קיים, ‏BE ‏‏לא מערבב.
4. **‏BE יורד ‏מ-755 ‏שורות (agent-session) + 380 (acp-transport) + 58 (client-impl) ‏‏= 1193 ‏שורות, ל-~150 ‏‏שורות proxy.** ‏פינוי ‏גדול.
5. **‏streaming TTS ‏ניתן לדחיה.** ‏prefetch + cache ‏‏מספק 95% מה-experience.
6. **‏‏הערכת זמן: ‏18-25h** ‏מימוש + ~6h spec + ~3h ‏‏שנעשו על מחקר ‏= ‏סך הכל ~27-34h ‏לrefactor מלא.

---

## 14. הצעדים הבאים

‏‏בלי לחכות לאישור (yolo mode): ‏‏אני ‏כותב את ‏`slice-10-fe-orchestrated-brief.md` ‏עם:

‏- ‏ארכיטקטורה סופית ‏(לא יותר השוואה — ‏‏‏החלטה)
‏- ‏API contracts ‏מלאים (כל endpoint, ‏schemas, ‏errors)
‏- ‏FE state shape (‏stores ‏חדשים/משופצים)
‏- ‏Migration plan ‏(‏מה לבנות חדש מקביל, מתי לעבור, מתי למחוק)
‏- ‏DoD ‏checklist ‏per phase
‏- ‏מותר/אסור ‏ל-executor
‏- ‏סקילים חובה
‏- ‏Prompt לסוכן

‏אבי יקרא, ‏יעיר הערות אם יש, ‏ואז ‏יתחיל implementation.

---

## 8. localStorage schema

> ‏סטטוס: ‏לטיוטה.

### Sketch ראשוני

```ts
type PlaybackState = {
  agentId: string
  sessionId: string | null
  /** ‏Index של ה-segment שמתנגן עכשיו ב-playlist. */
  currentSegmentIndex: number
  /** ‏playlist שנבנה מ-text_chunks שראינו עד עתה. ‏לא ב-localStorage — ‏מ-history events. */
  // playlist: PlaylistItem[] — rebuilt from history on load
  /** ‏Segment IDs ‏שכבר ‏נשמעו (avoid replaying after refresh). */
  playedSegmentIds: string[]
  /** ‏updatedAt ל-TTL. */
  updatedAt: number
}
```

Key: `voice-acp:playback:${agentId}`. ‏TTL: 24h ‏(נסיר automatically).

---

## 9. החלטות שכבר ‏הוחלטו

לפי דיון עם אבי (2026-05-17):

| תחום | החלטה |
|------|--------|
| STT path | `POST /api/stt` — separated, FE שולחת `session/prompt` בנפרד |
| Streaming TTS | ✅ in-scope — חובה ל-prefetch model |
| Cache strategy | content-hash בלבד (sha256(text+voice)) |
| WS scope | ‏רק bridge passthrough — כל UI flow עובר HTTP |
| Server events (history_*, audio_recording_saved) | ‏יתאיינו: ‏history מגיע מ-`session/load` ACP; recording_id ‏ב-response של /api/stt |
| Permission UI | auto-allow_once ב-FE; UI prompt — slice עתידי |
| ACP-parse | ב-FE, ‏ה-BE bytes-pipe ל-stdio-to-ws |
| fs/readTextFile/writeTextFile | ‏לא מוצהר. ‏opencode יקרא לבד מהדיסק |

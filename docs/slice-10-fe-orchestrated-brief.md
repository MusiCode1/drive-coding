# Slice 10 — FE-Orchestrated Refactor

> ‏**מטרה:** ‏הפיכת ה-server לproxy טיפש + ‏cache, ‏העברת כל לוגיקת ACP + voice
> ‏ל-FE. ‏ה-FE מנהל queue, ‏playlist, ‏prefetch, ‏cancellation.
>
> ‏**מקור אמת מקדים:** `docs/slice-10-research.md` — ‏‏מסמך מחקר שמסכם את ה-unknowns
> ‏שנסגרו ‏ואת ‏ההחלטות שהוסכמו עם אבי.
>
> ‏**Worktree:** `/home/user/projects/voice-acp-v3`, branch `vnext-fe-orchestrated`.
> ‏‏**בסיס מוצא:** commit `55c5bab` (fix של TTS duplication ב-vnext).
>
> ‏**Sub-agent:** Sonnet 4.6 ‏מספיק. ‏Opus לא נדרש — ‏החלטות ארכיטקטוניות סגורות,
> ‏ה-spec זה implementation.
>
> ‏**זמן הערכה:** 18-25h ‏מימוש, ‏ב-4-5 phases ‏גסות (לא TDD per-function).
>
> ‏**אסור TDD strict.** ‏Outer-loop בלבד: ‏‏integration tests ‏ב-DoD level.

---

## 1. ‏ההכרעות הארכיטקטוניות

‏‏(מעודכן 2026-05-17 ‏אחרי second-pass review של הקוד הקיים + ‏ההכרעה של אבי על proxy שקוף)

| תחום | החלטה | בסיס |
|------|--------|------|
| ‏ACP transport | **FE** — ‏`@agentclientprotocol/sdk` ‏‏בדפדפן + ‏בנייה של ‏client impl + initialize + session/new \| session/load | ‏ה-SDK Web Standards only. ‏מאמצים גם listSessions + loadSession כדי להיפטר מ-history events ב-WS |
| ‏Voice orchestration | FE | ‏‏פינוי coupling, FE-centric UX |
| ‏BE responsibility | spawn ‏stdio-to-ws + WS bytes pipe + ‏**transparent HTTP proxy** ‏ל-Google + ‏ElevenLabs + native endpoints קטנים | ‏BE ‏באמת ‏טיפש — ‏לא יודע ‏מה ‏עובר ‏ב-proxy ‏פרט ל-cache rule |
| ‏HTTP endpoints | **transparent proxy** — ‏`/proxy/google/*` ‏ו-`/proxy/elevenlabs/*`. ‏FE ‏משתמשת ב-SDKs המקוריים עם `baseURL` ‏כדי להפנות לproxy | ‏המודל ‏שאבי מציע: ‏לעתיד אפשר לשים מפתחות בצד לקוח ‏ולעקוף את ה-BE לחלוטין. ‏אותה תעבורה, ‏אותו פרוטוקול |
| ‏Cache | ‏rule-based על URL patterns ‏ב-proxy: ‏Gemini ‏`generateContent` ו-ElevenLabs ‏`text-to-speech` עם hash על body | ‏SDK-native — ‏אין `/api/translate` ‏מותאם |
| ‏STT | **FE** — ‏`@google/genai` ‏עם baseURL→proxy. ‏FE שולחת audio inline ב-generateContent | ‏אחיד עם translate/narrate שגם הם generateContent |
| ‏Streaming TTS | ✅ — ‏FE עושה fetch ישיר ל-`/proxy/elevenlabs/v1/text-to-speech/{id}/stream` (לא דרך SDK שלא תומך), ‏עם MediaSource | ‏ללא Safari fallback (אבי) |
| ‏Recordings | **endpoint native** ‏`POST /api/recordings` ‏ו-`GET /api/recordings/:id` — ‏fs access, ‏‏לא ל-proxy. ‏FE מעלה ‏ברקע במקביל ל-STT | ‏לא חלק מ-Gemini protocol |
| ‏Sessions / Projects / fs/browse | **endpoints native** ‏(כמו היום) | ‏‏לא חלק מ-protocol כלשהו |
| ‏Agent ‏handshake | ‏**FE** ‏עושה initialize + session/new \| session/load דרך SDK | ‏BE מספק רק ‏‏wsUrl/port |
| ‏Agent registry sync | ‏FE קוראת ל-`POST /api/agents/:id/session-attached { sessionId }` ‏אחרי שה-handshake הצליח | ‏BE ‏מעדכן registry + projectsRegistry |
| ‏fs.readTextFile/writeTextFile | ‏FE לא ‏‏מצהיר | ‏opencode קורא לבד מהדיסק |
| ‏Permission UI | auto-allow_once ב-FE ‏(כמו היום) | ‏UI prompt — slice עתידי |
| ‏Narration cache | ‏key = `toolCallId` (לא content hash) | ‏כפי שהיום ב-narrateToolCall. ‏cache hits ‏בעיקר על retry ‏באותו session |
| ‏localStorage state | playback position + ‏playedSegmentIds ‏(TTL 24h) | ‏refresh recovery |
| ‏Multi-tab | ‏לא נתמך פעיל. ‏cache הופך אותו ל-tolerable | ‏drive-coding מכשיר אחד |
| ‏Heartbeat | `$/ping` ‏כל 25s ‏מ-FE | ‏‏NAT/proxy idle eviction |
| ‏Auto-reconnect ‏ב-WS | ‏❌ — UI prompt למשתמש | ‏acp-ui מסבירים — desync session |
| ‏Warmup ‏אחרי stdio-to-ws ‏`connected` frame | ‏1500ms ‏לפני initialize | ‏subprocess warmup (קיים היום ב-BE, יעבור ל-FE) |
| ‏stdio-to-ws wrapper frames | ‏‏FE מסנן `connected`, ‏`heartbeat`, ‏`disconnected`, ‏`error` **לאורך כל הsession** (לא רק handshake) | ‏‏stdio-to-ws שולח heartbeat כל ~30s |

---

## 2. ‏ארכיטקטורה ‏סופית

```
┌────────────────────────────────┐
│  Browser (FE)                  │
│  ┌──────────────────────────┐  │
│  │ Svelte 5 UI               │  │
│  │  ↕ rune stores            │  │
│  │ ┌─────────────────────┐   │  │
│  │ │ ACP client (SDK)    │   │  │
│  │ │  - initialize       │   │  │
│  │ │  - session/new      │   │  │
│  │ │  - session/prompt   │   │  │
│  │ │  - sessionUpdate    │   │  │
│  │ │  - heartbeat $/ping │   │  │
│  │ └─────────┬───────────┘   │  │
│  │           ↓ WebSocket      │  │
│  │ ┌─────────────────────┐   │  │
│  │ │ Voice orchestrator  │   │  │
│  │ │  - sentence boundary│   │  │
│  │ │  - playlist + cache │   │  │
│  │ │  - prefetch policy  │   │  │
│  │ │  - AbortController  │   │  │
│  │ │  - AudioQueue (MS)  │   │  │
│  │ └─────────┬───────────┘   │  │
│  │           ↓ HTTP fetch     │  │
│  └──────────┬───────────────┘  │
└─────────────┼──────────────────┘
              │ HTTPS/WSS (tunnel)
              ▼
┌────────────────────────────────┐
│  BE (Bun)                      │
│                                │
│  /ws/agent/:id   ←──── bidirectional bytes pipe
│       ↓                        │
│  ws://127.0.0.1:<port>/        │
│       ↓ stdio-to-ws            │
│       ↓ stdio                  │
│     opencode (ACP)             │
│                                │
│  /api/stt        ←─── Gemini transcribe + recording save
│  /api/translate  ←─── Gemini translate (cache)
│  /api/tts        ←─── ElevenLabs stream (cache)
│  /api/narrate    ←─── Gemini narration (cache)
│                                │
│  /api/agents     (unchanged)   │
│  /api/sessions   (unchanged)   │
│  /api/projects   (unchanged)   │
│  /api/recordings (unchanged)   │
│  /api/fs/browse  (unchanged)   │
└────────────────────────────────┘
```

---

## 3. BE — API Contracts (transparent proxy + native endpoints)

‏ה-BE ‏אינו ‏מציע API ‏מותאם ל-voice ‏אלא **proxy שקוף** ל-Google ולElevenLabs ‏בנוסף ‏ל-endpoints native קטנים.

### 3.1 `/ws/agent/:agentId` — WS bytes pipe

‏עוטף את ה-WS של stdio-to-ws ‏ב-loopback. ‏הbytes ‏עוברים as-is ‏בשני הכיוונים. ‏ה-BE לא מפרסר, ‏לא מאמת, ‏לא מעשיר.

‏Edge cases:
- ‏Agent לא קיים → `close(1008, "agent not found")`
- ‏stdio-to-ws crashes → `close(1011, "bridge closed")`
- ‏FE נסגר → BE סוגר את ה-bridge WS

‏אין יותר ‏`ServerMessage` schema, ‏אין יותר ‏`audio_chunk`, ‏אין יותר ‏`history_*` ‏events. ‏ה-FE רואה ‏‏frames raw ‏‏‏של stdio-to-ws + ‏ACP JSON-RPC.

### 3.2 ‏Transparent proxy — ‏`/proxy/google/*` ‏ו-‏`/proxy/elevenlabs/*`

‏**Pattern:** ‏ה-FE קורא ל-`https://my-be.tuns.sh/proxy/google/v1beta/models/.../generateContent` ‏(לדוגמה). ‏ה-BE מקבל, ‏מסיר ‏את prefix `/proxy/google`, ‏עושה ‏fetch ‏ל-`https://generativelanguage.googleapis.com/v1beta/models/.../generateContent`. ‏ה-headers ו-body ‏עוברים as-is.

```ts
// pseudocode
app.all("/proxy/google/*", proxy("https://generativelanguage.googleapis.com"))
app.all("/proxy/elevenlabs/*", proxy("https://api.elevenlabs.io"))

function proxy(upstreamBase) {
  return async (c) => {
    const path = c.req.path.replace(/^\/proxy\/[^/]+/, "")
    const url = upstreamBase + path + c.req.url.searchParams_string
    // cache check first
    if (isCacheable(c.req.method, path, c.req.body)) {
      const key = await hashRequest(c.req.method, path, body)
      const cached = await proxyCache.get(key)
      if (cached) return new Response(cached.body, { headers: cached.headers, status: 200 })
    }
    
    const upstream = await fetch(url, {
      method: c.req.method,
      headers: c.req.headers,  // OneCLI יחליף ‏את ה-api-key header על המסלול
      body: c.req.body,
      signal: c.req.raw.signal,
    })
    
    // Optionally tee to cache for cacheable patterns
    if (isCacheable(...) && upstream.ok) {
      const [forFe, forCache] = upstream.body.tee()
      cacheAsync(key, forCache, upstream.headers)
      return new Response(forFe, { headers: upstream.headers, status: upstream.status })
    }
    
    return new Response(upstream.body, { headers: upstream.headers, status: upstream.status })
  }
}
```

‏**OneCLI integration:** ‏ה-BE עצמו ‏‏רץ ‏מאחורי OneCLI proxy ‏(HTTPS_PROXY env). ‏ה-fetch ‏החיצוני ‏עובר דרכו. ‏OneCLI מזהה את ה-host (`generativelanguage.googleapis.com` ‏או `api.elevenlabs.io`) ‏ו-**מחליף ‏את ה-API-key header** ‏בערך האמיתי לפני ‏ה-forward לupstream.

‏ה-headers ‏מ-FE יכילו placeholder ‏(כמו ‏שהSDKs מנסחים אותם). ‏ה-OneCLI ‏לא ‏מבדיל ‏בין fetch של BE לbcfetch שמתחיל ב-FE — ‏הוא ‏מסתכל ‏על ‏host destination.

‏**מותר ‏‏ב-MVP** ‏לוותר על proxy ‏על ‏‏responses שאי-cacheable (e.g., streaming) ‏ו-stream as-is. ‏Hono ‏ב-Bun ‏מאפשר ‏`return new Response(upstream.body, {...})` ‏שעובר זריקה ‏מהירה.

### 3.3 ‏Cache rules ‏ב-proxy

‏BE מזהה דפוסים ‏ספציפיים ‏ל-cache:

| Pattern | מתודה | Cache key | TTL |
|---------|--------|-----------|-----|
| `/proxy/google/v1beta/models/*:generateContent` | POST | `sha256(method + path + JSON body)` | unlimited (disk) |
| `/proxy/elevenlabs/v1/text-to-speech/{voiceId}/stream` | POST | `sha256(method + path + JSON body)` | unlimited |
| `/proxy/google/v1beta/models/*:streamGenerateContent` | POST | NOT cached (streaming generative) | — |
| ‏שאר ה-paths | * | NOT cached, ‏transparent forward | — |

‏‏ה-`generateContent` cache ‏מכסה גם ‏translate, ‏narration, ‏ו-STT (‏כי כולם generateContent ‏עם body ‏שונה). ‏STT ‏לא ‏צפוי ל-hit (audio שונה כל פעם) ‏אבל הוא לא נכשל בcache miss.

### 3.4 ‏Native endpoints ‏(unchanged, ‏עם הוספה קטנה)

| Endpoint | מתודה | מטרה |
|----------|--------|------|
| `/api/agents` | POST | ‏create agent + spawn bridge + ‏החזרת ‏`{ agentId, wsUrl, bridgePort }` |
| `/api/agents` | GET | ‏רשימה |
| `/api/agents/:id` | DELETE | ‏‏cleanup + kill bridge |
| `/api/agents/:id/session-attached` | POST 🆕 | ‏FE מודיע ‏שhandshake הצליח: ‏`{ sessionId }`. ‏BE ‏מעדכן registry + projectsRegistry |
| `/api/sessions` | GET | ‏רשימה union (כמו היום) |
| `/api/projects` | GET | רשימת cwds (כמו היום) |
| `/api/projects/:hash/sessions` | GET | sessions לפי project |
| `/api/recordings` | POST 🆕 | ‏‏‏‏שמירת audio: ‏`{ audioBase64, mimeType }` → ‏`{ id }`. ‏FE מעלה ברקע במקביל ל-STT |
| `/api/recordings/:id` | GET | ‏ה-audio (כמו היום) |
| `/api/fs/browse?path=` | GET | ‏‏file picker (כמו היום) |
| `/api/client-log` | POST | ‏FE remote logging (כמו היום) |
| `/api/health` | GET | ‏‏‏health |

### 3.5 ‏מה ‏‏שהוסר

- ‏`/api/stt`, ‏`/api/translate`, ‏`/api/tts`, ‏`/api/narrate` — ‏**לא נדרשים**. ‏ה-FE קורא ל-Gemini/ElevenLabs ‏ישירות ‏דרך proxy עם ה-SDKs המקוריים.
- ‏`ServerMessage` schema ב-WS (כל ה-`text_chunk`, `audio_chunk`, `tool_call`, `history_*`, ‏וכו') — ‏ה-WS pipe בלבד.

### 3.6 ‏Agent creation flow (מעודכן)

‏‏היום: ‏BE עושה הכל — ‏spawn + initialize + session/new + ‏record. ‏מחזיר Agent ‏עם `acpSessionId` ‏וready.

‏אחרי:

```
1. FE: POST /api/agents { cwd, cliKind, existingSessionId? }
2. BE: registry.create + bridgeManager.spawn — ‏מחזיר { agentId, wsUrl, bridgePort }
   ‏status = "spawning"
3. FE: ‏פותח WebSocket ל-/ws/agent/:agentId (proxy ל-bridge)
4. FE: ‏ממתין לframe `{type:"connected"}` ‏מ-stdio-to-ws (handshake)
5. FE: ‏warmup 1500ms (subprocess ready)
6. FE: SDK.initialize(...)
7. FE: SDK.newSession({cwd}) — או SDK.loadSession({sessionId, cwd}) — מחזיר sessionId
8. FE: POST /api/agents/:agentId/session-attached { sessionId }
9. BE: ‏registry.update({ status: "ready", acpSessionId })
   + projectsRegistry.recordCwd + projectsRegistry.recordSession
10. ‏FE: ‏סוכן ready, ‏מוכן ל-prompt
```

‏Dedup ‏מ-existing sessionId: ‏ב-FE side. ‏FE קוראת לראשונה ל-`GET /api/agents`, ‏מחפש agent קיים עם ‏`(cwd, sessionId)`, ‏ואם יש — ‏מתחבר אליו במקום ליצור חדש. ‏‏(או ‏BE יכול ‏לעשות dedup ‏ב-POST, ‏אם אם FE שולח ‏existingSessionId — ‏BE בודק registry ‏ומחזיר agent קיים. ‏פשוט יותר ל-BE.)

‏Crash handling: ‏‏היום BE שומר stderr, ‏מחלץ provider error. ‏ימשיך — ‏BE מנטר את ה-bridge process. ‏אם crash, BE שולח ‏`{type:"server_event","kind":"bridge_crash","crashReason":"..."}` ‏על ה-WS pipe ‏(או מעדכן registry, ‏ו-FE polls).

‏**החלטה לdesign:** ‏לwireup MVP ‏בלי `server_event` frames. ‏FE poll `/api/agents/:id` ‏מדי 5s ‏כשconnect lost. ‏slice עתידי ‏יוסיף ‏server-event channel.

---

## 4. ‏FE — Architecture

### ‏Modules ‏חדשים/משופצים

```
packages/frontend/src/lib/
├── acp/
│   ├── client.ts                  # NEW — ACP client wrapper (SDK + ndJsonStream)
│   ├── ws-to-streams.ts           # NEW — WebSocket → {readable, writable}
│   └── client-impl.ts             # NEW — Client interface (requestPermission, sessionUpdate)
├── voice/
│   ├── orchestrator.ts            # NEW — main voice flow (records sentences, prefetch, queue)
│   ├── playlist.ts                # NEW — ordered segments, prev/next/jump
│   ├── audio-stream.ts            # NEW — MediaSource-based AudioQueue
│   ├── translate-client.ts        # NEW — /api/translate wrapper with abort
│   ├── tts-client.ts              # NEW — /api/tts streaming wrapper
│   ├── narrate-client.ts          # NEW — /api/narrate wrapper
│   └── stt-client.ts              # NEW — /api/stt wrapper
├── stores/
│   ├── agent-session.svelte.ts    # REFACTOR — uses ACP client, parses notifications
│   ├── voice-session.svelte.ts    # REFACTOR — uses voice/orchestrator
│   ├── player.svelte.ts           # KEEP — playlist navigation (logic moves to voice/playlist)
│   └── playback-storage.ts        # NEW — localStorage persistence
└── log.ts                          # unchanged
```

### Stores ‏עיקריים — State Shape

```ts
// agent-session.svelte.ts (אחרי refactor)
export type Bubble = { kind, messageId, segments }  // unchanged

export interface AgentSession {
  agentId: string
  status: "disconnected" | "connecting" | "connected" | "thinking"
  bubbles: Bubble[]
  error: string | null
  isConnected: boolean
  
  // ACP-level
  sessionId: string | null
  
  connect(): Promise<void>
  disconnect(): Promise<void>
  
  // ACP requests via SDK
  sendPrompt(text: string): Promise<PromptResponse>
  cancelPrompt(): Promise<void>
  loadHistory(sessionId: string): Promise<void>  // session/load
}

// voice-session.svelte.ts (אחרי refactor)
export interface VoiceSession {
  voiceState: "idle" | "recording" | "transcribing" | "thinking" | "speaking"
  isRecording: boolean
  voiceError: string | null
  canReplayLast: boolean
  
  // Recording
  startRecording(): Promise<void>
  stopRecording(): Promise<void>
  sendAudioBlob(blob: Blob): Promise<void>  // upload path
  
  // Playback
  cancel(): void
  replayLast(): void
}

// player.svelte.ts (mostly unchanged)
export interface Player {
  playlist: PlaylistItem[]
  currentIndex: number
  hasNext: boolean
  hasPrev: boolean
  
  jumpToBubble(messageId: string): PlaylistItem | null
  jumpToSegment(segmentId: string): number
  goNext(): PlaylistItem | null
  goPrev(): PlaylistItem | null
  replayLastResponse(): PlaylistItem | null
}
```

### Voice orchestrator — ‏‏הליבה החדשה

```ts
// voice/orchestrator.ts
export function createVoiceOrchestrator(deps: {
  acp: AcpClient
  agentSession: AgentSession
  player: Player
  audioStream: AudioStream
  settings: SettingsStore
}) {
  // accumulators (per-prompt)
  let messageBuffer = ""
  let thoughtBuffer = ""
  let currentMessageId: string | null = null
  let currentThoughtId: string | null = null
  const recentMessages: string[] = []  // FIFO max 3
  let userMessage = ""
  
  // queue + cancellation
  const sentenceQueue: TtsJob[] = []
  let currentAbort: AbortController | null = null
  
  // subscribe to ACP sessionUpdate
  acp.onSessionUpdate(async (n) => {
    const update = n.update
    
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        if (thoughtBuffer.length > 0) await flushThought()
        if (!currentMessageId) currentMessageId = crypto.randomUUID()
        messageBuffer += update.content.text
        const { sentences, remaining } = splitIntoSentences(messageBuffer)
        messageBuffer = remaining
        for (const s of sentences) enqueueSentence("message", s, currentMessageId)
        agentSession.appendBubble("message", update.content.text, currentMessageId)
        break
      }
      case "agent_thought_chunk": {
        if (messageBuffer.length > 0) await flushMessage()
        // ... similar
      }
      case "tool_call": {
        await flushMessage()
        await flushThought()
        enqueueNarration(update.toolCallId, update.title, update.kind)
        agentSession.appendToolBubble(...)
      }
    }
  })
  
  async function enqueueSentence(kind: "message" | "thought", text: string, messageId: string) {
    const segmentId = crypto.randomUUID()
    player.addSegment({ segmentId, kind, messageId })
    sentenceQueue.push({ kind, text, segmentId, messageId })
    pumpQueue()
  }
  
  async function pumpQueue() {
    // see §5 — prefetch policy
  }
}
```

### Prefetch policy

‏המודל הוא "look-ahead 2": ‏בכל רגע נתון, ‏יש לכל היותר ‏2 segments ‏ב-prefetch ‏(‏currently playing + next + maybe next-next).

```ts
const PREFETCH_LOOKAHEAD = 2

async function pumpQueue() {
  const playing = player.currentIndex
  const target = Math.min(playing + PREFETCH_LOOKAHEAD, sentenceQueue.length - 1)
  
  for (let i = playing; i <= target; i++) {
    const job = sentenceQueue[i]
    if (!job || job.status !== "pending") continue
    job.status = "fetching"
    fetchSegment(job).catch(err => {
      if (err.name !== "AbortError") log.warn({ err }, "tts fetch failed")
    })
  }
}

async function fetchSegment(job: TtsJob) {
  const ac = new AbortController()
  job.abort = ac
  
  // 1. translate
  const tr = await translateClient.translate(job.text, "he", ac.signal)
  if (tr === null) return  // aborted or failed
  
  // 2. tts (streaming)
  const stream = await ttsClient.synthesize(tr, voiceId, ac.signal)
  
  // 3. attach stream to AudioQueue via segmentId
  audioStream.attachSegment(job.segmentId, stream)
  
  job.status = "ready"
}

// Called when player advances:
player.onAdvance(() => {
  pumpQueue()  // schedule next prefetch
})

// Called when user jumps to other segment:
player.onJump((newIndex) => {
  // Cancel all in-flight fetches for segments > newIndex
  for (let i = newIndex + 1; i < sentenceQueue.length; i++) {
    if (sentenceQueue[i].status === "fetching") {
      sentenceQueue[i].abort?.abort()
      sentenceQueue[i].status = "pending"
    }
  }
  pumpQueue()
})
```

### MediaSource AudioQueue — segment per Audio element

‏‏שיטה: ‏‏כל segment ‏הוא ‏`<audio>` ‏עם MediaSource נפרד. ‏האאודיו אלמנט מוכן לנגן ‏ברגע ש-time-to-first-byte הגיע. ‏מעבר ‏בין segments = ‏החלפת active ‏audio element.

‏זה ‏‏פשוט יותר ‏מ-sourceBuffer יחיד ‏‏עם sequence mode (‏שדורש‏‏ careful clear/restart ‏ב-jumps). ‏ה-trade-off: ‏‏‏‏כמה אובייקטי `<audio>` ‏‏באוויר בו-זמנית, ‏אבל יחס memory מינימלי ‏(MP3 streams לא גדולים).

```ts
// voice/audio-stream.ts
export type AudioSegment = {
  segmentId: string
  audio: HTMLAudioElement
  mediaSource: MediaSource
  sourceBuffer: SourceBuffer | null
  abortController: AbortController
  state: "loading" | "ready" | "playing" | "ended" | "cancelled"
}

export class AudioStream {
  private segments = new Map<string, AudioSegment>()
  private current: AudioSegment | null = null
  
  /** ‏‏הכנת segment ‏מ-fetch response stream. ‏הכנה אסינכרונית, ‏חוזרת ‏ברגע MediaSource open. */
  async prepareSegment(segmentId: string, stream: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    const audio = new Audio()
    const mediaSource = new MediaSource()
    audio.src = URL.createObjectURL(mediaSource)
    
    const seg: AudioSegment = {
      segmentId, audio, mediaSource, sourceBuffer: null, abortController: ac, state: "loading",
    }
    this.segments.set(segmentId, seg)
    
    await new Promise<void>((resolve) => {
      mediaSource.addEventListener("sourceopen", () => {
        seg.sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg")
        resolve()
      }, { once: true })
    })
    
    // ‏צריכת ה-stream ברקע, ‏‏appending ל-SourceBuffer
    ;(async () => {
      const reader = stream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (seg.state === "cancelled") break
          await this.appendBuffer(seg.sourceBuffer!, value)
        }
        if (seg.state !== "cancelled") {
          mediaSource.endOfStream()
          seg.state = "ready"
        }
      } catch (e) {
        seg.state = "cancelled"
      }
    })().catch(() => {})
  }
  
  /** ‏ניגון segment ‏‏(blocks אם עוד טוען). */
  async play(segmentId: string): Promise<void> {
    const seg = this.segments.get(segmentId)
    if (!seg) throw new Error(`no segment ${segmentId}`)
    
    if (this.current && this.current.segmentId !== segmentId) {
      this.current.audio.pause()
    }
    this.current = seg
    seg.state = "playing"
    
    return new Promise((resolve, reject) => {
      seg.audio.addEventListener("ended", () => { seg.state = "ended"; resolve() }, { once: true })
      seg.audio.addEventListener("error", reject, { once: true })
      seg.audio.play().catch(reject)
    })
  }
  
  /** ‏ביטול ושחרור ‏segment. */
  cancel(segmentId: string): void {
    const seg = this.segments.get(segmentId)
    if (!seg) return
    seg.state = "cancelled"
    seg.abortController.abort()
    seg.audio.pause()
    try { URL.revokeObjectURL(seg.audio.src) } catch {}
    if (seg.mediaSource.readyState === "open") {
      try { seg.mediaSource.endOfStream() } catch {}
    }
    this.segments.delete(segmentId)
  }
  
  /** ‏ניקוי הכל. */
  clear(): void {
    for (const seg of this.segments.values()) this.cancel(seg.segmentId)
    this.current = null
  }
  
  private appendBuffer(sb: SourceBuffer, chunk: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const onEnd = () => { sb.removeEventListener("updateend", onEnd); resolve() }
      sb.addEventListener("updateend", onEnd)
      try { sb.appendBuffer(chunk) } catch (e) { reject(e) }
    })
  }
}
```

‏‏‏gotcha: ‏MediaSource ב-Safari iOS < 17.1 ‏לא עובד. **לא fallback** ‏(לפי החלטת אבי).

### localStorage schema

```ts
// stores/playback-storage.ts
const KEY_PREFIX = "voice-acp:playback:"
const TTL_MS = 24 * 60 * 60 * 1000

export type PlaybackState = {
  agentId: string
  sessionId: string | null
  currentSegmentIndex: number
  playedSegmentIds: string[]
  updatedAt: number
}

export function loadPlaybackState(agentId: string): PlaybackState | null {
  const raw = localStorage.getItem(KEY_PREFIX + agentId)
  if (!raw) return null
  try {
    const state = JSON.parse(raw) as PlaybackState
    if (Date.now() - state.updatedAt > TTL_MS) {
      localStorage.removeItem(KEY_PREFIX + agentId)
      return null
    }
    return state
  } catch {
    return null
  }
}

export function savePlaybackState(state: PlaybackState): void {
  localStorage.setItem(KEY_PREFIX + state.agentId, JSON.stringify({
    ...state,
    updatedAt: Date.now(),
  }))
}
```

‏Saved on every player.currentIndex change ‏(debounced 1s). ‏Loaded on agent mount.

---

## 5. ‏BE — Implementation Sketch

### `/ws/agent/:id` ‏‏‏(`packages/backend/src/delivery/ws-agent.ts` ‏refactor)

```ts
export function createAgentWsHandler(deps: { orchestrator: AgentOrchestrator }) {
  return {
    async open(feWs) {
      const agentId = feWs.data.agentId
      const port = deps.orchestrator.getBridgePort(agentId)
      if (!port) {
        feWs.close(1008, "agent not found")
        return
      }
      
      const bridgeWs = new WebSocket(`ws://127.0.0.1:${port}/`)
      feWs.data.bridgeWs = bridgeWs
      
      // Buffer FE messages until bridge is open
      const pendingFromFe: (string | Uint8Array)[] = []
      let bridgeOpen = false
      feWs.data.pendingFromFe = pendingFromFe
      
      bridgeWs.on("open", () => {
        bridgeOpen = true
        for (const msg of pendingFromFe) bridgeWs.send(msg)
        pendingFromFe.length = 0
        feWs.data.bridgeOpen = true
      })
      
      bridgeWs.on("message", (data) => {
        try {
          feWs.send(typeof data === "string" ? data : data)
        } catch { /* ws closing */ }
      })
      
      bridgeWs.on("close", () => feWs.close(1011, "bridge closed"))
      bridgeWs.on("error", () => feWs.close(1011, "bridge error"))
    },
    
    message(feWs, raw) {
      if (feWs.data.bridgeOpen) {
        feWs.data.bridgeWs?.send(raw)
      } else {
        feWs.data.pendingFromFe.push(raw)
      }
    },
    
    close(feWs) {
      feWs.data.bridgeWs?.close()
    },
  }
}
```

### `/proxy/google/*` ו-`/proxy/elevenlabs/*` — transparent proxy

```ts
// packages/backend/src/delivery/http-proxy.ts
import { createProxyCache, computeCacheKey, isCacheableRequest } from "./proxy-cache"

const proxyCache = createProxyCache(path.resolve("data/cache/proxy"))

const PROXY_HOSTS: Record<string, string> = {
  google: "https://generativelanguage.googleapis.com",
  elevenlabs: "https://api.elevenlabs.io",
}

export function registerProxyHttp(app: Hono): void {
  app.all("/proxy/:provider/*", async (c) => {
    const provider = c.req.param("provider")
    const upstream = PROXY_HOSTS[provider]
    if (!upstream) return c.json({ error: "unknown provider" }, 404)
    
    // ‏הסרת ‏prefix
    const pathSuffix = new URL(c.req.url).pathname.replace(`/proxy/${provider}`, "")
    const search = new URL(c.req.url).search
    const targetUrl = `${upstream}${pathSuffix}${search}`
    
    // ‏Forward את ה-headers כפי שבאים. ‏OneCLI יחליף ‏api-key headers ‏על המסלול.
    const headers = new Headers(c.req.raw.headers)
    headers.delete("host")  // ‏אסור לupstream
    
    // ‏Read body once
    const body = c.req.method === "GET" || c.req.method === "HEAD"
      ? null
      : new Uint8Array(await c.req.arrayBuffer())
    
    // Cache check
    let cacheKey: string | null = null
    if (isCacheableRequest(c.req.method, pathSuffix, body)) {
      cacheKey = await computeCacheKey(c.req.method, pathSuffix, body)
      const cached = await proxyCache.get(cacheKey)
      if (cached) {
        return new Response(cached.body, {
          status: 200,
          headers: { ...cached.headers, "x-cache": "hit" },
        })
      }
    }
    
    // Forward to upstream
    const signal = c.req.raw.signal
    const res = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body,
      signal,
    })
    
    // Stream back to FE; tee for cache if applicable
    if (cacheKey && res.ok && res.body) {
      const [toClient, toCache] = res.body.tee()
      cacheStreamInBackground(cacheKey, toCache, res.headers)
      return new Response(toClient, {
        status: res.status,
        headers: { ...Object.fromEntries(res.headers), "x-cache": "miss" },
      })
    }
    
    return new Response(res.body, {
      status: res.status,
      headers: res.headers,
    })
  })
}

function isCacheableRequest(method: string, path: string, body: Uint8Array | null): boolean {
  if (method !== "POST" || !body) return false
  // Gemini generateContent (translate, narrate, STT)
  if (/^\/v1beta\/models\/[^/]+:generateContent\b/.test(path)) return true
  // ElevenLabs streaming TTS
  if (/^\/v1\/text-to-speech\/[^/]+\/stream\b/.test(path)) return true
  return false
}

async function computeCacheKey(method: string, path: string, body: Uint8Array | null): Promise<string> {
  const hasher = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${method}|${path}|${body ? new TextDecoder().decode(body) : ""}`),
  )
  return Buffer.from(hasher).toString("hex")
}

async function cacheStreamInBackground(
  key: string,
  stream: ReadableStream<Uint8Array>,
  headers: Headers,
): Promise<void> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    const total = chunks.reduce((s, c) => s + c.length, 0)
    const merged = new Uint8Array(total)
    let off = 0
    for (const c of chunks) { merged.set(c, off); off += c.length }
    
    // Store body + relevant headers (content-type)
    const meta = { contentType: headers.get("content-type") ?? "application/octet-stream" }
    await proxyCache.set(key, { body: merged, headers: meta })
  } catch {
    // partial — לא ‏cache
  }
}
```

### Cache implementation

```ts
// packages/backend/src/delivery/proxy-cache.ts
type CachedEntry = {
  body: Uint8Array
  headers: { contentType: string }
}

export function createProxyCache(baseDir: string) {
  // ‏מבוסס createDiskCache<Uint8Array> ‏הקיים, ‏עם header sidecar
  const bodyCache = createDiskCache<Uint8Array>({
    namespace: "proxy",
    baseDir,
    encode: (v) => v,
    decode: (v) => v,
  })
  // ‏Header נשמר ב-JSON sidecar: ‏key + ".headers"
  return {
    async get(key: string): Promise<CachedEntry | null> {
      const body = await bodyCache.get(key)
      if (!body) return null
      const headersText = await bodyCache.get(`${key}.headers`).then(b => b ? new TextDecoder().decode(b) : null)
      const headers = headersText ? JSON.parse(headersText) : { contentType: "application/octet-stream" }
      return { body, headers }
    },
    async set(key: string, entry: CachedEntry) {
      await bodyCache.set(key, entry.body)
      await bodyCache.set(`${key}.headers`, new TextEncoder().encode(JSON.stringify(entry.headers)))
    },
  }
}
```

### `/api/recordings` (חדש — ‏POST)

```ts
app.post("/api/recordings", async (c) => {
  const { audioBase64, mimeType } = await c.req.json()
  const bytes = Buffer.from(audioBase64, "base64")
  const { id } = await recordingsStore.save(new Uint8Array(bytes), mimeType)
  return c.json({ id })
})
```

### `/api/agents/:id/session-attached` (חדש)

```ts
app.post("/api/agents/:id/session-attached", async (c) => {
  const agentId = c.req.param("id")
  const { sessionId } = await c.req.json()
  
  const agent = await registry.get(agentId)
  if (!agent) return c.json({ error: "agent not found" }, 404)
  
  await registry.update(agentId, { status: "ready", acpSessionId: sessionId })
  await projectsRegistry.recordCwd(agent.cwd, agent.cliKind)
  await projectsRegistry.recordSession(agent.cwd, sessionId)
  
  return c.json({ ok: true })
})
```

### `/ws/agent/:id` ‏‏‏(`packages/backend/src/delivery/ws-agent.ts` ‏refactor)

```ts
export function createAgentWsHandler(deps: { orchestrator: AgentOrchestrator }) {
  return {
    async open(feWs) {
      const agentId = feWs.data.agentId
      const port = deps.orchestrator.getBridgePort(agentId)
      if (!port) {
        feWs.close(1008, "agent not found")
        return
      }
      
      const bridgeWs = new WebSocket(`ws://127.0.0.1:${port}/`)
      feWs.data.bridgeWs = bridgeWs
      
      // Buffer FE messages until bridge is open
      const pendingFromFe: (string | Uint8Array)[] = []
      let bridgeOpen = false
      feWs.data.pendingFromFe = pendingFromFe
      
      bridgeWs.on("open", () => {
        bridgeOpen = true
        for (const msg of pendingFromFe) bridgeWs.send(msg)
        pendingFromFe.length = 0
        feWs.data.bridgeOpen = true
      })
      
      bridgeWs.on("message", (data) => {
        try {
          feWs.send(typeof data === "string" ? data : data)
        } catch { /* ws closing */ }
      })
      
      bridgeWs.on("close", () => feWs.close(1011, "bridge closed"))
      bridgeWs.on("error", () => feWs.close(1011, "bridge error"))
    },
    
    message(feWs, raw) {
      if (feWs.data.bridgeOpen) {
        feWs.data.bridgeWs?.send(raw)
      } else {
        feWs.data.pendingFromFe.push(raw)
      }
    },
    
    close(feWs) {
      feWs.data.bridgeWs?.close()
    },
  }
}
```

### Orchestrator changes

‏`agent-orchestrator.ts:createAndSpawn` ‏מצטמצם דרסטית:

```ts
async createAndSpawn(input): Promise<{ agentId, wsUrl, bridgePort }> {
  // dedup check (כמו היום, על cwd+sessionId)
  if (input.existingSessionId) {
    const dup = findActiveDuplicate(...)
    if (dup) return { agentId: dup.id, wsUrl: dup.wsUrl, bridgePort: dup.bridgePort }
  }
  
  const agent = await registry.create(input)
  await registry.update(agent.id, { status: "spawning" })
  
  const handle = await bridgeManager.spawnWithStderr(agent.id, {
    cliKind: input.cliKind,
    cwd: input.cwd,
    modelOverride: input.modelOverride ?? null,
  })
  
  stderrGetters.set(agent.id, handle.getStderr)
  
  await registry.update(agent.id, { bridgePort: handle.port })
  // status stays "spawning" — FE will mark "ready" via /api/agents/:id/session-attached
  
  return {
    agentId: agent.id,
    wsUrl: handle.wsUrl,
    bridgePort: handle.port,
  }
}
```

**הסר** מ-orchestrator:
- ‏יצירת ‏ACP transport (createAcpWsTransport / createAcpWsLoadTransport)
- ‏createAgentSession
- ‏historyBuffer ‏ו-history broadcast
- ‏‏‏הקריאה ל-projectsRegistry.recordSession ‏(עוברת ל-`/api/agents/:id/session-attached`)

‏ה-orchestrator עדיין מנהל crash listening — ‏אם bridge מת, מסמן status=crashed עם crashReason מ-stderr.

### מחיקות מה-BE (Phase 4)

‏- ‏`packages/backend/src/app/agent-session.ts` — ‏**נמחק לחלוטין** (755 שורות).
‏- ‏`packages/backend/src/acp/acp-transport.ts` — ‏נמחק לחלוטין (380 שורות).
‏- ‏`packages/backend/src/acp/client-impl.ts` — ‏נמחק לחלוטין (58 שורות).
‏- ‏`packages/backend/src/acp/ws-streams.ts` — ‏נמחק לחלוטין (~130 שורות; ‏עובר ל-FE).
‏- ‏`packages/backend/src/voice/pipeline.ts` — ‏**נמחק לחלוטין** (~185 שורות). ‏ה-FE קורא ל-Gemini ‏דרך SDK ישירות.
‏- ‏`packages/backend/src/voice/narration.ts` — ‏**נמחק לחלוטין** (~153 שורות). ‏ה-FE ‏‏בונה ‏את ה-prompt ‏ומשתמש ב-`@ai-sdk/google` `generateText`.
‏- ‏`packages/backend/src/voice/providers/gemini-transcription.ts` — ‏נמחק (FE עושה ‏STT דרך ‏SDK).
‏- ‏`packages/backend/src/voice/cache-disk.ts` — ‏יוחלף ב-`createDiskCache` הגנרי ‏(שכבר קיים ב-`cache.ts`). ‏אופציונלי לarchive בPhase 4.
‏- ‏`packages/backend/src/voice/cache.ts` + ‏`cache-keys.ts` — ‏נשאר ‏(משתמש ב-`/proxy/*` ‏cache).
‏- ‏`packages/backend/src/voice/providers.ts` — ‏‏ייתכן ‏שהוא ‏נמחק לחלוטין (FE עושה את הSDKs). ‏אבל ‏אם רוצים ‏שgem still תוכל לעשות something server-side ‏בעתיד, ‏ניתן להשאיר.
‏- ‏טסטים: ‏`agent-session-*.test.ts` (3 קבצים), ‏`ws-protocol-tier1.test.ts`, ‏`narration.test.ts`, ‏`voice-pipeline.test.ts`, ‏`translate-cache.test.ts`, ‏`gemini-transcription.test.ts` — ‏‏‏רובם נמחקים, ‏חלקם מועברים ל-FE עם תרגום ל-Svelte stores.

‏סך הכל ‏BE shrinks ‏ב-~1700 שורות impl + ~800 שורות tests.

---

## 6. ‏FE — Implementation Sketch

### 6.1 ACP — ws-to-streams (port מ-BE עם תיקון)

‏הקובץ ‏הקיים ב-BE ‏(`packages/backend/src/acp/ws-streams.ts`, 131 שורות) ‏מועבר ל-FE עם התאמות:
1. ‏עובד ‏על `WebSocket` של דפדפן ‏(לא ‏`ws` npm)
2. ‏‏ה-set של frame types ‏לסינון: `connected`, ‏`heartbeat`, ‏`disconnected`, ‏`error` — ‏ב-**כל ה-session** (לא רק handshake), ‏בגלל ‏ש-stdio-to-ws שולח heartbeat כל ~30s
3. ‏‏שמירה ‏על ‏‏אופן ה-fragmentation: ‏‏לא להוסיף `\n` לframes נכנסים ‏(לאפשר ל-SDK ‏לאסוף partial frames)
4. ‏‏בכתיבה ‏‏ל-WS: ‏לפצל על `\n` ‏ולשלוח כל שורה ‏כ-frame בנפרד, ‏לכל שורה ‏להוסיף ‏suffix `\n` ‏(opencode מצפה ל-NDJSON delimited stream)

```ts
// lib/acp/ws-to-streams.ts
const STDIO_TO_WS_FRAME_TYPES = new Set(["connected", "heartbeat", "disconnected", "error"])

export function wsToWebStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      ws.addEventListener("message", (ev) => {
        const text = typeof ev.data === "string" 
          ? ev.data 
          : ev.data instanceof ArrayBuffer ? decoder.decode(ev.data) : String(ev.data)
        
        // ‏Filter stdio-to-ws wrapper frames לאורך כל הsession
        if (!text.includes('"jsonrpc"')) {
          try {
            const parsed = JSON.parse(text) as { type?: string; jsonrpc?: string }
            if (parsed.jsonrpc === undefined && parsed.type !== undefined) {
              if (STDIO_TO_WS_FRAME_TYPES.has(parsed.type)) return  // swallow
              console.warn("dropped non-ACP frame:", text.slice(0, 200))
              return
            }
          } catch { /* fallthrough — could be partial NDJSON */ }
        }
        
        // Forward as-is — ‏לא להוסיף `\n`, ‏ה-SDK יחזיק buffer ‏ל-partial frames
        controller.enqueue(encoder.encode(text))
      })
      ws.addEventListener("close", () => { try { controller.close() } catch {} })
      ws.addEventListener("error", (e) => { try { controller.error(e) } catch {} })
    },
  })
  
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      const text = decoder.decode(chunk)
      // ‏פיצול על `\n` — ‏SDK ‏כותב לנו `{...}\n` לכל הודעה
      for (const line of text.split("\n")) {
        if (line.trim().length > 0) {
          try { ws.send(`${line}\n`) } catch { /* ws closed */ }
        }
      }
    },
    close() { try { ws.close() } catch {} },
  })
  
  return { readable, writable }
}
```

### 6.2 ACP client (orchestrator-level)

```ts
// lib/acp/client.ts
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { wsToWebStreams } from "./ws-to-streams"
import { createClientImpl } from "./client-impl"

const WARMUP_DELAY_MS = 1500

export async function createAcpClient(agentId: string, onUpdate: (n: SessionNotification) => void) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)
  
  // 1. ‏WS open
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true })
  })
  
  // 2. ‏‏המתנה ל-stdio-to-ws ‏`{type:"connected"}` ‏handshake frame
  await new Promise<void>((resolve) => {
    const onMsg = (ev: MessageEvent) => {
      const text = typeof ev.data === "string" ? ev.data : ""
      if (text.includes('"type":"connected"')) {
        ws.removeEventListener("message", onMsg)
        resolve()
      }
    }
    ws.addEventListener("message", onMsg)
  })
  
  // 3. ‏Warmup — subprocess עוד לא מוכן ‏לקלוט initialize
  await new Promise(r => setTimeout(r, WARMUP_DELAY_MS))
  
  // 4. ‏בניית streams + connection
  const { readable, writable } = wsToWebStreams(ws)
  const stream = ndJsonStream(writable, readable)
  
  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection(_agent => client, stream)
  
  // 5. Initialize
  const initResult = await conn.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: "drive-coding", version: "0.2.0" },
  })
  
  // 6. Heartbeat $/ping ‏כל 25s — ‏NAT/proxy keepalive
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "$/ping" }) + "\n")
    }
  }, 25_000)
  
  return {
    conn,
    capabilities: initResult.agentCapabilities,
    
    /** newSession או loadSession, מחזיר sessionId */
    async newSession(opts: { cwd: string }) {
      return conn.newSession({ cwd: opts.cwd, mcpServers: [] })
    },
    
    async loadSession(opts: { cwd: string; sessionId: string }) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (conn as any).loadSession({ sessionId: opts.sessionId, cwd: opts.cwd, mcpServers: [] })
    },
    
    /** session/list — ל-FE שרוצה לרשום sessions ישנים לפני create */
    async listSessions() {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (conn as any).listSessions({})
    },
    
    async prompt(sessionId: string, text: string) {
      return conn.prompt({ sessionId, prompt: [{ type: "text", text }] })
    },
    
    async cancel(sessionId: string) {
      return conn.cancel({ sessionId })
    },
    
    close() {
      clearInterval(heartbeat)
      ws.close()
    },
  }
}
```

### 6.3 ‏Client impl ‏(`fs` capabilities לא ‏מוצהר)

```ts
// lib/acp/client-impl.ts
import type { Client, SessionNotification } from "@agentclientprotocol/sdk"

export function createClientImpl(opts: {
  onUpdate: (n: SessionNotification) => void
}): Client {
  return {
    async requestPermission(params) {
      // auto-allow_once. ‏slice עתידי יוסיף UI prompt.
      const byKind = (k: string) => params.options.find(o => o.kind === k)
      const chosen =
        byKind("allow_once") ??
        byKind("allow_always") ??
        params.options.find(o => !o.kind.startsWith("reject")) ??
        params.options[0]
      if (!chosen) return { outcome: { outcome: "cancelled" } }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },
    
    async sessionUpdate(notification) {
      opts.onUpdate(notification)
    },
    
    // ‏fs.readTextFile + writeTextFile: ‏NOT declared ב-clientCapabilities.
    // opencode ‏יקרא לדיסק לבד.
  }
}
```

### 6.4 Voice clients — ‏SDKs המקוריים עם baseURL→proxy

```ts
// lib/voice/sdks.ts — singleton SDK instances configured for our proxy
import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { GoogleGenAI } from "@google/genai"

const PROXY_BASE = `${location.protocol}//${location.host}`

/** ‏‏לתרגום + narration — generateText. */
export const googleAi = createGoogleGenerativeAI({
  apiKey: "browser-placeholder",  // לא חשוב מה
  baseURL: `${PROXY_BASE}/proxy/google/v1beta`,
})

/** ‏ל-STT — ‏multimodal generateContent עם audio inline. */
export const googleGenAi = new GoogleGenAI({
  apiKey: "browser-placeholder",
  httpOptions: { baseURL: `${PROXY_BASE}/proxy/google` },
})
```

### 6.5 STT client

```ts
// lib/voice/stt-client.ts
import { googleGenAi } from "./sdks"
import { saveRecording } from "./recordings-client"

export async function transcribe(blob: Blob, opts: {
  previousAssistantText?: string
  signal?: AbortSignal
}): Promise<{ text: string; recordingId: string }> {
  const audioBytes = new Uint8Array(await blob.arrayBuffer())
  const mimeType = blob.type || "audio/webm"
  
  // ‏Save recording ברקע במקביל ל-STT
  const recordingPromise = saveRecording(audioBytes, mimeType)
  
  const hebrewRule = "Output in the original script of the language spoken. If Hebrew, output Hebrew letters."
  const prompt = opts.previousAssistantText
    ? `Transcribe the user's audio. Context: previous assistant said: "${opts.previousAssistantText}". Transcribe ONLY user's audio. ${hebrewRule}`
    : `Transcribe the audio. ${hebrewRule}`
  
  const base64 = btoa(String.fromCharCode(...audioBytes))
  
  const response = await googleGenAi.models.generateContent({
    model: "gemini-flash-latest",
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
    }],
    config: { abortSignal: opts.signal },  // ‏אם ה-SDK תומך, אחרת ‏נסיף custom fetch
  })
  
  const { id: recordingId } = await recordingPromise
  return { text: response.text ?? "", recordingId }
}
```

### 6.6 Translate client

```ts
// lib/voice/translate-client.ts
import { generateText } from "ai"
import { googleAi } from "./sdks"

const TIMEOUT_MS = 2500

export async function translate(text: string, targetLang: "he" | "en", signal?: AbortSignal): Promise<string> {
  const prompt = `Translate the following text to ${targetLang === "he" ? "Hebrew" : "English"}.
Output ONLY the translated text, no explanations.

Text:
${text}`
  
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(new Error(`Translate timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS)
  signal?.addEventListener("abort", () => ac.abort(), { once: true })
  
  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    return result.text.trim()
  } finally {
    clearTimeout(timer)
  }
}
```

### 6.7 TTS streaming client — ‏fetch ישיר (SDK לא תומך)

```ts
// lib/voice/tts-client.ts
const PROXY_BASE = `${location.protocol}//${location.host}/proxy/elevenlabs`

export async function synthesizeStreaming(opts: {
  text: string
  voiceId: string
  modelId?: string
  signal?: AbortSignal
}): Promise<ReadableStream<Uint8Array>> {
  const modelId = opts.modelId ?? "eleven_v3"
  const response = await fetch(
    `${PROXY_BASE}/v1/text-to-speech/${opts.voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": "browser-placeholder",
        "content-type": "application/json",
        "accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: opts.text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal: opts.signal,
    },
  )
  
  if (!response.ok) {
    throw new Error(`TTS failed: ${response.status} ${await response.text().catch(() => "")}`)
  }
  if (!response.body) {
    throw new Error("TTS: no body in response")
  }
  
  return response.body
}
```

### 6.8 Narration client

```ts
// lib/voice/narrate-client.ts
import { generateText } from "ai"
import { googleAi } from "./sdks"
import { buildNarratePrompt } from "$lib/voice/narration-prompt"  // ‏port מ-core/voice/narration.ts

const TIMEOUT_MS = 1500

export async function narrate(opts: {
  userMessage: string
  recentMessages: string[]
  tool: { toolCallId: string; title: string; kind?: string }
  signal?: AbortSignal
}): Promise<string> {
  const prompt = buildNarratePrompt(
    { userMessage: opts.userMessage, recentMessages: opts.recentMessages },
    { toolCallId: opts.tool.toolCallId, title: opts.tool.title, kind: opts.tool.kind },
  )
  
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  opts.signal?.addEventListener("abort", () => ac.abort(), { once: true })
  
  try {
    const result = await generateText({
      model: googleAi("gemini-flash-lite-latest"),
      prompt,
      abortSignal: ac.signal,
    })
    return result.text.trim() || opts.tool.title  // fallback
  } catch (e) {
    return opts.tool.title  // ‏fallback ב-error או timeout
  } finally {
    clearTimeout(timer)
  }
}
```

‏**Note:** ‏`buildNarratePrompt` ‏ב-core (`packages/core/src/voice/narration-prompt.ts`) — ‏עוברת ממקומה הנוכחי ב-`packages/backend/src/voice/narration.ts:71`. ‏היא pure function, ‏שייכת ל-core.

### 6.9 Recordings client

```ts
// lib/voice/recordings-client.ts
export async function saveRecording(bytes: Uint8Array, mimeType: string): Promise<{ id: string }> {
  const audioBase64 = btoa(String.fromCharCode(...bytes))
  const response = await fetch("/api/recordings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ audioBase64, mimeType }),
  })
  if (!response.ok) throw new Error(`Save recording failed: ${response.status}`)
  return response.json()
}
```

### 6.10 ‏Cache hit detection ‏ב-FE

‏ה-FE לא צריך לדעת ‏cache hit/miss — ‏ה-`X-Cache: hit|miss` header ‏זמין אם רוצים ‏‏debugging. ‏פנימית, ‏‏המהירות תעיד.

---

## 7. ‏Phases

### Phase 1 — BE: proxy + native endpoints + WS pipe (4-6h)

**מטרה:** ‏BE ‏‏הופך ל-proxy שקוף + ‏‏endpoints native קטנים.

‏Tasks:
- ‏‏רישום ‏ב-`server.ts` של handler חדש ‏`registerProxyHttp(app)` ‏(`packages/backend/src/delivery/http-proxy.ts`)
- ‏‏Proxy ל-`/proxy/google/*` ‏ול-`/proxy/elevenlabs/*` — ‏transparent forwarding
- ‏Cache rule-based על URL patterns (generateContent + ‏TTS stream) — ‏‏`packages/backend/src/delivery/proxy-cache.ts`
- ‏‏Refactor ‏`/ws/agent/:id` ‏ל-bytes pipe (~50 שורות; ‏מקובץ חדש `ws-agent.ts` במקום הישן)
- ‏Endpoint חדש: ‏`POST /api/recordings` ‏(audioBase64 + mimeType → ‏id) — ‏‏מקובץ `http-history.ts` ‏(הרחבה)
- ‏Endpoint חדש: ‏`POST /api/agents/:id/session-attached` ‏(sessionId → רישום ב-registry + projectsRegistry)
- ‏Refactor `agent-orchestrator.createAndSpawn`: ‏מסיר ACP handshake, ‏מחזיר { agentId, wsUrl, bridgePort }
- ‏Integration tests: ‏curl ‏לproxy עם cache hit/miss, ‏ל-WS pipe ‏עם mock stdio-to-ws

‏DoD:
- ‏`POST /proxy/google/v1beta/models/gemini-flash-latest:generateContent` ‏זורם ל-upstream + ‏cache hit ב-2nd call
- ‏`POST /proxy/elevenlabs/v1/text-to-speech/{id}/stream` ‏זורם chunks ‏בlive + cache hit ב-2nd call
- ‏`POST /api/agents` ‏מחזיר ‏`{ agentId, wsUrl, bridgePort }` — ‏‏לא agent ready
- ‏`POST /api/agents/:id/session-attached` ‏מסמן ‏status=ready
- ‏`/ws/agent/:id` עובד pipe בtest mock עם stdio-to-ws fake

**Commit:** `feat(backend): Phase 1 — transparent proxy + native endpoints (slice 10)`

### Phase 2 — FE: ACP client (SDK) + agent flow (5-7h)

**מטרה:** ‏FE ‏עושה ACP handshake ‏עצמאית, ‏מציג bubbles ‏מ-sessionUpdate.

‏Tasks:
- ‏`packages/frontend/src/lib/acp/ws-to-streams.ts` — ‏port מ-BE עם תיקון frame types filter
- ‏`packages/frontend/src/lib/acp/client-impl.ts` (~40 שורות)
- ‏`packages/frontend/src/lib/acp/client.ts` — ‏createAcpClient עם warmup, heartbeat, newSession, loadSession, listSessions
- ‏Refactor ‏`packages/frontend/src/lib/stores/agent-session.svelte.ts`:
  - ‏POST `/api/agents` → ‏מקבל { agentId, wsUrl, bridgePort }
  - ‏fork ‏acp client → ‏initialize + newSession|loadSession → sessionId
  - ‏POST `/api/agents/:id/session-attached` { sessionId }
  - ‏subscribe ל-sessionUpdate, ‏מבנה bubbles ‏מ-notifications raw (אותו ‏logic של היום)
- ‏Refactor `routes/agent/[id]/+page.svelte`: ‏‏חיבור ‏לאflow החדש
- ‏Heartbeat $/ping כל 25s (כבר בclient.ts)
- ‏No auto-reconnect — UI prompt "חיבור נפל, רענן"
- ‏Integration test: ‏‏prompt → bubbles streaming end-to-end (mock WS עם NDJSON)

‏DoD:
- ‏ה-FE ‏יוצר agent, ‏עושה handshake, ‏שולח `session/prompt`, ‏מקבל text_chunks ‏ומציג bubbles
- ‏`session/load` ‏ל-existing sessionId → history bubbles
- ‏`session/list` (ב-page /sessions) — ‏ניתן ‏אבל אופציה לדחות לdebug עתידי

**Commit:** `feat(frontend): Phase 2 — ACP client over WS pipe (slice 10)`

### Phase 3 — FE: voice orchestrator (5-7h)

**מטרה:** ‏Voice flow מקצה לקצה: ‏record → STT → ACP → translate → TTS streaming → playback.

‏Tasks:
- ‏`packages/core/src/voice/narration-prompt.ts` — ‏פיצול `buildNarratePrompt` ‏מ-`backend/src/voice/narration.ts` ל-core (pure function)
- ‏`packages/frontend/src/lib/voice/sdks.ts` — googleAi (@ai-sdk/google) + googleGenAi (@google/genai) עם baseURL→proxy
- ‏`lib/voice/stt-client.ts`, ‏`translate-client.ts`, ‏`tts-client.ts`, ‏`narrate-client.ts`, ‏`recordings-client.ts`
- ‏`lib/voice/audio-stream.ts` — MediaSource per segment, ‏Audio element pool
- ‏`lib/voice/playlist.ts` — addSegment, ‏jumpTo, ‏prev, ‏next, ‏isPlayingBubble
- ‏`lib/voice/orchestrator.ts` — ‏הליבה: ‏accumulators, ‏‏subscribe ‏ל-agentSession.onUpdate, ‏prefetch policy (lookahead 2), ‏AbortController per pending request
- ‏Refactor `voice-session.svelte.ts` — delegate ל-orchestrator
- ‏Refactor `routes/agent/[id]/+page.svelte` — ‏‏מסיר את ה-effects הישנים שsubscribed ל-`voice.currentlyPlayingSegmentId`
- ‏localStorage state persistence (`stores/playback-storage.ts`)
- ‏Settings: ‏voiceId default ‏מקבל אופציה במשך flow

‏DoD:
- ‏הקלטה → POST /api/recordings ‏ברקע + STT via /proxy/google ‏generateContent → text
- ‏session/prompt עם text → notifications חוזרים
- ‏accumulator + splitIntoSentences ‏מפיק jobs
- ‏prefetch: ‏translate + TTS streaming + MediaSource playback בזרימה
- ‏user jump → ‏pending requests aborted (‏fetch signal) → ‏playback מתחיל מ-target
- ‏narration tool flow עובד (FE קורא ‏ל-/proxy/google עם narrate prompt)
- ‏localStorage persistence (refresh test)
- **‏"קפיצה להודעה" עובד** — ‏ה-FE ‏יודע ‏לבטל pending thoughts ‏ולקפוץ לmessage שהגיע

**Commit:** `feat(frontend): Phase 3 — voice orchestrator + streaming TTS via proxy (slice 10)`

### Phase 4 — BE cleanup + parity check (2-3h)

**מטרה:** ‏מחיקת קוד ישן, ‏‏וידוא ‏parity ‏מלא.

‏Tasks:
- ‏מחיקת `packages/backend/src/app/agent-session.ts` ‏(755 שורות)
- ‏מחיקת `packages/backend/src/acp/acp-transport.ts` (380 שורות)
- ‏מחיקת `packages/backend/src/acp/client-impl.ts` (58 שורות)
- ‏מחיקת `packages/backend/src/acp/ws-streams.ts` (131 שורות)
- ‏מחיקת `packages/backend/src/voice/pipeline.ts` (185 שורות)
- ‏מחיקת `packages/backend/src/voice/narration.ts` (153 שורות) — ‏אחרי שbuildNarratePrompt עבר ל-core
- ‏מחיקת `packages/backend/src/voice/providers/gemini-transcription.ts` (73 שורות)
- ‏מחיקת `packages/backend/src/voice/providers.ts` (66 שורות) — ‏אם אין שימוש server-side
- ‏מחיקת cache-disk.ts ‏אם לא בשימוש
- ‏עדכון `packages/backend/src/server.ts` ‏ל-imports החדשים בלבד
- ‏מחיקת tests מיותרים (~10-15 קבצי test)
- ‏‏וידוא flows ‏עובדים: ‏dashboard, ‏‏/sessions, ‏/agent/:id, ‏file picker, ‏settings, ‏recording replay
- ‏‏עדכון `docs/behaviors-coverage.md` — UI-AUDIO-8 ‏עכשיו ✅
- ‏‏עדכון `docs/walkthrough.md` ‏עם entry סיכום

‏DoD:
- ‏BE shrinks ‏‏ב-~1700 ‏שורות impl + ~800 שורות tests
- ‏typecheck + lint ‏ירוקים
- ‏‏כל ה-tests עוברים
- ‏‏manual smoke test ‏ב-browser: ‏record → STT → ACP → TTS playback ‏רצוף

**Commit:** `chore(backend): Phase 4 — remove old voice + ACP code (slice 10)`

### Phase 5 (אופציונלי) — UX polish

‏‏אם זמן: ‏prev/next UI ‏refinement, ‏replay button ‏behavior, ‏error states.

---

## 8. ‏DoD Checklist (Slice 10)

- [ ] 4 ‏phases הושלמו עם commits
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ‏ירוקים
- [ ] BE shrinks ‏ב-~1200 שורות impl + ~600 שורות tests
- [ ] FE ‏מכיל ‏~800 שורות חדשות ב-`lib/acp/` ‏ו-`lib/voice/`
- [ ] ‏הקלטה → תמלול → ACP → תרגום → TTS streaming → playback ‏עובד בדפדפן
- [ ] Prev/next/jump עובדים instant על cache hits
- [ ] Cancel ‏מבטל in-flight fetch (verified ב-network tab)
- [ ] רענון tab משחזר playback position ב-localStorage
- [ ] /sessions, /agent/:id, recording replay, ‏file picker — ‏כולם עובדים
- [ ] עדכון `docs/walkthrough.md` ‏עם ‏entry slice 10
- [ ] עדכון `docs/behaviors-coverage.md` — ‏UI-AUDIO-8 ✅, ‏וכל ה-behaviors המכוסים
- [ ] ‏screenshots ‏‏ב-`/tmp/slice-10-verification/`

---

## 9. ‏אסור / מותר

**מותר:**
- ‏`packages/backend/src/**` (refactor מלא)
- ‏`packages/frontend/src/**` (refactor מלא)
- ‏`packages/core/src/**` — ‏רק שינוי schema/agent.ts ‏ו-schemas/ws-messages.ts (‏ארכוב הרוב)
- ‏`packages/backend/tests/**`, ‏`packages/frontend/tests/**` (‏‏שינוי מלא)
- ‏`docs/walkthrough.md`, ‏`docs/behaviors-coverage.md`

**אסור:**
- ‏`docs/slice-10-research.md` — ‏זה מקור אמת, ‏לא לערוך
- ‏`docs/slice-10-fe-orchestrated-brief.md` — ‏‏‏זה ה-brief, ‏לא לערוך
- ‏`docs/reviews/**`, ‏`docs/archive/**`
- ‏`packages/core/src/log/**` — ‏לא לגעת ‏(slicing logging ‏עברה)

---

## 10. ‏סקילים חובה לסוכן ה-executor

- ‏`tdd` — **outer-loop בלבד**, ‏‏‏לא per-function
- ‏`dev-conventions` — Svelte 5 runes, ESM, ‏no `any`
- ‏`Svelte-MCP` — ‏לחיפוש docs של Svelte 5 (`$state`, `$derived`, `$effect`)
- ‏`commit` — מבנה commit messages (עברית, פר-phase)
- ‏`update-walkthrough` — entry בסוף

---

## 11. Prompt לסוכן

```
אתה סוכן refactor של ‏drive-coding ‏voice-acp-v3.
Slice 10 ‏הופך את ה-server ל-proxy טיפש + cache. ‏FE מנהל הכל.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v3
- branch: vnext-fe-orchestrated
- ‏בסיס: commit 55c5bab (vnext)

⭐ מקור אמת:
- docs/slice-10-research.md — ‏מחקר ‏שסגר את ה-unknowns
- docs/slice-10-fe-orchestrated-brief.md — ‏זה ה-brief

הכרעות סגורות (לא להחזיר):
- streaming TTS in-scope ‏(MediaSource, ‏ללא Safari fallback)
- ACP SDK ‏רץ בדפדפן ישירות (Web Standards only)
- BE = bytes pipe + 4 endpoints + cache
- localStorage לplayback state
- auto-allow_once permissions ‏(UI prompt בעתיד)

עבודה:
1. ‏טען skills: tdd (outer-loop בלבד!), dev-conventions, Svelte-MCP, commit, update-walkthrough.
2. ‏קרא ‏docs/slice-10-research.md מקצה לקצה.
3. ‏קרא ‏docs/slice-10-fe-orchestrated-brief.md ‏מקצה לקצה.
4. ‏בצע ‏Phase 1 → 2 → 3 → 4 ‏בסדר.
5. ‏commit פר phase. ‏פורמט עברי.
6. ‏בסוף — עדכן walkthrough + behaviors-coverage.

‏TDD outer-loop:
- ‏לפני כל phase: ‏כתוב 1-3 integration tests שמגדירים את ה-DoD
- ‏implementation עד שעוברים
- ‏‏unit tests רק לפונקציות עם edge cases מורכבים (sentence-boundary, prefetch policy)

‏הbackend רץ ב-tmux `be` על port 4000. ‏frontend ב-tmux `fe` על port 5173.
‏tunnel: your-app.nue.tuns.sh

‏‏לטסט browser: ‏linux-gui עם pw-clean.sh (port 9333).

‏אם נתקל בהחלטה ארכיטקטונית שלא מכוסה ב-brief → ‏עצור ושאל.
‏אחרת — ‏אוטונומיה גורפת.

pnpm typecheck + pnpm lint + pnpm test ‏לפני כל commit.
```

---

## 12. סיכום ‏הצפוי

| מימד | תוצאה |
|------|--------|
| ‏Commits | 4 phases ‏(אופציה ל-5) |
| ‏Tests חדשים | ‏~20-30 (כל שכבת ה-orchestrator + integration). ‏‏~80-100 ישנים נמחקים |
| ‏BE LoC ‏delta | ‏**-1700 impl, -800 tests** |
| ‏FE LoC ‏delta | ‏+900-1100 impl, +250 tests |
| ‏New endpoints | ‏2 native (`/api/recordings POST`, ‏`/api/agents/:id/session-attached`) + ‏proxy routes (`/proxy/google/*`, ‏`/proxy/elevenlabs/*`) |
| ‏‏New modules | ‏~10 ‏(ב-FE `lib/acp/` ו-`lib/voice/`) |
| ‏‏Performance | streaming TTS ‏‏‏מוריד time-to-first-byte ‏מ-1-2s ל-200-300ms |
| ‏‏UX wins | ‏prefetch + cancel = ‏jump-to-message ‏טבעי, ‏skip לא בזבזני |
| ‏‏Coupling reduction | ‏אין יותר WS schema לתחזק; ‏ה-traffic ‏מ-FE זהה ל-OneCLI gateway pattern — ‏מאפשר ‏‏מעבר ל-FE-only (keys בצד לקוח) בעתיד |

---

## 13. ‏Second-pass review — ‏פערים ‏שתוקנו

‏בעקבות ‏‏question של אבי ‏("האם קראת את הקבצים לעומק?") ‏בוצע ‏‏second-pass review של ‏15 קבצים שלא נכללו ב-original brief. ‏ה-gaps שנמצאו ‏ותוקנו ‏ב-brief זה:

### תיקונים ארכיטקטוניים

| # | הטענה המקורית ב-brief | התיקון |
|---|------------------------|----------|
| 1 | `/api/translate`, `/api/tts`, `/api/narrate`, `/api/stt` ‏כ-endpoints מותאמים | ‏**הוסר.** ‏המודל ‏הוא transparent proxy על Google + ElevenLabs. ‏FE משתמשת ב-SDKs המקוריים עם `baseURL`. ‏אבי החליט: ‏"השרת ‏טיפש" |
| 2 | "BE עושה ACP handshake (initialize + newSession)" | ‏**שונה.** ‏BE רק spawn ‏+ ‏מחזיר wsUrl. FE עושה את ה-handshake דרך SDK. ‏FE מודיעה ל-BE על sessionId דרך endpoint חדש `/api/agents/:id/session-attached` |
| 3 | History events `history_*` עוברים ב-WS | ‏**הוסר.** ‏ה-FE קוראת ‏ל-`session/load` ‏דרך SDK ומקבלת notifications ‏ישירות. ‏אין צורך ב-history events |
| 4 | "stdio-to-ws מסנן רק `connected` ב-handshake" | ‏**שונה.** ‏מסנן ‏גם `heartbeat` (כל ~30s), ‏`disconnected`, ‏`error` ‏לאורך ה-session. ‏ראה `ws-streams.ts` המקורי |
| 5 | "warmup delay" ‏לא ‏מוזכר | ‏**נוסף.** 1500ms ‏‏אחרי `connected` frame ‏לפני initialize. ‏subprocess עוד לא מוכן |
| 6 | narration cache key = ‏content hash | ‏**שונה.** ‏key = toolCallId (כפי שcurrent narrateToolCall עושה). ‏cache hits בעיקר ב-retry באותו session |
| 7 | "speakSentence stays in pipeline.ts" | ‏**שונה.** ‏speakSentence נמחק; ‏ה-FE עושה fetch streaming ישירות ל-`/proxy/elevenlabs` |
| 8 | "voice/narration.ts stays as-is" | ‏**שונה.** ‏מוסיר ב-Phase 4 — ‏buildNarratePrompt עוברת ל-core כ-pure function, ‏ה-FE קורא ל-Gemini ‏דרך SDK |

### תיקוני קוד מדויקים

| # | הטענה המקורית | המציאות בקוד |
|---|---------------|----------------|
| 9 | "agent-session.ts shrinks 90%" | ‏**מוסר לחלוטין.** ‏ה-fan-out ‏נעלם — ‏ה-FE מקבל notifications ‏ישירות מ-ACP |
| 10 | "BE shrinks ~1200 שורות" | ‏‏**יותר — ~1700 שורות impl + 800 tests.** ‏‏נכלל גם ‏narration.ts (153), ‏gemini-transcription.ts (73), ‏אם providers.ts מוסר (66) |
| 11 | "ws-streams.ts logic — port ל-FE" | ‏✅ ‏עם תיקון: ‏filter set ‏מ-{connected} ל-{connected, heartbeat, disconnected, error}, ‏פיצול ב-write על `\n` ‏ושליחה ‏per line |
| 12 | `recordings-store.save({bytes, mimeType}) → ?` | ‏**אומת:** ‏returns `{id: string, durationMs?: number}` |
| 13 | "narration cache הוא in-memory" | ‏**אומת:** ‏ה-cache abstraction ‏(`Cache<NarrationValue>`) ‏כבר תומך ב-disk; ‏‏הbackend הקיים ‏מעביר ‏in-memory Map ב-`agent-session.ts:370`. ‏עבודה ‏עתידית ‏היא להפנות ‏אותו ל-`createDiskCache` — ‏‏במודל החדש זה ‏יקרה ‏אוטומטית ב-proxy cache |

### Future-proofing (אבי highlight)

‏המודל ‏עם ‏transparent proxy + SDKs מקוריים ‏מאפשר ‏‏בעתיד:
1. ‏המשתמש מכניס ‏API keys ‏ב-FE settings → IndexedDB
2. ‏FE ‏מחליף `baseURL` ‏מ-proxy ל-upstream ישיר
3. ‏‏SDKs פולטים את ה-key ‏ישירות בheaders
4. ‏BE ‏‏הופך ‏ל-stdio-to-ws ‏spawner בלבד (אין יותר proxy)

‏זה אופציה אדריכלית לסליי-עתידי. ‏ה-brief זה ‏מספק את הצעד הראשון.

---

## 14. ‏Decisions עוד פתוחות לאישור אבי

‏‏לפני שאני מוסיר ל-executor, ‏יש 2 שאלות שכדאי להבהיר:

### 14.1 Dedup של existingSessionId — ‏BE ‏או FE?

‏היום: BE עושה dedup ב-`agent-orchestrator.createAndSpawn` (מחפש agent קיים עם cwd+sessionId).

‏אופציות:
‏(א) ‏**BE keeps dedup** — ‏FE שולח `{ cwd, sessionId? }` ל-`POST /api/agents`, ‏BE בודק registry, ‏אם קיים מחזיר ‏את הקיים. ‏אם לא — ‏spawns חדש.
‏(ב) ‏**FE עושה dedup** — ‏FE קוראת ‏`GET /api/agents`, ‏מחפש מקומית. ‏BE ‏‏תמיד spawns ‏ב-POST.

‏המלצה: **(א)** — ‏לשמור ‏ב-BE. ‏יותר עקבי, ‏‏פחות round trips.

### 14.2 ‏server_event channel ‏על ה-WS pipe?

‏אם bridge crashed או provider error מ-stderr — ‏איך FE יודע?

‏אופציות:
‏(א) ‏**BE שולח על ה-WS pipe** frames של `{"type":"server_event","kind":"bridge_crash",...}`. ‏ה-FE צריך לסנן אותם (כמו `connected`/`heartbeat`).
‏(ב) ‏**FE polls** `GET /api/agents/:id` ‏כשmusically ‏מאתר ‏error.
‏(ג) ‏**SSE endpoint נפרד** `/api/agents/:id/events`.

‏המלצה: ‏**(ב) ‏ב-MVP**. ‏ה-FE כבר ‏מטפל ב-error state ‏(`session.status = "crashed"`). ‏Polling ‏‏יקרה ‏‏רק כש-WS פתאום נופל ‏(rare). ‏slice עתידי ‏יוסיף channel ‏מפורש אם נצרך.

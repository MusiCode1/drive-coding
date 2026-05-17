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

| תחום | החלטה | בסיס |
|------|--------|------|
| ‏ACP parsing | FE — ‏`@agentclientprotocol/sdk` ‏‏בדפדפן | ‏ה-SDK Web Standards only |
| ‏Voice queue + playlist + prefetch | FE | ‏‏פינוי coupling, FE-centric UX |
| ‏BE = bytes pipe + endpoints + cache | ‏כן | ‏BE לא חייב להיות ACP membrane |
| ‏fs.readTextFile/writeTextFile | ‏לא מוצהר | ‏opencode קורא לבד מ-disk |
| ‏Permission UI | auto-allow_once ‏(כמו היום) | ‏UI prompt — slice עתידי |
| ‏STT | `POST /api/stt`, ‏FE שולחת `session/prompt` בנפרד | ‏separated concerns |
| ‏Streaming TTS | ✅ in-scope, ‏MediaSource API | ‏‏אבי החליט (לא Safari) |
| ‏Cache | ‏content-hash בלבד (`sha256(text+voiceId)`) | ‏פשטות |
| ‏localStorage state | playback position + ‏playedSegmentIds ‏(TTL 24h) | ‏refresh recovery |
| ‏Multi-tab | ‏לא נתמך פעיל. ‏cache הופך אותו ל-tolerable | ‏drive-coding מכשיר אחד |
| ‏Heartbeat | `$/ping` ‏כל 25s ‏מ-FE | ‏‏NAT/proxy idle eviction |
| ‏Auto-reconnect ‏ב-WS | ‏❌ — UI prompt למשתמש | ‏acp-ui מסבירים — desync session |

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

## 3. BE — API Contracts

### `/ws/agent/:agentId` — bytes pipe

‏עוטף את ה-WS של stdio-to-ws ‏ב-loopback. ‏הbytes ‏עוברים as-is ‏בשני הכיוונים. ‏ה-BE לא מפרסר, ‏לא מאמת, ‏לא מעשיר.

‏Edge cases:
- ‏Agent לא קיים → `close(1008, "agent not found")`
- ‏stdio-to-ws crashes → `close(1011, "bridge closed")`
- ‏FE נסגר → BE סוגר את ה-bridge WS

‏לא יותר ‏`ServerMessage` schema, ‏לא יותר ‏`audio_chunk`, ‏לא יותר ‏`history_*` ‏events. ‏ה-FE רואה את ‏ה-frames ‏הraw של stdio-to-ws + JSON-RPC של ACP.

### `POST /api/stt`

```ts
// Request:
type SttRequest = {
  audioBase64: string
  mimeType: string  // "audio/webm" | "audio/mp4" | ...
  agentId?: string   // optional — for recording association
  previousAssistantText?: string  // D39 STT context
}

// Response:
type SttResponse = {
  text: string
  recordingId: string  // saved to recordings-store
}

// Errors: 400 (invalid audio), 502 (Gemini failed)
```

### `POST /api/translate`

```ts
// Request:
type TranslateRequest = {
  text: string
  targetLang: "he" | "en"
}

// Response:
type TranslateResponse = {
  translated: string
  cacheHit: boolean
}

// Errors: 502 (Gemini failed/timeout)
// AbortSignal: יpropagated ל-fetch upstream
```

### `POST /api/tts` — streaming

```ts
// Request:
type TtsRequest = {
  text: string
  voiceId: string
  modelId?: "eleven_v3" | "eleven_multilingual_v2" | ...  // default eleven_v3
}

// Response: HTTP 200, Content-Type: audio/mpeg, Transfer-Encoding: chunked
//   Body: stream of MP3 bytes
// Or on cache hit: HTTP 200, same content-type, full body from disk
// Header: X-Cache: "hit" | "miss"

// Errors: 502 (ElevenLabs failed), 499 (client closed = abort)
// AbortSignal: יpropagated; partial cache write נמחק
```

### `POST /api/narrate`

```ts
// Request:
type NarrateRequest = {
  userMessage: string
  recentMessages: string[]  // FIFO max 3
  tool: { toolCallId: string; title: string; kind?: string }
}

// Response:
type NarrateResponse = {
  narrated: string
  cacheHit: boolean
}

// Errors: 502 (Gemini failed/timeout), returns title as fallback ב-FE
// Cache key: sha256(userMessage + "|" + recentMessages.join("|") + "|" + toolCallId)
```

### `POST /api/recordings` (חדש, מועבר מ-/api/stt חלקית)

‏אופציונלי לMVP — ‏אם המוצר ‏‏רוצה ‏שמירת recording בלי STT. ‏‏בשלב ראשון `/api/stt` ‏יעשה ‏את שני הדברים.

### Endpoints קיימים ‏(unchanged)

- ‏`POST /api/agents` — ‏create agent (cwd + cliKind), ‏‏‏מחזיר agentId
- ‏`GET /api/agents` — ‏רשימה
- ‏`DELETE /api/agents/:id`
- ‏`GET /api/sessions`, ‏`/api/projects`, ‏`/api/projects/:hash/sessions`
- ‏`GET /api/recordings/:id` — ‏streaming audio playback
- ‏`GET /api/fs/browse?path=...` — ‏file picker
- ‏`POST /api/client-log` — ‏FE remote logging

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

### `/api/translate`

```ts
// packages/backend/src/delivery/http-voice.ts
app.post("/api/translate", async (c) => {
  const { text, targetLang } = await c.req.json()
  const cacheKey = await sha256Key(`${text}|${targetLang}`)
  
  const cached = await translateCache.get(cacheKey)
  if (cached !== null) {
    return c.json({ translated: cached, cacheHit: true })
  }
  
  const signal = c.req.raw.signal
  try {
    const { text: translated } = await generateText({
      model: registries.translator["gemini/flash-lite"],
      prompt: buildTranslationPrompt(text, targetLang),
      abortSignal: signal,
    })
    const trimmed = translated.trim()
    await translateCache.set(cacheKey, trimmed)
    return c.json({ translated: trimmed, cacheHit: false })
  } catch (e) {
    if (signal.aborted) return c.body(null, 499)
    return c.json({ error: String(e) }, 502)
  }
})
```

### `/api/tts` — streaming

```ts
app.post("/api/tts", async (c) => {
  const { text, voiceId, modelId = "eleven_v3" } = await c.req.json()
  const cacheKey = await sha256Key(`${text}|${voiceId}|${modelId}`)
  
  const cached = await ttsCache.get(cacheKey)
  if (cached !== null) {
    return c.body(cached, 200, {
      "content-type": "audio/mpeg",
      "x-cache": "hit",
    })
  }
  
  const signal = c.req.raw.signal
  const upstream = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream`,
    {
      method: "POST",
      headers: {
        "xi-api-key": "placeholder-onecli-injects",
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
      signal,
    },
  )
  
  if (!upstream.ok) {
    return c.json({ error: `ElevenLabs ${upstream.status}` }, 502)
  }
  
  // Tee the stream: one to client, one to cache buffer
  const [toClient, toCache] = upstream.body!.tee()
  
  // Cache in background
  ;(async () => {
    const chunks: Uint8Array[] = []
    const reader = toCache.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        chunks.push(value)
      }
      const total = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
      let offset = 0
      for (const c of chunks) { total.set(c, offset); offset += c.length }
      await ttsCache.set(cacheKey, total)
    } catch {
      // partial — don't cache
    }
  })()
  
  return new Response(toClient, {
    status: 200,
    headers: {
      "content-type": "audio/mpeg",
      "x-cache": "miss",
    },
  })
})
```

### `/api/stt`

```ts
app.post("/api/stt", async (c) => {
  const { audioBase64, mimeType, previousAssistantText } = await c.req.json()
  const audioBytes = Buffer.from(audioBase64, "base64")
  
  // 1. Save recording
  let recordingId: string | undefined
  try {
    const saved = await recordingsStore.save(new Uint8Array(audioBytes), mimeType)
    recordingId = saved.id
  } catch (e) {
    log.warn({ err: e }, "recording save failed")
  }
  
  // 2. STT
  const sttRes = await transcribeUserAudio(
    { bytes: new Uint8Array(audioBytes), mimeType },
    { sttModel: "gemini/flash-context", previousAssistantText, ...defaultConfig },
    { stt: registries.stt },
  )
  
  if (sttRes.isErr()) {
    return c.json({ error: sttRes.error }, 502)
  }
  
  return c.json({ text: sttRes.value, recordingId })
})
```

### `/api/narrate`

```ts
app.post("/api/narrate", async (c) => {
  const { userMessage, recentMessages, tool } = await c.req.json()
  const cacheKey = await sha256Key(
    `${userMessage}|${recentMessages.join("|")}|${tool.toolCallId}`,
  )
  
  const cached = await narrateCache.get(cacheKey)
  if (cached) return c.json({ narrated: cached.text, cacheHit: true })
  
  const signal = c.req.raw.signal
  const result = await narrateToolCall(
    { userMessage, recentMessages },
    { toolCallId: tool.toolCallId, kind: tool.kind, title: tool.title },
    narrationGenerator,
    inMemoryCacheAdapter,
  )
  
  if (result.isErr()) {
    if (signal.aborted) return c.body(null, 499)
    return c.json({ error: result.error }, 502)
  }
  
  await narrateCache.set(cacheKey, { text: result.value, toolTitle: tool.title, createdAt: new Date().toISOString() })
  return c.json({ narrated: result.value, cacheHit: false })
})
```

### מחיקות מה-BE

‏בPhase 4 ‏(cleanup):
- ‏`packages/backend/src/app/agent-session.ts` — ‏מוסיר 90% (~700 שורות). ‏נשארות ~50 שורות ‏ל-lifecycle bookkeeping ‏אם נדרש.
- ‏`packages/backend/src/acp/acp-transport.ts` — ‏מוסיר לחלוטין (380 שורות)
- ‏`packages/backend/src/acp/client-impl.ts` — ‏מוסיר לחלוטין (58 שורות)
- ‏`packages/backend/src/acp/ws-streams.ts` — ‏מוסיר לחלוטין (mostly ‏עובר ל-FE)
- ‏`packages/backend/src/voice/pipeline.ts` — ‏חלקים נשארים (translateText, transcribeUserAudio); ‏speakSentence ‏מוחלף ב-streaming fetch
- ‏`packages/backend/src/voice/narration.ts` — ‏נשאר as-is
- ‏‏טסטים מ-`agent-session-coordination.test.ts`, ‏`agent-session-audio.test.ts`, ‏`agent-session-history.test.ts`, ‏`ws-protocol-tier1.test.ts` — ‏‏רובם מועברים ל-FE או נמחקים

‏סך הכל ‏‏BE shrinks ‏ב-~1200 שורות impl + ~600 שורות tests.

---

## 6. ‏FE — Implementation Sketch

### ACP client

```ts
// lib/acp/ws-to-streams.ts
export function wsToWebStreams(ws: WebSocket): {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
} {
  const readable = new ReadableStream({
    start(controller) {
      ws.addEventListener("message", (ev) => {
        if (typeof ev.data === "string") {
          // stdio-to-ws wrapper frame? swallow
          if (ev.data.startsWith('{"type":"connected"') || 
              ev.data.startsWith('{"type":"disconnected"')) return
          controller.enqueue(new TextEncoder().encode(ev.data))
        } else if (ev.data instanceof ArrayBuffer) {
          controller.enqueue(new Uint8Array(ev.data))
        }
      })
      ws.addEventListener("close", () => controller.close())
      ws.addEventListener("error", (e) => controller.error(e))
    },
  })
  
  const writable = new WritableStream({
    write(chunk) {
      const text = new TextDecoder().decode(chunk)
      ws.send(text)  // SDK appends newlines internally
    },
    close() {
      ws.close()
    },
  })
  
  return { readable, writable }
}
```

```ts
// lib/acp/client.ts
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk"
import { wsToWebStreams } from "./ws-to-streams"
import { createClientImpl } from "./client-impl"

export async function createAcpClient(agentId: string, onUpdate: (n: SessionNotification) => void) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:"
  const ws = new WebSocket(`${proto}//${location.host}/ws/agent/${agentId}`)
  
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true })
    ws.addEventListener("error", () => reject(new Error("WS connect failed")), { once: true })
  })
  
  // Wait for stdio-to-ws handshake (one `connected` frame)
  await new Promise<void>((resolve) => {
    const onMsg = (ev: MessageEvent) => {
      if (typeof ev.data === "string" && ev.data.includes('"connected"')) {
        ws.removeEventListener("message", onMsg)
        resolve()
      }
    }
    ws.addEventListener("message", onMsg)
  })
  
  // Build streams + connection
  const { readable, writable } = wsToWebStreams(ws)
  const stream = ndJsonStream(writable, readable)
  
  const client = createClientImpl({ onUpdate })
  const conn = new ClientSideConnection(_agent => client, stream)
  
  // Initialize
  const initResult = await conn.initialize({
    protocolVersion: 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
    clientInfo: { name: "drive-coding", version: "0.2.0" },
  })
  
  // Heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ jsonrpc: "2.0", method: "$/ping" }) + "\n")
    }
  }, 25_000)
  
  return {
    conn,
    capabilities: initResult.agentCapabilities,
    close() {
      clearInterval(heartbeat)
      ws.close()
    },
  }
}
```

### Client impl

```ts
// lib/acp/client-impl.ts
import type { Client, SessionNotification } from "@agentclientprotocol/sdk"

export function createClientImpl(opts: {
  onUpdate: (n: SessionNotification) => void
}): Client {
  return {
    async requestPermission(params) {
      // auto-allow_once (Phase: future slice will add UI)
      const byKind = (k: string) => params.options.find(o => o.kind === k)
      const chosen = byKind("allow_once") ?? byKind("allow_always") ?? params.options[0]
      if (!chosen) return { outcome: { outcome: "cancelled" } }
      return { outcome: { outcome: "selected", optionId: chosen.optionId } }
    },
    
    async sessionUpdate(notification) {
      opts.onUpdate(notification)
    },
    
    // fs.readTextFile + writeTextFile: NOT declared, agent reads disk directly.
    // No implementation needed — SDK won't call methods we don't declare.
  }
}
```

---

## 7. ‏Phases

### Phase 1 — BE proxy + endpoints (5-7h)

**מטרה:** ‏BE מוכן לקבל קריאות מ-FE.

‏Tasks:
- ‏Refactor `/ws/agent/:id` ל-bytes pipe (~50 שורות)
- ‏Endpoint `/api/translate` (cache, ‏abort)
- ‏Endpoint `/api/tts` (streaming, ‏cache via tee)
- ‏Endpoint `/api/stt` (אוחד עם recording save)
- ‏Endpoint `/api/narrate` (cache)
- ‏Integration tests: ‏curl לכל endpoint, ‏cache hit/miss, ‏abort
- ‏ה-BE עדיין מחזיק קוד ישן (agent-session.ts) ‏לתאימות אחורה — ‏לא מוחק עדיין

‏DoD:
- ‏4 endpoints חדשים עוברים ‏unit + integration tests
- ‏`/ws/agent/:id` עובד pipe בtest mock עם stdio-to-ws fake
- ‏Cache hit מחזיר ‏ב-<10ms, ‏cache miss ‏‏מצליח proxy

**Commit:** `feat(backend): Phase 1 — voice endpoints + WS bytes pipe (slice 10)`

### Phase 2 — FE ACP client (5-7h)

**מטרה:** ‏FE מתחבר ‏ל-ACP דרך SDK, ‏רואה bubbles.

‏Tasks:
- ‏`lib/acp/ws-to-streams.ts` (~30 שורות)
- ‏`lib/acp/client-impl.ts` (~40 שורות)
- ‏`lib/acp/client.ts` (~80 שורות)
- ‏Refactor `agent-session.svelte.ts`: ‏מתחבר עם SDK, ‏subscribes ל-sessionUpdate, ‏מבנה bubbles כמו היום (אבל מ-notifications raw)
- ‏Heartbeat `$/ping` ‏כל 25s
- ‏No auto-reconnect — ‏מציג "חיבור נפל, ‏לחץ לרענן"
- ‏Integration test: ‏שיחה מקצה לקצה ‏‏(prompt → bubbles streaming)

‏DoD:
- ‏ACP client ‏מבצע `initialize` + ‏`session/new` בהצלחה
- ‏`session/prompt` ‏עם text → bubbles מתעדכנות עם text_chunks
- ‏`session/load` ‏עם sessionId → history bubbles ‏מוצגות
- ‏heartbeat נשלח כל 25s (verified ב-traffic log)

**Commit:** `feat(frontend): Phase 2 — ACP client over WS pipe (slice 10)`

### Phase 3 — FE voice orchestrator (5-7h)

**מטרה:** ‏Voice flow מקצה לקצה ‏ב-FE: ‏record → STT → ACP → ‏translate → TTS streaming → play.

‏Tasks:
- ‏`lib/voice/stt-client.ts`, ‏`translate-client.ts`, ‏`tts-client.ts`, ‏`narrate-client.ts`
- ‏`lib/voice/audio-stream.ts` (MediaSource-based)
- ‏`lib/voice/playlist.ts` (`addSegment`, ‏`jumpTo`, ‏`prev`, ‏`next`)
- ‏`lib/voice/orchestrator.ts` (the big one — coordination, prefetch, queue, abort)
- ‏Refactor `voice-session.svelte.ts`: ‏‏delegates ל-orchestrator
- ‏Refactor `routes/agent/[id]/+page.svelte`: ‏‏משתמש ב-stores החדשים, ‏מסיר את ה-effect של player.addSegment ‏הישן
- ‏localStorage state persistence

‏DoD:
- ‏הקלטה → STT → ACP → ‏translate → TTS streaming → playback ‏‏פועלים מקצה לקצה
- ‏prefetch של 2 segments קדימה
- ‏prev/next ‏עובר instant ‏(cache hit אם כבר נטען)
- ‏cancel ‏מבטל in-flight ‏fetch
- ‏רענון tab משחזר ‏playback position ‏מ-localStorage

**Commit:** `feat(frontend): Phase 3 — voice orchestrator + streaming TTS (slice 10)`

### Phase 4 — BE cleanup + parity (3-4h)

**מטרה:** ‏מחיקת קוד ישן, ‏‏וידוא שכל הפיצ'רים עובדים.

‏Tasks:
- ‏מחיקת `app/agent-session.ts` (רוב התוכן)
- ‏מחיקת `acp/acp-transport.ts`, ‏`acp/client-impl.ts`, ‏`acp/ws-streams.ts`
- ‏פינוי `voice/pipeline.ts` — speakSentence ‏הוסר (מחזיק רק translateText + transcribeUserAudio)
- ‏מחיקת tests מיותרים: ‏coordination, audio, ws-protocol-tier1 ‏‏(integration לא נחוצה ‏יותר)
- ‏העברת tests של sentence-boundary + cache-key ‏ל-FE ‏(import מ-core ‏עובד from FE)
- ‏‏וידוא flows עובדים: ‏dashboard, /sessions, /agent/:id, file picker, settings, recording replay
- ‏‏‏עדכון behaviors-coverage.md
- ‏‏‏עדכון walkthrough.md ‏עם entry סיכום

‏DoD:
- ‏BE shrinks ‏‏‏על ~1200 ‏שורות impl
- ‏typecheck + lint ‏ירוקים
- ‏‏כל ה-tests עוברים
- ‏‏פיצ'רים שעבדו ב-vnext עובדים ב-vnext-fe-orchestrated

**Commit:** `chore(backend): Phase 4 — cleanup old voice + ACP code (slice 10)`

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
| ‏Tests חדשים | ‏~20-30 ‏(אבל ‏גם 50-80 ‏tests ‏ישנים נמחקים) |
| ‏BE LoC ‏delta | ‏-1200 impl, -600 tests |
| ‏FE LoC ‏delta | ‏+800 impl, +200 tests |
| ‏New endpoints | 4 |
| ‏‏New modules | 8 ‏(ב-FE `lib/acp/` ו-`lib/voice/`) |
| ‏‏Performance | streaming TTS ‏‏‏מוריד time-to-first-byte ‏מ-1-2s ל-200-300ms |
| ‏‏UX wins | ‏prefetch + cancel = ‏‏jump-to-message ‏עובד טבעית; ‏skip לא בזבזני |
| ‏‏Coupling reduction | ‏‏‏‏אין יותר WS schema לתחזק; ‏רק 4 HTTP contracts |

# Tier 1 — Voice Pipeline Enhancement (brief)

> **מטרה:** להחזיר את ה-UX של v1 ב-voice pipeline + להוסיף תשתית
> ל-playlist navigation (⏮/⏭ עתידי).
>
> **סוג:** Backend-only. שינויי frontend מינוריים (שדות חדשים ב-WS events).
> **TDD חובה.** Sub-agent: Sonnet 4.6.
> **זמן הערכה:** 4-6 שעות עבודה.

---

## 1. מה כלול ב-Tier 1

| # | פיצ'ר | למה |
|---|--------|-----|
| 1 | Tool call narration (Gemini Flash Lite) | המשתמש שומע "בודק את הקובץ" במקום שתיקה ארוכה |
| 2 | Thought translation + TTS | המשתמש שומע מחשבות באנגלית מתורגמות לעברית |
| 3 | Coordination: message↔thought↔tool_call | סדר השמע נכון |
| 4 | Cache היררכי (TTS + translation + narration) | חיסכון עלות + מהירות חוזרת |
| 5 | Provider error בruntime | "המודל לא ענה" → "חסר credit balance" |
| 6 | Message/thought/segment ID tracking | תשתית ל-playlist navigation בעתיד |

**מה לא כלול:**
- Voice picker UI — Slice 8b
- Thought voice חליפי — Slice 8b
- ⏮/⏭ buttons ב-frontend — נכלל ב-frontend refactor
- Streaming TTS אמיתי (MediaSource) — future-features

---

## 2. מבנה הקוד המוצע

### קבצים חדשים

```
packages/backend/src/voice/
├── disk-cache.ts          # CHANGE: → generic factory
├── cache.ts               # NEW: createDiskCache<T>({ namespace, encode, decode })
├── narration.ts           # NEW: buildNarratePrompt + narrateToolCall
└── cache-keys.ts          # NEW: hashing helpers (sha256)
```

### קבצים שמשתנים

```
packages/backend/src/
├── app/
│   ├── agent-session.ts       # coordination, buffers, ID tracking, queue
│   └── agent-orchestrator.ts  # pass getStderr to createAgentSession
├── voice/
│   ├── pipeline.ts            # cache param to translateText, narrateToolCall integration
│   └── providers/             # no change
packages/core/src/
└── protocol/messages.ts        # extend audio_chunk, text_chunk, tool_call
```

---

## 3. Cache abstraction — מבנה היררכי

### Interface

```typescript
// packages/core/src/cache/types.ts
export interface Cache<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T): Promise<void>
  has(key: string): Promise<boolean>
}
```

### Factory

```typescript
// packages/backend/src/voice/cache.ts
import type { Cache } from "@drive-coding/core/cache/types"

export function createDiskCache<T>(opts: {
  namespace: string                       // "tts" | "translation" | "narration"
  baseDir: string                          // ".cache"
  encode: (value: T) => Uint8Array
  decode: (bytes: Uint8Array) => T
}): Cache<T>
```

### שימוש

```typescript
const ttsCache: Cache<Uint8Array> = createDiskCache({
  namespace: "tts",
  baseDir: ".cache",
  encode: (v) => v,
  decode: (v) => v,
})

const translationCache: Cache<string> = createDiskCache({
  namespace: "translation",
  baseDir: ".cache",
  encode: (v) => new TextEncoder().encode(v),
  decode: (v) => new TextDecoder().decode(v),
})

interface NarrationValue {
  text: string
  toolTitle: string  // למעקב
  createdAt: string  // ISO timestamp
}

const narrationCache: Cache<NarrationValue> = createDiskCache({
  namespace: "narration",
  baseDir: ".cache",
  encode: (v) => new TextEncoder().encode(JSON.stringify(v)),
  decode: (v) => JSON.parse(new TextDecoder().decode(v)),
})
```

### מבנה ה-disk

```
.cache/
├── tts/
│   ├── ab12cd34.../sha256.bin
│   └── ...
├── translation/
│   └── ...
└── narration/
    └── ...
```

ה-key חיצוני הוא `sha256(input)`. ה-`disk-cache.ts` הקיים יוחלף ב-factory הזה (deprecation graceful).

---

## 4. Narration — מבנה מודולרי

```typescript
// packages/backend/src/voice/narration.ts

export interface NarrateContext {
  userMessage: string           // מה המשתמש אמר (post-STT)
  recentMessages: string[]      // FIFO max 3 של תגובות המודל
}

export interface ToolCallForNarrate {
  toolCallId: string            // cache key
  kind?: string                 // read/edit/execute/...
  title: string                 // הכותרת הגולמית של הtool
}

export function buildNarratePrompt(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
): string

export async function narrateToolCall(
  ctx: NarrateContext,
  tool: ToolCallForNarrate,
  registries: { translator: GoogleProvider },
  cache: Cache<NarrationValue>,
): Promise<Result<string, string>>
```

**Port מלא** של `buildNarratePrompt` ו-`narrateToolCall` מ-v1 `gemini-helper.ts:82-225`.

ה-cache משתמש ב-`toolCallId` כ-key (לא טקסט!). הסיבה: אותו טקסט-tool יכול לקבל narration אחרת לפי context. בvnext, ה-toolCallId יציב בתוך session אבל לא בין sessions — כך ש-cache hits יקרו בעיקר ב-loadSession בעתיד.

ה-timeout: 1500ms (נמוך מ-translation כי קצר יותר).

---

## 5. Coordination — handleNotification

ה-flow המלא ב-`agent-session.sendAudioPrompt`:

```typescript
// State per-session-call:
const messageBuffer = ""
const thoughtBuffer = ""
const currentMessageId: string | null = null
const currentThoughtId: string | null = null
const recentMessages: string[] = []  // FIFO max 3
let userMessage = ""  // set after STT
const ttsQueue: TtsJob[] = []
let ttsActive = false
let isCancelled = false

type TtsJob =
  | { kind: "message", text: string, segmentId, messageId }
  | { kind: "thought", text: string, segmentId, messageId }
  | { kind: "narration", text: string, toolCallId, segmentId, messageId }

// In handleNotification:
case agent_message_chunk:
  // If thought is mid-stream → flush it first
  if (thoughtBuffer.length > 0) await flushThought()
  
  if (!currentMessageId) currentMessageId = randomUUID()
  messageBuffer += chunk
  broadcast({ type: "text_chunk", kind: "message", text: chunk, messageId: currentMessageId })
  
  const { sentences, remaining } = splitIntoSentences(messageBuffer)
  messageBuffer = remaining
  for (const s of sentences) {
    const segmentId = randomUUID()
    sentenceQueue.push({ kind: "message", text: s, segmentId, messageId: currentMessageId })
  }
  processQueue()

case agent_thought_chunk:
  // If message is mid-stream → flush it first
  if (messageBuffer.length > 0) await flushMessage()
  
  if (!currentThoughtId) currentThoughtId = randomUUID()
  thoughtBuffer += chunk
  broadcast({ type: "text_chunk", kind: "thought", text: chunk, messageId: currentThoughtId })
  
  const { sentences, remaining } = splitIntoSentences(thoughtBuffer)
  thoughtBuffer = remaining
  for (const s of sentences) {
    const segmentId = randomUUID()
    sentenceQueue.push({ kind: "thought", text: s, segmentId, messageId: currentThoughtId })
  }
  processQueue()

case tool_call (status=pending):
  // Flush both buffers
  await flushMessage()
  await flushThought()
  
  const ctxSnapshot = {
    userMessage,
    recentMessages: [...recentMessages],
  }
  
  // Snapshot before any update changes context
  sentenceQueue.push({
    kind: "narration",
    text: "",  // resolved in processQueue via narrateToolCall
    toolCallId: update.toolCallId,
    ctx: ctxSnapshot,
    tool: { toolCallId, kind: update.kind, title: update.title },
    segmentId: randomUUID(),
    messageId: randomUUID(),
  })
  
  broadcast({ type: "tool_call", ..., narration: null })  // narration appended later
  
  processQueue()

// End of prompt:
await flushMessage()
await flushThought()
await waitForQueueDrain()

// PROMPT-17: provider error check
if (totalMessageChars === 0 && response.stopReason === "end_turn") {
  const stderr = getStderr()
  const err = extractProviderError(stderr)
  if (err) {
    broadcast({ type: "error", code: "PROVIDER_ERROR", message: err })
  }
}

broadcast({ type: "done", stopReason: response.stopReason })
```

### flushMessage/flushThought

```typescript
async function flushMessage() {
  if (messageBuffer.trim().length === 0) return
  const segmentId = randomUUID()
  sentenceQueue.push({
    kind: "message",
    text: messageBuffer.trim(),
    segmentId,
    messageId: currentMessageId!,
  })
  
  // For FIFO max 3 context (used by narrateToolCall):
  recentMessages.push(messageBuffer.trim())
  if (recentMessages.length > 3) recentMessages.shift()
  
  messageBuffer = ""
  currentMessageId = null  // next message starts a new id
  await processQueue()
}

async function flushThought() { /* mirror */ }
```

### processQueue (Updated)

```typescript
async function processQueue() {
  if (ttsActive) return
  ttsActive = true
  while (sentenceQueue.length > 0 && !isCancelled) {
    const job = sentenceQueue.shift()!
    
    let textToSpeak: string
    if (job.kind === "narration") {
      const nr = await narrateToolCall(job.ctx, job.tool, registries, narrationCache)
      if (nr.isErr()) { callbacks.onError(nr.error); continue }
      textToSpeak = nr.value
      broadcast({
        type: "tool_call_update",
        toolCallId: job.toolCallId,
        narration: textToSpeak,
      })
    } else {
      // message or thought — translate
      const tr = await translateText(job.text, config, { translator: registries.translator },
                                       translationCache)
      if (tr.isErr()) { callbacks.onError(tr.error); continue }
      textToSpeak = tr.value
    }
    
    if (isCancelled) break  // check before TTS
    
    const ttsRes = await speakSentence(textToSpeak, config, { tts: registries.tts },
                                         ttsCache, (mp3Base64) => {
      broadcast({
        type: "audio_chunk",
        mp3Base64,
        segmentId: job.segmentId,
        messageId: job.messageId,
        kind: job.kind,
        originalText: job.text,
        translatedText: textToSpeak,
      })
    })
    if (ttsRes.isErr()) callbacks.onError(ttsRes.error)
  }
  ttsActive = false
}
```

---

## 6. WS Protocol Changes

### Existing → After Tier 1

```typescript
// text_chunk:
{ type: "text_chunk", kind: "message"|"thought", text, messageId: string }
// + messageId (NEW)

// tool_call:
{ type: "tool_call", toolCallId, title, kind?, status?, ..., narration?: string }
// + narration (NEW, אופציונלי, מגיע ב-tool_call_update אחרי narrateToolCall)

// audio_chunk:
{
  type: "audio_chunk",
  mp3Base64: string,
  segmentId: string,        // NEW
  messageId: string,        // NEW (parent message/thought ID)
  kind: "message"|"thought"|"narration",  // NEW (default "message")
  originalText: string,     // NEW (source text in English)
  translatedText: string,   // NEW (Hebrew, post-translation)
}

// New events:
{ type: "tool_call_update", toolCallId, narration: string }  // NEW
```

ה-schemas ב-`packages/core/src/protocol/messages.ts` יורחבו עם ArkType.

---

## 7. Provider Error Integration

### Wiring

ב-`agent-orchestrator.spawn`, אחרי שe-bridge נוצר:

```typescript
const session = createAgentSession({
  agentId,
  transport,
  getStderr: () => bridgeManager.getStderr(agentId),  // NEW
})
```

### Check ב-sendPrompt + sendAudioPrompt

אחרי `transport.prompt(...)` חוזר, לפני broadcast `done`:

```typescript
if (response.stopReason === "end_turn" && totalMessageChars === 0) {
  const stderr = getStderr()
  const providerErr = extractProviderError(stderr)
  if (providerErr) {
    broadcast({
      type: "error",
      code: "PROVIDER_ERROR",
      message: `שגיאת provider: ${providerErr}`,
    })
  }
}
```

ה-`extractProviderError` קיים ב-`@drive-coding/core/acp/provider-error`.

---

## 8. TDD Order

### Phase 1 — Cache (RED→GREEN)
1. `cache.ts` factory + 8 tests (encode/decode, namespace separation, set/get roundtrip, missing key, idempotent init, concurrent writes)
2. Migration: `cache-disk.ts` הקיים → wrapper דק על `createDiskCache<Uint8Array>`

### Phase 2 — Narration (RED→GREEN)
3. `narration.ts:buildNarratePrompt` + 6 tests (port מ-v1)
4. `narration.ts:narrateToolCall` + 8 tests (cache hit, miss, timeout fallback, error path)

### Phase 3 — Translation cache integration
5. `pipeline.ts:translateText` — קבל `cache` parameter + 4 tests (hit/miss/error/cache key generation)

### Phase 4 — Coordination (RED→GREEN)
6. `agent-session.ts` — thoughtBuffer + flushThought + 6 tests
7. `agent-session.ts` — message↔thought↔tool_call coordination (PROMPT-11/12) + 8 tests
8. `agent-session.ts` — narration queue integration + 6 tests
9. `agent-session.ts` — message/thought/segment ID tracking + 5 tests

### Phase 5 — Provider Error
10. `agent-orchestrator.ts` — getStderr injection + 3 tests
11. `agent-session.ts` — runtime provider error check + 4 tests

### Phase 6 — WS protocol
12. `protocol/messages.ts` — extended schemas + ArkType tests
13. End-to-end test: full audio prompt with thought→message→tool_call → assert all WS events have correct IDs

---

## 9. DoD Checklist

- [ ] כל test עובר ירוק
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] coordination נכון: thought אחרי message flushes message; tool_call flushes both
- [ ] narration מופיע ב-tool_call_update עם cache hit אחרי second invocation
- [ ] translation cache hit על אותו טקסט פעם שנייה
- [ ] message+thought+segment IDs מועברים בכל audio_chunk
- [ ] cancel באמצע queue → אין segments נוספים נוצרים (isCancelled flag)
- [ ] provider error מופיע כ-WS error event כשהמודל מחזיר 0 chars + stderr contains credit/rate
- [ ] WS schemas ב-protocol/messages.ts עם ArkType validation
- [ ] cache ב-disk נוצר ב-`.cache/{namespace}/`
- [ ] עדכון `docs/behaviors-coverage.md`: PROMPT-2, PROMPT-7, PROMPT-10, PROMPT-11, PROMPT-12, PROMPT-13, PROMPT-17 → ✅
- [ ] עדכון `docs/walkthrough.md` עם סיכום

---

## 10. הערה לעתיד (לא ב-Tier 1)

**צלילים אמיתיים במקום oscillators:**
היום ב-frontend (Slice 7) ה-audio cues הם oscillator-generated (sine, triangle).
אבי רוצה להחליף ב-MP3/OGG אמיתיים בעתיד. מאגרים אפשריים:
- [Pixabay Sound Effects](https://pixabay.com/sound-effects/) — free, attribution-free
- [Mixkit](https://mixkit.co/free-sound-effects/) — free for commercial
- [Freesound.org](https://freesound.org/) — Creative Commons
- צלילים שצריך: recording_start, recording_stop, thinking, tool_call_starting, error
- מיקום: `frontend/static/sounds/*.mp3` עם preload

זה לא ב-Tier 1, רק רשום ל-future-features.

---

## 11. Prompt לסוכן

```
אתה סוכן TDD שמיישם Tier 1 של voice pipeline ב-drive-coding.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- v1 reference: /home/user/projects/voice-acp/backend/src/
  בעיקר: gemini-helper.ts, prompt-handler.ts, conn-state.ts, server.ts

מקור אמת: docs/tier-1-voice-pipeline-brief.md
סקאן זה לפני שאתה עובד — הוא מלא בפרטים: מבנה קוד, חתימות,
DoD checklist, TDD order, WS protocol changes.

עבודה:
1. קרא את ה-brief מקצה לקצה.
2. קרא את הקוד הקיים: packages/backend/src/app/agent-session.ts,
   packages/backend/src/voice/pipeline.ts, packages/backend/src/voice/cache-disk.ts.
3. קרא את v1 reference: gemini-helper.ts, prompt-handler.ts.
4. בצע לפי Phase 1→6 בסדר. TDD חובה: test → red → impl → green.
5. commit פר Phase. פורמט:
   "feat(voice): Phase X — <שם> — Y tests"
   או:
   "refactor(cache): generic factory + namespaced disk cache"
6. אל תכלול frontend changes — רק backend + protocol/messages.ts.

pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך:
- packages/frontend/src/**
- packages/core/src/** למעט: protocol/messages.ts, cache/types.ts
- docs/reviews/**, docs/archive/**

מותר:
- packages/backend/src/**, packages/backend/tests/**
- packages/core/src/protocol/messages.ts
- packages/core/src/cache/types.ts (חדש)
- docs/behaviors-coverage.md (עדכון סטטוסים)
- docs/walkthrough.md (entry חדש)

באג audio_chunk: סוכן קודם חוקר. אם מצא root cause והוא קשור
ל-coordination/buffers שאתה מטפל בהם — ראה את הדוח ב-/tmp/.
```

---

## 12. סיכום הצפוי

- 12-13 commits
- כ-60-80 tests חדשים
- כ-300-500 שורות impl חדשות ב-backend
- 7 behaviors מ-v1 משוחזרים (PROMPT-2, 7, 10, 11, 12, 13, 17)
- תשתית מלאה ל-Tier 1.b (playlist navigation) בעתיד

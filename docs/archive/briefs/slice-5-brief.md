# Slice 5 — Implementation Brief

> **מטרה:** voice round-trip מלא — לחץ-דבר, STT (Gemini), שלח ל-ACP, קבל תשובה streaming, תרגם ל-עברית (אם צריך), סינתז ב-ElevenLabs v3, השמע ב-frontend. כל ה-pipeline עובר דרך Vercel AI SDK (D38 + D39).
> **תלות:** Slice 4 (✅ commit `2c5db20`).
> **המתחיל:** Yolo executor (Sonnet 4-6).

---

## 1. החלטות שננעלו ל-Slice 5

| נושא | בחירה | מקור |
|------|--------|------|
| **Provider abstraction** | Vercel AI SDK — `experimental_transcribe`, `experimental_speech`, `generateText` | D38 |
| **STT default** | Custom Gemini transcription provider (~80 שורות) — תומך `previousAssistantText` context | D39 |
| **TTS default** | ElevenLabs `eleven_v3` (הקול היחיד שתומך עברית כראוי) | learning 2026-05-13 |
| **Translator** | `gemini-flash-latest` דרך `@ai-sdk/google` (יורש מה-POC) | D38 |
| **Audio input** | MediaRecorder ב-frontend, encoding `audio/webm;codecs=opus` (default). שולחים base64 ב-WS | spec §3 |
| **Audio output** | base64 mp3 chunks ב-WS, frontend מנגן עם `new Audio()` | spec §3 |
| **OneCLI runtime** | `onecli run --agent voice-acp -- bun ...` — הזרקת `xi-api-key` ל-elevenlabs.io ו-`x-goog-api-key` ל-generativelanguage.googleapis.com | learning 2026-05-14 |
| **NO_PROXY חובה** | `export NO_PROXY=localhost,127.0.0.1,::1; export no_proxy=$NO_PROXY` לפני `onecli run` — אחרת קריאות ל-localhost עוברות proxy ונכשלות | learning 2026-05-14 |
| **Cache** | per-text+voice+model→mp3 ב-`data/cache/tts/`. ל-Slice 5 — minimal (כל קריאה נכנסת לדיסק; אין eviction) | D8 |
| **Sentence boundary** | port מ-POC `backend/src/sentence-boundary.ts` — `core/voice/sentence-boundary.ts` (pure) | D47 |
| **Translation criteria** | המודל עונה רק עברית (לפי ה-system prompt). אם תשובה לא עברית — תרגום. ל-Slice 5: **תרגום תמיד** כל text_chunk חזרה לעברית — Gemini Flash. עתידי: detect language. | החלטה |
| **Voice flow** | user מחזיק לחץ → MediaRecorder → release → blob → base64 → ws → STT → ACP prompt → text_chunks → group ל-משפטים (sentence-boundary) → translator → TTS → audio_chunks ל-FE | spec §3 |
| **Cancel** | בלחיצה חוזרת או mid-recording — WS `cancel` → backend מבטל ACP prompt + מפסיק TTS streaming | D19 |

**במפורש לא כלול:**
- VAD (auto-stop on silence) — Slice 7
- Audio cues (5 sounds) — Slice 7 (D42)
- Drive-first UX (big button animations, state machine UI) — Slice 7
- Provider catalog UI — Slice 8 (D36)
- per-agent provider override — Slice 8 [future] (D43)
- Whisper local, Piper local — [future] (מתווסף בקלות דרך AI SDK)
- Speaker diarization, emotion detection, music background

---

## 2. מה נוסף

### 2.1 Core schemas

**עדכון** `packages/core/src/schemas/ws-messages.ts`:

ל-`ClientMessage` הוסף:
- `audio` — `{ type: "audio", agentId: string, audioBase64: string, mimeType: string }` (החלפת ה-`prompt` text-only עבור voice flow; את ה-`prompt` הטקסטואלי משאירים גם — debug או keyboard fallback)

ל-`ServerMessage` הוסף:
- `stt_partial` — `{ type: "stt_partial", text: string }` (מה ה-STT הבין; UI מציג להמתנה)
- `audio_chunk` — `{ type: "audio_chunk", mp3Base64: string }` (TTS streaming)
- `translation` — `{ type: "translation", original: string, translated: string }` (אופציונלי, debug)

### 2.2 Core voice (pure logic)

**חדש** `packages/core/src/voice/`:
- `sentence-boundary.ts` — port מה-POC. פונקציה `splitIntoSentences(buffer: string): { sentences: string[], remaining: string }`. עברית + אנגלית. סופי משפט: `.`, `!`, `?`, `:`, `,` (כן — פסיק לעברית נחשב לוקיישן טוב ל-TTS chunking).
- `cache-key.ts` — `cacheKeyFor(text: string, voiceId: string, modelId: string): string` — sha256(text + voice + model).hex
- `translation-prompt.ts` — `buildTranslationPrompt(text: string, targetLang: "he" | "en"): string` (משתמש ב-POC prompt).

**Tests חובה** ב-`packages/core/tests/voice/`:
- `sentence-boundary.test.ts` — port מ-`backend/test/sentence-boundary.test.ts` ב-POC (~30 cases). עברית: "שלום עולם. מה שלומך?" → 2 משפטים. אנגלית: "Hi there. How are you?" → 2. mixed. שאלות. רק חצי משפט → 0+remaining.
- `cache-key.test.ts` — deterministic, שונה למשתני voice/model.

### 2.3 Core ports

**עדכון** `packages/core/src/ports.ts`:
- `SttPort` — `transcribe(audioBytes: Uint8Array, mimeType: string, options?: { previousAssistantText?: string }): Promise<Result<{ text: string }, VoiceError>>`
- `TtsPort` — `synthesize(text: string, voiceId: string): Promise<Result<{ mp3Bytes: Uint8Array }, VoiceError>>`
- `TranslatorPort` — `translate(text: string, targetLang: "he" | "en"): Promise<Result<{ text: string }, VoiceError>>`
- `CacheStore` — `get(key: string): Promise<Uint8Array | null>`, `set(key: string, value: Uint8Array): Promise<void>` (disk implementation ב-backend)

### 2.4 Backend voice

**חדש** `packages/backend/src/voice/`:

- `providers.ts` — STT/TTS/translator registries:
  ```ts
  import { elevenlabs } from '@ai-sdk/elevenlabs'
  import { google } from '@ai-sdk/google'
  import { geminiTranscription } from './providers/gemini-transcription'

  export const STT_REGISTRY = {
    'gemini/flash-context': geminiTranscription('gemini-flash-latest'),
  }
  export const TTS_REGISTRY = {
    'elevenlabs/v3': elevenlabs.speech('eleven_v3'),
  }
  export const TRANSLATOR_REGISTRY = {
    'gemini/flash-lite': google('gemini-flash-lite-latest'),
  }
  // הרחבות נוספות ב-Slice 8
  ```

- `providers/gemini-transcription.ts` — custom AI SDK provider (D39). מיישם `TranscriptionModelV3`. ~80 שורות. תומך ב-`providerOptions.gemini.previousAssistantText` (משתמש ב-POC).
- `pipeline.ts` — orchestration:
  ```ts
  export interface VoiceDeps {
    stt: SttPort
    tts: TtsPort
    translator: TranslatorPort
    cache: CacheStore
    acpSession: AgentSession  // מ-Slice 4
  }
  export async function voiceRoundtrip(
    input: { audioBytes: Uint8Array, mimeType: string },
    deps: VoiceDeps,
    settings: VoiceSettings,
    callbacks: { onSttPartial, onTranslation, onAudioChunk, onError, onDone }
  ): Promise<void>
  ```
- `cache-disk.ts` — `CacheStore` implementation. `data/cache/tts/{sha256}.mp3`.
- `tts-stream.ts` — wrapper סביב `experimental_speech` שמחזיר stream של chunks (אם הספק תומך) או chunk יחיד.

### 2.5 Backend app

**עדכון** `packages/backend/src/app/agent-session.ts`:
- הוסף method: `async sendAudioPrompt(audioBytes, mimeType, voiceCallbacks)` — מפעיל voice pipeline ומקשר ל-ACP transport.
- ה-text_chunks שמגיעים מ-ACP נחתכים למשפטים → tirgum + TTS לכל אחד.

### 2.6 Backend delivery

**עדכון** `packages/backend/src/delivery/ws-agent.ts`:
- טפל ב-`type: "audio"` הודעה — base64 decode + `agentSession.sendAudioPrompt`.

### 2.7 Frontend

**עדכון** `packages/frontend/src/routes/agent/[id]/+page.svelte`:
- כפתור "לחץ והחזק לדבר" (push-to-talk).
  - `pointerdown` → MediaRecorder.start()
  - `pointerup` → MediaRecorder.stop() → ondataavailable → blob → base64 → WS `audio` message
- `<audio>` element או `new Audio()` per chunk. queue של mp3 chunks; משמיע ברצף.
- UI feedback: "מקליט", "מתמלל" (stt_partial), "המודל חושב" (thinking), "מנגן" (audio playing).

**חדש** `packages/frontend/src/lib/audio/`:
- `recorder.ts` — wraps MediaRecorder. מחזיר `{ start(), stop(): Promise<Blob> }`.
- `player.ts` — queue של mp3 chunks. ניגון רציף.

**חדש** `packages/frontend/src/lib/stores/voice-session.svelte.ts`:
- state: `recording`, `transcribing`, `thinking`, `speaking`, `idle`.
- מתאם בין recorder, WS, player.

---

## 3. תבניות קוד מדויקות

### 3.1 `packages/core/src/voice/sentence-boundary.ts`

```ts
const SENTENCE_END_RE = /([.!?:,])\s+/g

export function splitIntoSentences(buffer: string): {
  sentences: string[]
  remaining: string
} {
  const sentences: string[] = []
  let lastIdx = 0
  let match: RegExpExecArray | null

  // reset regex state
  SENTENCE_END_RE.lastIndex = 0

  while ((match = SENTENCE_END_RE.exec(buffer)) !== null) {
    const endIdx = match.index + match[0].length
    const sentence = buffer.slice(lastIdx, endIdx).trim()
    if (sentence.length > 0) sentences.push(sentence)
    lastIdx = endIdx
  }

  return { sentences, remaining: buffer.slice(lastIdx) }
}
```

מקור: POC `backend/src/sentence-boundary.ts` — port כמעט מילולי. רק שינוי: מחזיר אובייקט במקום tuple, לבהירות.

### 3.2 `packages/core/src/voice/cache-key.ts`

```ts
export async function cacheKeyFor(
  text: string,
  voiceId: string,
  modelId: string,
): Promise<string> {
  const input = `${modelId}|${voiceId}|${text}`
  const buf = new TextEncoder().encode(input)
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}
```

### 3.3 `packages/core/src/voice/translation-prompt.ts`

```ts
export function buildTranslationPrompt(
  text: string,
  targetLang: 'he' | 'en',
): string {
  if (targetLang === 'he') {
    return `תרגם את הטקסט הבא לעברית טבעית ושוטפת, ללא הסברים. אם הטקסט כבר בעברית — החזר אותו כמו שהוא.\n\nטקסט:\n${text}`
  }
  return `Translate to natural fluent English, no explanations. If already English, return as-is.\n\nText:\n${text}`
}
```

### 3.4 `packages/backend/src/voice/providers/gemini-transcription.ts`

(skeleton — Yolo ימלא לפי ה-D39 ובדיקה ב-`@ai-sdk/provider` types)

```ts
import type { TranscriptionModelV3 } from '@ai-sdk/provider'
import { GoogleGenAI } from '@google/genai'

export function geminiTranscription(modelId: string): TranscriptionModelV3 {
  return {
    specificationVersion: 'v3',
    provider: 'gemini-transcription',
    modelId,
    async doGenerate(options) {
      const ai = new GoogleGenAI({})
      const prevText = options.providerOptions?.gemini?.previousAssistantText as string | undefined

      const prompt = prevText
        ? `Transcribe the user's audio. Context: the previous assistant said:\n"${prevText}"\n\nTranscribe ONLY the user's audio, in the language spoken.`
        : "Transcribe the audio. Output ONLY the spoken words, no commentary."

      const response = await ai.models.generateContent({
        model: modelId,
        contents: [
          { role: 'user', parts: [
            { text: prompt },
            { inlineData: { mimeType: options.mediaType, data: Buffer.from(options.audio).toString('base64') } }
          ]}
        ]
      })

      const text = response.text ?? ''
      return {
        text,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId, headers: undefined }
      }
    }
  }
}
```

**הערה:** Yolo — אם ה-API של `@ai-sdk/provider` v3 שונה ממה שאני מתאר, התאם. הסתמך על types הקיימים. אם חסר type — `as any` זמני + הערה `// TODO: check provider-v3 spec`. עבור MVP זה מקובל.

### 3.5 `packages/backend/src/voice/pipeline.ts` (orchestration)

```ts
import { experimental_transcribe as transcribe, experimental_speech as speech, generateText } from 'ai'
import { splitIntoSentences } from '@drive-coding/core/voice/sentence-boundary'
import { buildTranslationPrompt } from '@drive-coding/core/voice/translation-prompt'
import { cacheKeyFor } from '@drive-coding/core/voice/cache-key'
import type { Result } from 'neverthrow'
import { ok, err } from 'neverthrow'

export interface VoiceCallbacks {
  onSttPartial: (text: string) => void
  onAudioChunk: (mp3Base64: string) => void
  onTranslation?: (original: string, translated: string) => void
  onError: (msg: string) => void
}

export interface VoiceConfig {
  sttModel: string       // key ב-STT_REGISTRY
  ttsModel: string       // key ב-TTS_REGISTRY
  ttsVoiceId: string
  translatorModel: string
  targetLang: 'he' | 'en'
  previousAssistantText?: string  // לcontext STT
}

export async function transcribeUserAudio(
  audio: { bytes: Uint8Array, mimeType: string },
  config: VoiceConfig,
  registries: { stt: typeof import('./providers').STT_REGISTRY },
): Promise<Result<string, string>> {
  const model = registries.stt[config.sttModel]
  if (!model) return err(`Unknown STT model: ${config.sttModel}`)

  try {
    const result = await transcribe({
      model,
      audio: audio.bytes,
      providerOptions: config.previousAssistantText
        ? { gemini: { previousAssistantText: config.previousAssistantText } }
        : undefined,
    })
    return ok(result.text)
  } catch (e: any) {
    return err(`STT failed: ${e.message || e}`)
  }
}

export async function speakSentence(
  text: string,
  config: VoiceConfig,
  registries: { tts: typeof import('./providers').TTS_REGISTRY },
  cache: { get: (k: string) => Promise<Uint8Array | null>, set: (k: string, v: Uint8Array) => Promise<void> },
  onChunk: (mp3Base64: string) => void,
): Promise<Result<void, string>> {
  const model = registries.tts[config.ttsModel]
  if (!model) return err(`Unknown TTS model: ${config.ttsModel}`)

  const key = await cacheKeyFor(text, config.ttsVoiceId, config.ttsModel)
  const cached = await cache.get(key)
  if (cached) {
    onChunk(Buffer.from(cached).toString('base64'))
    return ok(undefined)
  }

  try {
    const result = await speech({
      model,
      text,
      voice: config.ttsVoiceId,
    })
    await cache.set(key, new Uint8Array(result.audio.uint8Array))
    onChunk(Buffer.from(result.audio.uint8Array).toString('base64'))
    return ok(undefined)
  } catch (e: any) {
    return err(`TTS failed: ${e.message || e}`)
  }
}

export async function translateText(
  text: string,
  config: VoiceConfig,
  registries: { translator: typeof import('./providers').TRANSLATOR_REGISTRY },
): Promise<Result<string, string>> {
  // Skip translation if already in target language? Slice 5: always translate.
  const model = registries.translator[config.translatorModel]
  if (!model) return err(`Unknown translator model: ${config.translatorModel}`)

  try {
    const { text: translated } = await generateText({
      model,
      prompt: buildTranslationPrompt(text, config.targetLang),
    })
    return ok(translated.trim())
  } catch (e: any) {
    return err(`Translation failed: ${e.message || e}`)
  }
}
```

ה-orchestration עצמו (קריאות STT → ACP → tirgum + TTS לכל משפט) נמצא ב-`agent-session.ts`.

### 3.6 `packages/backend/src/voice/cache-disk.ts`

```ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export class DiskCache {
  constructor(private dir: string) {}

  async init() {
    await fs.mkdir(this.dir, { recursive: true })
  }

  async get(key: string): Promise<Uint8Array | null> {
    const file = path.join(this.dir, `${key}.mp3`)
    try {
      const buf = await fs.readFile(file)
      return new Uint8Array(buf)
    } catch {
      return null
    }
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const file = path.join(this.dir, `${key}.mp3`)
    await fs.writeFile(file, value)
  }
}
```

### 3.7 `packages/backend/src/app/agent-session.ts` (הוספה)

```ts
async sendAudioPrompt(
  audioBytes: Uint8Array,
  mimeType: string,
  voiceConfig: VoiceConfig,
  callbacks: VoiceCallbacks,
): Promise<void> {
  // 1. STT
  const sttRes = await transcribeUserAudio({ bytes: audioBytes, mimeType }, voiceConfig, this.registries)
  if (sttRes.isErr()) {
    callbacks.onError(sttRes.error)
    return
  }
  const userText = sttRes.value
  callbacks.onSttPartial(userText)

  // 2. Send to ACP — accumulate text_chunks
  let buffer = ''
  let lastAssistantText = ''
  const sentenceQueue: string[] = []
  let ttsActive = false

  const processQueue = async () => {
    if (ttsActive) return
    ttsActive = true
    while (sentenceQueue.length > 0) {
      const sentence = sentenceQueue.shift()!
      // Translate
      const trRes = await translateText(sentence, voiceConfig, this.registries)
      if (trRes.isErr()) { callbacks.onError(trRes.error); continue }
      callbacks.onTranslation?.(sentence, trRes.value)
      // TTS
      const ttsRes = await speakSentence(
        trRes.value, voiceConfig, this.registries, this.cache,
        callbacks.onAudioChunk,
      )
      if (ttsRes.isErr()) callbacks.onError(ttsRes.error)
      lastAssistantText += trRes.value + ' '
    }
    ttsActive = false
  }

  await this.acpTransport.prompt(userText, (chunk) => {
    if (chunk.kind === 'agent_message_chunk' && chunk.content.type === 'text') {
      buffer += chunk.content.text
      const { sentences, remaining } = splitIntoSentences(buffer)
      buffer = remaining
      sentenceQueue.push(...sentences)
      processQueue()
    }
  })

  // flush trailing buffer
  if (buffer.trim().length > 0) {
    sentenceQueue.push(buffer.trim())
    buffer = ''
    await processQueue()
  }

  // remember for next STT context
  this.lastAssistantText = lastAssistantText.trim()
}
```

**הערה:** ה-skeleton הזה לא מטפל ב-cancel באמצע. תוסיף `AbortController` שמחובר ל-WS `cancel` הודעה.

### 3.8 `packages/backend/src/delivery/ws-agent.ts` (הוספה)

```ts
case 'audio': {
  const audioBytes = Buffer.from(msg.audioBase64, 'base64')
  await session.sendAudioPrompt(
    new Uint8Array(audioBytes),
    msg.mimeType,
    /* voiceConfig from settings — Slice 5 hardcoded defaults */,
    {
      onSttPartial: (text) => send({ type: 'stt_partial', text }),
      onAudioChunk: (mp3Base64) => send({ type: 'audio_chunk', mp3Base64 }),
      onTranslation: (original, translated) => send({ type: 'translation', original, translated }),
      onError: (msg) => send({ type: 'error', message: msg }),
    }
  )
  send({ type: 'done' })
  break
}
```

### 3.9 Frontend — `packages/frontend/src/lib/audio/recorder.ts`

```ts
export class Recorder {
  private mr: MediaRecorder | null = null
  private chunks: Blob[] = []

  async start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    this.chunks = []
    this.mr.ondataavailable = (e) => this.chunks.push(e.data)
    this.mr.start()
  }

  stop(): Promise<{ blob: Blob, mimeType: string }> {
    return new Promise((resolve) => {
      if (!this.mr) return resolve({ blob: new Blob(), mimeType: '' })
      this.mr.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' })
        this.mr?.stream.getTracks().forEach(t => t.stop())
        resolve({ blob, mimeType: 'audio/webm' })
      }
      this.mr.stop()
    })
  }
}
```

### 3.10 Frontend — `packages/frontend/src/lib/audio/player.ts`

```ts
export class AudioQueue {
  private queue: HTMLAudioElement[] = []
  private playing = false

  enqueue(mp3Base64: string) {
    const audio = new Audio(`data:audio/mp3;base64,${mp3Base64}`)
    audio.addEventListener('ended', () => {
      this.playing = false
      this.tick()
    })
    this.queue.push(audio)
    this.tick()
  }

  private tick() {
    if (this.playing) return
    const next = this.queue.shift()
    if (!next) return
    this.playing = true
    next.play().catch((e) => {
      console.error('audio play failed', e)
      this.playing = false
      this.tick()
    })
  }

  clear() {
    this.queue = []
    this.playing = false
  }
}
```

### 3.11 Frontend — `packages/frontend/src/routes/agent/[id]/+page.svelte` (הוספה לכפתור)

```svelte
<script lang="ts">
  import { Recorder } from '$lib/audio/recorder'
  import { AudioQueue } from '$lib/audio/player'

  let recording = $state(false)
  let recorder = new Recorder()
  let player = new AudioQueue()

  async function startRec() {
    recording = true
    await recorder.start()
  }

  async function stopRec() {
    recording = false
    const { blob, mimeType } = await recorder.stop()
    const arrayBuf = await blob.arrayBuffer()
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)))
    ws.send(JSON.stringify({ type: 'audio', agentId, audioBase64: base64, mimeType }))
  }

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'audio_chunk') player.enqueue(msg.mp3Base64)
    // ... handle other types
  }
</script>

<button
  onpointerdown={startRec}
  onpointerup={stopRec}
  class:recording
>
  {recording ? 'מקליט...' : 'לחץ והחזק לדבר'}
</button>
```

---

## 4. Step-by-step

1. **Core voice utilities (TDD)**
   - כתוב `packages/core/tests/voice/sentence-boundary.test.ts` עם ~20 cases (port מה-POC). הרץ → red.
   - מימוש `packages/core/src/voice/sentence-boundary.ts`. הרץ → green.
   - כנ"ל ל-`cache-key.ts` ול-`translation-prompt.ts` (תרגום פשוט יותר — 2-3 cases).
   - `pnpm test` — צריך לעבור.

2. **Core ports**
   - הוסף `SttPort`, `TtsPort`, `TranslatorPort`, `CacheStore` ל-`packages/core/src/ports.ts`.
   - הוסף את ה-schemas החדשים ל-`ws-messages.ts`.
   - `pnpm typecheck`.

3. **Backend deps**
   - `cd packages/backend && pnpm add ai @ai-sdk/elevenlabs @ai-sdk/google @ai-sdk/provider @google/genai`
   - `pnpm install` (root).

4. **Backend voice providers**
   - `providers/gemini-transcription.ts` (custom AI SDK provider).
   - `providers.ts` (registries).
   - `cache-disk.ts`.

5. **Backend pipeline**
   - `pipeline.ts` — 3 פונקציות: `transcribeUserAudio`, `speakSentence`, `translateText`. כולן Result-returning.
   - Tests ב-`packages/backend/tests/voice-pipeline.test.ts` — mock-ים את ה-AI SDK functions, בודקים flow + error handling.

6. **Backend integration**
   - הוסף `sendAudioPrompt` ל-`agent-session.ts`.
   - הוסף type מ-`audio` ל-`ws-agent.ts`.
   - Tests ב-`packages/backend/tests/agent-session.test.ts` (הרחבה) — mock voice pipeline + ACP, בדוק שהשרשור עובד.

7. **Frontend**
   - `lib/audio/recorder.ts` + `player.ts`.
   - `lib/stores/voice-session.svelte.ts` — מנהל state machine.
   - עדכן `+page.svelte` עם push-to-talk button.

8. **Typecheck + lint + tests**
   - `pnpm typecheck` חייב לעבור.
   - `pnpm lint` חייב לעבור.
   - `pnpm test` — צריך 100+ tests (היה 93; יעד +10 לפחות).

9. **Smoke E2E**
   - **הרץ עם:** `export NO_PROXY=localhost,127.0.0.1,::1; export no_proxy=$NO_PROXY; onecli run --agent voice-acp -- pnpm --filter @drive-coding/backend dev`
   - הרץ frontend: `onecli run --agent voice-acp -- pnpm --filter @drive-coding/frontend dev` (frontend לא צריך את ה-keys, אבל ה-NO_PROXY חשוב לpe הdev server).
   - נסה manual: יצור agent (`opencode`, cwd `/tmp/test-cwd`), פתח `/agent/:id`, לחץ-דבר משפט קצר בעברית כמו "מה השם שלך?".
   - **DoD smoke:**
     - STT מתמלל נכון
     - ה-ACP מחזיר response
     - audio_chunk[s] מגיעים ל-frontend
     - השמע מנוגן

10. **Update walkthrough + commit**
    - הוסף entry חדש בראש `docs/walkthrough.md` עם DoD breakdown.
    - קמט: `git commit -m "(slice-5): voice pipeline — STT (Gemini) + TTS (ElevenLabs v3) + translator (Gemini Flash) דרך AI SDK\n\n..."`

---

## 5. Definition of Done

1. ✅ `packages/core/src/voice/{sentence-boundary,cache-key,translation-prompt}.ts` קיימים, pure, נבדקו
2. ✅ Core voice tests עוברים (>= 20 cases ל-sentence-boundary, 3 ל-cache-key, 2 ל-translation-prompt)
3. ✅ Core ports: `SttPort`, `TtsPort`, `TranslatorPort`, `CacheStore` מוגדרים
4. ✅ WS schemas: `audio` ClientMessage, `stt_partial` + `audio_chunk` + `translation` ServerMessage
5. ✅ Backend dependencies מותקנים (`ai`, `@ai-sdk/elevenlabs`, `@ai-sdk/google`, `@ai-sdk/provider`, `@google/genai`)
6. ✅ `gemini-transcription.ts` — custom AI SDK provider מיושם (TranscriptionModelV3 compliant)
7. ✅ `providers.ts` עם 3 registries (1 STT, 1 TTS, 1 translator — ה-defaults של D38)
8. ✅ `pipeline.ts` — 3 פונקציות (transcribeUserAudio, speakSentence, translateText), Result-returning
9. ✅ `cache-disk.ts` — DiskCache עובד
10. ✅ `agent-session.ts.sendAudioPrompt` — flow מלא: STT → ACP → sentence batching → translation → TTS
11. ✅ `ws-agent.ts` מטפל ב-`type: "audio"` הודעה
12. ✅ Frontend: Recorder + AudioQueue + push-to-talk button
13. ✅ typecheck + lint נקיים
14. ✅ tests >= 100 (היה 93; +7 לפחות חדשים)
15. ✅ Smoke E2E: voice round-trip מלא עבד פעם אחת עם opencode חי

---

## 6. Slice 5 לא כולל

- VAD (auto-stop on silence)
- Audio cues (D42)
- Drive-first UX (state machine UI animations, big button design)
- Provider catalog UI
- per-agent settings
- Tests של provider error handling מעבר ל-happy path (Slice 6/Slice 9)
- Reconnect (Slice 6)
- Multi-session ניהול (Slice 6)
- i18n של UI strings (Slice 9)

---

## 7. דיווח לסיום

ב-walkthrough entry:
- מה נוסף (קבצים + LOC)
- מספרי tests (לפני/אחרי)
- DoD breakdown 1-15
- smoke E2E result — האם הצליח? אם לא, איפה נתקעתי
- הערות חשובות (gotchas, decisions במהלך)

---

## 8. הוראה ל-Yolo

אתה ה-executor. עבוד מ-`docs/slice-5-brief.md` (קובץ זה — מסומן ב-worktree `voice-acp-v2`). הקפד על:

- **TDD מלא ב-core/voice/** — תכתוב tests ראשון, אז implementation. זה הליבה הטהורה (D46).
- **AI SDK provider — בדוק v3 spec** — אם משהו לא מתאים לסקלטון בסעיף 3.4, התאם מהקיים בקוד `node_modules/@ai-sdk/provider/dist/index.d.ts`. תקן הסקלטון לפי המציאות.
- **Smoke E2E — חובה.** בלי smoke שעבד, ה-Slice לא נסגר. ה-NO_PROXY חובה — בלעדיו תקבל "socket connection closed".
- **לקרוא את `~/.config/opencode/learnings.md`** סעיף 2026-05-13 ו-2026-05-14 — מסביר למה ElevenLabs v3 ולמה OneCLI selective agent.
- **קומיט בסוף** עם הודעה בעברית לפי תבנית `(slice-5): ...`.
- **אל תוסיף features** מעבר ל-DoD. אם פיתוי לכפתור־cues — לא. Slice 7.
- **timeline צפוי:** ~10-15 דקות for core/voice, ~30 דקות for backend voice, ~20 דקות for frontend, ~10 דקות for smoke. סה"כ ~75 דקות. אם עברת 90, עצור ודווח.

זהו. בהצלחה.

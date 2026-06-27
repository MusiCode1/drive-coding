# Slice V4a — gemini-tts-pcm-playback — תוכנית

> **תאריך**: 2026-06-27
> **סטטוס**: הושלם (אליעזר — 2026-06-27; 7 commits, calev-heavy ממתין)
> **Complexity**: 8/10 (verifier: **heavy** — calev-heavy)
> **תלות**: `depends_on: [V3]` (TtsProvider) + `[V1]` (select). **base = ענף `slice/V3-voice-tts-interface`** @ ba583f2 (שרשור V1→V3→V4a).

## §0 — Pre-flight

### Worktree
```bash
git worktree add .worktrees/V4a-gemini-tts-pcm-playback -b slice/V4a-gemini-tts-pcm-playback slice/V3-voice-tts-interface
cd .worktrees/V4a-gemini-tts-pcm-playback
pnpm install && pnpm hooks:install
```

### Run
- BE: `cd packages/backend && PORT=4001 onecli run --agent voice-acp -- bun --watch src/server.ts` (4000 תפוס; **חובה onecli** ל-`/proxy/google/*`).
- FE: `BE_PORT=4001 pnpm --filter @drive-coding/frontend-v2 dev`
- ⚠️ **שם החבילה `@drive-coding/frontend-v2`**; typecheck FE = `--filter frontend-v2 typecheck` (svelte-check); root typecheck לא כולל FE.

### Browser
- **HTTPS חובה** — WebAudio (`AudioContext`) הוא secure-context-only. Chrome על `localhost` עובד; מהוסט חיצוני → tunnel.
- **AudioContext דורש user-gesture** — voice-mode כבר מתחיל מ-gesture; ה-runtime test חייב להיכנס ל-voice-mode (לחיצת מיקרופון) לפני ציפייה לקול.

### OneCLI agent
- `voice-acp` (מזריק Google key ל-`generativelanguage.googleapis.com`).

### Reading list
> ⚠️ **ה-pre-brief + decisions + הבריף הזה הם uncommitted ב-dev ו**לא** בענף V3 (ה-base) → לא יהיו ב-worktree.**
> קרא אותם דרך **נתיבים מוחלטים** ב-dev tree (כמו שאתה קורא את הבריף עצמו):
**must-read**:
- `/home/user/projects/drive-coding/dev/docs/plans/v4-gemini-tts-pre-brief.md` — **כל ידע-הספייק המאומת** (endpoint, PCM format `audio/l16; rate=24000`, latency ~1–1.7s, verbatim, מבנה התגובה `candidates[0].content.parts[0].inlineData.data`).
- `/home/user/projects/drive-coding/dev/docs/decisions/voice-acp.md` (entries 2026-06-27: V4 + V1 + V3) — רציונל ה-seam.
- `packages/frontend/src/lib/engines/audio-stream.ts` — מודל ה-segment + ה-interface (קיים ב-worktree).
- `packages/frontend/AGENTS.md` §golden rules (קיים ב-worktree).

**reference**:
- `packages/frontend/src/lib/adapters/voice/sdks.ts` — `googleGenAi()` (SDK + proxy baseUrl).
- `packages/core/src/voice/tts-types.ts` — `TtsProvider`/`TtsRequest` (מ-V3).

## §1 — מטרה

הקראת-קול **דרך Gemini-TTS** (streaming PCM → WebAudio) זמינה כספק שני מאחורי `TtsProvider` (V3),
עם נתיב-השמעה נבחר לפי פורמט (router). **רקע**: ElevenLabs מת על קרדיטים (`quota_exceeded`, אומת חי
2026-06-27). **החלטת המשתמשת (Q1): ברירת-המחדל נשארת ElevenLabs** — המשתמשת מדליקה Gemini דרך
**בורר בהגדרות** (כדי לנסות, בלי לשנות התנהגות-ברירת-מחדל). מנקודת-מבטה: כשבוחרת Gemini, הקראת
תשובות-הסוכן עובדת בקול Gemini ("Kore"), first-audio ~1–1.7s, gap-less.

## §2 — Scope: מה כן, מה לא

| פיצ'ר | כן/לא | לאן |
|---|---|---|
| `splitInt16LE` + `pcmToFloat32` טהורים ב-core (TDD) | ✅ | — |
| `geminiTts: TtsProvider` (SDK `generateContentStream` → PCM stream) | ✅ | — |
| `AudioSink` interface + `PcmAudioStream` (WebAudio scheduling) + `RoutingAudioSink` | ✅ | — |
| בחירת sink פר-segment לפי `format` (router) | ✅ | — |
| **בורר ספק-TTS מינימלי בהגדרות** (ElevenLabs default \| Gemini) + persist | ✅ | — |
| **מעבר ברירת-המחדל ל-Gemini** | ❌ (Q1=לא) | default נשאר ElevenLabs; המשתמשת מדליקה Gemini בבורר |
| **Settings-UI מלא** לבחירת voice פר-ספק / כל השירותים | ❌ | V4b (V4a = בורר ספק בינארי בלבד) |
| voice-config מלא פר-ספק (ElevenLabs voiceId מול Gemini voiceName) | ❌ | V4b (V4a מקבע Gemini voice="Kore") |
| **AudioWorklet** (ring-buffer) | ❌ | fallback אם calev רואה jank (§7) |
| `TtsChunk` type | ❌ | — (הצרכן מקבל `ReadableStream<Uint8Array>`) |
| שינוי נתיב ה-MP3/MediaSource הקיים | ❌ | נשאר שלם, ליד נתיב ה-PCM |

## §3 — Architecture diagram

```
packages/core/src/voice/
  pcm.ts            ← חדש   splitInt16LE(carry,chunk)→{samples:Int16Array,rest} · pcmToFloat32  [pure, TDD]
  tts-types.ts      ← שינוי  TtsProvider מקבל שדה `format: "mp3" | "pcm"`

packages/frontend/src/lib/
  adapters/voice/
    tts.ts          ← שינוי  elevenLabsTts.format = "mp3"
    tts-gemini.ts   ← חדש   geminiTts: TtsProvider (format:"pcm") — googleGenAi().models.generateContentStream
                             → ReadableStream<Uint8Array> של PCM (base64-decode של inlineData)
    sdks.ts         [קיים — googleGenAi() כבר מוגדר ל-proxy]
  engines/
    audio-sink.ts        ← חדש   interface AudioSink + SegmentOpts{messageId,textHash,format?} + AudioSegmentState
    audio-stream.ts      ← שינוי  class AudioStream implements AudioSink  (אפס שינוי התנהגות)
    pcm-audio-stream.ts  ← חדש   class PcmAudioStream implements AudioSink (AudioContext + BufferSource queue)
    routing-audio-sink.ts← חדש   class RoutingAudioSink implements AudioSink (מנתב פר-segment לפי format)
    player.svelte.ts     ← שינוי  #audioStream: AudioSink (היה AudioStream)
  view-models/
    settings.svelte.ts   ← שינוי  שדה ttsProvider ("elevenlabs"|"google", default elevenlabs) + setter + persist
    speaker.svelte.ts    ← שינוי  #audioStream = RoutingAudioSink(...); בוחר provider לפי settings.ttsProvider; format ל-prepareSegment
  components/settings/
    SettingsScreen.svelte    ← שינוי  <Select> בורר ספק-TTS (ליד VoicePicker — שניהם פה)
packages/core/src/i18n/
  keys.ts                  ← שינוי  3 keys ל-MessageKey union
  catalogs/{he,en}         ← שינוי  ערכים ל-3 ה-keys (lint:i18n חוסם עברית-קשיחה)
```

> D5: ה-PCM-parsing (`pcm.ts`) טהור ב-core; ה-IO (SDK fetch, AudioContext) ב-shell.
> **נתיב ה-MP3 לא נגעים בו** — `PcmAudioStream` הוא sibling, לא תחליף.

## §4 — Commits בסדר

### Commit 0 — core: PCM parsing (approach: **TDD**)
**קבצים חדשים**: `packages/core/src/voice/pcm.ts` + `pcm.test.ts`
```ts
// pcm.ts — טהור. l16 = signed 16-bit little-endian.
/** מצרף carry (בייט-עודף קודם) ל-chunk, מפענח ל-Int16Array, מחזיר rest (בייט-עודף חדש אם אורך אי-זוגי). */
export function splitInt16LE(carry: Uint8Array, chunk: Uint8Array): { samples: Int16Array; rest: Uint8Array }
/** Int16 [-32768,32767] → Float32 [-1,1). */
export function pcmToFloat32(samples: Int16Array): Float32Array
```
**Tests**: carry ריק + אורך זוגי → כל הדגימות, rest ריק · אורך אי-זוגי → דגימה אחרונה ב-rest · carry של בייט אחד + chunk → מצורף נכון (little-endian: byte0 + byte1<<8) · ערכי-קצה (−32768/32767/0) ל-float · chunk ריק → samples ריק.
**Verification**: `npx vitest run pcm` (מ-root). ⚠️ ל-`@drive-coding/core` **אין `test` script** (רק build+typecheck) — `--filter @drive-coding/core test` נכשל. הטסטים רצים דרך root vitest projects.

### Commit 1 — core: format על TtsProvider (approach: **manual**)
**שינויים**: `tts-types.ts` — הוסף `format: "mp3" | "pcm"` ל-`interface TtsProvider`. `tts.ts` — `elevenLabsTts.format = "mp3"`.
**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck`

### Commit 2 — adapter: geminiTts provider (approach: **manual** + runtime-verify)
**קבצים חדשים**: `packages/frontend/src/lib/adapters/voice/tts-gemini.ts`
```ts
export const geminiTts: TtsProvider = {
  format: "pcm",
  async synthesize(req: TtsRequest): Promise<ReadableStream<Uint8Array>> {
    const iter = await googleGenAi().models.generateContentStream({
      model: req.modelId ?? "gemini-3.1-flash-tts-preview",
      contents: [{ parts: [{ text: req.text }] }],
      config: { responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: req.voiceId } } } },
    })
    // generateContentStream → Promise<AsyncGenerator<GenerateContentResponse>>.
    // ה-for-await שייך ל-start (חד-פעמי, צורך עד done), לא ל-pull.
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of iter) {
            // noUncheckedIndexedAccess → optional-chain מלא בכל index:
            const b64 = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
            if (b64) controller.enqueue(base64ToBytes(b64))  // base64 → PCM bytes
          }
          controller.close()
        } catch (e) { controller.error(e) }
      },
    })
  },
}
```
> ⚠️ **`base64ToBytes` לא קיים** (finding אביגיל r2 #1): `base64.ts` מכיל רק `bytesToBase64` (encode).
> **הוסף את הכיוון ההפוך ל-`base64.ts`** (בלי spread — אותו זהירות-stack כמו ה-encode):
> ```ts
> export function base64ToBytes(b64: string): Uint8Array {
>   const binary = atob(b64)
>   const bytes = new Uint8Array(binary.length)
>   for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
>   return bytes
> }
> ```
> signal/abort: SDK מקבל `config.abortSignal`? אם לא — להעביר `req.signal` ל-controller cancel. (Commit 2 runtime-check מברר.)
> ⚠️ **אומת onecli-direct** (SDK מחזיר l16/24kHz, 0 preamble). **לא אומת** דרך `googleGenAi()` baseUrl ל-`/proxy/google/` בדפדפן — **זה הצעד הראשון של ה-runtime check** (Commit 2: ודא ש-generateContentStream זורם דרך ה-proxy).
**Verification (runtime)**: דרך BE על :4001 — קריאת `geminiTts.synthesize({text:"שלום", voiceId:"Kore"})` מחזירה stream עם bytes>0, mime l16. (calev phase)

### Commit 3 — engine: AudioSink interface (approach: **manual**)
**קבצים חדשים**: `engines/audio-sink.ts`:
```ts
export type AudioSegmentState = "loading" | "ready" | "playing" | "ended" | "cancelled"  // הועבר מ-audio-stream
export interface SegmentOpts { messageId?: string | null; textHash?: string; format?: "mp3" | "pcm" }
export interface AudioSink {
  prepareSegment(segmentId: string, stream: ReadableStream<Uint8Array>, ac: AbortController, opts?: SegmentOpts): Promise<void>
  play(segmentId: string): Promise<void>
  cancel(segmentId: string): void
  clear(): void
}
```
> `format` הוא **אופציונלי** ומשמש **רק** את `RoutingAudioSink` (Commit 6); `AudioStream`/`PcmAudioStream` מתעלמים ממנו (כל אחד יודע את הפורמט שלו). זה תואם את ה-`provenance` הקיים (`{messageId, textHash}`) + שדה אחד.
**שינויים**: `audio-stream.ts` → `class AudioStream implements AudioSink` (ייבא AudioSegmentState מ-audio-sink; אפס שינוי לוגיקה; ה-4th arg שלו כבר `{messageId, textHash}` — תואם SegmentOpts). `player.svelte.ts` → `#audioStream: AudioSink` + param בנאי `sink: AudioSink`.
**Verification**: `pnpm --filter @drive-coding/frontend-v2 typecheck` + `test` (319+ ירוק — אפס regression על נתיב MP3).

### Commit 4 — engine: PcmAudioStream (approach: **manual** + runtime-verify — **הקומיט המסוכן**)
**קבצים חדשים**: `engines/pcm-audio-stream.ts` — `class PcmAudioStream implements AudioSink`.
- `AudioContext` משותף (אחד למופע), `resume()` ב-play (gesture-gated).
- prepareSegment: רושם segment, צורך stream ברקע (`splitInt16LE`→`pcmToFloat32`→`AudioBuffer`).
- play: תזמון gap-less — `nextStartTime` cursor, כל buffer `start(nextStartTime)`, `+= buf.duration`; resolve ב-`onended` של ה-source האחרון.
- cancel: abort + `source.stop()` לכל הפעילים. clear: cancel לכולם.
> WebAudio **לא רץ ב-happy-dom** → אין unit test; אימות **חי** ע"י calev (כמו MediaSource היום, audio-stream.ts:11).
**Verification (runtime, calev phase)**: הקראה דרך PcmAudioStream מנגנת רצף — **בלי gaps/clicks**, ללא glitch תחת גלילה.

### Commit 5 — Settings: בורר ספק-TTS (approach: **manual**)
**החלטת המשתמשת (Q1): אין flip של ברירת-מחדל** — ElevenLabs נשאר default; מוסיפים **בורר בהגדרות**
שהמשתמשת מדליקה ידנית כדי לנסות Gemini. (`DEFAULT_VOICE_CONFIG` ב-capabilities.ts **לא נגעים** → `select.test` נשאר ירוק.)

**(א) Settings VM** — `view-models/settings.svelte.ts` (דפוס שדה קיים: voiceId/speakThoughts...):
- `Persisted` interface + `DEFAULTS` + `#persist()` + `load`: הוסף `ttsProvider: "elevenlabs" | "google"` (default **"elevenlabs"**).
- `$state` field `ttsProvider = $state<"elevenlabs"|"google">(DEFAULTS.ttsProvider)` + setter `setTtsProvider = (v) => { this.ttsProvider = v; this.#persist() }`.

**(ב) i18n** — ⚠️ **שלושה מקומות, אחרת typecheck נשבר** (`Catalog = Record<MessageKey, MessageValue>`):
- `packages/core/src/i18n/keys.ts` — הוסף את ה-keys ל-**`MessageKey` union** (שורה ~22, מקור-האמת).
- `packages/core/src/i18n/catalogs/` — שני הקטלוגים (**he + en**) — חובה ערך לכל key חדש.
- keys מוצעים: `settings.ttsProvider.label`, `settings.ttsProvider.elevenlabs`, `settings.ttsProvider.gemini` (בדוק קונבנציית-שמות קיימת ב-keys.ts).

**(ג) UI** — `components/settings/SettingsScreen.svelte` (**שם** יושב `VoicePicker`, **לא** SessionOptionsPanel):
ליד `<VoicePicker>`, הוסף את רכיב ה-**`<Select>` המשותף** (`$lib/components/ui/Select.svelte`, `type SelectOption`)
— לא `<select>` גולמי. `options=[{value:"elevenlabs",label:t(...)},{value:"google",label:t(...)}]`,
`value={settings.ttsProvider}`, `onchange={(v) => settings.setTtsProvider(v)}` (דפוס מדויק מ-`VoicePicker.svelte`).
**Verification**: `--filter frontend-v2 typecheck` + `test` + `lint` (i18n) — הבורר נשמר ל-localStorage (בדיקה ידנית).

### Commit 6 — RoutingAudioSink + Speaker wiring (approach: **manual** + runtime-verify — **כולל phase-verify**)
**הבעיה**: `#audioStream`+`#player` נבנים פעם אחת ב-constructor (~128/131, `readonly`); ה-sink חייב להתאים
ל-format של הספק הנבחר. **הפתרון** (בלי לגעת ב-Player/constructor-lifecycle): sink-מנתב.

**קבצים חדשים**: `engines/routing-audio-sink.ts`
```ts
// מנתב פר-segment ל-sink הנכון לפי format. Player רואה AudioSink אחד; ה-constructor לא משתנה.
export class RoutingAudioSink implements AudioSink {
  #byId = new Map<string, AudioSink>()
  constructor(private mp3: AudioSink, private pcm: AudioSink) {}
  async prepareSegment(id, stream, ac, opts) {
    const sink = opts?.format === "pcm" ? this.pcm : this.mp3   // ברירת-מחדל mp3
    this.#byId.set(id, sink)
    return sink.prepareSegment(id, stream, ac, opts)
  }
  play(id)   { return (this.#byId.get(id) ?? this.mp3).play(id) }
  cancel(id) { this.#byId.get(id)?.cancel(id); this.#byId.delete(id) }
  clear()    { this.mp3.clear(); this.pcm.clear(); this.#byId.clear() }
}
```
> דורש ש-`AudioSink.prepareSegment` (Commit 3) יכלול ב-opts שדה אופציונלי `format?: "mp3" | "pcm"` (ה-sinks הקונקרטיים מתעלמים — הם יודעים את שלהם; רק הראוטר משתמש בו).

**שינויים `speaker.svelte.ts`**:
- `this.#audioStream = new RoutingAudioSink(new AudioStream(), new PcmAudioStream())` (~128). `#audioStream` typed `AudioSink`. Player ו-constructor ללא שינוי.
- ב-`#fetchJob` (~384): בחר ספק לפי ההגדרה, העבר format ל-prepareSegment:
  ```ts
  const isGemini = this.#settings.ttsProvider === "google"
  const provider: TtsProvider = isGemini ? geminiTts : elevenLabsTts
  const voiceId = isGemini ? "Kore" : this.#settings.voiceId
  const model   = isGemini ? "gemini-3.1-flash-tts-preview" : "eleven_v3"
  const textHash = await cacheKeyFor(text, voiceId, model)        // היה (voiceId, "eleven_v3") מקובע — finding r2 #2
  const stream = await provider.synthesize({ text, voiceId, modelId: model, messageId: job.messageId, signal: job.abort.signal })
  await this.#audioStream.prepareSegment(job.segmentId, stream, job.abort, { messageId: job.messageId, textHash, format: provider.format })
  ```
> **הערה cache** (finding r2 #2): x-cache-key נשלח ע"י fetch של ElevenLabs; ה-SDK של Gemini אולי לא שולח → ייתכן שה-proxy-cache לא נתפס בנתיב Gemini. **לא חוסם** (אופטימיזציה) — follow-up.
**Verification (calev phase אחרי Commit 4, ואז heavy)**: בורר=Gemini → הקראה חיה PCM gap-less; בורר=ElevenLabs → MP3 (אם יהיו קרדיטים); החלפת-בורר באמצע לא קורסת; ביטול (stop) עוצר מיד.

## §5 — DoD verifiable

| בדיקה | איך |
|---|---|
| `pcm.ts` TDD ירוק | `npx vitest run pcm` (מ-root; ל-core אין test script) |
| `select.test.ts` נשאר ירוק (לא נגעים ב-DEFAULT) | `npx vitest run select` — ללא שינוי (Q1=לא flip) |
| **בורר ttsProvider נשמר ל-localStorage** | בדיקה ידנית: החלף בורר → reload → נשמר; default=elevenlabs |
| typecheck FE + root נקי | `--filter frontend-v2 typecheck` + `pnpm typecheck` |
| כל טסטי FE + core ירוקים (אפס regression MP3) | `pnpm test` (root — כולל core+FE) — אדום=regression |
| lint נקי (אין עברית בקוד — כולל keys ל-בורר) | `pnpm lint` (i18n) |
| vite build ירוק | `--filter frontend-v2 build` |
| **Gemini provider זורם דרך ה-proxy** | runtime: `geminiTts.synthesize` → bytes>0, mime `audio/l16` (calev) |
| **הקראה חיה עובדת gap-less** | runtime: voice-mode → תשובה מוקראת בקול Gemini, בלי gaps/clicks (calev-heavy, נייד+דסקטופ) |
| **נתיב MP3 לא נשבר** | קוד ElevenLabs שלם; אם יהיו קרדיטים — מנגן MP3 כמקודם (structural — לא ניתן לבדוק חי בלי credits) |
| ביטול (stop) עוצר את ה-WebAudio מיד | runtime (calev) |

## §6 — Risks + mitigations

| סיכון | מקור | מיטיגציה |
|---|---|---|
| SDK `generateContentStream` לא זורם דרך `googleGenAi()` proxy baseUrl (אומת רק onecli-direct) | ספייק 2026-06-27 | **Commit 2 = הצעד הראשון מאמת זאת חי**; אם נכשל → escalate (אולי fetch ידני ל-`/proxy/google/...:streamGenerateContent?alt=sse` כמו ה-curl המאומת) |
| WebAudio gap/underrun (תזמון) | §3 ניתוח | `nextStartTime` cursor + lead 50ms; chunks מגיעים מהר מ-realtime → lead גדל. אם jank → §7 (AudioWorklet) |
| AudioContext לא resume (gesture) | secure-context/autoplay policy | resume ב-play; voice-mode כבר post-gesture; calev מאמת חי |
| chunk boundary (sample חצוי) | l16 stream | `splitInt16LE` carry — מכוסה TDD (Commit 0) |
| voiceId של ElevenLabs מוזרק ל-Gemini | מודל Settings.voiceId הוא של ElevenLabs | gemini → voiceName ברירת-מחדל ("Kore", אומת); מיפוי פר-ספק מלא = V4b (§9 Q2) |
| `--filter @drive-coding/frontend` no-op | אביגיל V1 #5 | כל ה-filters = `frontend-v2` |
| regression על נתיב MP3 בעת חילוץ AudioSink | Commit 3 | `implements AudioSink` בלי שינוי לוגיקה; `--filter frontend-v2 test` מאמת 319+ |

## §7 — Escalation triggers
עצור ושאל את מרדכי ב-parent task אם:
- Commit 2: SDK לא זורם דרך ה-proxy baseUrl (רק onecli-direct עבד) — צריך החלטת transport.
- PcmAudioStream נותן gaps/clicks ש-`nextStartTime` לא פותר → שאלת AudioWorklet (שינוי-ארכיטקטורה).
- AudioContext לא resume גם אחרי gesture (autoplay policy חוסם).
- מסתבר שצריך לשנות את נתיב ה-MP3/MediaSource (אמור להישאר שלם).
- מיפוי voiceId↔voiceName פר-ספק נדרש כבר ב-V4a (אמור להידחות ל-V4b).

## §8 — Complexity score
**8/10** — verifier: **heavy (calev-heavy)**.
- commits: 7 (גבוה) · שכבות חדשות: 2 (engine sinks + adapter provider) + core + settings/UI/i18n
- API חיצוני חדש (Gemini streaming, +1) · streaming/async pipeline (+2) · נתיב-אודיו חדש (WebAudio)
- **phase-verify אחרי Commit 4** (PcmAudioStream — הקומיט המסוכן) לפני Commit 6.

## §9 — שאלות פתוחות

| # | שאלה | הכרעה | חוסם? |
|---|---|---|---|
| 1 | flip ברירת-מחדל ל-Gemini? | **לא** (החלטת המשתמשת 2026-06-27). default נשאר ElevenLabs; בורר בהגדרות (Commit 5) מאפשר Gemini ידנית → אפס regression, `select.test` לא נגעים | ✅ נסגר |
| 2 | voice של Gemini ב-V4a | **"Kore"** קבוע (אומת חי); בחירה פר-ספק ב-Settings → V4b | ❌ |
| 3 | AudioContext — אחד משותף או per-segment? | **אחד למופע `PcmAudioStream`**, resume ב-play | ❌ |
| 4 | בחירת-sink דינמית בלי לגעת ב-Player/constructor | **`RoutingAudioSink`** (Commit 6) — מנתב פר-segment לפי format; Player רואה sink אחד | ✅ נסגר |
| 5 | בורר ספק = toggle בוליאני או select? | **`<select>`** (forward-compat ל-V4b כשיתווספו ספקים) — שדה string `ttsProvider` | ❌ |

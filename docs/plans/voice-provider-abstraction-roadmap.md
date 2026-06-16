# Roadmap — ניתוק שירותי-הקול מהספקים (TTS / תרגום / נרייט / STT)

> **תאריך**: 2026-06-16
> **כותב**: מרדכי (planner)
> **סטטוס**: טיוטה (roadmap — לא brief בודד). ממתין לאישור כיוון לפני כתיבת brief ראשון.
> **תוצר מבוקש**: לאפשר **כל ספק לכל שירות-קול** — שכל אחד מ-TTS (הקראה),
> תרגום, נרייט ו-STT יוכל לרוץ על ספק נבחר (ElevenLabs / Google-Gemini /
> OpenAI / …), במקום צימוד-קשיח של ספק-יחיד-לשירות כפי שקיים היום.

> **⚠️ אל תבלבל עם** `docs/plans/provider-abstraction-roadmap.md` — **זה domain אחר**.
> אותו מסמך מפשיט את **ספק-הסוכן** (פרוטוקול ACP / Codex / Claude). המסמך הזה
> מפשיט את **שירותי-הקול** (TTS/translate/narrate/STT). השם "Provider" כבר תפוס
> בפרויקט למשמעות agent-protocol — לכן ה-naming כאן **חייב להיות נבדל**
> (`VoiceProvider` / `voice-service` ולא `Provider` חשוף). ראה §D.

---

## §A — תמונת מצב: הצימוד הנוכחי (חקירת קוד 2026-06-16)

ארבעה שירותי-קול, כל אחד adapter ב-FE שקורא **ישירות** ל-SDK/fetch. אין שכבת
הפשטה בשימוש. הספק תפור-קשיח בשלוש רמות: **proxy-path**, **SDK/קריאה**, ו-**model-id**.

| שירות | ספק כיום | adapter (FE) | SDK / קריאה | model קשיח |
|------|----------|--------------|-------------|-----------|
| **הקראה (TTS)** | ElevenLabs | `frontend/src/lib/adapters/voice/tts.ts:29` | `fetch` ישיר → `/proxy/elevenlabs/v1/text-to-speech/{voiceId}/stream` | `eleven_v3` (`tts.ts:31`) |
| **תרגום** | Google-Gemini | `frontend/.../voice/translate.ts` | `@ai-sdk/google` `generateObject` | `gemini-flash-lite-latest` (`translate.ts:89`) |
| **נרייט** | Google-Gemini | `frontend/.../voice/narrate.ts` | `@ai-sdk/google` `generateText` | `gemini-flash-lite-latest` (`narrate.ts:42`) |
| **STT** | Google-Gemini | `frontend/.../voice/transcribe.ts:28` | `@google/genai` `generateContent` multimodal | `gemini-flash-latest` (`transcribe.ts:58`) |

### היכן יושב הצימוד

- **בחירת SDK + baseURL**: `frontend/.../voice/sdks.ts` — שני factories:
  `googleAi(model)` (`@ai-sdk/google`, `baseURL` רישית, `/proxy/google/v1beta`) ו-
  `googleGenAi()` (`@google/genai`, `httpOptions.baseUrl` קטנה, `/proxy/google/`).
- **bחירת-ספק = hardcoded** בכל adapter. **רק `voiceId`** (בתוך ElevenLabs) דינמי,
  דרך Settings (`frontend/.../view-models/settings.svelte.ts`, setter `setVoiceId`).
- **Orchestration**: `speaker.svelte.ts` (תור TTS פר-משפט, תרגום-מחשבות מותנה,
  נרייט פר-tool-call); `mic.svelte.ts` (הקלטה→`transcribe`).

### מה כבר אגנוסטי / קיים כתשתית

- **BE = proxy טיפש**: `backend/src/delivery/http-proxy.ts` עם
  `PROXY_HOSTS = { google, elevenlabs }`. הוספת ספק = רשומה ב-map + key ב-OneCLI.
  רישום: `backend/src/server.ts:76`. cache: `backend/src/delivery/proxy-cache.ts`
  (לפי path-patterns — `generateContent` + `text-to-speech/*/stream`).
- **`core/src/ports.ts:124-138`**: `SttPort` / `TtsPort` / `TranslatorPort` כבר
  מוגדרים — **אך לא בשימוש** (שרידי Slice 5), וה-shape לא תואם מציאות
  (`TtsPort.synthesize` מחזיר `mp3Bytes` בעוד ה-adapter מחזיר `ReadableStream`).
  → לא לאמץ as-is; להגדיר מחדש לפי הצורך האמיתי.
- **core טהור קיים**: `core/src/voice/narration-prompt.ts`,
  `core/src/voice/translation-prompt.ts` (בניית prompt טהורה),
  `core/src/voice/tts-queue.ts` (תור-סדר generics).
- **הזרקת keys = OneCLI** לפי host: `xi-api-key`→elevenlabs, `x-goog-api-key`→google.
  ספק חדש דורש עדכון ה-OneCLI agent (`voice-acp`). שים לב: Anthropic **לא** מוזרק
  בכוונה (ניקוז balance — ראה AGENTS.md).

### גרסאות רלוונטיות (`frontend/package.json`)

`ai@^6.0.184` · `@ai-sdk/google@^3.0.75` · `@google/genai@^2.3.0`.
**לא מותקנים**: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/elevenlabs`.

---

## §B — האם ה-AI SDK הוא ההפשטה? (אומת מול Context7 / ai-sdk.dev, 2026-06-16)

ה-AI SDK (`ai` v6) הוא שכבת-ספק אחידה — **אך מכסה את 4 השירותים בצורה לא-אחידה**.
זו ההבחנה שמעצבת את כל ה-refactor:

| שירות | AI SDK API | provider-agnostic | Gemini ב-SDK | OpenAI ב-SDK | streaming |
|------|-----------|:---:|:---:|:---:|:---:|
| **תרגום** | `generateObject` *(כבר בשימוש)* | ✅ מלא | ✅ | ✅ | — |
| **נרייט** | `generateText` *(כבר בשימוש)* | ✅ מלא | ✅ | ✅ | ✅ `streamText` |
| **STT** | `generateText` multimodal (audio-part) | ✅ | ✅ | ✅ | — |
| **הקראה (TTS)** | `experimental_generateSpeech` | חלקי | ❌ **לא** | ✅ | ❌ **buffer בלבד** |

עובדות שאומתו בתיעוד:
- `@ai-sdk/google` חושף רק `google()` (languageModel), `.embedding()`, `.interactions()`
  — **אין `.speech()` ואין `.transcription()`**. Gemini-TTS פשוט לא קיים ב-AI SDK.
- `experimental_generateSpeech`: OpenAI / ElevenLabs / Hume / LMNT בלבד, ומחזיר `audio`
  **מלא — לא stream**. תואם להערה הקיימת `tts.ts:4` ("@ai-sdk/elevenlabs לא תומכת
  בהזרמה → fetch ישיר"). ה-Speaker שלנו בנוי על chunked-streaming playback.
- `experimental_transcribe`: OpenAI-Whisper / Azure / Groq / Deepgram / … — **לא Google**.
  אבל STT עם Gemini אפשרי דרך `generateText` multimodal (audio file-part), שזה
  provider-agnostic (Gemini + OpenAI gpt-4o-audio) — רק לא דרך `transcribe()`.

### המסקנה הארכיטקטונית

ה-refactor **מצטמצם דרמטית**:

1. **תרגום / נרייט / STT (טקסטואליים)** — אין צורך ב"registry של adapters".
   ה-AI SDK *כבר* ה-interface האחיד. ה"ניתוק" = **פונקציה טהורה ב-core**:
   `(service, config) → { provider, model }`. ה-adapter (shell דק) קורא
   `generateText/Object/streamText` עם המודל. החלפת Gemini→OpenAI = שורת-config,
   לא קוד חדש. ה-prompts כבר טהורים ב-`core/voice/`.
2. **הקראה (TTS)** — ה-AI SDK *לא* מגיע (אין Gemini, אין streaming). זה ה-coupling
   האמיתי היחיד שצריך לנתק **ידנית**: `TtsProvider` interface אחיד + מימוש per-ספק
   (ElevenLabs fetch קיים, Gemini-TTS חדש).

---

## §C — ההכרעות (אושרו ע"י המשתמש 2026-06-16)

1. **היקף**: תשתית **+ ספק שני אחד כ-proof** (לא abstraction-only, לא cross-product מלא).
2. **ספקים**: TTS→**Gemini**, ושאר (translate/narrate/STT)→**OpenAI**.
   הבחירה מכסה **שני** סוגי-הפשטה ב-proof אחד:
   - translate/narrate/STT: Gemini→OpenAI = הוכחת החלפה **דרך AI SDK** (קל).
   - TTS: ElevenLabs→Gemini = הוכחת החלפה **דרך ה-interface הידני** (ה-proof החזק,
     במקום שבו AI SDK לא עוזר).
3. **STT בתוך scope** (כן, למרות שלא צוין בבקשה המקורית — אותו pattern, תוספת קטנה).
4. **מיקום ההפשטה**: **שכבה טהורה ב-core** (בחירת-ספק כפונקציה טהורה), IO נשאר
   shell דק ב-FE. *לא* registry-of-adapters ו*לא* BE-semantic-endpoints. עקבי עם
   D5 (functional core / imperative shell) ועם הארכיטקטורה הקיימת ("הכל ב-FE").

---

## §D — הארכיטקטורה היעד

```
core/src/voice/  (טהור)
  capabilities.ts   — VoiceConfig + descriptors (איזה ספק/מודל לכל שירות)
  select.ts         — (service, VoiceConfig) → VoiceModelRef   [טהור, TDD]
  narration-prompt.ts / translation-prompt.ts   [קיים]
  tts-types.ts      — TtsRequest/TtsChunk + TtsProvider interface (ל-TTS ידני)

frontend/.../adapters/voice/  (shell דק)
  translate.ts / narrate.ts / transcribe.ts
        → קוראים generateText/Object/streamText עם המודל מ-select()
        → מודל נבחר דרך @ai-sdk/google | @ai-sdk/openai לפי descriptor
  tts/
        elevenlabs.ts (fetch קיים) | gemini.ts (חדש)  — שניהם TtsProvider
        index.ts — בחירת מימוש לפי VoiceConfig.tts.provider

frontend/.../view-models/settings.svelte.ts
        → VoiceConfig persisted (provider+model פר-שירות), בנוסף ל-voiceId הקיים
```

- **Naming**: `VoiceProvider` / `VoiceConfig` / `VoiceModelRef` — נבדל מ-`Provider`
  של ה-agent-roadmap.
- **AI SDK כ-runtime**: עבור translate/narrate/STT, ה-descriptor ממופה ל-
  `LanguageModelV2` (`@ai-sdk/google` או `@ai-sdk/openai`); ה-adapter אגנוסטי.
- **TtsProvider ידני**: `synthesizeStreaming(req) → ReadableStream<Uint8Array>`
  (משמר את חוזה ה-Speaker הקיים). מימוש Gemini-TTS — ראה §F (open question).

---

## §E — רצף slices מוצע (JIT — brief מפורט ל-slice הבא בלבד)

| # | slice | תוצר | תלות | Complexity (משוער) |
|---|-------|------|------|:---:|
| **V1** | **voice-config-core** | `VoiceConfig` + `select()` טהור (TDD) ב-core. הסבת `translate.ts` + `narrate.ts` לקרוא מודל מ-`select()` במקום hardcoded. ברירת-מחדל = Gemini (אפס שינוי התנהגות). | — (base=dev) | 5 |
| **V2** | **voice-openai-text** | התקנת `@ai-sdk/openai` + factory `openaiAi()` ב-`sdks.ts` + key ב-OneCLI. הסבת STT ל-`generateText` multimodal אגנוסטי. אפשרות לבחור OpenAI ל-translate/narrate/STT. proof: החלפה Gemini→OpenAI עובדת e2e. | V1 | 6 |
| **V3** | **voice-tts-interface** | `TtsProvider` interface + הוצאת ElevenLabs מאחורי המימוש (אפס שינוי התנהגות). | V1 | 6 |
| **V4** | **voice-tts-gemini** | מימוש Gemini-TTS כ-`TtsProvider` (תלוי בתוצאת §F). בחירת ספק-TTS ב-Settings. proof: הקראה על Gemini. | V3, §F | 7–8 |

**Settings-UI** (בחירת ספק פר-שירות) — slice נפרד אחרי שה-proof עובד, או חלק מ-V4.

---

## §F — Open question חוסם ל-V4: Gemini-TTS streaming

ElevenLabs מחזיר MP3 **stream** שה-Speaker צורך chunked. Gemini-TTS מחזיר PCM.

> **סטטוס**: ✅ נבדק (Context7 / `@google/genai` v2, 2026-06-16).

**המסקנה: יש streaming ל-Gemini-TTS — אך לא בנתיב שאנחנו מחוברים אליו.**
קיימים *שני מוצרים* של Google בשם "Gemini TTS", על hosts שונים:

| API | host | streaming TTS? | auth | מצב אצלנו |
|-----|------|:---:|------|-----------|
| **Gemini Developer API** | `generativelanguage.googleapis.com` | ❌ **"TTS does not support streaming"** — `generateContent` buffer מלא בלבד | xi/goog key (OneCLI מזריק) | ✅ זה ה-`/proxy/google` שלנו |
| **Cloud Text-to-Speech** | `texttospeech.googleapis.com` | ✅ **`StreamingSynthesize`** — chunks (1920B = 40ms LINEAR16 @ 24kHz, או OGG_OPUS/ALAW/MULAW) | key/service-account נפרד | ❌ host לא מחובר |

נתיבים נוספים שנשללו: `generateContentStream` על מודל-TTS — לא מתועד רשמית, ספק.
**Live API** (`ai.live.connect`, WebSocket) — streaming אמיתי אך מיועד ל-conversational
realtime + VAD, לא ל-TTS-של-טקסט-מוכן. ארכיטקטורה שונה לחלוטין → לא מתאים.

מקורות (אומת 2026-06-16): ai.google.dev/gemini-api/docs/speech-generation (אין streaming
ב-Developer API) · cloud.google.com/text-to-speech/docs/gemini-tts (StreamingSynthesize) ·
GoogleCloudPlatform/generative-ai#2480 (באג: streaming מחזיר LINEAR16 גם כשמבקשים OGG_OPUS).

### תוצאות spike בפועל (gcloud, project `generative-code`, 2026-06-16)

ניסיתי את Cloud TTS חי. הממצא **שובר את אופציית Gemini-TTS-streaming לארכיטקטורה שלנו**:

| בדיקה | תוצאה |
|-------|-------|
| Cloud TTS API נגיש (billing+auth) | ✅ standard voice `he-IL-Standard-A` → 78KB PCM |
| **`POST /v1/text:streamingSynthesize`** | ❌ **404 Not Found** (גם `v1beta1`) — **לא קיים ב-REST** |
| Gemini voice `Kore`/`gemini-2.5-flash-preview-tts` (non-streaming) | ⚠️ `500 INTERNAL "Unable to generate audio"` — en-US **ו**-he-IL, גם אחרי הפעלת `aiplatform` + propagation |

**מסקנה חד-משמעית**: `StreamingSynthesize` הוא **gRPC-bidi בלבד** — לא חשוף ב-HTTP/REST.
ה-FE שלנו צורך דרך HTTP-proxy; gRPC-bidi **לא רץ מהדפדפן** ללא BE שמריץ gRPC-client
ומזרים ל-WS — סטייה מהותית מ"BE = proxy טיפש" (§A). בנוסף, Gemini voices החזירו 500
גם ב-non-streaming → לא drop-in גם ל-buffer.

### מדידת latency של Gemini-TTS buffer (Vertex `us-central1`, `generateContent`, 2026-06-16)

הצלחתי להריץ Gemini-TTS דרך **Vertex AI** (`us-central1`, `role:"user"` חובה; ה-Developer
API דחה Bearer — דורש API key; Vertex/`global` נתן 500). פלט: **PCM `audio/L16;rate=24000`**.
מדידות warm (זמן עד קבלת האודיו המלא — אין first-byte playback ב-buffer):

| אורך משפט | זמן דיבור | latency (warm) |
|-----------|-----------|----------------|
| 26 תווים | 2.3s | **3.5–4.0s** |
| 67 תווים | 6.1s | **5.2–5.7s** |
| 123 תווים | (סבב cold) | **12.9s** |

**מסקנה: לא שמיש ל-UX קולי-חי.** המשתמש מחכה 3.5–5.7s **בשתיקה מלאה** לפני כל משפט
(buffer — אין השמעה-תוך-כדי). גרוע מכך: למשפטים קצרים ה-**generation איטי מה-playback**
(2.3s דיבור עולה ~4s ליצור) → בצינור משפט-אחר-משפט נוצרים פערי-שתיקה מצטברים. השוואה:
ElevenLabs streaming מתחיל להשמיע תוך ~200–500ms. Gemini-TTS buffer מתאים אולי ל-narration
לא-אינטראקטיבי (audiobook), **לא** ל-assistant hands-free.

### Gemini Live API (WebSocket) — streaming-TTS שמיש (אומת חי 2026-06-16)

תיקון להערכה המוקדמת: דחיתי את ה-WS מהיד — **בטעות**. ה-Live API נגיש דרך **WebSocket**
(לא gRPC) → **כן רץ מהדפדפן**, ועקבי עם ארכיטקטורת ה-WS הקיימת (FE↔BE). הרצתי spike
חי (Developer API, `wss://generativelanguage.googleapis.com/.../BidiGenerateContent`,
model `gemini-2.5-flash-native-audio-latest`):

| תצורה | first-audio | preamble | streaming |
|-------|-------------|----------|-----------|
| ברירת מחדל | 2424 ms | ❌ "thinking" text | ✅ 73 chunks |
| **`thinkingConfig.thinkingBudget=0`** (warm) | **~1070 ms** (יציב ×2) | ✅ נעלם | ✅ 73–82 chunks |

**עם thinking כבוי: first-audio ~1s, streaming אמיתי, ללא preamble.** אותו סדר-גודל
כמו ElevenLabs (~300ms — איטי פי-3, אך שמיש ל-UX), ורחוק מ-buffer (4–6s). פלט PCM 24kHz.

**Caveats שנותרו (ל-spike מעמיק ב-V4):**
1. **dialog-model, לא TTS נקי**: `native-audio` בנוי לשיחה. ה-text channel היה נקי
   ב-spike, אך אין ערובה ל-100% verbatim תמיד (סיכון תוספות/שינוי במקרי-קצה) — חובה
   לאמת באודיו על מדגם.
2. **נתיב WS**: דורש חיווט WS (FE↔BE↔Gemini) + הזרקת key ל-WS — ה-OneCLI מזריק כיום ל-HTTP
   בלבד. זו תוספת תשתית, אך לא סטיית-ארכיטקטורה (כבר יש WS לסוכן).
3. **PCM→WebAudio**: כמו כל Gemini-audio — נתיב השמעה אחר מ-MP3/MediaSource.
4. **רישוי/יציבות**: מודלי `*-native-audio-*` הם preview.

> **השלכה ל-V4 — שלושה מועמדים ל-ספק-TTS-שני (לא חד-משמעי):**
> - **Gemini Live (WS, native-audio, thinking=0)** — streaming ~1s, מהדפדפן, אך dialog-model
>   (סיכון verbatim) + נתיב-WS + PCM. **הכי קרוב ל-streaming, הכי הרבה עבודה.**
> - **OpenAI `gpt-4o-mini-tts`** — buffer, MP3, מובנה ב-`@ai-sdk/openai` (כבר ב-V2). פשוט,
>   אך buffer (latency לא נמדד — לאמת).
> - **ElevenLabs-only** — לדחות ספק-TTS-שני, להוכיח את ה-`TtsProvider` interface בלי ספק נוסף.
>
> מועמד שנפסל: Gemini-TTS **buffer** (`generateContent`, models `*-preview-tts`) — 4–6s, PCM.
> ממצא-לוואי: קיים `gemini-3.5-live-translate-preview` (Live translate) — כיוון עתידי אפשרי
> לאיחוד translate+TTS ב-session קולי אחד. מחוץ ל-scope הנוכחי.

> **הערת היגיינה**: ה-spike הפעיל `texttospeech.googleapis.com` + `aiplatform.googleapis.com`
> על project `generative-code`. enable-only (ללא חיוב עד שימוש); אפשר לכבות אם לא נדרש.

**השלכות ל-V4 (חובה לטפל ב-brief):**
1. **פורמט**: Gemini-TTS מחזיר **PCM גולמי** (24kHz/16-bit/mono, base64 ב-`inlineData`),
   לא MP3. ה-Speaker/Player הנוכחי בנוי על MP3 ב-MediaSource → ל-PCM נדרש נתיב
   השמעה אחר (WebAudio `AudioBuffer`) או המרת-PCM→WAV.
2. **חוזה `TtsProvider`**: חייב לתמוך גם בספק **buffer-בלבד**. הגישה הנקייה —
   `synthesize(req) → ReadableStream<Uint8Array>` כאשר ספק-buffer עוטף את הפלט
   המלא כ-stream-של-chunk-יחיד. כך ElevenLabs נשאר streaming אמיתי ו-Gemini
   "כל-המשפט-ואז-השמעה" — אותו interface, latency-profile שונה.
3. **UX/latency**: Gemini-TTS = השהיה עד סוף-המשפט לפני תחילת ההשמעה (אין
   first-byte playback). מקובל פר-משפט? אם לא — Gemini-TTS אולי לא מתאים כספק-הקראה,
   ונשקול ספק-TTS שני אחר (OpenAI `gpt-4o-mini-tts`, שגם הוא buffer ב-AI SDK אך לפחות
   מובנה ב-SDK). **החלטה זו פתוחה למשתמש לפני V4.**

---

## §G — סיכונים

| סיכון | מיטיגציה |
|-------|----------|
| `speaker.svelte.ts` / `settings.svelte.ts` הם קבצים **משותפים** (`parallel-safe-code.md`) | slices סדרתיים (depends_on), שינוי-state מתואם מראש ב-brief |
| ports.ts הישן (`TtsPort` וכו') עלול להטעות שזה ה-contract | מתעלמים; מגדירים `core/voice/tts-types.ts` חדש לפי הצורך האמיתי |
| OneCLI לא מזריק Anthropic; OpenAI דורש הוספת key ל-agent `voice-acp` | V2 כולל צעד תשתית OneCLI; אם key חסר → proxy 401 (תסמין מתועד ב-AGENTS.md) |
| Gemini-TTS streaming/format (§F) | spike לפני V4; V1–V3 לא חסומים על §F |
| כלל זהב #5 (אין backward-compat-in-place) | כל slice ממיר consumer במלואו; ברירת-מחדל שומרת התנהגות, לא מתחזקת שני נתיבים |

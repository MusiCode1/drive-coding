# Roadmap — ניתוק שירותי-הקול מהספקים (TTS / תרגום / נרייט / STT)

> **תאריך**: 2026-06-16 · **כותב**: מרדכי (planner)
> **סטטוס**: טיוטה (roadmap — לא brief בודד). ממתין לאישור כיוון + הכרעת ספק-TTS לפני כתיבת brief ראשון.
> **תוצר מבוקש**: לאפשר **כל ספק לכל שירות-קול** — שכל אחד מ-TTS (הקראה), תרגום, נרייט
> ו-STT יוכל לרוץ על ספק נבחר (ElevenLabs / Gemini / OpenAI / …), במקום צימוד-קשיח
> של ספק-יחיד-לשירות כפי שקיים היום.

> **⚠️ אל תבלבל עם** `docs/plans/provider-abstraction-roadmap.md` — **domain אחר**: אותו
> מסמך מפשיט את **ספק-הסוכן** (פרוטוקול ACP / Codex / Claude). המסמך הזה מפשיט את
> **שירותי-הקול**. השם "Provider" כבר תפוס למשמעות agent-protocol → ה-naming כאן חייב
> להיות נבדל (`VoiceProvider` / `voice-service`). ראה §D.

---

## §A — תמונת מצב: הצימוד הנוכחי (חקירת קוד 2026-06-16)

ארבעה שירותי-קול, כל אחד adapter ב-FE שקורא **ישירות** ל-SDK/fetch. אין שכבת הפשטה
בשימוש. הספק תפור-קשיח בשלוש רמות: **proxy-path**, **SDK/קריאה**, **model-id**.

| שירות | ספק כיום | adapter (FE) | SDK / קריאה | model קשיח |
|------|----------|--------------|-------------|-----------|
| **הקראה (TTS)** | ElevenLabs | `frontend/src/lib/adapters/voice/tts.ts:29` | `fetch` → `/proxy/elevenlabs/v1/text-to-speech/{voiceId}/stream` | `eleven_v3` (`tts.ts:31`) |
| **תרגום** | Gemini | `frontend/.../voice/translate.ts` | `@ai-sdk/google` `generateObject` | `gemini-flash-lite-latest` (`translate.ts:89`) |
| **נרייט** | Gemini | `frontend/.../voice/narrate.ts` | `@ai-sdk/google` `generateText` | `gemini-flash-lite-latest` (`narrate.ts:42`) |
| **STT** | Gemini | `frontend/.../voice/transcribe.ts:28` | `@google/genai` `generateContent` multimodal | `gemini-flash-latest` (`transcribe.ts:58`) |

### היכן יושב הצימוד
- **בחירת SDK + baseURL**: `frontend/.../voice/sdks.ts` — `googleAi(model)` (`@ai-sdk/google`,
  `baseURL` רישית, `/proxy/google/v1beta`) ו-`googleGenAi()` (`@google/genai`,
  `httpOptions.baseUrl` קטנה, `/proxy/google/`).
- **בחירת-ספק = hardcoded** בכל adapter. רק `voiceId` (בתוך ElevenLabs) דינמי דרך
  Settings (`frontend/.../view-models/settings.svelte.ts`, `setVoiceId`).
- **Orchestration**: `speaker.svelte.ts` (תור TTS פר-משפט, תרגום-מחשבות מותנה, נרייט
  פר-tool-call); `mic.svelte.ts` (הקלטה→`transcribe`).

### מה כבר קיים כתשתית
- **BE = proxy טיפש**: `backend/src/delivery/http-proxy.ts`, `PROXY_HOSTS = { google, elevenlabs }`.
  הוספת ספק = רשומה ב-map + key ב-OneCLI. רישום: `backend/src/server.ts:76`.
  cache: `backend/src/delivery/proxy-cache.ts` (path-patterns).
- **`core/src/ports.ts:124-138`**: `SttPort`/`TtsPort`/`TranslatorPort` מוגדרים אך **לא בשימוש**
  (שרידי Slice 5), וה-shape לא תואם מציאות (`TtsPort.synthesize`→`mp3Bytes` בעוד ה-adapter
  מחזיר `ReadableStream`). → לא לאמץ as-is.
- **core טהור קיים**: `core/src/voice/{narration-prompt,translation-prompt,tts-queue}.ts`.
- **הזרקת keys = OneCLI** לפי host: `xi-api-key`→elevenlabs, `x-goog-api-key`→google. ספק
  חדש דורש עדכון ה-OneCLI agent (`voice-acp`). Anthropic **לא** מוזרק בכוונה (ניקוז balance).

### גרסאות (`frontend/package.json`)
`ai@^6.0.184` · `@ai-sdk/google@^3.0.75` · `@google/genai@^2.3.0`.
**לא מותקנים**: `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/elevenlabs`.

---

## §B — האם ה-AI SDK הוא ההפשטה? (אומת מול Context7 / ai-sdk.dev)

ה-AI SDK (`ai` v6) הוא שכבת-ספק אחידה — **אך מכסה את 4 השירותים בצורה לא-אחידה**:

| שירות | AI SDK API | provider-agnostic | Gemini ב-SDK | OpenAI ב-SDK | streaming |
|------|-----------|:---:|:---:|:---:|:---:|
| **תרגום** | `generateObject` *(בשימוש)* | ✅ מלא | ✅ | ✅ | — |
| **נרייט** | `generateText` *(בשימוש)* | ✅ מלא | ✅ | ✅ | ✅ `streamText` |
| **STT** | `generateText` multimodal (audio-part) | ✅ | ✅ | ✅ | — |
| **הקראה (TTS)** | `experimental_generateSpeech` | חלקי | ❌ **לא** | ✅ | ❌ **buffer בלבד** |

עובדות שאומתו: `@ai-sdk/google` חושף רק `google()`/`.embedding()`/`.interactions()` —
**אין `.speech()`/`.transcription()`**. `experimental_generateSpeech`: OpenAI/ElevenLabs/Hume/LMNT
בלבד, `audio` מלא (לא stream). `experimental_transcribe`: OpenAI/Azure/Groq/… — **לא Google**
(אך STT עם Gemini אפשרי דרך `generateText` multimodal — לא דרך `transcribe()`).

**מסקנה ארכיטקטונית — ה-refactor מצטמצם דרמטית:**
1. **תרגום / נרייט / STT (טקסטואליים)** — אין צורך ב-registry-of-adapters. ה-AI SDK *כבר*
   ה-interface האחיד. ה"ניתוק" = **פונקציה טהורה ב-core**: `(service, config) → {provider, model}`.
   ה-adapter (shell דק) קורא `generateText/Object/streamText`. החלפת ספק = שורת-config.
2. **הקראה (TTS)** — ה-AI SDK לא מגיע (אין Gemini, אין streaming). ה-coupling האמיתי
   היחיד שצריך לנתק **ידנית**: `TtsProvider` interface + מימוש per-ספק.

---

## §C — ההכרעות

1. **היקף** (אושר): תשתית **+ ספק שני אחד כ-proof** (לא abstraction-only, לא cross-product מלא).
2. **STT בתוך scope** (אושר): אותו pattern, תוספת קטנה.
3. **מיקום ההפשטה** (אושר): **שכבה טהורה ב-core** (בחירת-ספק כפונקציה טהורה), IO נשאר
   shell דק ב-FE. עקבי עם D5 (functional core) ועם הארכיטקטורה הקיימת.
4. **ספקים** (חלקית):
   - **טקסטואליים** (translate/narrate/STT): ספק-שני = **OpenAI** (דרך AI SDK — קל, e2e proof).
   - **TTS**: ⏳ **פתוח** — ה-spike (§F) פסל את Gemini-buffer והותיר 3 מועמדים. ראה §F + §H.

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
        → generateText/Object/streamText עם המודל מ-select()  (@ai-sdk/google | @ai-sdk/openai)
  tts/  elevenlabs.ts (fetch קיים) | <provider-2>.ts  — שניהם TtsProvider
        index.ts — בחירת מימוש לפי VoiceConfig.tts.provider

frontend/.../view-models/settings.svelte.ts
        → VoiceConfig persisted (provider+model פר-שירות), בנוסף ל-voiceId הקיים
```

- **Naming**: `VoiceProvider` / `VoiceConfig` / `VoiceModelRef` — נבדל מ-`Provider` של agent-roadmap.
- **AI SDK כ-runtime** לטקסטואליים: ה-descriptor ממופה ל-`LanguageModelV2`; ה-adapter אגנוסטי.
- **`TtsProvider` ידני**: `synthesize(req) → ReadableStream<Uint8Array>`. ספק-streaming
  (ElevenLabs/Gemini-Live) זורם chunks; ספק-buffer עוטף את הפלט המלא כ-stream-של-chunk-יחיד
  — **אותו interface, latency-profile שונה**. כך הוא תומך בשני סוגי הספקים.

---

## §E — רצף slices (JIT — brief מפורט ל-slice הבא בלבד)

| # | slice | תוצר | תלות | Cx |
|---|-------|------|------|:--:|
| **V1** | **voice-config-core** | `VoiceConfig` + `select()` טהור (TDD) ב-core. הסבת `translate.ts`+`narrate.ts` לקרוא מודל מ-`select()`. ברירת-מחדל Gemini (אפס שינוי התנהגות). | — | 5 |
| **V2** | **voice-openai-text** | `@ai-sdk/openai` + `openaiAi()` ב-`sdks.ts` + key ב-OneCLI. הסבת STT ל-`generateText` multimodal אגנוסטי. בחירת OpenAI ל-translate/narrate/STT. **proof: Gemini→OpenAI e2e.** | V1 | 6 |
| **V3** | **voice-tts-interface** | `TtsProvider` interface + הוצאת ElevenLabs מאחוריו (אפס שינוי התנהגות). | V1 | 6 |
| **V4** | **voice-tts-provider-2** | ספק-TTS-שני (TBD — §H) כ-`TtsProvider` + בחירה ב-Settings. **proof: הקראה על ספק שני.** היקף תלוי בבחירה (Live=גדול, OpenAI=קטן). | V3 | 6–8 |

**Settings-UI** (בחירת ספק פר-שירות) — slice נפרד אחרי שה-proof עובד, או חלק מ-V4.
**עיקרון JIT**: brief מפורט+מאומת ל-V1 בלבד; השאר נכתבים אחרי GO על הקודם.

---

## §F — ממצאי spike: streaming-TTS פר-ספק (אומת חי 2026-06-16)

הרצתי spikes חיים (gcloud, project `generative-code` עם billing). סיכום כל הנתיבים שנבדקו
ל-Gemini-TTS, ממוין מהטוב לפחות-מתאים:

| נתיב | transport | streaming | latency (first-audio) | פלט | נגיש מה-FE? |
|------|-----------|:---:|----------------------|-----|:---:|
| **Gemini Live — native-audio** (`gemini-2.5-flash-native-audio-latest`, `thinkingBudget=0`) | **WebSocket** | ✅ אמיתי (73–82 chunks) | **~1070ms** (warm, יציב ×2) | PCM 24kHz | ✅ **כן** (WS) |
| Gemini-TTS buffer (`*-preview-tts`, `generateContent`, Vertex `us-central1`) | HTTP | ❌ buffer | 3.5–5.7s (משפט שלם) | PCM 24kHz | ✅ |
| Cloud TTS `StreamingSynthesize` (`texttospeech.googleapis.com`) | **gRPC-bidi** | ✅ | — | PCM/OGG_OPUS | ❌ **gRPC-only** (404 ב-REST) |
| Gemini-TTS Developer-API (`/proxy/google`) | HTTP | ❌ | — | — | ⚠️ דורש API key (Bearer נדחה) |

### מה זה אומר
- **Gemini Live (WS) = מועמד streaming-TTS שמיש.** ~1s first-audio (סדר-גודל כמו ElevenLabs
  ~300ms — איטי פי-3, שמיש ל-UX), streaming אמיתי, **נגיש מהדפדפן דרך WS** (עקבי עם
  ארכיטקטורת ה-WS הקיימת לסוכן). עם `thinkingBudget=0` ה-preamble ("thinking" text) נעלם.
- **Gemini-TTS buffer נפסל** ל-UX-חי: 3.5–5.7s שתיקה לפני כל משפט; למשפטים קצרים
  ה-generation **איטי מה-playback** → פערים מצטברים. מתאים ל-narration לא-אינטראקטיבי בלבד.
- **Cloud TTS streaming נפסל**: `StreamingSynthesize` הוא gRPC-bidi (404 ב-REST/v1+v1beta1)
  → לא רץ מהדפדפן ללא BE-gRPC-bridge.

### Caveats ל-Gemini-Live (ל-spike מעמיק ב-V4, אם נבחר)
1. **dialog-model, לא TTS נקי**: ה-text channel היה verbatim ב-spike, אך אין ערובה ל-100%
   verbatim תמיד — **חובה לאמת באודיו על מדגם**.
2. **נתיב WS**: דורש חיווט FE↔BE↔Gemini + הזרקת key ל-WS (OneCLI מזריק כיום ל-HTTP בלבד).
   תוספת תשתית, לא סטיית-ארכיטקטורה.
3. **PCM→WebAudio**: נתיב השמעה אחר מ-MP3/MediaSource (כל Gemini-audio הוא PCM).
4. מודלי `*-native-audio-*` הם **preview**.

### ממצא-לוואי
קיים `gemini-3.5-live-translate-preview` (Live **translate**) — כיוון עתידי אפשרי לאיחוד
translate+TTS ב-session קולי אחד. מחוץ ל-scope הנוכחי.

### עדכון 2026-06-27 — מועמד חדש **מאומת חי**: `gemini-3.1-flash-tts-preview` (SSE streaming)
ה-spike לעיל בדק רק מודלי TTS של **2.5** (`*-preview-tts`), שהיו buffer-only. מאז שוחרר
**`gemini-3.1-flash-tts-preview`** עם streaming אמיתי. **ספייק חי (2026-06-27, דרך onecli
`voice-acp` + BE proxy)** אימת את כל הנתיב:

| נתיב | transport | streaming | first-audio | הזרקת key | נגיש מה-FE? |
|------|-----------|:---:|:---:|-----------|:---:|
| **`gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse`** | **HTTP/SSE** | ✅ (107 events) | **~0.7–1.0s (נמדד)** | **`x-goog-api-key` — מוזרק כיום** | ✅ **דרך `/proxy/google/*` — אומת end-to-end** |

- ✅ **verbatim עברי** — STT round-trip החזיר בדיוק את הקלט. ✅ **אין preamble** (audio-only).
- ✅ פלט PCM 16-bit 24kHz (`audio/l16; rate=24000`). caveat PCM→WebAudio (§F caveat 3) עדיין חל; caveat verbatim (§F caveat 1) **נופל** (מודל TTS טהור).
- ⚠️ **תיקון:** ה-endpoint הוא `streamGenerateContent?alt=sse` (לא `/v1beta/interactions` כפי שטען סיכום-docs מוקדם). `supportedGenerationMethods` ב-metadata לא מפרט streaming אבל הוא עובד אמפירית.

**המסקנה:** עוקף את שני החסרונות הכבדים של Gemini-Live בבת אחת (transport=HTTP+proxy קיים;
TTS טהור=בלי סיכון verbatim) **ובאותו latency**. ר' `docs/decisions/voice-acp.md` (2026-06-27) לפירוט מלא.

> **מקורות**: ai.google.dev/gemini-api/docs/speech-generation · cloud.google.com/text-to-speech/docs/gemini-tts ·
> GoogleCloudPlatform/generative-ai#2480 · spikes חיים (REST synthesize, Vertex generateContent, WS BidiGenerateContent).

> **היגיינת-spike**: הופעלו `texttospeech` + `aiplatform` + `generativelanguage` על
> `generative-code` (enable-only, ללא חיוב עד שימוש). API key זמני שנוצר ל-WS spike — **נמחק**.
> ניתן לכבות את ה-APIs אם לא יידרשו.

---

## §G — סיכונים

| סיכון | מיטיגציה |
|-------|----------|
| `speaker.svelte.ts` / `settings.svelte.ts` קבצים **משותפים** (`parallel-safe-code.md`) | slices סדרתיים (depends_on), שינוי-state מתואם מראש ב-brief |
| `ports.ts` הישן עלול להטעות שזה ה-contract | מתעלמים; מגדירים `core/voice/tts-types.ts` חדש |
| OneCLI לא מזריק Anthropic; OpenAI דורש key ל-agent `voice-acp` | V2 כולל צעד תשתית OneCLI; key חסר → proxy 401 (תסמין ב-AGENTS.md) |
| Gemini-Live: dialog-model (סיכון verbatim) + נתיב-WS + PCM | spike-אודיו לפני V4; V1–V3 לא חסומים. אם הסיכון גבוה → OpenAI buffer / ElevenLabs-only |
| כלל זהב #5 (אין backward-compat-in-place) | כל slice ממיר consumer במלואו; ברירת-מחדל שומרת התנהגות, לא מתחזקת שני נתיבים |

---

## §H — החלטות פתוחות (לפני dispatch)

1. **ספק-TTS-שני** — ארבעה מועמדים:
   - **`gemini-3.1-flash-tts-preview` (SSE-streaming)** ⭐ **— נבחר, אומת חי 2026-06-27** —
     streaming על `streamGenerateContent?alt=sse` דרך ה-proxy `/proxy/google/*` הקיים
     (`x-goog-api-key` מוזרק כיום), מודל TTS טהור, verbatim עברי מאומת, TTFB ~0.7–1.0s. **המועמד
     המוביל.** ידע-הספייק + צורת-אינטגרציה + שאלות פתוחות מרוכזים ב-**`docs/plans/v4-gemini-tts-pre-brief.md`**.
     ה-brief המלא ייכתב אחרי GO על V3 (תלוי ב-`TtsProvider`).
   - **Gemini-Live (WS)** — streaming ~1s, מהדפדפן; אך dialog-model + נתיב-WS + PCM. הרבה עבודה (V4 גדול).
   - **OpenAI `gpt-4o-mini-tts`** — buffer, MP3, מובנה ב-`@ai-sdk/openai` (כבר ב-V2). פשוט; latency לא נמדד (לאמת כשיהיה key).
   - **ElevenLabs-only** — לדחות ספק-שני, להוכיח את ה-`TtsProvider` interface בלי ספק נוסף.
2. **התחלת V1** — V1 (שכבה טהורה + translate/narrate) **לא תלוי** בהכרעת-TTS → ניתן לכתוב brief ולהריץ אביגיל מיד.
3. **ניקוי APIs** ב-`generative-code` — לכבות או להשאיר.

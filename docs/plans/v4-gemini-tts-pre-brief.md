# Pre-brief — V4: ספק-TTS-שני `gemini-3.1-flash-tts-preview`

> **סטטוס: PRE-BRIEF** (לא brief מלא, לא dispatchable, לא עבר אביגיל).
> נכתב 2026-06-27 כש-ידע-הספייק טרי. **תלוי V1→V3** (§E ב-`voice-provider-abstraction-roadmap.md`) —
> בפרט `TtsProvider` interface ש-V3 יוצר. ה-brief המלא של V4 ייכתב **אחרי GO על V3**, יהפוך
> כל הפניה לקובץ/symbol לאמיתית, ואז → אביגיל → dispatch.
>
> מטרת המסמך: שכש-V4 יגיע, ה-brief יהיה הרכבה מהירה מנתונים מאומתים — לא גזירה-מחדש.

---

## 1. הכרעה (סגורה) — איזה ספק

`gemini-3.1-flash-tts-preview` הוא המועמד הנבחר ל-V4. הוכרע על בסיס **ספייק חי מאומת**
(2026-06-27) — ר' `docs/decisions/voice-acp.md` §2026-06-27 ו-§F עדכון ב-roadmap.

למה הוא, ולא Gemini-Live / OpenAI / ElevenLabs-only: עוקף את שני החסרונות של Gemini-Live
(transport=WS, dialog-model) בבת אחת — HTTP/SSE דרך ה-proxy הקיים + מודל TTS טהור (verbatim),
באותו latency (~1s).

## 2. עובדות-ספייק מאומתות (חי, דרך onecli `voice-acp` + BE proxy)

| ממד | ערך מאומת |
|-----|-----------|
| endpoint | `POST …/v1beta/models/gemini-3.1-flash-tts-preview:streamGenerateContent?alt=sse` |
| transport | HTTP, תגובת **SSE** (`data: {…}` per event); **לא** gRPC, **לא** WS |
| first-audio (TTFB) | **~0.7–1.0s** (ישיר 0.98s · דרך ה-proxy 0.70s) |
| פלט | PCM 16-bit LE, 24kHz, mono — `mimeType: "audio/l16; rate=24000; channels=1"` |
| מבנה תגובה | כל event: `candidates[0].content.parts[0].inlineData.data` = base64(PCM-chunk) |
| chunks | ~107 events ל-~4.2s אודיו (משפט עברי קצר) |
| preamble | **אין** — זרם audio-only; `text` part ריק (אף ש-`thinking:true` ב-metadata) |
| verbatim עברי | **✅ מאומת** — STT round-trip החזיר בדיוק את הקלט |
| key injection | `x-goog-api-key` — OneCLI `voice-acp` כבר מזריק ל-`generativelanguage.googleapis.com` |
| נתיב פרודקשן | **✅ עובד end-to-end** דרך `/proxy/google/*` (BE proxy מזרים שקוף, code-read) |

**מלכודות שהספייק תפס (לזכור ב-brief):**
- ה-endpoint הוא `streamGenerateContent?alt=sse` — **לא** `/v1beta/interactions` (טענת docs שגויה).
- `supportedGenerationMethods` ב-metadata **לא** מפרט `streamGenerateContent`, אבל הוא עובד.
  → ה-brief לא יסתמך על metadata; הספייק הוא מקור-האמת.

### דוגמת request body (מאומת)
```json
{
  "contents": [{ "parts": [{ "text": "<טקסט עברי>" }] }],
  "generationConfig": {
    "responseModalities": ["AUDIO"],
    "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": "Kore" } } }
  }
}
```
(לשקול `thinkingConfig.thinkingBudget: 0` כהקשחה נגד preamble — בספייק לא היה preamble גם בלעדיו.)

## 3. צורת אינטגרציה (מעוגן בקוד הקיים)

**הספק הקיים** — `packages/frontend/src/lib/adapters/voice/tts.ts`:
`synthesizeStreaming(opts: TtsOptions): Promise<ReadableStream<Uint8Array>>` — fetch ל-
`/proxy/elevenlabs/v1/text-to-speech/{voiceId}/stream`, `accept: audio/mpeg`, מחזיר
`response.body` (זרם **MP3** גולמי) שנצרך ב-MediaSource.

**ההבדל המהותי של Gemini — שני פערים שהם ליבת העבודה של V4:**

1. **פירוק תגובה שונה:** ElevenLabs = זרם בייטים גולמי (MP3) ב-`response.body`.
   Gemini = **SSE** שצריך parsing (`data:` → JSON → `inlineData.data` → `base64-decode` → PCM bytes).
   הספק של Gemini יעטוף את ה-SSE-parse לתוך אותו `ReadableStream<Uint8Array>` — **אך הבייטים הם PCM גולמי, לא MP3**.

2. **נתיב השמעה שונה (caveat §F-3):** ה-Speaker הקיים מנגן MP3 דרך **MediaSource**.
   PCM/l16 **לא** עובר דרך MediaSource → צריך **WebAudio** (AudioWorklet / AudioBufferSourceNode).
   → או שה-Speaker מקבל נתיב-PCM, או שה-`TtsChunk` נושא תג-פורמט וה-player מסתעף.
   **זה ה-decision הארכיטקטוני הגדול של V4** (לא נסגר בספייק — דורש הכרעה ב-brief).

**איפה זה מתחבר (אחרי V3):** `TtsProvider` interface ב-`core/voice/tts-types.ts` + מימוש
`adapters/voice/tts/gemini.ts` לצד `elevenlabs.ts`, בחירה ב-`index.ts` לפי `VoiceConfig.tts.provider` (V1).

## 4. שאלות פתוחות שה-brief המלא חייב לסגור

1. **PCM→WebAudio** — AudioWorklet (זרם רציף, נכון לקול) מול תור AudioBufferSourceNode? איך נשמר
   ה-gap-less playback בין chunks? (ההכרעה הגדולה.)
2. **Chunking של טקסט** — היום ElevenLabs מקבל משפט/בועה. Gemini streaming פר-קריאה — האם משדרים
   משפט-משפט (כמו היום) או בלוק גדול? משפיע על latency-נתפס.
3. **בחירת voice** — `prebuiltVoiceConfig.voiceName` (Gemini: "Kore" וכו') מול `voiceId` של ElevenLabs.
   `VoiceConfig` (V1) צריך להחזיק voice פר-ספק. רשימת הקולות הזמינים = לאמת.
4. **Cache** — `isCacheableRequest` ב-`http-proxy.ts` + `ttsCacheHeaders`: האם cache-ל-POST-SSE
   רצוי/עובד? (ה-proxy מזרים גם כשהוא cache-ב-tee, אז לא חוסם — אבל לאמת מדיניות.)
5. **טיפול בשגיאות** — SSE שנקטע באמצע, event ללא `inlineData`, quota/429.
6. **שפה/voice עברית** — בספייק verbatim היה מושלם; לאמת על מדגם רחב יותר + בחירת voice שנשמע טוב בעברית.

## 5. הערכת מורכבות (טנטטיבי)

**7–8** — ה-SSE-parse + ספק חדש = בינוני; אבל **PCM→WebAudio + שילוב ב-Speaker** מעלה את הסיכון
(נתיב-השמעה חדש, regression-risk על ה-playback הקיים). אם מתממש 8+ → **calev-heavy**.
ייתכן פיצול: (V4a) `TtsProvider` של Gemini שמחזיר PCM-stream + נתיב WebAudio; (V4b) בחירה ב-Settings.

## 6. תלויות

`depends_on: [V3]` (TtsProvider interface) → `depends_on: [V1]` (VoiceConfig). **חסום עד ש-V3 נחת.**
אין טעם ב-brief מלא / אביגיל לפני כן — ה-symbols של V3 עוד לא קיימים.

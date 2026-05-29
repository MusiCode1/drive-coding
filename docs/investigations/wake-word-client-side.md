# מחקר: זיהוי מילת-התעוררות (wake word) בצד-לקוח

> תאריך: 2026-05-29
> סטטוס: מחקר ראשוני — לא הוחלט, לא מומש
> הקשר: הפיכת ההקלטה מ-push-to-talk ידני ל-hands-free (רלוונטי ל-CarMode / slice 7)

## 1. הבעיה והאילוצים שלנו

היום ההקלטה היא **push-to-talk**: המשתמש לוחץ על `MicButton`, ה-`Mic` VM עובר
`idle → recording → transcribing → idle`, וה-`Recorder` engine עוטף `MediaRecorder`
(ראה `packages/frontend/src/lib/view-models/mic.svelte.ts` ו-`engines/recorder.ts`).

הרצון: מנגנון שמאזין ברקע, מזהה מילת-מפתח ("hey X"), ואז **מתחיל** הקלטה, ובסוף
(מילת-עצירה או שתיקה) **מסיים** ושולח ל-STT. זה הדרישה הקלאסית של wake-word detection.

### האילוצים הקריטיים של הפרויקט

| אילוץ | משמעות למחקר |
|---|---|
| ‏**עברית** היא שפת היעד | רוב מנועי ה-wake-word המוכנים מגבילים שפה — אבל זו מגבלה תפעולית של ה-vendor, לא טכנית. ראה §5. |
| ‏**צד-לקוח** (in-browser, PWA) | חייב WebAssembly/WebAudio. לא כל מנוע מביא JS runtime. |
| ‏**hands-free / CarMode** | חייב latency נמוך ו-false-accept rate נמוך (אסור שירעיש תוך כדי נהיגה). |
| ‏**stack קיים** | TS, SvelteKit, 5-layer. מנוע wake-word ייכנס כ-`engine` חדש (לא VM, לא adapter). |
| ‏**פרטיות** — הפרויקט כבר שולח אודיו ל-Gemini ל-STT | wake-word **מקומי** דווקא משפר פרטיות: רק אחרי הזיהוי שולחים אודיו החוצה. |

## 2. סקירת מנועים

### 2.1 Picovoice Porcupine ⭐ (המוביל המסחרי)

- **מה זה:** מנוע wake-word על-מכשירי מבוסס DNN. 4.8k★. Apache-2.0 על הקוד,
  אבל ה-runtime דורש **AccessKey** מ-Picovoice Console.
- **Web SDK:** `@picovoice/porcupine-web` — WebAssembly + Web Worker, אודיו דרך
  `@picovoice/web-voice-processor` (כולל downsampling ל-16kHz אוטומטי). עובד
  ב-Chrome/Safari/Firefox/Edge. API נקי: `PorcupineWorker.create(accessKey, [keyword], cb, {base64: model})`.
- **דיוק:** לפי הבנצ'מרק שלהם — 11× מדויק מ-PocketSphinx/Snowboy, 6.5× מהיר. מצוין.
- **🚫 שפות:** English, Mandarin, French, German, Italian, Japanese, Korean,
  Portuguese, Spanish. **אין עברית.** שפות נוספות "case-by-case ללקוחות מסחריים".
- **מילים מותאמות:** אפשר לאמן `.ppn` מותאם ב-Console — אבל רק בשפות הנתמכות.
  כלומר אי אפשר לאמן wake-word עברי גם בתשלום (אלא בהסכם מסחרי מיוחד).
- **רישוי:** Free tier מוגבל (כמות משתמשים פעילים חודשית; דורש חיבור ל-Console
  לאימות מפתח). שימוש מסחרי בתשלום. ה-AccessKey צריך להגיע ל-FE — לא סוד אמיתי
  אבל קושר אותנו ל-vendor.

**שורה תחתונה:** הכי טוב טכנית, אבל **לא תומך עברית** — פוסל אותו לדרישה כפי שנוסחה.
רלוונטי רק אם נבחר מילת-מפתח **לועזית** (למשל "Computer" / "Hey Drive").

### 2.2 openWakeWord (קוד פתוח)

- **מה זה:** framework קוד-פתוח (Apache-2.0), 2.3k★. מודלים pre-trained
  ("alexa", "hey jarvis", "hey mycroft"). אימון מודל חדש קל (Colab, <1 שעה,
  100% דאטה סינתטי מ-TTS — לא צריך לאסוף הקלטות).
- **ארכיטקטורה:** melspectrogram (ONNX) → feature-extractor משותף (Google
  speech-embedding) → classifier קטן. פריימים של 80ms.
- **🚫 שפות:** **אנגלית בלבד**. הסיבה: מודלי ה-TTS לייצור דאטה הם אנגליים.
  ה-README אומר שמודל STT בשפה אחרת "כנראה היה עובד" — אבל זה לא ממומש.
- **🚫 דפדפן:** **אין JS runtime רשמי.** ה-FAQ מפורש: "ONNX runtime תומך JS, אבל
  שאר הלוגיקה (melspectrogram וכו') צריכה port — לא ב-roadmap". הדגמת ה-web שלהם
  היא streaming דרך WebSocket ל-**backend** Python. כלומר לא צד-לקוח אמיתי.
- **רישוי מודלים:** CC-BY-NC-SA 4.0 (לא-מסחרי!) למודלים ה-pre-trained.

**שורה תחתונה:** קוד פתוח ונחמד, אבל גם אנגלית-בלבד וגם **לא רץ בדפדפן** ללא
פיתוח משמעותי. שני חסמים. לא מתאים כמו שהוא.

### 2.3 microWakeWord

- מנוע מ-@kahrendt, מיועד ל-edge/microcontrollers (ESP32). יעיל מאוד, אימון
  סינתטי דומה ל-openWakeWord. **לא** מיועד לדפדפן ולא לעברית. לא רלוונטי לנו.

### 2.4 Vosk (vosk-browser)

- **מה זה:** Kaldi-based ASR מלא שרץ בדפדפן דרך WASM (`vosk-browser` npm).
  לא wake-word engine — אלא **ASR מלא** עם grammar/keyword spotting.
- **עברית:** ל-Vosk **יש מודל עברי** (`vosk-model-small-he` / קהילתי). איכות
  בינונית, אבל קיים.
- **כ-wake-word:** אפשר להריץ Vosk עם grammar מצומצם (רק מילת-המפתח) → keyword
  spotting. גודל מודל קטן ~50MB, latency סביר על desktop, כבד יותר על מובייל.
- **חסרון:** מודל גדול לטעינה ב-FE, צריכת CPU/זיכרון גבוהה ב-always-listening.
  פחות מדויק מ-Porcupine ל-wake-word ספציפי.

**שורה תחתונה:** **המועמד היחיד שתומך עברית מקומית בדפדפן.** טוב כ-PoC, אבל כבד.

### 2.5 Web Speech API (`SpeechRecognition`)

- **מה זה:** API מובנה בדפדפן. ב-Chrome מאזין רציף (`continuous=true`) ומחזיר
  טקסט. אפשר להשוות את הטקסט למילת-מפתח עברית בקוד.
- **עברית:** ✅ `recognition.lang = 'he-IL'` עובד ב-Chrome.
- **חסרונות חמורים:**
  - ב-Chrome זה **לא מקומי** — האודיו נשלח לשרתי Google (סותר את "צד-לקוח").
  - Safari/Firefox: תמיכה חלקית/לא קיימת.
  - לא יציב ל-always-listening (sessions נופלים, צריך restart loops).
  - אין שליטה על threshold/false-accept.

**שורה תחתונה:** הכי קל למימוש מהיר, עברית מובנית, אבל לא-מקומי ולא-יציב.
מתאים ל-prototype בלבד, לא ל-CarMode production.

## 3. טבלת השוואה

| מנוע | עברית | רץ בדפדפן (מקומי) | דיוק wake | משקל/latency | רישוי | בשלות |
|---|:---:|:---:|:---:|:---:|---|:---:|
| **Porcupine** | ❌ | ✅ WASM | ⭐⭐⭐ | קל מאוד | vendor + AccessKey | גבוהה |
| **openWakeWord** | ❌ | ❌ (BE בלבד) | ⭐⭐⭐ | בינוני | CC-BY-NC מודלים | בינונית |
| **Vosk-browser** | ✅ | ✅ WASM | ⭐⭐ | כבד (~50MB+) | Apache-2.0 | בינונית |
| **Web Speech API** | ✅ | ❌ (ענן Google) | ⭐⭐ | קל (מובנה) | חינם | נמוכה (לא יציב) |

## 4. דרך שלישית: VAD מקומי + STT קיים (ללא wake-word כלל)

שווה לשקול שלא משתמשים ב-wake-word בכלל, אלא ב-**VAD** (Voice Activity Detection):
- ספריית `@ricky0123/vad-web` — Silero VAD ב-ONNX, רץ בדפדפן, **שפה-אגנוסטי**
  (מזהה דיבור, לא מילים). קל יחסית.
- זרימה: המיקרופון פתוח → VAD מזהה תחילת דיבור → מתחיל הקלטה → VAD מזהה שתיקה →
  עוצר ושולח ל-Gemini STT הקיים שלנו.
- **יתרון ענק:** עוקף לגמרי את בעיית-העברית (VAD לא תלוי שפה), משתלב ישירות עם
  `transcribe.ts` הקיים, ונותן בדיוק את ה"התחל/סיים הקלטה אוטומטית" שביקשת —
  בלי הצורך במילת-מפתח.
- **חיסרון:** אין "מילת הפעלה" — המערכת מגיבה לכל דיבור. ב-CarMode (סביבה רועשת,
  רדיו, נוסעים) זה עלול להפעיל שגוי. פתרון: כפתור "התחל מצב האזנה" שמפעיל את לולאת
  ה-VAD, ואז בתוך המצב הזה הכל אוטומטי.

## 5. רגע — הסיווג "שפה" מטעה. בואו נחדד.

הערה חשובה (שמתחילה ממשתמשת ששאלה את השאלה הנכונה): **למה שפה משנה בכלל?**
מנוע wake-word עובד על תכונות אקוסטיות של מילה ספציפית, לא על "הבנת" שפה.
טכנית, אפשר לאמן מודל לזהות **כל** מילה, בכל שפה, כל עוד יש דוגמאות אודיו.

אז למה Porcupine מגביל ל-9 שפות?
- ה-pipeline שלהם להפקת custom wake word מקבל **טקסט** ובונה דוגמאות אודיו ע"י
  TTS פנימי. אין להם TTS עברי איכותי → אין שפה. זו מגבלה **תפעולית** של ה-vendor,
  לא מגבלה תיאורטית של המנוע. גם בתשלום, אם השפה לא ברשימה — לא מאמנים.
- אפשר "לרמות" עם transliteration ("shalom porcupine" באנגלית). זה לפעמים עובד,
  לפעמים לא — תלוי עד כמה הפונמות העבריות קיימות באנגלית. **לא מומלץ ל-production**.

אז התשובה הנכונה היא: **כן, אפשר עברית.** אבל לא דרך Porcupine — דרך אימון
**openWakeWord** עם TTS עברי משלנו.

### הוכחה: הקהילה כבר עושה את זה

המאגר `fwartner/home-assistant-wakewords-collection` (534★) מכיל מודלי openWakeWord
מאומנים בקהילה לכל מיני שפות שלא נתמכות ב"רשמיות":
**אנגלית, דנית (`dk/hey_leo`), פינית (`fi/kaisa`), רוסית (`ru/nafanya`), סינית
(`zh/`)**. אם עשו דנית ופינית בלי תמיכה רשמית — אפשר לעשות גם עברית. זה תהליך
אימון של ~1 שעה ב-Colab עם דאטה 100% סינתטי.

### אז מה הבעיה האמיתית?

**שתי בעיות, לא אחת:**

#### בעיה 1: אימון מודל wake-word עברי (פתירה)
- ה-Colab של openWakeWord מקבל `target_phrase = "your wake word"` + TTS, מייצר
  אלפי דוגמאות סינתטיות, מאמן classifier קטן מעל feature-extractor של Google.
- ברירת מחדל: TTS אנגלי → לא מתאים לעברית.
- **התאמה לעברית:** להחליף את ה-TTS לעברי — Gemini 2.5 TTS Hebrew, ElevenLabs v3
  Hebrew, או Piper Hebrew. צריך כמה אלפי דוגמאות עם דוברים שונים, אינטונציות,
  מהירויות → מאומן פעם אחת, מתקבל קובץ `.onnx` של ~1-2MB.
- זה הפרק "Easy" יחסית — צריך לכתוב Colab notebook משלנו או לעדכן את הקיים.
- אפשר גם להוסיף דוגמאות real-audio של המשתמש עצמו לדיוק טוב יותר (verifier model).

#### בעיה 2: הרצת המודל ב-FE (קשה יותר אבל אפשרי)
זו הבעיה הקריטית יותר. openWakeWord **אין לו JS runtime רשמי.** ה-FAQ אומר
מפורשות שזה לא ב-roadmap, וההדגמת web שלהם משתמשת ב-WebSocket לbackend Python.

**אבל** — המודלים עצמם הם **ONNX**. אפשר לבנות runtime משלנו בדפדפן:

| רכיב | מה צריך |
|---|---|
| ‏Audio capture | ‏AudioWorklet שמקבל MediaStream, downsample ל-16kHz mono PCM |
| ‏Mel spectrogram | ‏`melspectrogram.onnx` של openWakeWord — להריץ ב-onnxruntime-web |
| ‏Embedding | ‏`embedding_model.onnx` (Google speech-embedding) — להריץ ב-onnxruntime-web |
| ‏Classifier | ‏המודל המותאם שאימנו (`hey_drive.onnx`) — להריץ ב-onnxruntime-web |
| ‏Glue code | ‏לולאה: ‎80ms frames → melspec → embed → classify → threshold → callback |

**זה לא טריוויאלי** — צריך לכתוב ~200-400 שורות TS כדי לחבר את הצנרת. אבל זה גם
לא R&D — הכל ONNX סטנדרטי, ו-`onnxruntime-web` רץ מעולה בדפדפן (גם עם WebGL/WebGPU
לתאוצה). זמן בנייה משוער: 2-4 ימי עבודה ל-MVP.

## 6. עדכון — `openwakeword-wasm-browser` קיים ועושה את כל העבודה

חיפוש מעמיק יותר חשף פרויקט שעושה בדיוק את ה-runtime שתכננתי לבנות מאפס:

**`dnavarrom/openwakeword_wasm`** (Nov 2025, npm: `openwakeword-wasm-browser@0.1.0`)
- Wrapper דק סביב openWakeWord עם `onnxruntime-web`. עובד בכרום ללא שכבת-native.
- חושף `WakeWordEngine` class עם API קליל: `engine.load() → engine.start() → engine.on('detect', cb)`.
- **כל ה-pipeline כבר עטוף**: AudioWorklet ב-16kHz + 80ms frames, melspectrogram ONNX,
  embedding ONNX, classifier ONNX, **plus Silero VAD מובנה** (בונוס: מחליף את
  ה-VAD שדיברנו עליו ב-§4 — אותו `silero_vad.onnx`, כבר נכלל).
- אירועים: `ready`, `detect ({keyword, score, at})`, `speech-start`, `speech-end`, `error`.
- שליטה: `detectionThreshold`, `cooldownMs`, `setActiveKeywords()`, `setGain()`,
  `runWav()` (לבדיקה offline).

זה הופך את "2-4 ימי בנייה של runtime" → "יום integration".

### מה זה אומר על כל ההמלצה?

המסלולים A/B/C המקוריים עדיין תקפים, אבל **מסלול C נהיה פשוט בהרבה** — לא צריך
לבנות AudioWorklet, melspec wrapper, frame buffering, threshold logic — הכל קיים.

### מסלולים מעודכנים

| # | מסלול | כסף | מקומי? | עברית? | זמן | סיכון |
|---|---|---|---|---|---|---|
| **A** | Porcupine + מילה לועזית | 🟡 free tier מוגבל* | ✅ | ❌ | חצי יום | תלות ב-vendor |
| **B** | Porcupine + transliteration | 🟡 כנ"ל | ✅ | ⚠️ חלקית | יום + PoC | false-rejects |
| **C-new** | `openwakeword-wasm-browser` + מודל pre-trained לועזי | ✅ 0 | ✅ | ❌ (אנגלית בלבד) | **יום** | רישוי NC |
| **D** | C-new + אימון מודל עברי (Colab + Gemini TTS) | ✅ 0 | ✅ | ✅ | יום + שבוע | רישוי המודל = שלי |

‏* Porcupine free tier מוגבל ל-3 משתמשים פעילים/חודש ב-tier החינמי. שימוש מסחרי בתשלום.

### מסלול C-new — איך נראית האינטגרציה אצלנו

**מודלים pre-trained זמינים** (כל אחד `.onnx` של ~1-2MB):
- `hey_jarvis_v0.1.onnx`
- `alexa_v0.1.onnx`
- `hey_mycroft_v0.1.onnx`
- `hey_rhasspy_v0.1.onnx`
- `timer_v0.1.onnx` ("set a 10 minute timer")
- `weather_v0.1.onnx` ("what's the weather")

**Files להוסיף לפרויקט:**
```
packages/frontend/static/openwakeword/
  models/
    melspectrogram.onnx       # ~700KB shared
    embedding_model.onnx      # ~6MB shared
    silero_vad.onnx           # ~2MB shared
    hey_jarvis_v0.1.onnx      # ~1MB classifier
  ort/
    ort-wasm-simd.wasm        # onnxruntime-web runtime
```
~10MB סה"כ. נטען לרקע אחרי mount.

**Engine חדש** ב-5-layer:
```ts
// engines/wake-word-listener.ts
import WakeWordEngine from 'openwakeword-wasm-browser'

export class WakeWordListener {
  #engine: WakeWordEngine
  onTrigger?: (keyword: string) => void
  onSpeechEnd?: () => void   // לזיהוי סוף-משפט אחרי trigger

  constructor(opts: { keyword: string }) {
    this.#engine = new WakeWordEngine({
      baseAssetUrl: '/openwakeword/models',
      keywords: [opts.keyword],
      detectionThreshold: 0.5,
      cooldownMs: 2000,
    })
  }

  async start() {
    await this.#engine.load()
    this.#engine.on('detect', ({keyword}) => this.onTrigger?.(keyword))
    this.#engine.on('speech-end', () => this.onSpeechEnd?.())
    await this.#engine.start()
  }

  async stop() { await this.#engine.stop() }
}
```

**שינוי ב-Mic VM** (`view-models/mic.svelte.ts`):
```
idle → listening → triggered → recording → transcribing → idle
                                  ↓ (5s no speech)
                                idle
```
- `listening`: WakeWordListener.start(). Recorder לא רץ. כפתור MicButton מציג "👂".
- `triggered`: זוהה wake word. Recorder.start() אוטומטי. ביפ קליל ל-feedback.
- `recording`: ההקלטה רצה. ‏ה-`speech-end` מ-Silero (כבר במנוע) עוצר אוטומטית.
- `transcribing`: כמו היום — ‏שולח ל-Gemini, ‏אז חזרה ל-`listening`.

### מה לגבי המגבלות?

**רישוי (חשוב):** המודלים pre-trained של openWakeWord הם **CC-BY-NC-SA 4.0** —
לא-מסחרי. עבור voice-acp בתור פרויקט אישי/non-commercial → בסדר. אם בעתיד יהפוך
מסחרי → לעבור למסלול D (לאמן מודל משלך, שיהיה רכוש שלך).

**בשלות של `openwakeword-wasm-browser`:** 4 stars, 8 commits, יוצר אחד, ‏ללא
releases ב-npm רשמי (יש tarball מובנה ברפו). ‏סיכון נמוך-בינוני. ‏אם משהו נשבר —
‏הקוד קטן (~JS+wasm), fork ‏פשוט. ‏ה-pipeline מבוסס על article של DeepCoreLabs
‏שעבד כבר.

**אנגלית בלבד (לעת עתה):** המודלים pre-trained בשפה אחת. בחר אחד מה-5 הזמינים
("Hey Jarvis" הכי טבעי). בעתיד — D (אימון עברי) נכנס לאותה תשתית בדיוק, רק
מחליפים את ה-`.onnx` של ה-classifier.

### המלצה סופית

**מסלול C-new עם "Hey Jarvis".**

- ‏עומד בכל הקריטריונים שלך: 0 כסף, מקומי לחלוטין, אנגלית מותר באיטרציה הזו.
- ‏יום עבודה ל-MVP, יומיים-שלושה ל-CarMode מלא (integration עם Mic FSM + UI feedback).
- ‏הארכיטקטורה מוכנה לאיטרציה הבאה (עברית) — רק מחליפים קובץ `.onnx`.
- ‏אין AccessKey, אין vendor, אין מגבלות.

הצעד הראשון: PoC של 2 שעות שמאמת ש-`runWav()` על ה-WAV הדמו (`hey_jarvis_11-2.wav`
שמסופק ברפו) מחזיר score גבוה. אם כן — נבנה את ה-engine.

### הצעת ארכיטקטורה (לכל אחת מהדרכים)

`engine` חדש בשם `WakeListener` / `VadListener` ב-`engines/`:
- מחזיק את ה-`MediaStream` ואת מנוע הזיהוי (WASM worker).
- חושף `start()` / `stop()` ואירוע `onTrigger` / `onSpeechStart` / `onSpeechEnd`.
- ה-`Mic` VM (או VM חדש `Listener`) מאזין לאירועים → קורא ל-`Recorder` הקיים.
- side-effect של always-listening שייך ל-owner של ה-state (כלל זהב #4) — כלומר
  ל-`Listener` VM, לא ל-route.
- ב-CarMode (slice 7): כפתור "מצב האזנה" מפעיל/מכבה את ה-`Listener`.

## 6. צעדים מומלצים להמשך

- [ ] להחליט: VAD-בלבד (אוטומטי) או wake-word מפורש (trigger word)?
- [ ] אם VAD: PoC קצר עם `@ricky0123/vad-web` על FE, לבדוק latency+false-accept
      בסביבה רועשת מדומה.
- [ ] אם wake-word לועזי: לפתוח חשבון Picovoice Console, לבדוק את ה-free tier
      ואת מגבלת המשתמשים, PoC עם `@picovoice/porcupine-web`.
- [ ] למדוד צריכת סוללה/CPU ב-always-listening על מובייל (קריטי ל-CarMode).
- [ ] לבדוק התנהגות עם wake-lock וברקע (האם הדפדפן משתיק את המיקרופון במסך כבוי).

## מקורות

- Picovoice Porcupine — github.com/Picovoice/porcupine, picovoice.ai/docs/porcupine
- openWakeWord — github.com/dscripka/openWakeWord (FAQ: אין JS runtime, אנגלית בלבד)
- microWakeWord — github.com/kahrendt/microWakeWord
- Vosk — alphacephei.com/vosk, vosk-browser (npm)
- Silero VAD / vad-web — github.com/ricky0123/vad

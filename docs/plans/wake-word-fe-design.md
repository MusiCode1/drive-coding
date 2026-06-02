# מסמך תכנון: ספריית wake-word ב-Frontend

> תאריך: 2026-06-02
> סטטוס: תכנון — לפני brief. מבוסס על POC מוכח (`poc/wake-word-orb/`).
> מקור-אמת ל-feasibility: `docs/investigations/wake-word-client-side.md`
> תלוי בקריאה: `packages/frontend/AGENTS.md` (5 שכבות + חוקי זהב)

## 1. מטרה

להוציא את הקוד שהוכח ב-POC (`poc/wake-word-orb/`) לקוד production ב-FE,
ב-TypeScript, לפי ארכיטקטורת 5 השכבות. התוצר משרת את slice 17 (wake word)
ואת CarMode (slice 7).

**מה ה-POC הוכיח (לא לתכנן מחדש):**
- זיהוי wake-word מקומי בדפדפן עובד (hey_jarvis score 0.999).
- צנרת: melspec → embedding → VAD → classifier, ב-onnxruntime-web (WASM).
- הקלטת wake-to-wake (detect#1 → buffer → detect#2 → WAV, trim של frames).
- נורית חיווי: גודל=עוצמה, צבע=מצב (אפור/כחול/אדום), גוון כהה לפי קול, flash.
- כל classifier דורש window-size שונה (16/22/34) — חייב הסקה מ-metadata.
- timer/weather = false positives על דיבור — לא לכלול. רק wake words אמיתיות.

## 2. למה FE ולא core

`packages/core/` חייב להיות pure (no IO, no browser globals — ראה `dev/AGENTS.md`).
הקוד הזה הוא browser-IO מלא: `onnxruntime-web`, `AudioContext`, `getUserMedia`,
`AudioWorklet`, `Blob`. לכן הוא שייך ל-FE. בתוך ה-FE הוא מתחלק לשכבות הקיימות
(engines / view-models / components), בדיוק כמו Mic/Speaker/Player.

ההחלטה תועדה כבר ב-`wake-word-client-side.md §6`: "מנוע wake-word ייכנס כ-engine חדש".

## 3. מיפוי POC → שכבות FE

| קובץ POC | שכבה | יעד | תפקיד |
|---|---|---|---|
| `wake-word-lib.js` (פרימיטיבים טהורים) | engine (טהור) | `engines/wake-word/pipeline.ts`, `vad.ts`, `wav.ts`, `audio-math.ts` | mel/embed/classifier windows, VAD state, encodeWav, RMS — בלי IO, unit-testable |
| `wake-word-lib.js` (`WakeWordDetector`, `createMicStream`) | engine (IO) | `engines/wake-word/wake-word-engine.ts` | מחזיק MediaStream + ONNX sessions, מריץ את הצנרת, פולט אירועים |
| `capture.js` | engine | `engines/wake-word/capture.ts` | wake-to-wake buffer + trim |
| `app.js` (orchestration, state, cues, toggle) | view-model | `view-models/wake-word.svelte.ts` | `$state` מצב, מאזין לאירועי engine, מנהל capture, צלילים, effect |
| `orb-dom.js` | component | `components/VoiceOrb.svelte` | נורית — props בלבד |
| `index.html` | route | route קיים/חדש | composition |
| מודלי `.onnx` | static | `static/wake-word/models/` | — |

## 4. חוקי import (מ-AGENTS.md) — מה מותר לכל שכבה

```
component (VoiceOrb)  → props/getContext + util בלבד
view-model (WakeWordVM) → engines, adapters
engine (wake-word)    → @drive-coding/core בלבד (+ onnxruntime-web)
```

→ ה-engine **לא** יודע על Svelte/`$state`. ה-VM **לא** יודע על ONNX/AudioContext.
ה-component **לא** יודע על שום דבר חוץ מ-props.

## 5. תכנון השכבות

### 5.1 engine — חלקים טהורים (unit-testable, no IO)

**`engines/wake-word/audio-math.ts`**
- `computeRms(frame: Float32Array): number`
- `transformMel(data: Float32Array): void` (נוסחת `/10 + 2` במקום, AHA #1)
- קבועים: `SAMPLE_RATE=16000`, `FRAME_SIZE=1280`, thresholds.

**`engines/wake-word/wav.ts`**
- `encodeWav(frames: Float32Array[], sampleRate): Uint8Array` (header + PCM16).
- ב-FE עוטפים ל-Blob; ה-encoding עצמו טהור → testable בלי DOM.

**`engines/wake-word/pipeline.ts`**
- `inferWindowSize(session): number` (מ-inputMetadata.shape[1]).
- `createScorePipeline({ sessions, classifiers })` — מחזיק mel(76)+emb(maxWindow)
  buffers, per-classifier window. `push(frame) → scores | null`.
- ⚠️ זה החלק שתפס את ה-window-size bug. ה-windows מוסקים, לא קבועים.
- ה-pipeline מקבל את ה-`InferenceSession`-ים כפרמטר — לא יוצר אותם (IO בחוץ).

**`engines/wake-word/vad.ts`**
- `createVadState()`, `runVadStep(session, frame, state) → prob`.

> הערה על "טהור": pipeline/vad מקבלים `ort.InferenceSession` ומריצים `.run()`.
> זה async-IO על המודל, אבל בלי `AudioContext`/`getUserMedia`/DOM. לטסטים —
> mock של session שמחזיר tensors ידועים. אם רוצים טהור-מוחלט, אפשר port
> `InferenceRunner` — אבל זה overkill ל-FE engine. **החלטה: ort ישיר, mock בטסט.**

### 5.2 engine — חלק ה-IO

**`engines/wake-word/wake-word-engine.ts`** — `WakeWordEngine`
- `constructor({ keywords, baseAssetUrl, thresholds... })`
- `async load()` — טוען mel/embed/vad + classifier לכל keyword (`InferenceSession.create`).
- `async start()` — `getUserMedia` + AudioWorklet → frames → pipeline+vad.
- `async stop()`.
- emitter פנימי. אירועים: `ready`, `frame(Float32Array)`, `level(rms)`,
  `vadStart`, `vadEnd({frames})`, `detect({keyword, score, sinceVadStart})`,
  `score({scores})`, `error`.
- gating ל-detect: `score>threshold && vadActive && !cooldown` (כמו ה-POC).
- **types/schemas** ל-config ולאירועים — ArkType ב-`types.ts`.

**`engines/wake-word/capture.ts`** — `WakeWordCapture`
- `pushFrame(frame)` — צובר כש-capturing.
- `start()` / `stop() → { frames, wav: Blob } | null` (trim של N frames מהסוף).
- `abort()` — עצירה בלי שמירה.
- טהור-יחסית (buffer + encodeWav); אין IO חוץ מ-Blob.

### 5.3 view-model

**`view-models/wake-word.svelte.ts`** — `WakeWordVM` (entity: "מנגנון ההאזנה")
- `$state`: `mode: "off" | "listening" | "recording"`, `level: number`,
  `lastError`.
- מחזיק `WakeWordEngine` + `WakeWordCapture` (engines).
- מאזין לאירועי engine → מעדכן `$state` + מניע capture.
- `toggle()` — off↔listening (זה מה שלחיצת הנורית קוראת).
- `$effect` (חוק זהב #4 — side-effect שייך ל-owner): סנכרון
  `mode → engine.start/stop`. הצלילים (cue start/end) + ההשמעה-המושהית
  של ההקלטה — כאן (לא ב-route, לא ב-component).
- על detect: VM מחליט start/stop capture ומחליף mode (listening↔recording).

> שאלה פתוחה ל-brief: האם זה VM עצמאי או שהוא מתמזג עם `Mic` הקיים?
> ה-POC עצמאי. ל-slice 17 ייתכן ש-`Mic` יקבל מצב `listening` (ראה
> `slice-17-wake-word.md` הקיים — autoStopMode). **להכריע ב-brief.**

### 5.4 component

**`components/VoiceOrb.svelte`** — props בלבד (`<script>` < 50 שורות):
```ts
let { mode, level, onToggle }: {
  mode: "off"|"listening"|"recording"; level: number; onToggle: () => void
} = $props()
```
- גודל + brightness מחושבים מ-`level` (smoothing ב-JS — ב-component מותר,
  זה state ויזואלי transient).
- צבע לפי `mode`. flash — דרך prop/method או אירוע נפרד.
- ⚠️ הריכוך: transition קצר על size/filter, ארוך על background-color
  (הלקח מה-POC — שני timings על properties נפרדים).

## 6. נקודות פתוחות להכרעה ב-brief

1. **VM עצמאי או מיזוג עם Mic?** (ראה §5.3). משפיע על slice 17.
2. **flash — איך מועבר ל-component?** prop counter / exported method / event.
3. **smoothing של level — ב-VM או ב-component?** (נטייה: component, זה ויזואלי).
4. **i18n** — מחרוזות הסטטוס/שגיאה דרך core/i18n (אסור עברית קשיחה).
5. **מודלים ב-static** — אילו keywords default? (POC: 4 אמיתיות). גודל ~10MB.
6. **טעינה עצלה** — לטעון מודלים רק כשמפעילים האזנה? (UX מול חביון ראשון).
7. **onnxruntime-web** — dependency חדש ב-package.json. WASM מ-CDN או vendored?

## 7. טסטים (Vitest)

- **טהור (חובה):** `audio-math` (RMS, mel transform), `wav` (header נכון,
  אורך PCM), `pipeline` (window slicing, inferWindowSize, hop), `capture`
  (trim, abort, buffer).
- **engine (mock ort):** gating של detect (threshold/vad/cooldown), רצף אירועים.
- **VM:** מעברי mode, toggle, תגובה ל-detect (start/stop capture).
- **component:** render לפי mode (snapshot/DOM), קריאת onToggle.
- לא נבדק אוטומטית (כמו ב-POC): מיקרופון חי, אודיו אמיתי.

## 8. מה לא בתכולה (out of scope)

- אימון מודל עברי (track D — `wake-word-client-side.md §5`).
- שילוב מלא ב-Mic FSM של slice 17 (אלא אם מחליטים מיזוג ב-§6.1).
- CarMode UI (slice 7).
- Settings UI ל-wake-word (slice 9).

## 9. הפניות

- POC: `poc/wake-word-orb/` (engine+capture+orb+lib, מוכח).
- מחקר: `docs/investigations/wake-word-client-side.md`.
- brief קיים (יעודכן): `docs/plans/slice-17-wake-word.md`.
- כללי FE: `packages/frontend/AGENTS.md`.

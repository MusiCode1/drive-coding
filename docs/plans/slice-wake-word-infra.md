# Brief: slice — תשתית wake-word ב-FE + route בדיקה

> סטטוס: **הושלם** (2026-06-02). complexity: 6/10. 9 commits, tip 65ed38c. calev GO 9/9.
> verifier: calev light. depends_on: [].
> base: **`poc-wake-word`** (לא dev) — כדי שה-POC reference, מסמך התכנון וה-brief
> יהיו זמינים בתוך ה-worktree. קוד ה-FE/core ב-poc-wake-word זהה ל-dev (ההפרש =
> docs בלבד), אז הבסיס-קוד תקין. **אין מיזוג לקוד הקיים** — רק קבצים חדשים + route מבודד.

## 0. הקשר וסביבה

**מטרה:** להוציא את ה-POC המוכח לקוד production ב-FE, לפי 5 השכבות, **בלי לגעת
בקוד הקיים** (Mic, +layout, routes קיימים). ה-consumer היחיד הוא route בדיקה חדש
`/wake-word-test` שמשחזר את התנהגות ה-POC בתוך ה-FE האמיתי. כך מאמתים שהתשתית
עובדת לפני שממזגים לממשק (בעתיד, slice 17).

⚠️ **שם ה-package**: ה-FE הוא `@drive-coding/frontend-v2` (כך ב-package.json),
למרות שהתיקייה היא `packages/frontend/`. כל פקודות `pnpm --filter` חייבות
`@drive-coding/frontend-v2`.

מכיוון שה-base הוא `poc-wake-word`, **כל ה-reference זמין בתוך ה-worktree החדש**
בנתיבים יחסיים רגילים (אין צורך בנתיבים אבסולוטיים):

**מקורות-אמת (must-read לפני קוד) — כולם ב-worktree:**
- `poc/wake-word-orb/` — המימוש המוכח (engine+capture+orb+lib). זה ה-reference
  (read-only; אל תערוך — רק קרא והעתק ממנו).
- `docs/plans/wake-word-fe-design.md` — מסמך התכנון (מיפוי לשכבות).
- `docs/investigations/wake-word-client-side.md` — feasibility + לקחים.
- `packages/frontend/AGENTS.md` — 5 שכבות + חוקי זהב + חוקי import.

**worktree:** (נפתח מ-`poc-wake-word`, לא dev — ראה הסבר ב-header)
```bash
git worktree add .worktrees/slice-wake-word-infra -b slice-wake-word-infra poc-wake-word
cd .worktrees/slice-wake-word-infra
pnpm install && pnpm hooks:install
```

**הרצה לבדיקה ידנית (getUserMedia דורש secure context — localhost בסדר):**
```bash
pnpm --filter @drive-coding/frontend-v2 dev   # פתח את ה-port שמודפס, נווט ל-/wake-word-test
# ⚠️ שם ה-package הוא frontend-v2 (התיקייה היא packages/frontend/, אבל ה-name ב-package.json הוא @drive-coding/frontend-v2)
```

**סביבה:** ה-models הם binaries (~10MB). מועתקים מ-`poc/wake-word-orb/assets/models/`.
ה-engine רץ בדפדפן בלבד (ONNX WASM + AudioWorklet). אין BE מעורב.

**הכרעות שכבר התקבלו (לא לפתוח מחדש):**
- VM עצמאי `WakeWordVM` (לא מיזוג עם Mic).
- 4 keywords: hey_jarvis, alexa, hey_mycroft, hey_rhasspy. **לא** timer/weather
  (false positives על דיבור — מתועד ב-POC).
- אין lazy-load בשלב זה (נטען ב-load() כשה-route מבקש; אופטימיזציה עתידית).
- onnxruntime-web = dependency רגיל ב-frontend/package.json.
- `lerp` → `packages/core/` (utility טהור גנרי).
- flash → שדה `$state` מונה ב-VM, ה-component מגיב דרך context/$effect.
- smoothing של level → ב-component (ויזואלי).
- **אפס נגיעה** ב-Mic / +layout.svelte / routes קיימים / context.ts הקיים.

## 1. עקרון ארכיטקטוני (חוקי import מ-AGENTS.md)

```
route (/wake-word-test)  → view-model, component
component (VoiceOrb)     → getContext + util בלבד
view-model (WakeWordVM)  → engines
engine (wake-word)       → @drive-coding/core + onnxruntime-web
core (lerp)              → pure
```

- engine לא יודע על Svelte/$state. VM לא יודע על ONNX/AudioContext.
  component לא יודע על שום דבר חוץ מ-VM (דרך context) + props.

## 2. מבנה קבצים (כולם חדשים)

```
packages/core/src/ui/
  math.ts                              # lerp (טהור) + טסט

packages/frontend/
  package.json                         # + onnxruntime-web dependency
  static/wake-word/models/*.onnx       # 7 קבצים מ-POC (mel/embed/vad + 4 classifiers; NOT timer/weather — ראה §6)
  src/lib/
    engines/wake-word/
      audio-math.ts                    # computeRms, transformMel, קבועים
      wav.ts                           # encodeWav (Float32[]→Uint8Array)
      pipeline.ts                      # inferWindowSize + createScorePipeline
      vad.ts                           # createVadState + runVadStep
      wake-word-engine.ts              # WakeWordEngine (ONNX+mic, emitter)
      capture.ts                       # WakeWordCapture (wake-to-wake buffer)
      types.ts                         # config + event types (ArkType schemas)
    view-models/
      wake-word.svelte.ts              # WakeWordVM
    components/
      VoiceOrb.svelte                  # נורית (props/context)
  src/routes/wake-word-test/
    +page.svelte                       # route בדיקה — ה-consumer היחיד
```

## 3. Commits (פירוק לביצוע)

### Commit 1 — core: lerp (TDD)
**`packages/core/src/ui/math.ts`**
```ts
/** Linear interpolation: ערך נע לעבר יעד בשבר factor (0..1). טהור. */
export function lerp(current: number, target: number, factor: number): number {
  return current + (target - current) * factor
}
```
- export ב-`packages/core/src/index.ts` (additive — הוסף שורה, אל תשנה קיים).
- **טסט** `packages/core/src/ui/math.test.ts`: lerp(0,10,0.5)=5, lerp(5,5,x)=5,
  factor=0→current, factor=1→target.
- testing: **tdd** (טהור).
- DoD: `pnpm --filter @drive-coding/core typecheck` + test ירוקים.

### Commit 2 — engine: חלקים טהורים (TDD)
**`engines/wake-word/audio-math.ts`** — מתוך `poc/wake-word-orb/wake-word-lib.js`:
```ts
export const SAMPLE_RATE = 16000
export const FRAME_SIZE = 1280
export const VAD_THRESHOLD = 0.5
export const DETECT_THRESHOLD = 0.5
export function computeRms(chunk: Float32Array): number  // sqrt(mean(x^2))
export function transformMel(data: Float32Array): void   // x/10 + 2 במקום (AHA #1)
// ⚠️ ב-POC הנוסחה הזו inline בתוך runMelspec (wake-word-lib.js), לא פונקציה נפרדת.
// כאן מחלצים אותה לפונקציה טהורה חדשה (כדי שתהיה testable). pipeline.ts יקרא לה.
```
**`engines/wake-word/wav.ts`**:
```ts
export function encodeWav(frames: Float32Array[], sampleRate = SAMPLE_RATE): Uint8Array | null
// header 44B + PCM16 (זהה ל-createWavBlob ב-POC, אבל מחזיר Uint8Array; null אם ריק)
```
- **טסטים:** computeRms (סינוס ידוע), transformMel (ערך בודד), encodeWav
  (header RIFF/WAVE/fmt/data נכון, אורך PCM = frames*2 בייט, null על []).
- testing: **tdd**.
- DoD: typecheck + tests ירוקים. אין import של ort/DOM בקבצים האלה.

### Commit 3 — engine: pipeline + vad (mock ort בטסט)
**`engines/wake-word/types.ts`** — ArkType schemas + types:
- `WakeWordConfig` (keywords, baseAssetUrl, thresholds, cooldownMs, vadHangoverFrames).
- event payload types: `DetectEvent {keyword, score, sinceVadStart}`, `VadEndEvent {frames}`.
**`engines/wake-word/vad.ts`**:
```ts
export function createVadState(): { h: Tensor; c: Tensor }
export async function runVadStep(session, frame, state): Promise<number>  // prob 0..1
```
**`engines/wake-word/pipeline.ts`** — ⚠️ הלקח הקריטי מה-POC:
```ts
export function inferWindowSize(session, fallback = 16): number  // מ-inputMetadata.shape[1]
export function createScorePipeline({ melModel, embModel, classifiers }):
  { windows: Record<string,number>; reset(): void; push(frame): Promise<Record<string,number>|null> }
```
- **window-size שונה לכל classifier** (16/22/34) — חובה הסקה, לא קבוע. embBuffer
  בגודל max-window; כל classifier מקבל את ה-N האחרונים (ראה POC `runClassifier`).
- mel buffer 76, hop 8 (AHA #2/#3).
- **טסטים (mock InferenceSession):** session מזויף שמחזיר tensors ידועים →
  inferWindowSize מחזיר shape[1], pipeline מחזיר null עד שחלון 76 מתמלא, ואז
  scores לכל keyword. window slicing נכון.
- testing: **tdd** (mock ort — אין דפדפן).
- DoD: typecheck + tests. `onnxruntime-web` types בלבד (import type).

### Commit 4 — engine: WakeWordEngine + capture (IO)
**`engines/wake-word/wake-word-engine.ts`** — `WakeWordEngine`:
- `constructor(config)`, `async load()` (InferenceSession.create לכל מודל),
  `async start()` (getUserMedia + AudioWorklet → frames), `async stop()`.
- emitter (אפשר להעתיק `createEmitter` מ-POC או פשוט Set<handler> per event).
- אירועים: `ready`, `frame`, `level`, `vadStart`, `vadEnd`, `detect`, `score`, `error`.
- gating ל-detect: `score>threshold && vadActive && !cooldown`.
- `get frameIndex`.
**`engines/wake-word/capture.ts`** — `WakeWordCapture`:
- `pushFrame(frame)`, `start()`, `stop(trimFrames): {wavBytes, frames}|null`,
  `abort()`, `get capturing`.
- משתמש ב-`encodeWav` מ-Commit 2.
- testing: **manual** (IO — מיקרופון). capture עצמו (buffer/trim) → אפשר unit test
  קטן (push N frames, stop, אורך נכון). engine IO → manual ב-route.
- DoD: typecheck. אין $state כאן (זה engine, לא VM).

### Commit 5 — view-model: WakeWordVM
**`view-models/wake-word.svelte.ts`**:
```ts
export type WakeWordMode = "off" | "listening" | "recording"
export class WakeWordVM {
  mode: WakeWordMode = $state("off")
  level = $state(0)            // RMS גולמי (ההחלקה ב-component)
  flashCount = $state(0)       // מונה — מוגדל בכל detect
  lastError: string | null = $state(null)
  // מחזיק WakeWordEngine + WakeWordCapture
  // toggle(): off↔listening (לחיצת הנורית)
  // $effect: mode → engine.start/stop  (חוק זהב #4)
  // מאזין לאירועי engine: level→this.level, frame→capture.pushFrame,
  //   detect→ flashCount++, החלפת recording↔listening + capture start/stop,
  //   על stop של capture: cue + השמעה מושהית (~1s)
  // צלילי cue (OscillatorNode) — כאן (VM), כמו app.js ב-POC
}
```
- **i18n:** שגיאות/סטטוס דרך core/i18n אם מוצגים (lastError כ-MessageKey).
- testing: **integration** (mock engine — להזריק אירועים, לבדוק מעברי mode +
  flashCount + capture start/stop).
- DoD: typecheck + tests. ה-effect לא רץ ב-SSR (ה-route SPA, אבל לוודא guard).

### Commit 6 — component: VoiceOrb
**`components/VoiceOrb.svelte`** (`<script>` < 50 שורות):
- props: `{ vm: WakeWordVM }` (או getContext — ראה §4 להכרעה).
- גודל + brightness מחושבים מ-`lerp(prev, vm.level, factor)` ב-rAF/$effect
  (ההחלקה כאן, משתמש ב-`lerp` מ-core).
- צבע לפי `vm.mode` (אפור/כחול/אדום) — transition CSS ארוך (~300ms).
- size/filter — transition קצר (~80ms). **שני timings על properties שונים**
  (הלקח מה-POC — לא לשים transition ארוך על ערך per-frame).
- flash: `$effect` שמגיב ל-`vm.flashCount` → מפעיל אנימציית הבזק.
- הנורית = כפתור (role=button, click → vm.toggle()).
- CSS: זהה ל-`poc/wake-word-orb/index.html` (.orb-dom-core וכו').
- testing: **manual** (ויזואלי) + אפשר component test בסיסי (render לפי mode).
- DoD: typecheck.

### Commit 7 — route בדיקה + assets + dependency
- **`package.json`**: הוסף `"onnxruntime-web": "^1.22.0"` ל-dependencies.
  `pnpm install`.
- **`static/wake-word/models/`**: העתק **7** קבצי .onnx מ-`poc/wake-word-orb/assets/models/`
   (3 משותפים: mel/embed/vad + 4 keywords: jarvis/alexa/mycroft/rhasspy.
   **לא** timer/weather — ראה §6 לרשימה המדויקת.)
   ⚠️ binaries — לוודא שלא נחסמים ע"י .gitignore לא רצוי (static אמור להיכלל).
- **`src/routes/wake-word-test/+page.svelte`** — ה-consumer היחיד:
  - יוצר `new WakeWordVM(...)` (route זה standalone, לא דרך +layout — מותר כי
    זה route בדיקה מבודד, לא חלק מה-app shell. תיעוד בהערה למה חריג).
  - מרנדר `<VoiceOrb>`, סטטוס, ושמירת הקלטות (כמו ה-POC).
  - baseAssetUrl = `/wake-word/models`.
- testing: **manual** — `pnpm dev`, נווט ל-/wake-word-test, אמור wake word,
  ראה נורית מגיבה + clip נשמר.
- DoD: typecheck + build נקיים. הדף עובד בדפדפן (calev יאמת).

## 4. נקודות עדינות / הכרעות מימוש

- **שמות מ-POC → production (renames מכוונים):** ה-brief נותן שמות שונים מה-POC,
  בכוונה (התאמה לקונבנציות FE). מיפוי כדי שלא תחפש לשווא ב-POC:
  - `WakeWordEngine` (brief) ← `WakeWordDetector` (POC `wake-word-lib.js`).
  - `runVadStep` (brief) ← `runVad` (POC).
  - `WakeWordCapture.stop(trimFrames)` (brief, פרמטר) ← ב-POC ה-trim נקרא מ-DOM
    input (`trimInput.value`); כאן הוא פרמטר מפורש (engine לא יודע על DOM).
  - `encodeWav→Uint8Array` (brief) ← `createWavBlob→Blob` (POC); ה-VM/route עוטף
    ל-Blob. הלוגיקה (header+PCM16) זהה.
- **VM ב-route, לא ב-+layout:** חוק זהב אומר ש-VMs נוצרים ב-+layout. כאן חריג
  מכוון — זה route בדיקה standalone שלא חלק מה-app. ה-VM נוצר ב-route עצמו
  ומת איתו. **לתעד בהערה.** (לא להוסיף ל-context.ts — זה לא singleton של האפליקציה.)
- **VoiceOrb מקבל vm כ-prop** (לא getContext) — כי ה-VM לא ב-context. פשוט יותר
  לבדיקה.
- **i18n:** ה-route עצמו יכול להשתמש במחרוזות אנגליות פשוטות? **לא** — חוק
  lint-no-hebrew חוסם עברית, אבל אנגלית מותרת בקוד. עם זאת, אם מציגים טקסט
  למשתמש, עדיף i18n. לבדיקה — אנגלית פשוטה ב-route מקובלת (זה לא ממשק production).
- **encodeWav מחזיר Uint8Array** (לא Blob) — כדי שיהיה טהור/testable. ה-route/VM
  עוטף ל-`new Blob([bytes], {type:"audio/wav"})` ליצירת URL.
- **onnxruntime-web ב-engine:** `import * as ort from "onnxruntime-web"`.
  `ort.env.wasm.numThreads = 1` (single-thread, עוקף COOP/COEP — הלקח מה-POC).

## 5. Definition of Done (calev light)

1. `pnpm --filter @drive-coding/core typecheck` + core tests ירוקים (lerp + audio-math + wav + pipeline).
2. `pnpm --filter @drive-coding/frontend-v2 typecheck` נקי.
3. `pnpm --filter @drive-coding/frontend-v2 build` נקי.
4. `pnpm lint:i18n` נקי (אין עברית קשיחה).
5. `/wake-word-test` נטען, המודלים נטענים (סטטוס "ready").
6. לחיצה על הנורית → מאזין (כחול). אמירת wake word → נורית אדומה + cue.
   אמירה שנייה → חזרה לכחול + clip נשמר + השמעה אוטומטית.
7. הנורית מגיבה לעוצמת קול (גודל + גוון) ול-VAD/detect (flash).
8. **אפס שינוי** ב: Mic, +layout.svelte, context.ts, routes קיימים (/, /chat, /settings).
   (calev: `git diff --stat poc-wake-word` — רק קבצים חדשים + package.json + core/index.ts + core/ui/).
9. כל 4 ה-keywords נטענים בלי קריסת window-size (jarvis/alexa/mycroft/rhasspy).

## 6. assets — רשימת המודלים להעתקה

מ-`poc/wake-word-orb/assets/models/` ל-`packages/frontend/static/wake-word/models/`:
- `melspectrogram.onnx`, `embedding_model.onnx`, `silero_vad.onnx` (משותפים)
- `hey_jarvis_v0.1.onnx`, `alexa_v0.1.onnx`, `hey_mycroft_v0.1.onnx`, `hey_rhasspy_v0.1.onnx`
- **לא** להעתיק: `timer_v0.1.onnx`, `weather_v0.1.onnx` (false positives).
- (ה-MODEL_FILE_MAP ב-types.ts יכלול רק את ה-4.)

## 7. מה לא בתכולה (out of scope)

- מיזוג ל-Mic FSM / app shell (slice 17 עתידי).
- אימון מילה חדשה (drive-coding / עברי — track נפרד).
- lazy-load אופטימיזציה.
- Settings UI / CarMode.
- onnxruntime-web vendoring (CDN/local wasm tuning — אם ה-build לא מוצא wasm,
  זו נקודת עצירה: דווח למרדכי, אל תאלתר).

## 8. risks

| סיכון | מיטיגציה |
|---|---|
| onnxruntime-web + Vite/SvelteKit — טעינת wasm (CORS/MIME) | אם נשבר אחרי 2 גישות — עצור, דווח. ה-POC עבד עם CDN; ב-bundle ייתכן שצריך config ל-wasm assets. |
| window-size bug חוזר | הטסט ב-Commit 3 חייב לכסות מודל עם window≠16 (mock). |
| static binaries לא נכללים ב-build | calev מאמת שהמודלים נגישים מ-/wake-word/models בזמן ריצה. |
| SSR מנסה להריץ engine | ה-route SPA (ssr=false קיים ב-+layout.ts); ה-effect/load מאחורי onMount/browser guard. |

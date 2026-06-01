# Slice 17 — Wake Word ("Hey Jarvis") — תוכנית

> **תאריך**: 2026-05-29
> **סטטוס**: ‏טיוטה ‏(v2 — ‏toggle ‏ב-מילה ‏אחת) — ‏ממתינה ל-plan-verifier
> **Complexity**: 8/10 (verifier: **heavy**)
> **תלות**: slice 3 (Mic + VoiceMode FSM) — ✅ merged ‏ל-dev. ‏אין תלות ב-slice 6/7.
> **Base**: dev tip `aa0b73a` (merge: slice 15 a+b+c)
> **מתבסס על**: ‏`docs/investigations/wake-word-client-side.md` (מחקר ‏מקדים — ‏must-read)

> **‏עדכון ‏ארכיטקטורה ‏(v2)**: ‏מילת-מפתח ‏אחת ‏(`hey_jarvis`) ‏עושה **toggle** — ‏אמירה ‏ראשונה ‏מתחילה ‏הקלטה, ‏שנייה ‏עוצרת. ‏**אין VAD auto-stop ‏כברירת מחדל** ‏(המשתמשת ‏שונאת ‏שהקלטה ‏נקטעת ‏באמצע ‏מחשבה). ‏ה-WakeWordEngine ‏רץ ‏always-on ‏(לא ‏נעצר), ‏ה-Recorder ‏על ‏stream ‏שני ‏נפרד. ‏ראה §3.

---

## §0 — Pre-flight

> ‏אם אתה ‏executor חדש: ‏קרא את [`EXECUTOR_DISPATCH.md`](./EXECUTOR_DISPATCH.md) ‏לפני כל דבר אחר.

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-17-wake-word -b slice-17-wake-word dev
cd .worktrees/slice-17-wake-word
pnpm install
pnpm hooks:install
```

### Ports

| ‏מה | ‏פקודה |
|---|---|
| ‏BE (אופציונלי — ‏אין שינוי ב-BE) | `cd packages/backend && PORT=4003 onecli run --agent voice-acp -- bun --watch src/server.ts` |
| ‏FE | `BE_PORT=4003 pnpm --filter @drive-coding/frontend-v2 dev` |

‏אם 4003 ‏תפוס — ‏לפי §2 ‏של DISPATCH, ‏בחר ‏הבא ‏החופשי. ‏אל ‏תהרוג ‏BE/FE/tunnel ‏אחר.

### Browser

**‏חובה HTTPS ל-getUserMedia**. ‏שתי אפשרויות:
1. ‏Tunnel (מומלץ ל-mobile + ‏feedback אמיתי על mic):
   ```bash
   ssh -i ~/.ssh/pico -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 \
     -R drive-coding-s17:80:localhost:<vite-port> tuns.sh http
   ```
   URL: `https://your-app-s17.nue.tuns.sh`
2. ‏Localhost ‏ב-Chrome מקומי — ‏Chrome ‏מתייחס ‏ל-localhost ‏כ-secure ‏אז ‏getUserMedia ‏עובד גם ‏על http://localhost:5173.

‏לבדיקה ‏ה-localhost מספיק. ‏לבדיקת mobile/CarMode ‏הproject ‏צריך tunnel.

### OneCLI agent

‏ה-Wake Word ‏לא מצריך OneCLI ‏בשום שלב (הכל ‏מקומי). ‏ה-FE Vite proxy ‏עדיין מתחבר ‏ל-BE ‏(לשאר ה-app), ‏אבל ‏ה-API ‏לא דרוש ‏לפיתוח slice 17 ‏עצמו.

### Reading list

**‏must-read לפני** (~20 ‏דקות):

1. ‏**`docs/investigations/wake-word-client-side.md`** — ‏המחקר המקדים, ‏כל ההחלטות שם. §6 ‏מתאר ‏בדיוק ‏את הפתרון שאנו בונים.
2. ‏`packages/frontend/AGENTS.md` — ‏5 ‏חוקי הזהב + ‏מבנה 5 ‏שכבות.
3. ‏`packages/frontend/src/lib/view-models/mic.svelte.ts` — ‏ה-VM שמורחב. ‏לקרוא ‏כולו (109 ‏שורות).
4. ‏`packages/frontend/src/lib/engines/recorder.ts` — ‏ה-engine שמתחבר אחרי trigger (58 ‏שורות).
5. ‏`docs/conventions/parallel-safe-code.md` §1, §2 — ‏additive design ‏ל-`context.ts` + `+layout.svelte`.

**reference**:

- ‏`packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` — ‏איך derived VM ‏עוקב אחרי states.
- ‏`packages/frontend/src/lib/engines/audio-stream.ts` — ‏דוגמה ל-engine ‏עם Web Audio API.
- ‏`~/.config/opencode/learnings.md` 2026-05-16 — `gotcha: Svelte 5 $effect that reads+writes same $state = infinite loop`.

---

## §1 — מטרה

‏אישה מדברת ‏עם הסוכן בלי לגעת בטלפון, ‏ובלי ‏שמשהו ‏יקטע ‏אותה ‏באמצע ‏מחשבה:
1. ‏המנוע הקליל ‏רץ ‏ברקע always-on. ‏היא אומרת "**Hey Jarvis**" → ‏ביפ קצר ‏מאשר ‏זיהוי
2. ‏הקלטה מתחילה
3. ‏היא ‏מדברת ‏את ‏הפקודה — ‏יכולה ‏לעצור, ‏לחשוב, ‏להמשיך. ‏**שום ‏דבר ‏לא ‏קוטע ‏אותה.**
4. ‏היא ‏אומרת "**Hey Jarvis**" ‏שוב → ‏הקלטה ‏נעצרת
5. ‏ה-audio ‏נשלח ל-Gemini (קיים) → ‏טקסט → ‏ACP → ‏סוכן
6. ‏ה-app חוזר למצב "listening" ‏לפעם הבאה

‏כל זה בצד-לקוח לחלוטין. ‏רק האודיו של ‏הפקודה (לא ‏ההאזנה המתמשכת) יוצא ‏לענן. ‏מילת-המפתח ‏היא **toggle אחד** — ‏אותה ‏מילה ‏מתחילה ‏ועוצרת.

‏**אפשרות ל-VAD auto-stop ‏לאחרים**: ‏יש Setting ‏`autoStopMode: "wakeword" | "vad"`. ‏ברירת מחדל ‏`wakeword` ‏(מילה ‏שנייה ‏עוצרת). ‏מי ‏שמעדיף ‏עצירה ‏אוטומטית ‏על ‏שתיקה — ‏בוחר `vad` (משתמש ‏ב-`speech-end` ‏שכבר ‏קיים ‏בספרייה).

‏עברית באיטרציה הבאה — ‏כרגע "Hey Jarvis" ‏מספיק להוכחת תהליך.

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏Wake-word detection ‏ל-"Hey Jarvis" ‏always-on | ✅ | ‏Commit 1-2 |
| ‏**Toggle**: ‏מילה ‏ראשונה ‏start, ‏שנייה ‏stop | ✅ | ‏Commit 2 |
| ‏Recorder ‏על ‏stream ‏שני ‏נפרד (לא ‏מתנגש ‏עם WakeWord) | ✅ | ‏Commit 2 |
| ‏Mic FSM ‏מורחב: ‏`listening` ‏state חדש | ✅ | ‏Commit 2 |
| ‏Setting `autoStopMode: "wakeword" \| "vad"` (default wakeword) | ✅ | ‏Commit 3 |
| ‏VAD auto-stop ‏(opt-in דרך Setting) | ✅ | ‏Commit 2-3 (`speech-end` listener) |
| ‏UI feedback: ‏אייקון 👂 ב-MicButton ‏ב-listening | ✅ | ‏Commit 3 |
| ‏Setting: ‏`wakeWordEnabled` (ברירת מחדל: ‏off) | ✅ | ‏Commit 3 |
| ‏cue audio ‏על trigger (ביפ ‏קליל) | ✅ קליל | ‏Commit 2 (oscillator inline) |
| ‏i18n keys ‏חדשים | ✅ | ‏Commit 3 |
| ‏**Single-stream + patch** (חיסכון mic כפול) | ❌ | **future** — ‏ראה §10 |
| ‏**מילת-מפתח + פקודה ("Hey Jarvis, החלף סשן")** | ❌ | **future** — ‏ראה §10 |
| ‏Wake-word ‏עברי (custom-trained) | ❌ | ‏future (אותה תשתית, ‏רק `.onnx` ‏שונה) |
| ‏בחירת wake-word מ-UI ‏(jarvis / alexa / mycroft) | ❌ | ‏slice 9 (Settings page) |
| ‏Audio cue dedicated מ-`CuesEngine` (slice 6) | ❌ | ‏slice 6 ‏עוד ‏לא ‏merged. ‏ב-slice 17 — beep inline ‏עצמאי |
| ‏Wake lock / ‏background tab | ❌ | ‏slice 7 (CarMode) |
| ‏Media Session integration | ❌ | ‏slice 7 |
| ‏Mobile testing מעמיק | 🟡 | ‏smoke בלבד ב-slice 17. ‏slice 7 ‏יסגור |

---

## §3 — Architecture

```
‏TWO independent getUserMedia streams from the SAME mic (browser allows it):

‏Stream #1 (always-on)                    Stream #2 (only while recording)
        │                                          │
        ▼                                          ▼
┌──────────────────────────┐         ┌──────────────────────────┐
│ WakeWordEngine (lib)      │         │ Recorder (EXISTING)      │
│  melspectrogram.onnx 700K │         │  MediaRecorder wrapper   │
│  embedding_model.onnx 1.3M│         │  → Blob (webm/opus)      │
│  silero_vad.onnx     2M   │         └────────────┬─────────────┘
│  hey_jarvis_v0.1.onnx 1M  │                      │
│                           │                      │ blob
│ NEVER stops while         │                      ▼
│ wake-word is enabled.     │              transcribe() → sendPrompt()
│ event: 'detect'           │              (EXISTING flow, unchanged)
└────────────┬──────────────┘
             │ on('detect', "hey_jarvis")  ← TOGGLE
             ▼
┌─────────────────────────────────────────────────────────┐
│ WakeWordListener engine (NEW, ~70 lines TS)              │
│  start() / stop() / onTrigger / onSpeechEnd / onError    │
│  wraps lib as-is (NO patch, NO fork)                     │
└────────────┬─────────────────────────────────────────────┘
             │ onTrigger → Mic.#handleTrigger()
             ▼
┌─────────────────────────────────────────────────────────┐
│ Mic VM (CHANGED — FSM extended)                          │
│                                                          │
│   idle ──toggleListening()──► listening                  │
│    ▲                            │                        │
│    │  toggleListening()         │ onTrigger #1 (start)   │
│    │                            ▼                        │
│    │                         recording ◄──┐              │
│    │                            │         │ (autoStop=   │
│    │            onTrigger #2     │         │  vad → also  │
│    │            (stop)  OR       │         │  speech-end) │
│    │            speech-end(vad)  ▼         │              │
│    └──────────  transcribing ────┘                       │
│                     │                                    │
│                     ▼ sendPrompt → resume listening      │
│                                                          │
│  toggle() ‏(unchanged) — ‏push-to-talk ‏עדיין ‏עובד        │
└──────────────────────────────────────────────────────────┘
```

**‏עקרונות:**
1. ‏**שני getUserMedia ‏נפרדים ‏מאותו mic.** ‏הדפדפן ‏מרשה. ‏WakeWordEngine ‏על ‏אחד (always-on), ‏Recorder ‏על ‏שני (רק ‏בזמן ‏הקלטה). ‏אין race, ‏אין stop/restart ‏של ‏ה-listener.
2. ‏**ה-WakeWordEngine ‏לא ‏נעצר** ‏כל ‏עוד ‏wake-word ‏enabled — ‏גם ‏בזמן ‏שמקליטים. ‏ככה ‏הוא ‏שומע ‏את ‏ה-toggle ‏השני.
3. ‏**Toggle**: ‏`detect` ‏ראשון ‏(ב-listening) → ‏start recording. ‏`detect` ‏שני ‏(ב-recording) → ‏stop. ‏אותה ‏מילה.
4. ‏**ה-push-to-talk ‏הקיים** ‏(`toggle()`) ‏נשמר ‏ב-100%.

**‏⚠️ Cooldown gotcha** (‏מקוד ‏הספרייה): ‏`detect` ‏חסום ‏ע"י ‏`cooldownMs` (default 2000) — ‏אחרי ‏detect ‏ראשון, ‏השני ‏לא ‏יפלוט ‏תוך ‏2 ‏שניות. ‏ל-toggle ‏זה ‏גרוע: ‏אם ‏המשתמשת ‏אומרת "Hey Jarvis... <פקודה קצרה>... Hey Jarvis" ‏מהר — ‏ה-stop ‏יוחמץ. ‏**פתרון**: ‏העבר ‏`cooldownMs: 500` ‏ל-WakeWordEngine. ‏ראה §6 risk 12.

‏קבצים ‏חדשים:
- ‏`packages/frontend/src/lib/engines/wake-word-listener.ts` — ‏העוטף (~70 ‏שורות)
- ‏`packages/frontend/static/openwakeword/models/*.onnx` — ‏4 ‏מודלים (~5MB)
- ‏`packages/frontend/src/lib/view-models/mic.test.svelte.ts` — ‏integration tests ל-FSM

‏קבצים ‏שמשתנים:

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/frontend/package.json` | ‏`openwakeword-wasm-browser`: `file:./vendor/openwakeword-wasm-browser-0.1.0.tgz` (vendored) | ‏לא-additive (dependency) |
| ‏`packages/frontend/src/lib/view-models/mic.svelte.ts` | ‏הוסף ‏state `listening` ‏ל-type, ‏הוסף ‏method ‏`toggleListening()`, ‏הוסף ‏private `#listener: WakeWordListener \| null`. ‏ה-`toggle()` ‏הקיים ‏לא ‏משתנה. | ‏Invasive על FSM type, additive על methods. ‏ראה §6 risk 7. |
| ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` | ‏הוסף `wakeWordEnabled` ‏**ו-`autoStopMode`** ‏ב-**ארבעה** ‏מקומות לפי הconvention שמוסבר בראש הקובץ: (א) `Persisted` type, (ב) `DEFAULTS`, (ג) `$state` fields + setters ‏ב-section ‏חדש `// ─── wake-word ───`, (ד) `#persist()`. ‏ראה הנחיות ‏הקובץ ‏שורות 4–11 ‏ו-§3.2. | Additive ‏ב-4 ‏סעיפים |
| ‏`packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts` | ‏הוסף `"listening"` ‏ל-`VoiceModeState` union + ‏ל-`$derived.by` ‏(לפני בדיקת `recording`). ‏ה-MicButton ‏צופה רק ב-`voiceMode.state` (לא `mic.state`), ‏לכן חובה לעדכן גם פה כדי שאייקון 👂 ייראה. | Additive |
| ‏`packages/frontend/src/lib/context.ts` | ‏אין שינוי. ‏ה-WakeWordListener ‏הוא ‏engine, ‏לא VM ‏— ‏הוא ‏מנוהל ‏ע"י Mic ‏פנימית. | — |
| ‏`packages/frontend/src/routes/+layout.svelte` | ‏Additive: ‏`$effect` חדש ‏ב-Commit 3 ‏שמסנכרן `settings.wakeWordEnabled` ‏↔ ‏`mic.toggleListening`. ‏ב-section ‏ייעודי `// ─── wake-word effect ───` ‏בסוף ‏ה-script. | Additive |
| ‏`packages/frontend/src/lib/components/MicButton.svelte` | ‏הוסף ל-`ICONS`, ‏ל-`statusKey()`, ‏ולCSS ‏סקציית state ‏עבור `listening` (אייקון 👂, ‏רקע ‏אחר, ‏animation עדינה). ‏עדכן `onClick`: ‏אם state="listening" → ‏no-op (toggle ‏רגיל לא רלוונטי כאן). | Additive |
| ‏`packages/core/src/i18n/catalogs/he.ts` ‏+ ‏`en.ts` | ‏הוסף keys ‏חדשים: ‏`mic.listening`, ‏`mic.wakeWordHint` | Additive |
| ‏`packages/core/src/i18n/keys.ts` | ‏הוסף שני ה-keys ‏ל-union `MessageKey` | Additive |

---

## §4 — Commits ‏בסדר

### Commit 0 — Vendor library + assets (approach: **none**)

‏הורדת הלייברי וה-models. ‏אין tests, ‏רק typecheck + build.

**‏פעולות**:

1. ‏הורד את `openwakeword-wasm-browser-0.1.0.tgz` ‏מ-`https://github.com/dnavarrom/openwakeword_wasm/raw/main/openwakeword-wasm-browser-0.1.0.tgz`:
   ```bash
   mkdir -p packages/frontend/vendor
   curl -L -o packages/frontend/vendor/openwakeword-wasm-browser-0.1.0.tgz \
     https://github.com/dnavarrom/openwakeword_wasm/raw/main/openwakeword-wasm-browser-0.1.0.tgz
   ```

2. ‏הורד את ה-models מ-`https://github.com/dnavarrom/openwakeword_wasm/tree/main/models`:
   ```bash
   mkdir -p packages/frontend/static/openwakeword/models
   BASE=https://github.com/dnavarrom/openwakeword_wasm/raw/main/models
   for f in melspectrogram.onnx embedding_model.onnx silero_vad.onnx hey_jarvis_v0.1.onnx; do
     curl -L -o packages/frontend/static/openwakeword/models/$f "$BASE/$f"
   done
   ```

3. ‏הורד את ‏ort wasm:
   ```bash
   mkdir -p packages/frontend/static/openwakeword/ort
   # ה-ort wasm נמצא ב-node_modules/onnxruntime-web/dist/ אחרי install — נעתיק אז.
   ```
   (‏אחרי ‏ה-`pnpm install` ‏בPhase 4, ‏העתק `node_modules/onnxruntime-web/dist/ort-wasm*.wasm` ‏ל-`static/openwakeword/ort/`. ‏אם זה ‏לא ‏נמצא ‏— ‏ה-lib ‏יוריד ‏מ-CDN ‏אוטומטית. **‏ב-MVP — ‏סמוך על CDN, ‏אל ‏תcopy ‏ידנית**.)

4. ‏עדכן ‏`packages/frontend/package.json`:
   ```json
   "dependencies": {
     ...
     "openwakeword-wasm-browser": "file:./vendor/openwakeword-wasm-browser-0.1.0.tgz"
   }
   ```

5. ‏רוץ `pnpm install`.

**Verification**:

```bash
pnpm install                                # אין שגיאות
pnpm --filter @drive-coding/frontend-v2 typecheck   # ‏צריך לעבור (TS לא יודע על הlib עדיין — אם זורק על import, זה בPhase 1)
ls -lh packages/frontend/static/openwakeword/models/   # 4 קבצים, ~5MB סה"כ (embedding 1.3MB)
```

**Commit message**: `chore(frontend): vendor openwakeword-wasm-browser + hey_jarvis models`

**‏הערות**:
- ‏~5MB ‏ב-static/ ‏(לא 10) — ‏embed 1.3M, ‏vad 2M, ‏mel 700K, ‏classifier 1M. ‏יורד ‏רק ‏ב-lazy load. ‏לתעד ‏ב-walkthrough.
- ‏**ה-tarball ‏כולל ‏`src/index.d.ts` ‏מלא** — ‏אין ‏צורך ‏לכתוב ‏d.ts ‏ידני (בניגוד ‏למה ‏ש-Commit 1 ‏אמר ‏בגרסה ‏קודמת). ‏ה-types: ‏`WakeWordEngine`, ‏`WakeWordEngineOptions`, ‏`DetectEventPayload`, ‏event map ‏מלא.
- ‏ה-tarball ‏כולל ‏גם ‏`.tflite` ‏versions ‏(לא ‏בשימוש — ‏אנחנו ‏על ONNX). ‏אפשר ‏למחוק ‏אותם ‏מ-static ‏אם ‏רוצים ‏לחסוך ‏מקום, ‏אבל ‏הם ‏ב-node_modules ‏בכל ‏מקרה.

---

### Commit 1 — WakeWordListener engine (approach: **manual**)

‏עוטף ‏את ‏ה-`WakeWordEngine` של הlib. ‏API ‏פשוט שמתאים ל-stack שלנו.

**‏Testing approach**: **manual**. ‏הסיבה: ‏ה-pipeline ‏משתמש ‏ב-AudioWorklet + WASM + AudioContext — ‏לא ‏ניתן ‏לעטוף ‏ב-vitest node env ‏ללא mock כבד שלא יוסיף ערך. ‏Smoke test ‏ידני ‏ב-browser ‏ב-Phase 4 ‏יאמת ‏ש-`onTrigger` ‏אכן ‏פולט.

**קובץ חדש**: `packages/frontend/src/lib/engines/wake-word-listener.ts`

**API skeleton**:

```ts
/**
 * WakeWordListener — wraps openwakeword-wasm-browser for always-on detection.
 *
 * The 'detect' event fires when the wake word is heard with sufficient
 * confidence. 'speech-end' fires when Silero VAD detects silence after
 * speech began (used to auto-stop recording).
 *
 * Loads ~10MB of ONNX assets on first start() — cache them in the SW or
 * accept the one-time load cost.
 *
 * Stateful: do NOT instantiate twice (mic conflicts).
 */
import WakeWordEngine from "openwakeword-wasm-browser"

export type WakeWordKeyword = "hey_jarvis"  // expandable in future slices

export class WakeWordListener {
  state: "idle" | "loading" | "listening" | "error" = "idle"

  onTrigger?: (keyword: WakeWordKeyword, score: number) => void
  onSpeechEnd?: () => void
  onError?: (err: Error) => void

  readonly #keyword: WakeWordKeyword
  #engine: WakeWordEngine | null = null

  constructor(opts: { keyword: WakeWordKeyword } = { keyword: "hey_jarvis" }) {
    this.#keyword = opts.keyword
  }

  /**
   * Start listening. Idempotent — calling twice is safe (no-op on the 2nd).
   * Requires a user gesture before first call (browsers require this for
   * AudioContext + getUserMedia).
   */
  async start(): Promise<void>

  /** Stop listening, release the MediaStream + WASM resources. */
  async stop(): Promise<void>
}
```

**Implementation details** (‏לא ‏פסאודו — ‏כתוב ‏את ‏זה):

```ts
async start() {
  if (this.state === "listening" || this.state === "loading") return
  this.state = "loading"
  try {
    if (!this.#engine) {
      this.#engine = new WakeWordEngine({
        baseAssetUrl: "/openwakeword/models",
        // ortWasmPath omitted — fall back to onnxruntime-web CDN
        keywords: [this.#keyword],
        detectionThreshold: 0.5,
        cooldownMs: 500,   // ‏⚠️ ‏NOT 2000 — ‏toggle ‏צריך ‏detect ‏שני ‏מהר. ‏ראה §6 risk 12.
      })
      await this.#engine.load()
      this.#engine.on("detect", ({ keyword, score }) => {
        this.onTrigger?.(keyword as WakeWordKeyword, score)
      })
      this.#engine.on("speech-end", () => this.onSpeechEnd?.())
      this.#engine.on("error", (err) => {
        // ‏ה-lib ‏מטיפוס Error ‏לפי ‏ה-index.d.ts
        this.state = "error"
        this.onError?.(err)
      })
    }
    await this.#engine.start()
    this.state = "listening"
  } catch (e) {
    this.state = "error"
    const err = e instanceof Error ? e : new Error(String(e))
    this.onError?.(err)
    throw err
  }
}

async stop() {
  if (this.state === "idle") return
  if (this.#engine) {
    try {
      await this.#engine.stop()
    } catch (e) {
      console.warn("[wake-word-listener] stop failed", e)
    }
  }
  this.state = "idle"
}
```

‏**‏אסור** ‏להוסיף method ציבורי ‏מעבר ל-`start/stop` ‏ול-3 ‏ה-callbacks. ‏אם נדרש — ‏זה Escalation.

**‏TypeScript types**: ‏ה-tarball ‏**כבר ‏כולל** ‏`src/index.d.ts` ‏מלא (`WakeWordEngine`, ‏`WakeWordEngineOptions`, ‏`DetectEventPayload`, ‏event map). ‏**אל ‏תכתוב ‏d.ts ‏ידני** — ‏ה-import ‏`import WakeWordEngine from "openwakeword-wasm-browser"` ‏יקבל types ‏אוטומטית. ‏אם ‏typecheck ‏בכל ‏זאת ‏לא ‏מוצא ‏types (resolution issue ‏עם tarball) — ‏בדוק ‏ש-`package.json` ‏של ‏הlib ‏מצביע ‏ל-`types` field; ‏אם ‏לא, ‏רק ‏אז ‏הוסף ‏shim ‏מינימלי.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
# ‏לא ‏tests ‏ב-vitest — manual approach
```

**Commit message**: `feat(frontend): add WakeWordListener engine wrapping openwakeword-wasm-browser`

---

### Commit 2 — Mic FSM extension + integration (approach: **integration**)

‏הרחבת ‏Mic FSM ‏לטיפול ‏ב-wake-word. ‏זה ‏ה-commit ה-קריטי.

**‏Testing approach**: **integration**. ‏הסיבה: ‏אין logic ‏טהור כאן ‏(הכל ‏מתאם ‏בין מנועים). ‏אחרי ‏הקוד — ‏integration test ‏שמוודא:
- ‏`Mic.toggleListening()` ‏יוצר WakeWordListener (mock)
- ‏עם ‏stub `onTrigger` → ‏ה-`recording` state ‏נכנס + ‏Recorder.start ‏נקרא
- ‏עם ‏stub `onSpeechEnd` → ‏ה-transcribing ‏נכנס

**קובץ שמשתנה**: `packages/frontend/src/lib/view-models/mic.svelte.ts`

**FSM ‏חדש**:

```
‏State machine:
  idle ◄──────────────────────────────────┐
   │                                       │
   │ toggleListening()                    │ stop()
   │                                       │
   ▼                                       │
  listening (wake-word always-on)          │
   │                                       │
   │ onTrigger (wake-word detected)       │
   │                                       │
   ▼                                       │
  recording (Recorder rolling)             │
   │                                       │
   │ onSpeechEnd (Silero VAD silence)     │
   │                                       │
   ▼                                       │
  transcribing                             │
   │                                       │
   │ Gemini done → sendPrompt              │
   │                                       │
   └────► listening (back to wake-word) ───┘
          (‏אם ‏המשתמשת ‏ביקשה ‏listening)
   או
   └────► idle (אם ‏ה-listening ‏הופסק)
```

**‏שינויים ‏ל-Mic class**:

**‏עקרון ‏מרכזי**: ‏ה-WakeWordEngine ‏(דרך `#listener`) ‏**always-on** ‏כל ‏עוד ‏wake-word ‏enabled — ‏גם ‏בזמן ‏recording. ‏הוא ‏על ‏stream ‏נפרד ‏מה-Recorder. ‏ה-`onTrigger` ‏מבחין ‏בין ‏detect ‏ראשון ‏(start) ‏לשני ‏(stop) ‏לפי ‏`this.state`. ‏ה-`autoStopMode` ‏קובע ‏אם ‏גם ‏`speech-end` ‏(VAD) ‏עוצר.

```ts
// ‏בראש ‏הקובץ — ‏imports ‏חדשים:
import { WakeWordListener } from "../engines/wake-word-listener"

// ה-state type — ‏הוסף "listening":
export type MicState = "idle" | "listening" | "recording" | "transcribing"

export type AutoStopMode = "wakeword" | "vad"

export class Mic {
  state: MicState = $state("idle")
  error: MessageKey | null = $state(null)

  /** ‏מוזרק ‏מבחוץ ‏(ע"י ‏ה-effect ‏ב-+layout ‏מ-settings). ‏default wakeword. */
  autoStopMode: AutoStopMode = "wakeword"

  readonly #session: AgentSession
  readonly #recorder: Recorder
  #listener: WakeWordListener | null = null   // ‏חדש — ‏always-on ‏בזמן ‏listening+recording
  #wakeWordActive = false                      // ‏חדש — ‏האם ‏ה-wake-word ‏אמור ‏לרוץ

  constructor(opts: { session: AgentSession }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
  }

  // ‏ה-toggle() ‏הקיים — ‏לא ‏משנים אותו ‏כלל. ‏ה-push-to-talk ‏עובד ‏כמו ‏היום.

  /**
   * Enable/disable wake-word listening. Idempotent.
   * Called by a Settings effect when wakeWordEnabled changes.
   *
   * When enabled: starts the always-on WakeWordEngine (its own mic stream).
   * The engine stays running through the whole start→record→stop cycle.
   */
  toggleListening = async (): Promise<void> => {
    if (!this.#wakeWordActive) {
      // ‏הפעלה
      this.#wakeWordActive = true
      if (!this.#listener) {
        this.#listener = new WakeWordListener({ keyword: "hey_jarvis" })
        this.#listener.onTrigger = () => { void this.#handleTrigger() }
        this.#listener.onSpeechEnd = () => { void this.#handleSpeechEnd() }
        this.#listener.onError = (e) => {
          console.warn("[mic] wake-word error", e)
          this.error = "mic.error.generic"
          this.#wakeWordActive = false
          if (this.state === "listening") this.state = "idle"
        }
      }
      try {
        await this.#listener.start()   // ‏פותח getUserMedia #1 (always-on)
        if (this.state === "idle") this.state = "listening"
      } catch {
        this.#wakeWordActive = false
        this.state = "idle"
        this.error = "mic.error.generic"
      }
      return
    }

    // ‏כיבוי — ‏מבטל ‏את ‏ה-wake-word ‏לחלוטין
    this.#wakeWordActive = false
    await this.#listener?.stop()       // ‏סוגר getUserMedia #1
    if (this.state === "recording") {
      // ‏הקלטה ‏באמצע — ‏בטל ‏אותה ‏גם (Recorder = getUserMedia #2)
      void this.#recorder.stop().catch(() => {})
    }
    this.state = "idle"
  }

  /**
   * The wake word was detected. This is a TOGGLE:
   *   - in "listening" → start recording
   *   - in "recording" → stop + transcribe
   * The WakeWordEngine keeps running throughout (never stopped here).
   */
  async #handleTrigger(): Promise<void> {
    if (this.state === "listening") {
      // ‏detect #1 — ‏התחל ‏הקלטה ‏על ‏stream ‏שני ‏(Recorder ‏פותח getUserMedia ‏שלו)
      try {
        await this.#recorder.start()
        this.state = "recording"
        this.#beep(880, 100)   // ‏ביפ ‏start. slice 6 ‏יחליף ב-CuesEngine.
      } catch (e) {
        console.warn("[mic] recorder.start failed", e)
        this.error = "mic.error.generic"
        // ‏נשארים ‏ב-listening — ‏ה-wake-word ‏עדיין ‏רץ
      }
      return
    }

    if (this.state === "recording") {
      // ‏detect #2 — ‏עצור ‏הקלטה ‏ושלח
      this.#beep(660, 100)   // ‏ביפ ‏stop (תדר ‏שונה)
      await this.#finishRecording()
      return
    }

    // ‏transcribing ‏או ‏idle — ‏מתעלמים ‏(detect ‏לא ‏רלוונטי)
  }

  /**
   * Silero VAD reported silence after speech. ONLY acts when autoStopMode==="vad"
   * AND we're recording. In "wakeword" mode (default) this is ignored — the user
   * stops by saying the wake word again, NOT by being silent.
   */
  async #handleSpeechEnd(): Promise<void> {
    if (this.autoStopMode !== "vad") return   // ‏ברירת מחדל: ‏לא ‏קוטעים ‏על ‏שתיקה
    if (this.state !== "recording") return
    this.#beep(660, 100)
    await this.#finishRecording()
  }

  async #finishRecording(): Promise<void> {
    this.state = "transcribing"
    let blob: Blob
    try {
      const result = await this.#recorder.stop()   // ‏סוגר getUserMedia #2
      blob = result.blob
    } catch (e) {
      console.warn("[mic] recorder.stop() failed", e)
      this.error = "mic.error.generic"
      this.#resumeOrIdle()
      return
    }

    let text: string
    let recordingId: string
    try {
      const result = await transcribe(blob)
      text = result.text
      recordingId = result.recordingId
    } catch (e) {
      console.warn("[mic] transcribe() failed", e)
      this.error = "mic.error.transcribe"
      this.#resumeOrIdle()
      return
    }

    if (text.trim().length > 0) {
      void this.#session.sendPrompt(text, { recordingId })
    }
    this.#resumeOrIdle()
  }

  /**
   * After a recording cycle. The WakeWordEngine never stopped, so we just
   * flip state back. No listener.start() needed — it's still running.
   */
  #resumeOrIdle(): void {
    this.state = this.#wakeWordActive ? "listening" : "idle"
  }

  /** Inline beep — replaced by CuesEngine in slice 6+. */
  #beep(freq: number, ms: number): void {
    if (typeof AudioContext === "undefined") return
    try {
      const ctx = new AudioContext()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = freq
      osc.type = "sine"
      const t = ctx.currentTime
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.15, t + 0.005)
      gain.gain.linearRampToValueAtTime(0, t + ms / 1000)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + ms / 1000 + 0.05)
      setTimeout(() => void ctx.close(), ms + 100)
    } catch { /* ignore */ }
  }

  // ‏ה-cancel() ‏הקיים — ‏עדכן ‏לטפל ‏גם ‏ב-listening+recording:
  cancel(): void {
    if (this.state === "recording") {
      void this.#recorder.stop().catch(() => {})   // ‏סוגר getUserMedia #2
      // ‏ה-WakeWordEngine ‏ממשיך ‏לרוץ ‏(לא ‏נוגעים ‏בו)
      this.state = this.#wakeWordActive ? "listening" : "idle"
      this.error = null
      return
    }
    if (this.state === "listening") {
      // ‏‏Critical: ‏ללא ה-branch הזה, ‏VoiceMode.cancel() ‏בזמן listening ‏יותיר
      // ‏isCancelling=true לנצח (ה-$effect ב-VoiceMode מחכה ל-mic.state==="idle").
      this.#wakeWordActive = false
      void this.#listener?.stop().catch(() => {})
      this.state = "idle"
      this.error = null
      return
    }
    // ‏שאר ‏ה-states (transcribing) ‏כמו ‏היום — ‏אי-אפשר ‏לבטל ‏Gemini ‏באמצע
  }
}
```

**‏הערה ‏על ‏ה-existing `toggle()` (push-to-talk)**: ‏לא ‏משתנה. ‏edge case: ‏המשתמשת ‏ב-`listening` ‏ולוחצת ‏על MicButton. ‏החלטה (Commit 3): ‏ב-listening ‏ה-onClick ‏הוא ‏no-op — ‏הכיבוי ‏דרך long-press/Settings, ‏לא ‏click. ‏ה-`toggle()` ‏הקיים ‏לא ‏יודע ‏על listening ‏ולא ‏נקרא ‏שם.

**‏הבדל ‏מהותי ‏מ-v1**: ‏ה-WakeWordEngine ‏לא ‏נעצר ‏ב-trigger. ‏הוא ‏רץ ‏ברציפות ‏על ‏stream ‏#1. ‏ה-Recorder ‏פותח/סוגר ‏stream ‏#2 ‏נפרד. ‏אין ‏stop/restart ‏של ‏ה-listener, ‏אין ‏race ‏על ‏ה-mic ‏(שני ‏getUserMedia ‏עצמאיים).

**‏Integration tests**:

‏קובץ ‏חדש: ‏`packages/frontend/src/lib/view-models/mic.test.svelte.ts`

```ts
// ‏בדיקות ‏מינימליות ‏שמוודאות ‏שה-FSM ‏עובד (toggle ‏ב-מילה ‏אחת):
// 1. ‏Mic ‏מתחיל ‏ב-idle
// 2. ‏toggleListening() ‏מעביר ‏ל-listening, ‏יוצר WakeWordListener (mock), ‏listener.start נקרא
// 3. ‏onTrigger #1 (ב-listening) → ‏state="recording", ‏recorder.start נקרא, ‏listener.stop ‏לא ‏נקרא (always-on!)
// 4. ‏onTrigger #2 (ב-recording) → ‏transcribing → ‏recorder.stop + transcribe + sendPrompt → ‏חוזר ‏ל-listening
// 5. ‏autoStopMode="wakeword" (default): ‏onSpeechEnd ‏ב-recording → ‏no-op (NOT ‏עוצר)
// 6. ‏autoStopMode="vad": ‏onSpeechEnd ‏ב-recording → ‏כן ‏עוצר (transcribing)
// 7. ‏toggleListening() ‏שנייה ‏(ב-listening) → ‏listener.stop, ‏state=idle
// 8. ‏toggleListening() ‏בזמן ‏recording → ‏מבטל ‏הקלטה + ‏listener.stop + idle
// 9. ‏ה-toggle() ‏הקיים ‏עוד ‏עובד ‏ב-idle (push-to-talk regression)
// 10. ‏cancel() ‏ב-listening → ‏idle (לא ‏תקוע)
```

**‏Mock ‏ל-WakeWordListener**:

```ts
import { vi } from "vitest"

// ‏מאחר ‏ש-WakeWordListener ‏מוקצה ‏ב-toggleListening (לא ‏ב-constructor), ‏ה-mock
// ‏צריך ‏לחשוף ‏reference ‏ל-instance ‏האחרון ‏כדי ‏לדמות onTrigger/onSpeechEnd:
let lastListener: any
vi.mock("../engines/wake-word-listener", () => {
  class MockListener {
    state = "idle"
    onTrigger?: (k: string, s: number) => void
    onSpeechEnd?: () => void
    onError?: (e: Error) => void
    start = vi.fn(async () => { this.state = "listening" })
    stop = vi.fn(async () => { this.state = "idle" })
    constructor() { lastListener = this }
  }
  return { WakeWordListener: MockListener }
})
// ‏בטסט: ‏לאחר `await mic.toggleListening()`, ‏לקרוא ‏`lastListener.onTrigger!("hey_jarvis", 0.9)`.

// ‏גם mock ‏ל-Recorder (start/stop ‏מחזיר Blob ריק) ‏ול-transcribe (מחזיר {text:"x", recordingId:""}).
vi.mock("../engines/recorder", () => { ... })
vi.mock("../adapters/voice/transcribe", () => { ... })
```

**‏הערה ‏על ‏אבחנת ‏toggle ‏בטסט**: ‏ה-test ‏חייב ‏לקרוא ‏`lastListener.onTrigger()` ‏**פעמיים** ‏כדי ‏לכסות ‏את ‏שני ‏הצדדים ‏של ‏ה-toggle (start ‏אז stop), ‏ולוודא ‏ש-`lastListener.stop` ‏**לא** ‏נקרא ‏בין ‏לבין (ה-engine ‏always-on).

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test mic.test
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

**Commit message**: `feat(frontend): extend Mic FSM with wake-word listening state`

**‏⚠️ ‏Phase verifier ‏מומלץ אחרי ‏commit ‏הזה** — ‏ראה §8.

---

### Commit 3 — VoiceMode + Settings + UI feedback + i18n (approach: **manual**)

‏חיבור ‏הswitch ‏ל-Settings, ‏הוספת `listening` ‏ל-VoiceMode, ‏אייקון 👂 ב-MicButton, ‏מחרוזות i18n.

**‏Testing approach**: **manual**. ‏UI ‏פשוט, ‏בדיקה ‏בדפדפן.

**‏שינויים**:

#### 3.1 — i18n keys ‏(`packages/core/src/i18n/keys.ts`)

‏הוסף ‏ל-`MessageKey` union (additive — ‏בסוף):
```ts
| "mic.listening"               // ‏Hebrew: "‏ממתינה ל-Hey Jarvis"
| "voiceMode.status.listening"  // ‏Hebrew: "‏מקשיבה"
```
‏(הסרתי ‏keys ‏ל-Settings UI — ‏אין Settings page ‏ב-MVP. ‏autoStopMode ‏ללא UI ‏בשלב ‏הזה — ‏רק ‏ברירת ‏מחדל ‏`wakeword`. slice 9 ‏יוסיף ‏UI ‏מלא ‏עם ‏ה-keys ‏הנוספים.)

‏הוסף ערכים ‏ב-`packages/core/src/i18n/catalogs/he.ts` + ‏`en.ts`.

#### 3.2 — Settings: 4 ‏שינויים לפי הconvention שבראש הקובץ

‏הקובץ ‏`packages/frontend/src/lib/view-models/settings.svelte.ts` ‏מתעד ‏בראש (שורות 4–11) ‏ש-persistence ‏דורש 4 ‏פעולות. ‏בצע ‏את ‏כולן:

**שני שדות ‏חדשים**: ‏`wakeWordEnabled` ‏(boolean) ‏ו-`autoStopMode` (`"wakeword" | "vad"`).

**א. ‏`Persisted` type** (סביב שורה 24):
```ts
type Persisted = {
  cliKind: CliKind
  lastCwd: string
  voiceId: string
  beUrl: string
  wakeWordEnabled: boolean              // ← ‏חדש
  autoStopMode: "wakeword" | "vad"      // ← ‏חדש
}
```

**ב. ‏`DEFAULTS`** (סביב שורה 31):
```ts
const DEFAULTS: Persisted = {
  cliKind: "opencode",
  lastCwd: "",
  voiceId: DEFAULT_VOICE_ID,
  beUrl: "",
  wakeWordEnabled: false,     // ← ‏ברירת מחדל off
  autoStopMode: "wakeword",   // ← ‏ברירת מחדל: ‏המילה ‏עוצרת, ‏לא ‏שתיקה
}
```

**ג. ‏`$state` ‏fields + setters** ‏ב-section ‏חדש ‏בסוף ה-class (לפני `#persist()`):
```ts
// ─── wake-word ───

wakeWordEnabled = $state<boolean>(DEFAULTS.wakeWordEnabled)
autoStopMode = $state<"wakeword" | "vad">(DEFAULTS.autoStopMode)

setWakeWordEnabled = (v: boolean): void => {
  this.wakeWordEnabled = v
  this.#persist()
}

setAutoStopMode = (m: "wakeword" | "vad"): void => {
  this.autoStopMode = m
  this.#persist()
}
```

‏גם ‏ב-constructor (סביב שורה 75) ‏הוסף ‏אחרי `this.beUrl = loaded.beUrl`:
```ts
this.wakeWordEnabled = loaded.wakeWordEnabled
this.autoStopMode = loaded.autoStopMode
```

**ד. ‏`#persist()`** (סביב שורה 152):
```ts
#persist(): void {
  save({
    cliKind: this.cliKind,
    lastCwd: this.lastCwd,
    voiceId: this.voiceId,
    beUrl: this.beUrl,
    wakeWordEnabled: this.wakeWordEnabled,  // ← ‏חדש
    autoStopMode: this.autoStopMode,        // ← ‏חדש
  })
}
```

#### 3.3 — VoiceMode ‏(`packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts`)

‏ה-MicButton ‏צופה ‏רק ‏ב-`voiceMode.state`, ‏לכן חובה לחשוף ‏את `listening`:

```ts
export type VoiceModeState =
  | "idle"
  | "listening"     // ← ‏חדש
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "cancelling"
```

‏ב-`$derived.by` — ‏הוסף branch **‏לפני** `recording` (אחרי `isCancelling` ‏ולפני ‏ה-`mic.state === "recording"`):

```ts
state: VoiceModeState = $derived.by(() => {
  if (this.isCancelling) return "cancelling"
  if (this.#mic.state === "listening") return "listening"     // ← ‏חדש
  if (this.#mic.state === "recording") return "recording"
  if (this.#mic.state === "transcribing") return "transcribing"
  if (this.#speaker.state === "speaking") return "speaking"
  if (this.#session.status === "thinking") return "thinking"
  return "idle"
})
```

‏ה-`cancel()` ב-VoiceMode ‏לא ‏דורש שינוי — ‏הוא ‏קורא ‏ל-`mic.cancel()`, ‏ו-Mic.cancel() (שעודכן ב-Commit 2) ‏עובר ‏מ-listening ל-idle, ‏ואז ה-`$effect` ‏הקיים ‏מאפס ‏את ‏isCancelling. ‏בטוח.

#### 3.4 — Mic getter ‏+ `+layout.svelte` $effect ‏לסינכרון Settings ↔ Mic

**‏בעיה ‏שצריך ‏לפתור**: ‏ה-effect ‏לא ‏יכול ‏להסתמך ‏על ‏`mic.state === "idle"` ‏כדי ‏לדעת ‏אם ‏ה-wake-word ‏פעיל — ‏כי ‏בזמן ‏recording ‏ה-state ‏הוא ‏`"recording"` ‏אבל ‏ה-wake-word ‏עדיין ‏enabled. ‏לכן ‏ה-Mic ‏חושף ‏getter ‏שמשקף ‏את ‏ה-`#wakeWordActive` ‏הפנימי.

**א. ‏ב-`mic.svelte.ts`** — ‏הוסף getter ‏ציבורי (Commit 2 ‏או ‏3, ‏אך ‏הכי ‏הגיוני ‏ב-Commit 2 ‏עם ‏שאר ‏ה-FSM):
```ts
get isWakeWordActive(): boolean {
  return this.#wakeWordActive
}
```

**ב. ‏ב-`+layout.svelte`** — ‏section ‏ייעודי **‏בסוף ה-script** (אחרי ‏ה-wiring block):
```ts
// ─── wake-word effect ─── (slice 17)
$effect(() => {
  const enabled = settings.wakeWordEnabled
  const mode = settings.autoStopMode
  // ‏הזרק ‏את ‏ה-mode ‏ל-Mic (read מ-settings, ‏write ל-mic — ‏לא ‏אותו ‏$state, ‏בטוח)
  mic.autoStopMode = mode
  // ‏סנכרן ‏enabled ↔ wake-word active. ‏מסתמך ‏על ‏getter, ‏לא ‏על ‏mic.state.
  if (enabled && !mic.isWakeWordActive) {
    void mic.toggleListening()   // ‏מפעיל
  } else if (!enabled && mic.isWakeWordActive) {
    void mic.toggleListening()   // ‏מכבה
  }
})
```

**‏Verify ‏אין ‏infinite loop**: ‏ה-effect ‏קורא ‏`settings.wakeWordEnabled`, ‏`settings.autoStopMode`, ‏`mic.isWakeWordActive`. ‏הוא ‏כותב ‏ל-`mic.autoStopMode` (לא ‏reactive — ‏plain field) ‏וקורא ‏ל-`toggleListening` ‏(שמשנה ‏`#wakeWordActive`, ‏שזה ‏מאחורי getter). **‏שאלה ‏ל-verifier**: ‏האם ‏קריאת getter ‏`isWakeWordActive` ‏שמבוססת ‏על ‏`#wakeWordActive` (שהוא ‏**לא** ‏`$state`) ‏יוצרת ‏tracking? ‏אם ‏`#wakeWordActive` ‏הוא ‏plain field (לא `$state`), ‏ה-getter ‏לא ‏reactive ‏וה-effect ‏לא ‏יתעורר ‏ממנו → ‏בטוח. **חובה ‏לוודא ‏ש-`#wakeWordActive` ‏אינו ‏`$state`** (אחרת loop). ‏ה-trigger ‏היחיד ‏ל-effect ‏צריך ‏להיות ‏שינוי ‏ב-settings.

‏בנוסף — ‏אם `mic.state` ‏עובר ‏ל-recording/transcribing ‏(אחרי trigger), ‏ה-effect ‏מתעורר אבל ‏שני התנאים false → ‏no-op. ‏בסוף, ‏כשmic ‏חוזר ל-listening (`#resumeOrIdle`), ‏ה-effect ‏מתעורר, ‏שני התנאים false → ‏no-op. ‏מצוין.

#### 3.5 — MicButton ‏(`packages/frontend/src/lib/components/MicButton.svelte`)

‏המבט הראשון: ‏הקובץ מאתחל `ICONS` ‏ו-`statusKey` ‏מ-`VoiceModeState`. ‏אחרי שעדכנת ‏את ‏ה-union ‏ב-3.3 — ‏TypeScript ‏יכריח אותך לטפל ב-`"listening"`:

**א. ‏ICONS**:
```ts
const ICONS: Record<VoiceModeState, string> = {
  idle: "🎙",
  listening: "👂",       // ← ‏חדש
  recording: "⏺",
  transcribing: "🌀",
  thinking: "🌀",
  speaking: "🔊",
  cancelling: "✕",
}
```

**ב. ‏statusKey**:
```ts
function statusKey(s: VoiceModeState): MessageKey {
  switch (s) {
    case "idle":         return "voiceMode.status.idle"
    case "listening":    return "voiceMode.status.listening"  // ← ‏חדש
    case "recording":   return "voiceMode.status.recording"
    case "transcribing": return "voiceMode.status.transcribing"
    case "thinking":    return "voiceMode.status.thinking"
    case "speaking":    return "voiceMode.status.speaking"
    case "cancelling":  return "voiceMode.status.cancelling"
  }
}
```

**ג. ‏`onClick`**: ‏מה ‏לעשות ‏ב-listening?
```ts
function onClick() {
  if (voiceMode.state === "speaking" || voiceMode.state === "thinking") {
    voiceMode.cancel()
    return
  }
  if (voiceMode.state === "transcribing" || voiceMode.state === "cancelling") return
  if (voiceMode.state === "listening") return  // ← ‏חדש: ‏no-op. ‏הכיבוי דרך Settings/long-press.
  // idle or recording — push-to-talk ‏רגיל
  void mic.toggle()
}
```

**ד. ‏CSS**: ‏הוסף ‏אחרי `.mic-cancelling`:
```css
.mic-listening {
  background: #4a8a4a;  /* ‏ירוק רך — ‏שונה ‏מ-recording */
  animation: glow 2s ease-in-out infinite alternate;
}
```

#### 3.6 — ‏כפתור הפעלה ‏ל-wakeWord ‏ב-MVP

‏אין /settings route ‏עדיין (slice 9 ‏עוד ‏לא ‏מומש). ‏ב-MVP ‏שלנו — ‏הוסף ‏long-press handler ‏ל-MicButton: 800ms ‏לחיצה ‏מחליפה ‏את ‏`settings.wakeWordEnabled`.

‏ב-`MicButton.svelte` (script):
```ts
import { getSettings } from "$lib/context"
const settings = getSettings()

let pressTimer: number | null = null

function onPointerDown() {
  pressTimer = window.setTimeout(() => {
    settings.setWakeWordEnabled(!settings.wakeWordEnabled)
    pressTimer = null
  }, 800)
}

function onPointerUp() {
  if (pressTimer !== null) {
    window.clearTimeout(pressTimer)
    pressTimer = null
  }
}
```

‏ב-button: ‏הוסף `onpointerdown={onPointerDown}` ו-`onpointerup={onPointerUp}` ‏ו-`onpointerleave={onPointerUp}`.

‏החלטה: ‏long-press ‏הוא ‏זמני. ‏slice 9 (Settings page) ‏יחליף ‏ב-UI ‏רגיל.

**Verification ‏ידני** (‏ב-browser, ‏localhost:vite-port):

1. ‏פתח app, ‏וודא ‏שmic ‏לא ‏פעיל (כפתור ‏רגיל 🎙)
2. ‏Long-press ‏על MicButton 1 ‏שניה → ‏וודא ‏שאייקון ‏הפך ‏ל-👂
3. ‏Console: ‏וודא ‏שאין שגיאות. ‏מיקרופון ‏פעיל (אינדיקטור ‏בטאב)
4. ‏אמור "Hey Jarvis" ‏(אנגלית, ‏ברור) → ‏וודא ‏ביפ (880Hz) ‏+ ‏אייקון ‏הופך ‏ל-⏺ (recording)
5. ‏**דבר ‏עם ‏הפסקות** — ‏אמור ‏משפט, ‏שתוק ‏3 ‏שניות, ‏המשך. ‏וודא ‏ש-**ההקלטה ‏לא ‏נקטעה** (עדיין ⏺). ‏זה ‏ה-DoD ‏המרכזי — ‏אין VAD-stop.
6. ‏אמור "Hey Jarvis" ‏שוב → ‏וודא ‏ביפ (660Hz) ‏+ ‏transcribing 🌀 → ‏ה-prompt ‏המלא ‏(כולל ‏אחרי ‏ההפסקה) ‏נשלח ל-ACP
7. ‏וודא ‏שחזרנו ‏ל-listening (👂)
8. **‏toggle ‏מהיר**: ‏אמור "Hey Jarvis" ‏ומיד ‏"Hey Jarvis" ‏(תוך ‏שנייה) → ‏וודא ‏ש-start+stop ‏שניהם ‏נתפסו (cooldownMs=500 ‏מאפשר). ‏אם ‏ה-stop ‏מוחמץ — ‏ה-cooldown ‏גבוה ‏מדי.
9. ‏Long-press ‏שני → ‏וודא ‏שmic ‏חזר ‏לidle (אינדיקטור ‏מיקרופון ‏נעלם)
10. **‏Regression: ‏push-to-talk** — ‏long-press ‏off, ‏click ‏רגיל, ‏וודא ‏שעדיין ‏עובד ‏כמו ‏היום

**Verification ‏אוטומטי**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 test            # ‏לא ‏אמור ‏לשבור tests קיימים
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

**Commit message**: `feat(frontend): Settings toggle + MicButton listening state for wake-word`

---

### Commit 4 — walkthrough + slices.md + brief status (approach: **none**)

**‏קבצים**:
- ‏`docs/walkthrough.md` — ‏entry ‏על slice 17
- ‏`packages/frontend/docs/slices.md` — ‏הוסף slice 17 ‏בטבלה ‏(אם ‏לא ‏קיים) + ‏סטטוס ✅
- ‏`docs/plans/slice-17-wake-word.md` (זה) — ‏סטטוס → "‏הושלם"

‏אם מתגלות סטיות מ-brief תוך כדי — ‏תיעוד ‏ב-section ‏האחרון של ‏הbrief ‏הזה.

**Commit message**: `docs: slice 17 wake-word — walkthrough + status update`

---

## §5 — DoD verifiable

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | typecheck + build + tests + lint:i18n ‏ירוקים | `pnpm ... typecheck && build && test && pnpm lint:i18n` |
| 2 | ‏Mic ‏יש ‏state `listening` ‏ב-type | ‏typecheck (Mic.state ‏ל-value ‏לא-קיים ‏נדחה) |
| 3 | ‏Long-press על MicButton מפעיל wake-word | ‏ידני: ‏אייקון 👂 ‏מופיע, ‏אין שגיאה בconsole |
| 4 | ‏'Hey Jarvis' ‏מזוהה (detect #1) → ‏הקלטה ‏מתחילה | ‏ידני: ‏ביפ 880Hz, ‏אייקון ⏺, ‏state="recording" |
| 5 | **‏הקלטה ‏לא ‏נקטעת ‏על ‏שתיקה** (autoStopMode=wakeword) | ‏ידני: ‏דבר ‏עם ‏הפסקה ‏של 3s → ‏עדיין ⏺. ‏**ה-DoD ‏המרכזי.** |
| 6 | ‏'Hey Jarvis' ‏שני (detect #2) → ‏עוצר ‏ושולח | ‏ידני: ‏ביפ 660Hz, ‏transcribing, ‏ה-prompt ‏המלא ‏ב-ACP |
| 7 | ‏toggle ‏מהיר ‏(start+stop ‏תוך ‏שנייה) ‏נתפס | ‏ידני: ‏cooldownMs=500 ‏מאפשר. ‏בדוק ‏שה-stop ‏לא ‏מוחמץ |
| 8 | ‏WakeWordEngine ‏לא ‏נעצר ‏בין ‏start ל-stop | ‏integration test: ‏`lastListener.stop` ‏לא ‏נקרא ‏בין ‏שני ‏ה-triggers |
| 9 | ‏אחרי ‏הפקודה — ‏חוזר ‏ל-listening | ‏ידני: ‏אייקון ‏חוזר ‏ל-👂 |
| 10 | ‏autoStopMode="vad" → ‏שתיקה ‏כן ‏עוצרת | ‏integration test (אין UI ב-MVP — ‏בדיקה ‏דרך ‏הזרקת ‏`mic.autoStopMode="vad"`) |
| 11 | ‏Long-press שני → ‏עוצר ‏הכל | ‏ידני: ‏איקון ‏רגיל, ‏אינדיקטור ‏mic ‏נעלם |
| 12 | **Regression**: ‏push-to-talk ‏עם wake-word ‏כבוי | ‏ידני: ‏Click → ‏הקלטה → ‏Click → ‏transcribing → ‏prompt |
| 13 | **Regression**: ‏Mic FSM ‏לא ‏שובר flows ‏אחרים | ‏smoke run + ‏chat ‏רגיל ‏ידני |
| 14 | ‏cancel() ‏ב-listening → ‏idle (לא ‏תקוע ‏ב-cancelling) | ‏integration test |
| 15 | ‏Mobile smoke | ‏Tunnel + ‏Chrome ‏Android: ‏getUserMedia ×2 + AudioWorklet |
| 16 | ‏i18n: ‏אין מחרוזות עברית בקוד | `pnpm lint:i18n` |
| 17 | ‏Settings persistence: ‏wakeWordEnabled + autoStopMode ‏שורדים reload | ‏ידני: ‏localStorage |

---

## §6 — Risks + mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏Bundle size (~5MB ‏ב-static) | ‏ONNX models | ‏Lazy load — ‏רק ‏אחרי toggleListening ‏ראשון. ‏לא ‏ב-initial bundle. ‏SW caching ‏ב-slice 7. |
| 2 | ‏ה-`openwakeword-wasm-browser` ‏לא יציב (4★, ‏יוצר אחד) | ‏מחקר | ‏קראתי ‏את ‏הקוד — ‏~300 ‏שורות ‏נקי. ‏מבודד ‏מאחורי WakeWordListener. ‏אם ‏נשבר — patch/fork ‏פשוט. |
| 3 | ‏שני getUserMedia ‏מאותו mic — ‏האם ‏הדפדפן ‏מרשה? | ‏ארכיטקטורה | ‏כן ‏מרשה (לא resource ‏בלעדי). ‏אם ‏בכל ‏זאת ‏בעיה ‏(echo, ‏gain) — ‏Escalation. ‏ה-Recorder ‏וה-WakeWord ‏על ‏tracks ‏נפרדים. |
| 4 | **‏Cooldown ‏חוסם ‏את ‏ה-toggle ‏השני** | ‏קוד ‏הספרייה: `cooldownMs` default 2000 | ‏**העבר ‏`cooldownMs: 500`** ל-WakeWordEngine constructor. ‏אם ‏עדיין ‏מוחמץ — ‏הורד ‏ל-300. ‏בדיקה ‏ידנית DoD 7. |
| 5 | ‏False positives ‏(השם ‏מזוהה ב-TV ברקע) | ‏general wake-word | ‏threshold=0.5 + ‏Silero VAD ‏פנימי (detect ‏דורש ‏isSpeechActive). ‏אם ‏בעיה — ‏future setting. |
| 6 | ‏AudioContext/getUserMedia ‏בלי user gesture | ‏Chrome autoplay policy | ‏`toggleListening` ‏רק ‏מ-long-press handler — ‏user gesture ‏מובהק. |
| 7 | ‏Mic FSM type breaking change | ‏הוספת `listening` ‏ל-`MicState` | ‏Consumer ‏יחיד ב-dev: ‏VoiceMode (מטופל §3.3). ‏Grep ‏לוודא: ‏`grep -rn "MicState\\|mic.state" packages/frontend/src/`. |
| 8 | ‏Svelte 5 ‏`$effect` ‏loop | ‏learning 2026-05-16 | ‏ה-effect ‏קורא ‏settings.*, ‏כותב ‏`mic.autoStopMode` (plain field, ‏לא $state). ‏ה-getter `isWakeWordActive` ‏מבוסס ‏`#wakeWordActive` שחייב ‏להיות ‏**plain field, ‏לא $state** — ‏אחרת loop. ‏ראה §3.4. |
| 9 | ‏i18n strings ‏עבריים ‏בקוד | learnings | pre-commit hook ‏חוסם. ‏וודא `pnpm hooks:install`. |
| 10 | ‏types ‏resolution ‏מ-tarball | ‏file: dependency | ‏ה-tarball ‏כולל ‏`index.d.ts`. ‏אם ‏לא ‏נמצא — ‏בדוק ‏`types` field ‏ב-package.json ‏של ‏הlib. |
| 11 | ‏HTTPS requirement | ‏getUserMedia | ‏Chrome localhost ‏exception. ‏Mobile → tunnel (§0). |
| 12 | ‏ה-Recorder ‏(getUserMedia #2) ‏ו-WakeWord ‏(#1) ‏מתחרים ‏על ‏echo cancellation | ‏שני ‏tracks ‏פעילים | ‏אם ‏ה-WakeWord ‏שומע ‏את ‏ה-TTS ‏או ‏feedback — ‏future. ‏ב-MVP ‏לא ‏מצופה ‏בעיה ‏(TTS ‏לא ‏רץ ‏בזמן ‏recording). |

**3 ‏שתמיד נשכחים**:
1. ✅ ‏i18n — ‏2 keys ‏חדשים (`mic.listening`, `voiceMode.status.listening`), ‏he.ts + en.ts
2. ✅ ‏Svelte 5 reactivity — ‏`#wakeWordActive` ‏plain field (לא $state), ‏effect read-only ‏על ‏settings
3. ✅ ‏OneCLI placeholder — ‏לא רלוונטי (אין external API)

---

## §7 — Escalation triggers

‏עצור ‏ושאל ‏את מרדכי ‏אם:

1. ‏ה-lib `openwakeword-wasm-browser` ‏לא ‏מצליחה לטעון ‏ב-browser (CORS, ‏MIME type, ‏missing wasm) — ‏ייתכן ‏שצריך ‏Vite plugin ‏או ‏headers ‏מיוחדים. ‏אם ‏ניסית ‏2 ‏גישות ‏ולא ‏עבד — ‏עצור.
2. ‏שני ‏getUserMedia ‏מאותו mic ‏גורמים ‏לכשל ‏לא ‏צפוי (echo, ‏ה-WakeWord ‏שומע ‏את ‏עצמו, ‏track ‏שני ‏נכשל) — ‏ייתכן ‏שצריך ‏לעבור ‏ל-single-stream + patch ‏(future, §10) ‏מוקדם ‏מהצפוי.
3. ‏ה-Mic FSM type change ‏שובר ‏consumer ‏חיצוני ‏שהbrief ‏פספס.
4. ‏ה-cooldown ‏אפילו ‏ב-300ms ‏לא ‏מאפשר ‏toggle ‏אמין — ‏ייתכן ‏שצריך ‏לזהות ‏את ‏ה-toggle ‏אחרת ‏(לא ‏דרך ‏שני detect ‏events).
5. ‏ה-`#wakeWordActive` ‏כ-plain field ‏לא ‏מספיק ‏reactive ‏ל-UI (ה-MicButton ‏לא ‏מתעדכן) — ‏ייתכן ‏שצריך ‏אותו ‏כ-$state ‏אבל ‏אז ‏יש ‏loop ‏risk. ‏Escalate ‏לדיון.

**‏אל ‏תשאל ‏על**:
- ‏בחירת port (§2 DISPATCH)
- ‏סגנון UI (אייקון 👂, ‏long-press duration, ‏צבעים) — ‏בחר ‏סביר, ‏רשום ב-commit msg
- ‏ערך cooldownMs ‏המדויק (500/400/300) — ‏בחר ‏מה ‏שעובד ‏בבדיקה ‏ידנית

---

## §8 — Complexity score: 8/10

| ‏פקטור | ‏ניקוד |
|---|---|
| Cross-store data flow ‏חדש (engine → VM → effect) | +2 |
| ‏Streaming / real-time (audio frames) | +2 |
| ‏State machine ‏חדש (Mic FSM ‏מורחב) | +2 |
| ‏Refactor של ‏קוד ‏קיים (Mic VM) | +1 |
| >5 files ‏ב->2 packages (core/i18n + frontend) | +1 |
| ‏ספרייה ‏חיצונית ‏חדשה (openwakeword-wasm-browser) | +2 |
| ‏ספרייה DOM-mutating (AudioWorklet, ‏WASM) | +1 |
| ‏Mitigators: ‏אין IO ב-core | -1 |
| **‏סה"כ** | **8** |

**Verifier tier**: **`verifier-slice-heavy`** ‏בסוף.

**‏Verifier-phase**: ‏מומלץ ‏אחרי **‏Commit 2** ‏(Mic FSM extension) — ‏זה ‏ה-commit ‏המסוכן.

```ts
Task({
  subagent_type: "verifier-phase",
  description: "Verify Mic FSM after wake-word integration",
  prompt: `‏אתה verifier-phase. ‏brief: docs/plans/slice-17-wake-word.md.
‏Phase: Commit 2 (Mic FSM extension).
‏Commit hash: <executor will fill>.
‏Environment: localhost:<vite-port>, Chrome localhost.
‏בדוק את ‏Commit 2 ‏לפי ‏ה-brief. ‏סדרי עדיפויות:
1. ‏ה-FSM ‏transitions ‏נכונים (listening →[detect#1]→ recording →[detect#2]→ transcribing → listening).
2. ‏ה-WakeWordEngine ‏NEVER ‏נעצר ‏בין ‏start ל-stop (always-on) — ‏`#listener.stop` ‏לא ‏נקרא ‏ב-#handleTrigger.
3. ‏autoStopMode="wakeword" (default): ‏speech-end ‏הוא ‏no-op. ‏autoStopMode="vad": ‏speech-end ‏עוצר.
4. ‏Regression: ‏ה-toggle() ‏הקיים ‏עוד ‏עובד ‏ב-push-to-talk.
5. ‏cancel() ‏ב-listening ‏וב-recording ‏לא ‏משאיר ‏state ‏תקוע.
6. ‏Integration tests ‏עוברים.`
})
```

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏שני getUserMedia ‏או single-stream? | **שני** (פשוט, ‏אפס patch). ‏single-stream ‏ב-future (§10). | ❌ |
| 2 | ‏Long-press על MicButton ‏או ‏Settings UI? | Long-press ‏ב-MVP (Settings page = slice 9). | ❌ |
| 3 | ‏Inline beep ‏או CuesEngine? | inline ‏ב-`#beep()`. slice 6 ‏יחליף. | ❌ |
| 4 | ‏Bundle ‏models ‏או CDN? | bundle ‏ב-`static/` (פרטיות + offline). ‏~5MB. | ❌ |
| 5 | ‏`onError` — ‏עוצר ‏או retry? | ‏עוצר → ‏idle, ‏המשתמשת ‏מפעילה ‏שוב. | ❌ |
| 6 | ‏יצירת ‏listener ‏ב-toggleListening או constructor? | ‏ב-toggleListening (lazy — ‏חוסך 5MB ‏עד שצריך). | ❌ |
| 7 | ‏cooldownMs ‏מדויק ל-toggle? | ‏התחל 500, ‏הורד ‏אם ‏stop ‏מוחמץ. | ❌ |

---

## §10 — Future work (לתעד, ‏לא ‏ב-scope)

> ‏החלטות ‏מפורשות ‏שדחינו ‏לאיטרציות ‏הבאות. ‏מתועד ‏כאן ‏כדי ‏שלא ‏יישכח.

1. **‏Single-stream + patch (חיסכון mic כפול)** — ‏כיום ‏שני getUserMedia ‏נפרדים (פשוט, ‏אבל ‏שני tracks ‏פעילים). ‏העתיד: ‏stream ‏אחד ‏מפוצל ‏ב-Web Audio graph. ‏דורש ‏`pnpm patch openwakeword-wasm-browser` ‏(או `patch-package`) ‏להוספת ‏`onAudioFrame(chunk)` callback ‏ב-`_processChunk` — ‏לחשוף ‏את ‏ה-PCM frames ‏שכבר ‏זורמים ‏ב-AudioWorklet, ‏ולצבור ‏אותם ‏כהקלטה ‏(WAV encoder ‏~40 ‏שורות). ‏**NOT fork** — patch ‏מתוחזק ‏כ-diff ‏ב-repo. ‏יתרון: ‏mic ‏יחיד, ‏פחות ‏סוללה.

2. **‏מילת-מפתח + פקודה ("Hey Jarvis, החלף סשן")** — ‏העתיד: ‏ה-wake word ‏לא ‏רק ‏toggle ‏הקלטה ‏אלא ‏פותח ‏חלון ‏לפקודה ‏מובנית. ‏זרימה: ‏"Hey Jarvis" → ‏מאזין ‏לפקודה ‏ל-N ‏שניות (כאן ‏**VAD ‏כן ‏מתאים** — ‏לתפוס ‏את ‏הפקודה ‏הקצרה ‏שאחרי ‏המילה) → ‏STT ‏על ‏הפקודה → ‏routing: ‏"הקלט"/"עצור"/"החלף סשן"/"בטל" ‏וכו'. ‏זה ‏משלב ‏את ‏ה-VAD ‏שדחינו ‏כאן, ‏אבל ‏רק ‏ל-command capture ‏(לא ‏לתוכן ‏הארוך). ‏דורש ‏command parser ‏+ ‏מיפוי ‏פקודות ‏ל-actions.

3. **‏Wake-word עברי** — ‏אימון ‏מודל ‏`.onnx` ‏עברי ‏(Colab + Gemini/ElevenLabs TTS, ‏~שעה). ‏אותה ‏תשתית ‏בדיוק — ‏רק ‏מחליפים ‏את ‏ה-classifier ‏ב-`baseAssetUrl`. ‏ראה ‏`docs/investigations/wake-word-client-side.md` §5-6.

4. **‏Settings UI ל-wake-word** — slice 9 (Settings page): ‏toggle ‏ל-wakeWordEnabled, ‏בחירת ‏autoStopMode (wakeword/vad), ‏בחירת ‏wake-word ‏(jarvis/alexa/mycroft), ‏threshold slider. ‏מחליף ‏את ‏ה-long-press ‏הזמני.

5. **‏SW caching ל-models** — slice 7 (CarMode): ‏cache ‏את ‏~5MB ‏ב-Service Worker ‏כדי ‏שלא ‏יירד ‏שוב ‏בכל ‏טעינה.

---

## ‏סטיות מהתכנון (‏מתעדכן ע"י executor ‏תוך כדי)

> ‏ה-executor מתעד פה כל סטייה מה-brief ולמה.

- ...

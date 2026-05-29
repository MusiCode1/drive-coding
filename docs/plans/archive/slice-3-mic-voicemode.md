# Slice 3 — Mic + STT + VoiceMode FSM — תוכנית

> **תאריך**: 2026-05-28
> **סטטוס**: הושלם 2026-05-29
> **Complexity**: 7/10 (verifier: light + ‏phase verifier אחרי commit 2)
> **תלות**: ‏slice 0.5 ✅, ‏slice 2 ✅. ‏slice 1 ‏(Mic standalone) ‏דולג — ‏משולב כאן
> **מתבסס על**: ‏`docs/plans/README.md` (מבנה), ‏`docs/conventions/parallel-safe-code.md` (additive)

---

## §0 — Pre-flight

### Worktree

```bash
cd /home/user/projects/voice-acp
git worktree add .worktrees/slice-3-mic-voicemode -b slice-3-mic-voicemode dev
cd .worktrees/slice-3-mic-voicemode
pnpm install
pnpm hooks:install   # ‏חובה — ‏מפעיל pre-commit hook ל-Hebrew lint
```

### איך להריץ

| ‏מה | ‏פקודה | ‏Port |
|---|---|---|
| ‏BE | `cd packages/backend && onecli run --agent voice-acp -- bun --watch src/server.ts` | 4000 (fixed) |
| ‏FE | `pnpm --filter @drive-coding/frontend-v2 dev` | OS-assigned |

**Critical**: ‏BE ‏חייב ‏OneCLI. ‏בלעדיו: ‏401/400 על כל קריאה ל-google API ‏(STT) ‏ולא יעבוד. ‏ראה root `AGENTS.md §Backend MUST run through OneCLI`.

### Tunnel + ‏browser

‏Tunnel — ‏הפקודה המלאה (החלף `<vite-port>` ‏אחרי שVite מדפיס startup):

```bash
ssh -i ~/.ssh/pico \
  -o StrictHostKeyChecking=accept-new \
  -o ServerAliveInterval=30 \
  -R drive-coding:80:localhost:<vite-port> tuns.sh http
```

‏URL: ‏`https://your-app.nue.tuns.sh`

‏Browser: ‏Chrome ‏רגיל מקומי. **‏זהירות**: ‏Mic דורש HTTPS או localhost. ‏בtunnel (HTTPS) — ‏עובד. ‏בHTTP מ-LAN IP — ‏לא.

### OneCLI agent

‏שם: ‏`voice-acp`. ‏מזריק: ‏`x-goog-api-key` ל-`generativelanguage.googleapis.com` (Gemini STT).

### Reading list

**must-read לפני** (~‎20 ‏דקות):

1. ‏`docs/conventions/parallel-safe-code.md` §1, §2, §4 — ‏החוקים על קבצים משותפים
2. ‏`packages/frontend/AGENTS.md` — ‏5 ‏חוקי זהב + ‏מבנה 5 ‏שכבות
3. ‏`docs/frontend-spec.md §5` (Mic state machine) + ‏`§9` (Voice flow) + ‏`§6` (status text)
4. ‏`packages/frontend/docs/slices.md` — ‏entry של slice 3 בטבלה
5. ‏`AGENTS.md` (root) §Worktrees, §Ports, §Backend MUST run through OneCLI

**reference בזמן עבודה**:

- ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts` — ‏דוגמה ל-`$effect.root` + ‏untrack pattern לסוכן executor
- ‏`packages/frontend/src/lib/view-models/agent-session.svelte.ts` — ‏API של `sendPrompt(text, opts?)` ‏שיקבל `recordingId`
- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/audio/recorder.ts` — ‏מקור Recorder (57 שורות)
- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/voice/stt-client.ts` — ‏מקור STT adapter (56 שורות)
- ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/voice/base64.ts` — ‏עוזר ‏ל-chunked base64 (16 שורות)
- ‏`~/.config/opencode/learnings.md` — ‏gotchas רוחביים

---

## §1 — מטרה

‏אחרי slice 3: ‏אישה לוחצת על כפתור מיקרופון בצ'אט, ‏מדברת, ‏לוחצת שוב — ‏הטקסט מתומלל ע"י Gemini ונשלח לסוכן כprompt. ‏הכפתור משנה צבע/אנימציה ‏לפי VoiceMode FSM ‏(idle → recording → transcribing → thinking → speaking → idle). ‏הסוכן עונה ‏(via Speaker מ-slice 2). ‏ה-MVP שמיש: ‏שיחה קולית מלאה.

‏Recording אופציונלי נשמר ל-`recordingId` ‏שמועבר ‏ל-`sendPrompt({recordingId})` — ‏הכנה ‏ל-slice 10 (replay).

---

## §2 — Scope

| ‏פיצ'ר | ‏כן/לא | ‏לאן |
|---|---|---|
| ‏Mic engine (MediaRecorder wrapper) | ✅ | ‏commit 0 |
| ‏STT adapter (Gemini multimodal) | ✅ | ‏commit 0 |
| ‏Mic VM (state: idle/recording/transcribing) | ✅ | ‏commit 1 |
| ‏VoiceMode FSM (derived) | ✅ | ‏commit 2 |
| ‏MicButton component | ✅ | ‏commit 3 |
| ‏Integration ‏ב-ChatInput | ✅ | ‏commit 3 |
| ‏Recording save endpoint ‏ב-BE | ❌ | ‏slice 10 |
| ‏Mic permission UI (modal) | ❌ | ‏future. ‏ב-MVP — ‏שגיאה inline ‏אם נדחה |
| ‏Audio cues (start/stop) | ❌ | ‏slice 6 |
| ‏Car mode mic activation | ❌ | ‏slice 7 |
| ‏Mid-speech interruption (VAD) | ❌ | ‏future |
| ‏Cancelling state implementation | 🟡 | ‏ב-VoiceMode אבל ‏לא נטרגר ‏ב-MVP (slice 7 ‏יוסיף ‏את ‏הUX) |

---

## §3 — Architecture diagram

```
+layout.svelte
  ├─ new I18nVM()
  ├─ new Settings()
  ├─ new AgentSession()
  ├─ new Speaker({ session, settings })
  ├─ new Mic({ session })                  ← ‏חדש
  └─ new VoiceMode({ mic, session, speaker }) ← ‏חדש (derived VM)
        │
        ├─ engines/recorder.ts            ← ‏חדש (copy מ-main)
        │   │  MediaRecorder wrapper
        │   │  start() / stop() → Blob
        │   │  getUserMedia permission
        │
        └─ adapters/voice/transcribe.ts   ← ‏חדש (copy מ-main)
            │  Gemini generateContent ‏עם inlineData audio (via @google/genai SDK)
            │  Hebrew transliteration prompt fix
            │  POST /proxy/google/v1beta/models/gemini-flash-latest:generateContent

‏Glue ב-Mic.toggle():
  if state === "idle":  start recording
  if state === "recording": stop → blob → transcribe → session.sendPrompt(text, {recordingId})
  if state === "transcribing": no-op (disabled)

‏VoiceMode derivation:
  if mic.state === "recording" → "recording"
  if mic.state === "transcribing" → "transcribing"
  if session.status === "thinking" → "thinking" (unless speaker plays)
  if speaker.state === "speaking" → "speaking"
  else → "idle"

‏Components ‏שמתעדכנים (additive, ‏לפי parallel-safe):
  components/chat/ChatInput.svelte   ← ‏MicButton next to <textarea>
  components/chat/MicButton.svelte   ← ‏חדש
```

---

## §4 — Commits

### Commit 0 — engines + adapters (approach: **manual** copy מ-main)

‏יצירת ‏Recorder engine + ‏STT adapter. ‏אינטגרציה ‏עם SDK חיצוני — ‏לא TDD.

**מקור**: ‏`/home/user/projects/voice-acp/main/packages/frontend/src/lib/`

**קבצים חדשים**:

| ‏יעד | ‏מקור (main) | ‏שינויים בהעתקה |
|---|---|---|
| ‏`packages/frontend/src/lib/engines/recorder.ts` | `audio/recorder.ts` (57 ‏שורות) | ‏copy. ‏החלף `import { createLogger } from "$lib/log"` + ‏שורות log ‏ב-`console.warn/info` (ראה risk #4) |
| ‏`packages/frontend/src/lib/adapters/voice/transcribe.ts` | `voice/stt-client.ts` (56 ‏שורות) | ‏copy + 3 שינויים: ‏**(א)** ‏הסר `import { saveRecording } from "./recordings-client"`. ‏**(ב)** ‏החלף ‏את ‏השורה `const recordingPromise = saveRecording(audioBytes, mimeType).catch(() => ({ id: "" }))` ‏ב-`const recordingPromise = Promise.resolve({ id: "" })` (BE endpoint לא קיים, ‏slice 10 ‏יוסיף). ‏**(ג)** ‏ה-`import { googleGenAi } from "./sdks"` ‏נשאר as-is — ‏`sdks.ts` ‏קיים ‏ב-`packages/frontend/src/lib/adapters/voice/sdks.ts` ‏מ-slice 2 |
| ‏`packages/frontend/src/lib/adapters/voice/base64.ts` | `voice/base64.ts` (18 שורות) | ‏copy as-is. ‏transcribe.ts ‏מייבא ממנו `bytesToBase64` |

‏**אזהרת voiceId-style gotcha**: ‏בדומה ל-slice 2, ‏יש כאן שני SDK distinct:
- ‏`@ai-sdk/google` (lakekey baseURL) — ‏לא בשימוש ב-slice 3
- ‏`@google/genai` (httpOptions.baseUrl) — **‏כן בשימוש** ע"י ‏`googleGenAi` ‏ב-`adapters/voice/sdks.ts` (קיים מ-slice 2). ‏אל ‏תשנה ‏אותו.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
```

‏אין consumer עדיין — ‏רק ‏typecheck.

---

### Commit 1 — Mic view-model (approach: **manual**)

**קבצים חדשים**:
- ‏`packages/frontend/src/lib/view-models/mic.svelte.ts`

**API skeleton**:

```ts
import type { AgentSession } from "./agent-session.svelte"
import { Recorder } from "../engines/recorder"
import { transcribe } from "../adapters/voice/transcribe"

export type MicState = "idle" | "recording" | "transcribing"

export class Mic {
  state: MicState = $state("idle")
  error: string | null = $state(null)

  readonly #session: AgentSession
  readonly #recorder: Recorder

  constructor(opts: { session: AgentSession }) {
    this.#session = opts.session
    this.#recorder = new Recorder()
  }

  /**
   * Single entry point — ‏כפתור ‏יקרא לזה. ‏מתנהג לפי state:
   * - idle → start recording
   * - recording → stop, transcribe, ‏ושלח prompt
   * - transcribing → no-op (disabled)
   */
  toggle = async (): Promise<void>

  /** Cancel mid-recording (slice 7 ‏יקרא לזה ב-cancel button) */
  cancel(): void
}
```

**Pipeline (פסאודו, ‏בתוך toggle)**:

```
‏if state === "idle":
  state = "recording"
  this.error = null
  try: await this.#recorder.start()  // ‏יקרא ל-getUserMedia
  catch (e):
    state = "idle"
    this.error = t("mic.error.permission") // ‏או generic
    return

‏if state === "recording":
  // ‏לסגור recording, ‏לקבל blob
  state = "transcribing"
  let blob
  try: ({blob} = await this.#recorder.stop())  // ‏Recorder גם מחזיר mimeType — ‏לא נדרש כאן, ‏ה-blob.type משמש פנימית ב-transcribe
  catch (e):
    state = "idle"
    this.error = ‏הודעה
    return
  // ‏לתמלל — transcribe(blob) ‏מסיג את ה-mimeType מ-blob.type ‏פנימית
  let text, recordingId
  try:
    ({text, recordingId} = await transcribe(blob))
  catch (e):
    state = "idle"
    this.error = ‏הודעה
    return
  // ‏לשלוח prompt
  if text.trim().length > 0:
    void this.#session.sendPrompt(text, { recordingId })
  state = "idle"

‏if state === "transcribing":
  return  // ‏no-op
```

**Gotchas**:
- ‏getUserMedia ‏עלול לזרוק `NotAllowedError` (user denied) ‏או ‏`NotFoundError` (no mic). ‏טיפול נקי.
- ‏transcribe ‏עלול ‏להחזיר text ריק. ‏בודקים ‏`text.trim().length > 0` ‏לפני ‏sendPrompt.
- ‏`transcribe(blob)` ‏מקבל ‏blob בלבד; ‏ה-MIME type נמשך מ-`blob.type` ‏פנימית. ‏אין צורך להעביר mimeType.

**API signatures (לעיון)**:
```ts
// Recorder
start(): Promise<void>
stop(): Promise<{ blob: Blob; mimeType: string }>
get isRecording(): boolean

// transcribe
transcribe(blob: Blob, opts?: {
  previousAssistantText?: string
  signal?: AbortSignal
}): Promise<{ text: string; recordingId: string }>
```

**i18n keys** ‏(הוסף ל-`packages/core/src/i18n/keys.ts` ‏+ ‏catalogs בsection "mic"):
- `mic.error.permission`
- `mic.error.notFound`
- `mic.error.transcribe`
- `mic.error.generic`

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/core test
pnpm lint:i18n
```

---

### Commit 2 — VoiceMode FSM (derived) (approach: **manual**)

‏derived VM. ‏לא ‏מחזיק state ‏ישירות, ‏מסכם 3 ‏מקורות.

**קבצים חדשים**:
- ‏`packages/frontend/src/lib/view-models/derived/voice-mode.svelte.ts`

**מבנה התיקייה**: ‏`derived/` ‏נוצרת חדשה. ‏הfolder existed in plans (לפי `AGENTS.md`) ‏אבל ‏אין קבצים בה עדיין.

**API skeleton**:

```ts
import type { Mic } from "../mic.svelte"
import type { AgentSession } from "../agent-session.svelte"
import type { Speaker } from "../speaker.svelte"

export type VoiceModeState =
  | "idle"
  | "recording"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "cancelling"

export class VoiceMode {
  readonly #mic: Mic
  readonly #session: AgentSession
  readonly #speaker: Speaker

  /** ‏Internal flag — set ‏ע"י cancel(), ‏מתאפס ‏כש-FSM מגיע ‏ל-idle */
  isCancelling: boolean = $state(false)

  state: VoiceModeState = $derived.by(() => {
    if (this.isCancelling) return "cancelling"
    if (this.#mic.state === "recording") return "recording"
    if (this.#mic.state === "transcribing") return "transcribing"
    if (this.#speaker.state === "speaking") return "speaking"
    if (this.#session.status === "thinking") return "thinking"
    return "idle"
  })

  constructor(opts: { mic: Mic; session: AgentSession; speaker: Speaker }) {
    this.#mic = opts.mic
    this.#session = opts.session
    this.#speaker = opts.speaker
    // $effect לזיהוי כש-state חזר ל-idle אחרי cancelling → reset isCancelling
    $effect(() => {
      if (
        this.isCancelling &&
        this.#mic.state === "idle" &&
        this.#session.status !== "thinking" &&
        this.#speaker.state === "idle"
      ) {
        this.isCancelling = false
      }
    })
  }

  /**
   * Cancel ‏ההקלטה / ‏TTS / ‏בקשה. ‏נקרא ע"י כפתור Cancel ‏(slice 7) ‏או ב-mic
   * click ‏ב-state ‏speaking.
   */
  cancel(): void {
    this.isCancelling = true
    this.#mic.cancel()
    // ‏Speaker.stop() ‏מוסף ב-commit הזה כ-additive change ל-Speaker (ראה למטה).
    // ‏מנקה queue + cancel ‏ל-current segment, ‏בלי לשנות enabled.
    this.#speaker.stop()
  }
}
```

**‏שינוי additive ל-Speaker שנכלל ב-commit זה**:

‏ב-`packages/frontend/src/lib/view-models/speaker.svelte.ts`, ‏ב-section "Toggle audio" (ראה Speaker §):
‏הוסף ‏method ציבורי ‏שמופנה ‏ל-`#stopAndClear()` (כבר ‏קיים פנימית, ‏פותר את ‏הלוגיקה):

```ts
/**
 * Stop playback + ‏clear pending TTS jobs, ‏בלי לשנות `enabled`.
 * ‏שונה מ-toggle(): ‏toggle ‏גם הופך enabled. ‏stop() ‏רק עוצר.
 * ‏בשימוש: ‏VoiceMode.cancel().
 */
stop(): void {
  this.#stopAndClear()
}
```

‏זה ‏additive: ‏method חדש, ‏לא משנה ‏behavior קיים. ‏לפי `parallel-safe-code.md` ‏מותר. ‏הקובץ ‏אמור להיות כבר עם sections (`// ─── Toggle audio ───` ‏או ‏דומה) — ‏אם לא, ‏הוסף לקראת הסוף ‏לפני private.

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
```

**Phase verifier אחרי commit 2** ‏(per `verifier-phase`):
- ‏ה-derived state ‏מחזיר ‏ערכים ‏נכונים ‏לכל ‏צירוף ‏ב-input (test cases ‏ב-VoiceMode.test.ts ‏אם מתאים, ‏או manual reasoning)
- ‏cancel() ‏לא ‏גורם ‏ל-infinite loop ‏ב-effect
- ‏Speaker stop call ‏לא ‏שובר state

---

### Commit 3 — MicButton + Integration (approach: **manual**)

**קבצים חדשים**:
- ‏`packages/frontend/src/lib/components/chat/MicButton.svelte`

**קבצים שמשתנים** (כל אחד **additive** ‏לפי `parallel-safe-code.md`):

| ‏קובץ | ‏שינוי | ‏סוג |
|---|---|---|
| ‏`packages/frontend/src/lib/context.ts` | ‏הוסף ‏ב-section `// ─── mic ───` (stub קיים, ‏הסר ‏את ה-stub והכנס): ‏`export const [getMic, setMic] = createContext<Mic>()` + ‏import. ‏אותה לוגיקה ‏ב-section `// ─── voice-mode ───` | Additive |
| ‏`packages/frontend/src/routes/+layout.svelte` | ‏ב-section `// ─── mic ───`: ‏`const mic = new Mic({ session })` + ‏imports. ‏ב-section `// ─── voice-mode ───`: ‏`const voiceMode = new VoiceMode({ mic, session, speaker })`. ‏ב-wiring block: ‏`setMic(mic); setVoiceMode(voiceMode)` | Additive |
| ‏`packages/frontend/src/lib/components/chat/ChatInput.svelte` | ‏הוסף `<MicButton />` ‏בתוך ה-form. ‏RTL: ‏ב-DOM אחרי ‏ה-textarea (יראה ‏מימין כי .form-row flex). ‏אין סעיפים מסומנים ב-ChatInput — ‏הוספת ‏component ב-end ‏של ה-form ‏היא additive (לא משנה ‏את ‏ה-textarea + button) | Additive |
| ‏`packages/frontend/src/lib/view-models/speaker.svelte.ts` | ‏הוסף ‏method ‏ציבורי `stop()` ‏ב-section toggling — ‏ראה Commit 2 §"שינוי additive ל-Speaker" | Additive |

**MicButton skeleton**:

```svelte
<script lang="ts">
import { getI18n, getMic, getVoiceMode } from "$lib/context"

const mic = getMic()
const voiceMode = getVoiceMode()
const t = getI18n().t

// ‏ה-key מתורגם דרך MessageKey union; ‏switch מבטיח typecheck.
function statusKey(s: VoiceModeState): MessageKey {
  switch (s) {
    case "idle": return "voiceMode.status.idle"
    case "recording": return "voiceMode.status.recording"
    case "transcribing": return "voiceMode.status.transcribing"
    case "thinking": return "voiceMode.status.thinking"
    case "speaking": return "voiceMode.status.speaking"
    case "cancelling": return "voiceMode.status.cancelling"
  }
}
const stateText = $derived(t(statusKey(voiceMode.state)))

function onClick() {
  if (voiceMode.state === "speaking" || voiceMode.state === "thinking") {
    voiceMode.cancel()
    return
  }
  if (voiceMode.state === "transcribing" || voiceMode.state === "cancelling") return
  // idle או recording
  void mic.toggle()
}
</script>

<button class="mic-btn mic-{voiceMode.state}" onclick={onClick}
  disabled={voiceMode.state === "transcribing" || voiceMode.state === "cancelling"}
  aria-label={stateText}>
  <span class="icon">{ICONS[voiceMode.state]}</span>
</button>
{#if mic.error}<div class="error" role="alert">{mic.error}</div>{/if}

<style>...</style>
```

‏הCSS לפי `frontend-spec.md §5` (110px ‏עיגול, ‏צבעים פר state, ‏אנימציות pulse/rotate-slow/glow).

**ICONS map**:
```ts
const ICONS: Record<VoiceModeState, string> = {
  idle: "🎙", recording: "⏺", transcribing: "🌀",
  thinking: "🌀", speaking: "🔊", cancelling: "✕",
}
```

**i18n keys ל-voiceMode** (הוסף ‏ב-section "voice-mode"):
- ‏`voiceMode.status.idle`, ‏`.recording`, ‏`.transcribing`, ‏`.thinking`, ‏`.speaking`, ‏`.cancelling`

**Verification**:

```bash
pnpm --filter @drive-coding/frontend-v2 typecheck
pnpm --filter @drive-coding/frontend-v2 build
pnpm lint:i18n
```

‏ידני (חובה):
1. ‏Browser → ‏Connect → ‏לחץ Mic ‏(אישור permission ‏בdialog ‏ראשון)
2. ‏דבר ‏(הצבע ‏אדום, ‏pulse)
3. ‏לחץ Mic שוב → ‏סגול ‏(transcribing) → ‏מועבר לסוכן (thinking) → ‏שומעים תגובה (speaking) → ‏חוזר ל-idle
4. ‏Console: ‏אין errors

---

### Commit 4 — walkthrough + ‏cleanup

- ‏`docs/walkthrough.md` — ‏רשומה חדשה
- ‏`packages/frontend/AGENTS.md` — ‏"slice 3 ‏הושלם" (‏עדכון: ‏ה-FE AGENTS.md ‏היום מציין slice 1 ‏כsegment הבא — ‏יש להחליף לslice 4 ‏Bubble polish ‏הבא)
- ‏`packages/frontend/docs/slices.md` — ‏status 💭 → ✅, ‏עדכון "Mic + STT" ‏שמ-dולג ‏בנפרד והפך לחלק מ-slice 3
- ‏`docs/plans/slice-3-mic-voicemode.md` — ‏סטטוס → "הושלם", ‏סטיות (אם יש)

---

## §5 — DoD

| # | ‏בדיקה | ‏איך |
|---|---|---|
| 1 | ‏MicButton מופיע ‏ב-chat ‏(ליד textarea) | ‏ידני |
| 2 | ‏לחיצה ‏ראשונה — ‏permission dialog בbrowser | ‏ידני |
| 3 | ‏מאשרים — ‏הכפתור אדום, ‏אנימציית pulse | ‏ידני |
| 4 | ‏לחיצה שנייה — ‏סגול (transcribing) ‏לכמה שניות, ‏אז ‏הbubble user מופיע עם הטקסט שאמרתי | ‏ידני |
| 5 | ‏הסוכן ‏עונה (כפתור הופך צהוב thinking, ‏ואז ירוק speaking) | ‏ידני |
| 6 | ‏הקול נשמע (Speaker מ-slice 2) | ‏ידני |
| 7 | ‏חוזר ל-idle כחול | ‏ידני |
| 8 | ‏BE log: ‏proxy → ‏google generateContent (STT) ‏+ ‏generateContent (translate) ‏+ ‏elevenlabs (TTS) | `journalctl/log` |
| 9 | ‏Permission denied → ‏error inline, ‏state חוזר ל-idle | ‏ידני: ‏Block in chrome://settings |
| 10 | ‏typecheck + build + tests | ‏ראה §4 |
| 11 | ‏i18n lint | `pnpm lint:i18n` |
| 12 | ‏smoke test רץ (לא ‏שובר slice 2) | `tests/smoke/chat-roundtrip.mjs` |

---

## §6 — Risks + ‏mitigations

| # | ‏סיכון | ‏מקור | ‏מיטיגציה |
|---|---|---|---|
| 1 | ‏HTTPS required ל-getUserMedia | ‏Web API | ‏Tunnel HTTPS פעיל. ‏Localhost עובד כtreat-as-secure. ‏LAN IP בHTTP ‏לא יעבוד — ‏לא להבטיח |
| 2 | ‏Gemini ‏מתעתק לטינית במקום עברית | ‏learnings 2026-05-16 | ‏prompt ב-`transcribe.ts` כולל hebrewRule (כבר ב-main) |
| 3 | ‏MediaRecorder mimeType לא נתמך | ‏Browser API | ‏copy from main: ‏בודק `isTypeSupported("audio/webm;codecs=opus")` + ‏fallback. ‏לא לשנות |
| 4 | ‏$lib/log לא קיים | ‏FE החדש בלי תשתית log | ‏החלף ב-`console.warn/info` (commit 0) |
| 5 | ‏Hebrew strings ‏בקוד → ‏pre-commit חוסם | ‏i18n-gap | ‏כל מחרוזת ‏→ ‏`t(key)`. ‏הוסף mic.* ‏ו-voiceMode.* ‏keys |
| 6 | ‏Svelte 5 reactivity על Class field | ‏general | ‏$state ‏על public field עובד. ‏לפי slice 2 (Player.state) |
| 7 | ‏OneCLI לא מזריק x-goog-api-key | ‏learnings 2026-05-16 | ‏ה-`googleGenAi` SDK ‏ב-`sdks.ts` ‏כבר ‏מוגדר עם `apiKey: "browser-placeholder"` ‏ו-`httpOptions.baseUrl` ל-`/proxy/google/`. ‏ה-BE proxy ‏רץ דרך OneCLI. ‏אם 401 — ‏לבדוק עם `journalctl` ‏על BE log |
| 8 | ‏saveRecording endpoint לא קיים | ‏slice 10 ‏יוסיף | ‏ב-commit 0: ‏הסר ‏את ‏הקריאה. ‏החזר `recordingId: ""`. ‏ב-slice 10 ‏זה ‏יישלם |
| 9 | ‏derived $state.by + ‏effect infinite loop | ‏Svelte 5 | ‏ה-effect ‏ב-VoiceMode ‏רק כותב ‏ל-`isCancelling = false` ‏כש-3 ‏תנאים חיוביים. ‏ברגע שהשתנה ל-false, ‏התנאי לא ‏אמת יותר → ‏ה-write לא ‏יחזור. ‏אם executor רואה ‏לולאה אינסופית בfעל — ‏זה ‏באג אחר ‏(escalation #4) |
| 10 | ‏Speaker stop ‏בעת cancel — invasive | ‏design | ‏ראה Escalation #1 |
| 11 | ‏MicButton — ‏Svelte 5 reactivity על voiceMode.state | ‏common | ‏`$derived` ‏על stateText. ‏אם לא ‏מתעדכן — ‏ודא ‏שVoiceMode ‏נטען ‏מהקונטקסט נכון |

---

## §7 — Escalation triggers

‏עצור ושאל את Tama אם:

1. ‏permission denied — ‏ה-UX ‏הנוכחי ‏הוא ‏inline error. ‏אם Tama רוצה modal/dialog — ‏זה ‏slice ‏עתידי, ‏לא ‏כאן.
2. ‏MediaRecorder באייפון/iOS Safari — ‏דורש ‏MediaRecorder polyfill. ‏Out of scope.
3. ‏transcribe ‏מחזיר ‏שגיאה 4xx ‏על ‏inputs שאמורים לעבוד — ‏סימן ל-credential issue ‏או prompt error.
4. ‏ה-`$effect` ‏ב-VoiceMode infinite loop — ‏סימן ‏שה-derivation לוגית שגויה.
5. ‏Speaker ‏ב-dev ‏לא ‏מכיל ‏את ‏ה-method ‏`#stopAndClear()` ‏(אמור להיות שם — ‏אם לא, ‏ה-implementation ‏של ‏`stop()` ‏ב-commit 2 צריך ‏להעתיק ‏את ‏ה-cleanup logic).

‏אחרת: ‏החלט סבירות, ‏רשום בcommit message, ‏המשך.

---

## §8 — Complexity score: 7/10

| ‏פקטור | ‏ניקוד |
|---|---|
| ‏מספר commits (4) | ‏סביר |
| ‏שכבות חדשות (engine + adapter + 2 ‏VMs + component) | +3 |
| ‏APIs חיצוניים (Gemini STT) | +1 |
| ‏Browser APIs ‏(MediaRecorder, ‏getUserMedia, ‏permissions) | +2 |
| ‏Streaming pipeline | 0 (no streaming) |
| ‏Refactor של state model | +1 (VoiceMode derived) |
| ‏שינוי protocol BE↔FE | 0 |
| ‏סה"כ | **7** |

‏**Verifier**:
- ‏`verifier-phase` אחרי commit 2 (VoiceMode derivation logic — ‏שובר ‏אם ‏לוגית שגויה)
- ‏`verifier-slice-light` בסוף הסבב

---

## §9 — שאלות פתוחות

| # | ‏שאלה | ‏ברירת מחדל | ‏חוסם? |
|---|---|---|---|
| 1 | ‏איך ‏לעצור ‏את ‏Speaker ‏ב-cancel | ‏הוסף ‏`Speaker.stop()` ‏public ‏שמופנה ‏ל-`#stopAndClear()`. ‏additive — ‏לא משנה behavior קיים. ‏ראה Commit 2 §"שינוי additive ל-Speaker" | ❌ ‏סגור |
| 2 | ‏Hebrew transcribe ‏permission text ‏בdialog ‏עברי | ‏ה-browser דובר אנגלית/לוקאל בעצמו. ‏לא ‏ב-scope | ❌ |
| 3 | ‏MicButton ‏מיקום ב-RTL — ‏לפני או ‏אחרי textarea | ‏לפני (RTL: ‏ימין של textarea) — ‏זה ‏מקבל "‏לפני" ‏לוגית ב-DOM | ❌ |
| 4 | ‏saveRecording — ‏גם stub ב-FE | ‏Adapter ‏מחזיר `recordingId: ""`. ‏slice 10 ‏יוסיף ‏את ‏ה-BE endpoint + ‏ה-FE call | ❌ |

---

## §10 — מה אחרי slice 3

‏MVP שמיש לאישה: ‏מקליטה, ‏שומעת, ‏רואה. ‏הצעדים הבאים פותחים גלים נוספים:
- ‏slice 4 (Bubble polish) — ‏markdown, ‏tool bubbles, ‏RTL
- ‏slice 6 (Audio cues) — ‏צלילים ב-state transitions של VoiceMode
- ‏slice 7 (Car mode) — ‏תלוי בslice 3+6

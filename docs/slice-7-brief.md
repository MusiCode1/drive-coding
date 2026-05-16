# Slice 7 — Drive-First UX Implementation

> **מטרה:** יישום סעיף 9.6 של `vnext-architecture.md` ("UX Principles — Drive-First") ב-frontend. ה-UI היום הוא scaffold — לא product. נביא אותו לפחות לרמה של POC v1, פלוס D42 audio cues שתוכננו.
>
> **תלות:** Slice 5.6 (provider-error + markdown port). ה-`renderMarkdown` חייב להיות זמין כי ה-bubble styling מסתמך עליו.
>
> **CWD:** `/home/user/projects/voice-acp-v2`
>
> **מבצע:** Yolo (Sonnet 4.6)
>
> **התכנון קובע.** ה-v1 (POC) הוא **reference implementation** טוב — port את ה-CSS וה-state machine שלו, אבל ה-תכנון ב-`vnext-architecture.md §9.6` מנצח כשהם מתנגשים.

---

## 0. ⚠️ TDD חובה לכל קוד שייכתב

חזרה על העיקרון: כל פיצ'ר חדש — test → red → impl → green → next. תופס גם לקוד CSS עם behavioral tests (לדוגמה: "כפתור עם data-state=recording יש לו class .pulse"), גם ל-state machine logic, גם ל-keyboard shortcuts.

חריג: copy של design tokens (CSS variables) ושינויי styling pure — לא נדרש test. אבל **כל לוגיקה** (state transitions, scroll, audio queue, car mode) — TDD חובה.

---

## 1. רקע — איפה אנחנו

ה-UI הנוכחי (אחרי 5.5 + 5.6):
- Light mode "system-ui" generic
- כפתור 56px בפינה
- 0 animations
- markdown — מובא ע"י 5.6 (תלוי בו)
- Tools rendering — partial (5.5)
- אין state coloring על הכפתור
- אין audio cues
- אין car mode
- אין wake lock / landscape lock
- אין navigation buttons (prev/next/replay-last)
- אין smart scroll עם user intent detection

**ה-vnext-spec.md** ביצע split:
- Slice 4 = "chat טקסטואלי בלי voice"
- Slice 5 = "voice pipeline"
- Slice 7 = "Drive-first UX מלא + audio cues (D42)"

זה Slice 7. אנחנו ממלאים את ה-gap.

---

## 2. מקורות אמת (קרא לפני)

### 2.1 תכנון (קובע)
- `/home/user/projects/voice-acp-v2/docs/vnext-architecture.md §9.6` (שורות 749-818) — 8 עקרונות drive-first, 4 UI surfaces, state machine, צבעים
- D19, D35, D41, D42 (שורות 178, 194, 200, 201)

### 2.2 Reference implementation (POC v1)
- `/home/user/projects/voice-acp/frontend/index.html` (2025 שורות) — frontend מלא של POC עם CSS, state machine, car mode
- `/home/user/projects/voice-acp/frontend/config.html` (649 שורות) — דף הגדרות (לא קריטי ל-Slice 7)

קרא את `index.html` כולו לפני שמתחילים. שורות 7-511 = CSS. 514-535 = HTML. 538-2025 = JS.

---

## 3. מה לבנות

### 3.1 Design tokens — Dark mode ו-CSS variables (10 דק)

**Reference:** `index.html:8-27`

צור `packages/frontend/src/app.css` או הוסף ל-`+layout.svelte`:

```css
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --bg-elev: #161922;
  --fg: #e6e6e6;
  --fg-dim: #a0a0a0;
  --muted: #6a6a6a;
  --accent: #4f8cff;
  --accent-hi: #6ba1ff;
  --recording: #ff4f4f;
  --thinking: #ffaa33;
  --speaking: #4fff8a;
  --bubble-user: #2a3550;
  --bubble-agent: #1d2230;
  --border: #2a2f3a;
  --tool-bg: #1a1f2a;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  height: 100dvh;
  overflow: hidden;
}
body {
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--fg);
  display: flex;
  flex-direction: column;
}
```

**הבדל מ-v1:** v1 השתמש ב-`#0f1115` כ-`--bg`. **התכנון §9.6 לא מציין צבעים מדויקים** — רק "High contrast, large text". ה-v1 colors יפים, נשתמש בהם.

### 3.2 Layout — Header + Chat + Footer (15 דק)

**Reference:** `index.html:514-536` HTML, `47-73` header CSS, `76-132` chat CSS, `372-510` footer CSS

עדכן `packages/frontend/src/routes/agent/[id]/+page.svelte`:
- `<header>` עם title + meta + ⚙ link ל-/settings
- `<div id="chat-wrap">` — chat + jump-down button
- `<footer>` — status + controls

חוקי flex:
- `body` = `flex-direction: column`
- `header` + `footer` = `flex-shrink: 0`
- `chat-wrap` = `flex: 1`, position relative
- `chat` = `flex: 1, overflow-y: auto, scroll-behavior: smooth`

### 3.3 כפתור גדול — State Machine (40 דק) **TDD**

**Reference:** `index.html:403-455` (CSS), `974-1023` (JS state machine), `984-989` (icons)

**Spec §9.6 דורש 5 states:** idle, recording, processing, speaking, cancelling

**v1 השתמש ב-4 בלבד:** idle, recording, speaking, paused (אין processing נפרד; הוא משולב עם speaking)

**החלטה:** התכנון מנצח. ניישם **5 states לפי 9.6** עם הבחנה ברורה בין `processing` (STT + ACP, לפני התשובה) ל-`speaking` (TTS playing).

**State machine logic** (`packages/frontend/src/lib/stores/mic-state.svelte.ts` חדש):
```ts
export type MicState = "idle" | "recording" | "processing" | "speaking" | "cancelling"

export function deriveMicState(input: {
  isRecording: boolean
  isThinking: boolean
  isAudioPlaying: boolean
  isCancelling: boolean
}): MicState { ... }
```

**TDD:** test ראשון —
```ts
it("idle when nothing is happening", () => {
  expect(deriveMicState({ isRecording: false, isThinking: false, isAudioPlaying: false, isCancelling: false })).toBe("idle")
})
// אז: recording, processing, speaking, cancelling
// סה"כ 8+ tests ל-state transitions
```

**Visual (CSS):**

```css
#mic-btn {
  width: 110px;            /* ≥80px לפי 9.6 — v1 השתמש ב-110 */
  height: 110px;
  border-radius: 50%;
  border: none;
  font-size: 44px;
  cursor: pointer;
  background: var(--accent);
  color: white;
  box-shadow: 0 4px 18px rgba(79, 140, 255, 0.4);
  transition: transform 0.15s, box-shadow 0.2s, background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}
#mic-btn:hover:not(:disabled) { transform: scale(1.04); }
#mic-btn:active:not(:disabled) { transform: scale(0.97); }
#mic-btn:disabled { background: #2a2f3a; cursor: not-allowed; }
#mic-btn[data-state="recording"] {
  background: var(--recording);
  animation: pulse 1.2s infinite;
}
#mic-btn[data-state="processing"] {
  background: #8855ff;  /* סגול לפי 9.6 */
  animation: rotate-slow 2s linear infinite;
}
#mic-btn[data-state="speaking"] {
  background: var(--speaking);
  box-shadow: 0 4px 18px rgba(79, 255, 138, 0.45);
}
#mic-btn[data-state="cancelling"] {
  background: #ff9933;  /* כתום לפי 9.6 */
  animation: flash-fast 0.3s infinite;
}
@keyframes pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(255, 79, 79, 0.6); }
  50% { box-shadow: 0 0 0 18px rgba(255, 79, 79, 0); }
}
@keyframes rotate-slow { to { transform: rotate(360deg); } }
@keyframes flash-fast {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

**אייקונים:**
```ts
const ICONS = { idle: "🎙", recording: "⏺", processing: "🌀", speaking: "🔊", cancelling: "✕" }
```

### 3.4 Status text מתחת לכפתור (5 דק)

**Reference:** `index.html:383-397, 528`

```svelte
<div id="status" class={micState}>{statusText[micState]}</div>
```

```ts
const statusText: Record<MicState, string> = {
  idle: "לחצי על הכפתור כדי לדבר",
  recording: "מקליט...",
  processing: "מעבד...",
  speaking: "מקריא תשובה",
  cancelling: "מבטל...",
}
```

CSS: צבע משתנה לפי state class — `#status.recording { color: var(--recording); }` etc.

### 3.5 Right-side controls (20 דק) **TDD**

**Reference:** `index.html:456-510` (CSS), `529-535` (HTML), `1016-1022` (visibility logic)

3 כפתורים `56px` round:
- 🔊 **replay-last** — מנגן את ההודעה האחרונה (פעיל רק כשיש)
- ⏭ **next** / ⏮ **prev** — מנווט בין segments של אודיו (פעיל רק כשיש queue)
- ⏹ **stop** — עוצר הקראה (פעיל רק במצב speaking/cancelling)

**Slice 7 scope:** רק replay-last + stop. prev/next נדחים ל-Slice 8 (segment navigation מורכב).

**TDD:** `it("replay-last button disabled when no audio has played yet")`, etc.

### 3.6 Smart scroll + Jump-down (15 דק) **TDD**

**Reference:** `index.html:558-594` (auto-scroll logic), `99-132` (jump-down CSS)

**Logic:**
- auto-scroll מופעל כברירת מחדל
- כל user interaction (wheel/touch/keyboard/mousedown) → mark timestamp
- on scroll event:
  - אם הגענו לקצה תחתון (`distance <= 10`) → re-enable auto + hide jump-down
  - אם המשתמש גלל ידנית (interaction תוך 500ms) → disable auto + show jump-down

**Code:** הוסף ל-`+page.svelte` או store נפרד:
```ts
let autoScrollEnabled = $state(true)
let showJumpDown = $state(false)
let lastUserInteraction = 0

function onUserInteraction() { lastUserInteraction = Date.now() }
function onScroll() {
  const el = chatEl
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  const isUser = Date.now() - lastUserInteraction < 500
  if (distance <= 10) {
    autoScrollEnabled = true
    showJumpDown = false
  } else if (isUser && autoScrollEnabled) {
    autoScrollEnabled = false
    showJumpDown = true
  }
}
```

החלף את ה-`$effect` ב-`+page.svelte` שעושה auto-scroll עכשיו לזה שמכבד `autoScrollEnabled`.

**TDD:** unit test ל-store/derive function — given scroll position + interaction timestamp → expected state.

### 3.7 Bubble redesign (20 דק)

**Reference:** `index.html:134-213` (bubble styling), `216-233` (thought), `236-312` (tools), `314-358` (replay button)

עדכן את ה-`.bubble`, `.msg.user`, `.msg.agent`, `.msg.thought`, `.msg.tool_call` ב-`+page.svelte`:

- **user bubble:** `align-self: flex-start` (RTL — שמאל), `background: var(--bubble-user)`, `border-bottom-right-radius: 4px` (asymmetric corner)
- **agent bubble:** `align-self: flex-end` (RTL — ימין), `background: var(--bubble-agent)`, `border-bottom-left-radius: 4px`
- **markdown styling** ב-bubble: כל הset של `index.html:168-213` (p, h1-h4, ul/ol, code, pre, a, blockquote, table)
- **thought:** dashed border, italic, `💭` prefix
- **tools:** background `var(--tool-bg)`, expandable עם arrow `▸` שמסתובב, status dots animated

### 3.8 Audio cues — startup chime + 5 event cues (30 דק)

**Reference:**
- v1 השתמש ב-Web Audio API oscillator (שורות 1883-1898) — לא mp3
- D42 דורש "5 mp3 cues"

**החלטה:**
- **v1's startup chime** (sine A5→E6) — מיישמים ב-Web Audio. אין צורך ב-mp3.
- **D42 5 event cues** (`recording_start`, `recording_stop`, `thinking`, `tool_call`, `error`) — ניצור כ-Web Audio synthesized tones, **לא** mp3 קבצים, כי mp3 דורש assets שאין לנו.
- **התכנון §9.6 אומר רק "5 צלילים minimal".** לא דורש שיהיו mp3 דווקא. ה-spec מציין `static/sounds/` אבל זה implementation detail — לא חוזה.
- **Future:** Slice 8 או 9 — אפשרות לטעון קבצי mp3 מ-`static/sounds/` אם המשתמש יוצר אותם.

צור `packages/frontend/src/lib/audio/cues.ts`:
```ts
let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
  if (audioCtx.state === "suspended") audioCtx.resume()
  return audioCtx
}

function tone(freqs: number[], duration: number, gain: number = 0.18) {
  const ctx = getCtx()
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = "sine"
  const t = ctx.currentTime
  freqs.forEach((f, i) => osc.frequency.setValueAtTime(f, t + (duration * i) / freqs.length))
  g.gain.setValueAtTime(0, t)
  g.gain.linearRampToValueAtTime(gain, t + 0.02)
  g.gain.linearRampToValueAtTime(0, t + duration)
  osc.connect(g).connect(ctx.destination)
  osc.start(t)
  osc.stop(t + duration + 0.02)
}

export const cues = {
  recordingStart: () => tone([880], 0.12, 0.2),       // single A5 short
  recordingStop:  () => tone([660], 0.12, 0.2),       // single E5 short
  thinking:       () => tone([523, 659], 0.3, 0.15),  // C5→E5 (rising)
  speaking:       () => tone([659, 523], 0.3, 0.15),  // E5→C5 (falling)
  error:          () => tone([330, 220], 0.4, 0.25),  // E4→A3 (low warning)
}
```

חבר ב-`+page.svelte`:
- on `recording` state enter → `cues.recordingStart()`
- on `recording` state exit (→ processing) → `cues.recordingStop()`
- on `processing` state enter → `cues.thinking()`
- on first `audio_chunk` arrives → `cues.speaking()`
- on `error` message → `cues.error()`

**Important:** AudioContext דורש user gesture כדי להתחיל. אם המשתמש לא לחץ עוד כפתור — הראשונה ניסיון יכשל. ה-context יוצר רק על-ידי first user click.

### 3.9 Car mode + Media Session API (D19) (40 דק) **TDD**

**Reference:** `index.html:1878-2018`

ב-`/agent/:id?car=1` — תיכנס car mode.

**מה זה:**
- `MediaSession` עם metadata + play/pause handlers
- AudioContext עם רעש לבן ב-loop (gain=0.015 — כמעט לא נשמע) — מחזיק את ה-MediaSession פעיל
- bluetooth car button → תוקפץ play/pause action → תפעיל/תעצור הקלטה

**Slice 7 scope:** רק enable button + basic Media Session handlers. אין צורך ב-startup chime + noise loop (זה car mode עצמו, לא MVP).

**Test:** mock `navigator.mediaSession`, assert ש-action handlers נרשמו, assert ש-play/pause toggles `isRecording`.

### 3.10 Wake Lock + Landscape Lock (D19) (10 דק)

**Reference:** v1 לא יישם — זה תוספת מ-§9.6.

**Wake Lock:**
```ts
let wakeLock: WakeLockSentinel | null = null

async function acquireWakeLock() {
  if (!("wakeLock" in navigator)) return
  try {
    wakeLock = await navigator.wakeLock.request("screen")
  } catch {}
}
```

קרא ל-`acquireWakeLock` כש-mic state נכנס ל-recording, ושחרר ב-idle.

**Landscape Lock:**
```ts
if ("orientation" in screen && "lock" in screen.orientation) {
  screen.orientation.lock("landscape").catch(() => {})
}
```

`?car=1` בלבד. אופציונלי — אם דורש HTTPS + fullscreen, דחה ל-Slice 8.

### 3.11 Dashboard cards (15 דק)

**Reference:** §9.6 — "cards גדולים, scroll vertical"

ה-dashboard הנוכחי בvnext הוא רשימה minimal. שדרג:
- כל agent card גדול (`min-height: 100px`, padding 16-20px)
- כפתור "+ חדש" קבוע בתחתית או fab
- אם יש 0 agents — empty state מוסבר

---

## 4. Step-by-step

1. **Design tokens** — copy CSS variables, dark mode מלא (3.1)
2. **Layout** — header/chat/footer flex hierarchy (3.2)
3. **Mic state machine** — TDD store + 5 states + transitions (3.3)
4. **Mic button styling** — pulse, rotate, flash animations (3.3)
5. **Status text** — derived from state (3.4)
6. **Smart scroll** — TDD + jump-down button (3.6)
7. **Bubble redesign** — markdown styling, user/agent asymmetry (3.7)
8. **Right-side controls** — replay-last + stop (3.5)
9. **Audio cues** — Web Audio oscillator helper + wire to state transitions (3.8)
10. **Car mode + Media Session** — TDD + enable button (3.9)
11. **Wake Lock** — optional (3.10)
12. **Dashboard cards** — visual upgrade (3.11)
13. **Smoke E2E:** רענן את הדפדפן, צור agent, דבר, אסרט כל ה-states ויזואלית
14. **Commit:** `(slice-7): drive-first UX — state machine, dark mode, audio cues, car mode`

---

## 5. Definition of Done

### Design + Layout
1. ✅ Dark mode מלא עם CSS variables לפי v1
2. ✅ Layout flex עם header/chat/footer (100dvh, overflow hidden)
3. ✅ system-ui font, ui-monospace למוניטור
4. ✅ Header עם title + meta + ⚙ link

### Mic Button
5. ✅ כפתור 110px עגול במרכז (footer)
6. ✅ State machine TDD — 5 states (idle/recording/processing/speaking/cancelling)
7. ✅ 5 צבעים שונים לפי state (לפי §9.6)
8. ✅ Animations: pulse (recording), rotate (processing), flash (cancelling), glow (speaking)
9. ✅ Icons: 🎙 ⏺ 🌀 🔊 ✕
10. ✅ Status text מתחת לכפתור עם צבע לפי state
11. ✅ Hover scale 1.04, active scale 0.97

### Chat
12. ✅ User bubbles צד שמאל (RTL), agent ימין
13. ✅ Markdown styling מלא ב-bubble (p/h1-4/ul/ol/code/pre/a/blockquote/table)
14. ✅ Thought sub-bubble: dashed border, italic, 💭 prefix
15. ✅ Tools sub-bubble: collapsible עם arrow, status dots animated
16. ✅ Smart scroll עם user-intent detection + jump-down button

### Controls
17. ✅ Right-side: replay-last (🔊, 56px) + stop (⏹, 56px)
18. ✅ Stop visible רק במצב speaking
19. ✅ replay-last פעיל רק כשיש אודיו

### Audio
20. ✅ 5 Web Audio cues (recordingStart/Stop/thinking/speaking/error)
21. ✅ Cues מופעלים בstate transitions

### Car mode (opt-in via ?car=1)
22. ✅ Media Session API handlers (play/pause toggle isRecording)
23. ✅ Enable button פעיל רק במצב car
24. ✅ TDD: state transitions via bluetooth simulation

### Drive principles (§9.6)
25. ✅ Touch targets ≥80px (mic 110, side 56, dashboard cards ≥100h)
26. ✅ Wake Lock acquired during recording
27. ✅ No modals/dialogs
28. ✅ No pinch-zoom (viewport meta)

### Tests
29. ✅ Tests עוברים: target 220+ (היה 198 אחרי 5.6, +20 חדשים)
30. ✅ typecheck נקי, lint נקי

### Polish
31. ✅ Dashboard cards גדולים (≥100px height)
32. ✅ Empty state ל-dashboard ריק
33. ✅ Walkthrough entry + commit

---

## 6. Slice 7 לא כולל (נדחה)

- Segment navigation (prev/next) — Slice 8
- Audio file mp3 cues (`static/sounds/`) — Slice 8 future-proof
- Settings page redesign — Slice 8
- Per-message replay button (32px) — Slice 8 (יש כבר תיקון בסיסי ב-5.5)
- Multi-session UI dropdown — Slice 6 (לא דחוף לאבי לפי הוראתו)
- i18n strings — Slice 9

---

## 7. אם נתקעת

- **AudioContext לא נדלק:** דורש user gesture. וודא שה-cues מופעלים רק אחרי first click של כפתור.
- **Wake Lock requires HTTPS:** דרך ה-tunnel `tuns.sh` זה HTTPS. localhost dev — לא יעבוד, זו בעיה ידועה.
- **Media Session ב-test:** mock `navigator.mediaSession` עם `setActionHandler: vi.fn()`.
- **Svelte 5 `$effect` + CSS class binding:** השתמש ב-`class:state-recording={micState === "recording"}` במקום string concat.
- **scroll-behavior smooth + tests:** test ה-derive function, לא ה-DOM scroll.

---

## 8. אסור לערוך

- `packages/backend/src/**`
- `packages/core/src/**`
- `docs/agents/**`
- `docs/slice-1*.md` ... `docs/slice-6*.md`
- ה-frontend tests שנכתבו ב-5.5 (אבל מותר להוסיף עוד)

---

## 9. הוראות פעולה

1. קרא את ה-brief, ה-`vnext-architecture.md §9.6`, וה-`v1 index.html` (לעומק — 2025 שורות).
2. עבוד לפי Step-by-step.
3. TDD לכל logic (state machine, smart scroll, car mode, audio cues).
4. עדכן `docs/walkthrough.md` בסוף.
5. commit אחד.

**Timeline:** ~3-4 שעות עם TDD. אם 5+ — דווח ועצור.

בהצלחה.

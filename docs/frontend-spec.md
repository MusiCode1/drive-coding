# Frontend Specification — drive-coding

> **מקור אמת יחיד** למה ה-frontend צריך להיראות, להרגיש, ולעשות.
> סוכן שעובד על frontend **קורא קובץ זה** — לא צריך לקרוא 5 מסמכים נפרדים.
>
> **מבוסס על:**
> - `vnext-architecture.md §9.6` — עקרונות drive-first (קובע כשיש סתירה)
> - `/home/user/projects/voice-acp/frontend/index.html` — reference implementation (POC v1, 2025 שורות, עבד ב-prod)
> - `reviews/ui-parity-review.md` — gap analysis (מה חסר ומה שבור)

---

## 1. עקרונות Drive-First (§9.6 — קובע)

כל החלטת UI נשפטת לפי: **"האם זה עובד עם ידיים על ההגה ועיניים על הכביש?"**

1. **כפתור אחד גדול במרכז.** start/stop של הקלטה + cancel של מודל. אין כפתור נפרד לכל פעולה.
2. **Touch targets ≥ 80px.** אצבע בנהיגה לא מדייקת.
3. **High contrast, large text.** בועות גדולות, ניתנות לקריאה במבט קצר.
4. **TTS-first feedback.** כל מצב חשוב גם נשמע (לא רק נראה).
5. **בלי modals/dialogs.** הם דורשים אצבע מדויקת והסתכלות.
6. **בלי scroll מורכב.** scroll הבועות אוטומטי, אין pinch-zoom.
7. **Wake lock + landscape lock.** המסך לא יכבה, ולא יסתובב באמצע ריצה.
8. **Media Session API.** כפתור bluetooth ברכב יוכל להפעיל/לעצור הקלטה.

---

## 2. UI Surfaces

| Surface | Route | Purpose | Style |
|---------|-------|---------|-------|
| Dashboard | `/` | רשימת agents חיים + "+ חדש" | cards גדולים (min-height 100px), scroll vertical, dark |
| Agent live | `/agent/:id` | ממשק קולי פעיל | כפתור גדול במרכז footer, בועות מעליו |
| Agent new | `/agent/new` | בחירת CLI, cwd, model | רגיל. select dropdowns. לפני הנהיגה. |
| Settings | `/settings` | קולות, שפה, מפתחות | placeholder כרגע (Slice 8) |

---

## 3. Design Tokens — Dark Mode

מועתק מ-v1 `index.html:8-27`. **זה הcurrent ב-`+layout.svelte`.**

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
```

**Typography:** `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`
**Monospace:** `ui-monospace, "SF Mono", Consolas, monospace`

---

## 4. Page Layout — `/agent/:id`

```
┌─────────────────────────────┐
│ header (flex-shrink: 0)     │  ← link, title, meta, status badge, ⚙
├─────────────────────────────┤
│                             │
│   chat area (flex: 1)       │  ← overflow-y: auto, scroll-behavior: smooth
│   ┌───────────────────┐     │
│   │ bubbles            │     │
│   │ ...                │     │
│   └───────────────────┘     │
│                    [↓]      │  ← jump-down button (absolute, bottom-right)
├─────────────────────────────┤
│ footer (flex-shrink: 0)     │
│   status text               │  ← "לחצי על הכפתור כדי לדבר"
│   [🔊] [  🎙  ] [⏹]       │  ← replay-last | MIC 110px | stop
│   [text input]              │  ← collapsed in car mode
│   [🚗 enable]              │  ← only if ?car=1
└─────────────────────────────┘
```

**חוקי flex:**
- `.page-wrap`: `display: flex; flex-direction: column; height: 100dvh; overflow: hidden`
- `header` + `footer`: `flex-shrink: 0`
- `#chat-wrap`: `flex: 1; position: relative; min-height: 0; display: flex`
- `.chat` (ul): `flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; scroll-behavior: smooth`

**RTL:** `<html lang="he" dir="rtl">` ב-`app.html`. כל bubble עם `dir="auto"`.

---

## 5. כפתור ה-Mic — State Machine

### 5 states (לפי §9.6)

```
              ┌──── idle ◄──────┐
              │      │           │ done speaking
              │     click       │
              ▼                  │
          recording              │
              │ click            │
              ▼                  │
          processing             │
          (STT + ACP)            │
              │ first audio_chunk│
              ▼                  │
          speaking ──────────────┘
              │ click (interrupt)
              ▼
          cancelling
              │ (timeout / idle reached)
              ▼
          (back to idle)
```

### צבעים + animations + icons

| State | Color | CSS | Animation | Icon |
|-------|-------|-----|-----------|------|
| idle | כחול `var(--accent)` | `background: var(--accent)` | אין | 🎙 |
| recording | אדום `var(--recording)` | `background: var(--recording)` | `pulse 1.2s infinite` (box-shadow pulse) | ⏺ |
| processing | סגול `#8855ff` | `background: #8855ff` | `rotate-slow 2s linear infinite` | 🌀 |
| speaking | ירוק `var(--speaking)` | `background: var(--speaking)` | glow (box-shadow) | 🔊 |
| cancelling | כתום `#ff9933` | `background: #ff9933` | `flash-fast 0.3s infinite` | ✕ |

### CSS של הכפתור

```css
#mic-btn {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  border: none;
  font-size: 44px;
  cursor: pointer;
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
```

### State transitions (logic)

```ts
function deriveMicState(input): MicState {
  if (input.isCancelling) return "cancelling"
  if (input.isRecording) return "recording"
  if (input.isThinking && !input.isAudioPlaying) return "processing"
  if (input.isAudioPlaying) return "speaking"
  return "idle"
}
```

### לחיצה על הכפתור

| State | Action |
|-------|--------|
| idle | `voice.startRecording()` |
| recording | `voice.stopRecording()` → sends audio → transitions to processing |
| processing | (disabled — waiting) |
| speaking | `isCancelling = true; voice.cancel(); session.cancel()` |
| cancelling | (no-op) |

### Side controls (56px round buttons)

| Button | Icon | When visible | Action |
|--------|------|-------------|--------|
| replay-last | 🔊 | תמיד (disabled אם אין אודיו) | `voice.replayLast()` |
| stop | ⏹ | speaking / cancelling | `voice.cancel()` |

---

## 6. Status Text מתחת לכפתור

```ts
const MIC_STATUS_TEXT = {
  idle: "לחצי על הכפתור כדי לדבר",
  recording: "מקליט...",
  processing: "מעבד...",
  speaking: "מקריא תשובה",
  cancelling: "מבטל...",
}
```

צבע הstatus text משתנה לפי state (CSS class):
- `.recording { color: var(--recording); }`
- `.processing { color: var(--thinking); }`
- `.speaking { color: var(--speaking); }`
- `.cancelling { color: #ff9933; }`

---

## 7. Chat Bubbles

### Alignment (RTL)

| Kind | Side | CSS |
|------|------|-----|
| user | **ימין** (start ב-RTL) | `align-self: flex-start` |
| assistant | **שמאל** (end ב-RTL) | `align-self: flex-end` |
| thought | **שמאל** | `align-self: flex-end; opacity: 0.85` |
| tool_call | **full width** | `align-self: stretch` |

### Bubble styling

```css
.bubble {
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 14px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-wrap: break-word;
  max-width: 85%;
}

.bubble-user {
  background: var(--bubble-user);     /* #2a3550 */
  border-bottom-right-radius: 4px;    /* asymmetric — flat on user side */
}

.bubble-agent {
  background: var(--bubble-agent);    /* #1d2230 */
  border-bottom-left-radius: 4px;
}
```

### Thought sub-bubble

```css
.msg-thought .bubble {
  background: transparent;
  border: 1px dashed var(--border);
  color: var(--fg-dim);
  font-style: italic;
  font-size: 12.5px;
}
.msg-thought .bubble::before {
  content: "💭 ";
  opacity: 0.6;
}
```

### Tools sub-bubble (collapsible)

**Reference:** v1 `index.html:236-312`

```
┌──────────────────────────────────────────┐
│ ● tool-name                    completed ▸│  ← header, click to expand
├──────────────────────────────────────────┤
│   ● read file.ts           ✅            │  ← tool items (hidden by default)
│   ● bash ls                ✅            │
│   ● edit app.ts            ⏳            │
└──────────────────────────────────────────┘
```

- header: `tools-header` — flex row, summary + arrow
- items: `tool-item` — status dot (color-coded) + tool name
- arrow rotates 90° on expand (`transform: rotate(90deg)`)
- status dots:
  - `pending` → `var(--muted)` gray
  - `in_progress` → `var(--thinking)` orange, `pulse-dot 1s infinite`
  - `completed` → `var(--speaking)` green
  - `failed` → `var(--recording)` red

### Markdown rendering

Assistant messages render HTML via `{@html renderMarkdown(msg.text)}`.

**Styling ב-bubble (reference: v1 `index.html:168-213`):**

```css
.bubble p { margin: 0 0 0.5em; }
.bubble p:last-child { margin-bottom: 0; }
.bubble h1, .bubble h2, .bubble h3, .bubble h4 { margin: 0.5em 0 0.3em; font-weight: 600; }
.bubble h1 { font-size: 1.2em; }
.bubble h2 { font-size: 1.1em; }
.bubble h3, .bubble h4 { font-size: 1em; }
.bubble ul, .bubble ol { margin: 0.3em 0; padding-inline-start: 1.5em; }
.bubble li { margin: 0.15em 0; }
.bubble code {
  background: rgba(255,255,255,0.07);
  padding: 1px 5px;
  border-radius: 4px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 0.92em;
}
.bubble pre {
  background: rgba(0,0,0,0.3);
  padding: 8px 10px;
  border-radius: 6px;
  overflow-x: auto;
  margin: 0.4em 0;
  direction: ltr;
  text-align: left;
}
.bubble pre code { background: none; padding: 0; }
.bubble a { color: var(--accent-hi); }
.bubble blockquote {
  border-inline-start: 3px solid var(--border);
  padding-inline-start: 10px;
  margin: 0.4em 0;
  color: var(--fg-dim);
}
.bubble table { border-collapse: collapse; margin: 0.4em 0; }
.bubble th, .bubble td { border: 1px solid var(--border); padding: 4px 8px; }
```

### Empty chat state

```css
.chat:empty::before {
  content: "התחילו לדבר — תוכן השיחה יופיע כאן.";
  color: var(--muted);
  font-size: 13px;
  align-self: center;
  margin: auto;
}
```

---

## 8. Smart Scroll

**Reference:** v1 `index.html:558-594`

**Logic:**
- auto-scroll מופעל כברירת מחדל
- כל user interaction (wheel/touch/keyboard/mousedown) → סמן timestamp
- on scroll event:
  - `distance ≤ 10px` מתחתית → re-enable auto + hide jump-down
  - `distance > 10px` + recent user interaction (<500ms) + auto was on → disable auto + show jump-down
  - otherwise → no change

**Jump-down button:**
- position: absolute, bottom 14px, inset-inline-end 14px
- 40px round, `↓` icon
- opacity 0 → 1 transition (200ms)
- click → `chatEl.scrollTop = chatEl.scrollHeight; autoScrollEnabled = true`

---

## 9. Voice Flow

### הקלטה (push-to-talk)

1. click mic (idle) → `voice.startRecording()`
2. MediaRecorder starts, mic state → recording, audio cue plays
3. click mic (recording) → `voice.stopRecording()`
4. blob → base64 → WS message: `{ type: "audio", agentId, audioBase64, mimeType }`
5. mic state → processing

### תשובה (streaming)

1. backend returns `stt_partial` → show STT preview bubble
2. backend returns `text_chunk` (kind=message) → streaming assistant bubble
3. backend returns `text_chunk` (kind=thought) → thought sub-bubble
4. backend returns `tool_call` / `tool_call_update` → tools sub-bubble (merge by toolCallId)
5. backend returns `audio_chunk` (mp3Base64) → AudioQueue plays, mic state → speaking
6. backend returns `done` → finalize streaming, mic state → idle

### AudioQueue

```ts
class AudioQueue {
  private queue: HTMLAudioElement[] = []
  private playing = false
  private lastPlayed: HTMLAudioElement | null = null

  enqueue(mp3Base64: string): void {
    const audio = new Audio(`data:audio/mp3;base64,${mp3Base64}`)
    audio.addEventListener("ended", () => {
      this.playing = false
      this.tick()
    })
    this.queue.push(audio)
    this.tick()
  }

  private tick(): void {
    if (this.playing) return
    const next = this.queue.shift()
    if (!next) return
    this.playing = true
    this.lastPlayed = next
    next.play().catch(() => { this.playing = false; this.tick() })
  }

  replayLast(): void {
    if (!this.lastPlayed) return
    this.lastPlayed.currentTime = 0
    this.lastPlayed.play().catch(() => {})
  }

  clear(): void { this.queue = []; this.playing = false }
  get hasLastPlayed(): boolean { return this.lastPlayed !== null }
}
```

### כפתור העלאת אודיו נסתר (QA/debug)

```html
<input id="audio-file-input" type="file" accept="audio/*" style="display:none" />
```

מפעילים: `document.querySelector('#audio-file-input').click()`
הקובץ עובר בדיוק אותו flow כמו הקלטה: blob → base64 → WS `audio` message.

קובץ test מוכן: `/tmp/test-voice.mp3` (56KB, עברית, "שלום, אני בודק את המערכת").

---

## 10. Audio Cues (D42)

5 צלילים מסונתזים עם Web Audio API (oscillator):

| Event | Tone | When |
|-------|------|------|
| recordingStart | A5 (880Hz), 120ms | mic idle → recording |
| recordingStop | E5 (660Hz), 120ms | mic recording → processing |
| thinking | C5→E5 rising, 300ms | entering processing |
| speaking | E5→C5 falling, 300ms | first audio_chunk arrives |
| error | E4→A3, 400ms | error message received |

**חשוב:** AudioContext דורש user gesture. ייצור ב-first click בלבד.

---

## 11. Car Mode (?car=1)

**Reference:** v1 `index.html:1878-2018`

### רכיבים
1. **Media Session API** — metadata + play/pause handlers
2. **Background noise source** — AudioBufferSourceNode, loop, gain=0.015 (מחזיק MediaSession פעיל)
3. **Startup chime** — A5→E6 two-tone (Web Audio oscillator)
4. **Enable button** — מופיע רק ב-`?car=1`

### Media Session handlers

| Action | Behavior |
|--------|----------|
| pause | toggle recording (start if idle, stop if recording) |
| play | toggle recording |
| previoustrack | replay-last |

### Flow

1. user navigates to `/agent/:id?car=1`
2. enable button appears: "🚗 הפעל בקרת רכב"
3. click → AudioContext created → startup chime → background noise loop → handlers registered
4. badge: "🚗 בקרת רכב פעילה"
5. bluetooth play/pause → toggle mic

---

## 12. Wake Lock + Orientation

**Wake Lock:**
- acquire `navigator.wakeLock.request("screen")` when entering recording
- release when returning to idle

**Landscape Lock (car mode only):**
- `screen.orientation.lock("landscape")` — requires HTTPS + might need fullscreen

---

## 13. Header

```html
<header>
  <a href="/" class="back-link">←</a>
  <h1 class="title">{agent.cliKind}</h1>
  <div class="meta" dir="ltr">{agent.cwd}</div>
  <span class="badge badge-{status}">{status}</span>
  <a href="/settings" class="settings-link">⚙</a>
</header>
```

**CSS:**
```css
header {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.meta {
  font-size: 11px;
  color: var(--muted);
  font-family: ui-monospace, monospace;
  text-align: left;
  direction: ltr;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 60%;
}
```

---

## 14. Dashboard (`/`)

**Cards:** כל agent = card גדול (min-height 100px):
- שם CLI + cwd + status badge
- כפתור מחיקה `×` (position: absolute, `inset-inline-end`)
- click → navigate to `/agent/:id`

**Empty state:**
```
אין סוכנים פעילים.
לחצו "+ סוכן חדש" כדי להתחיל.
```

**"+ סוכן חדש" button:** בולט, ברור, touch-friendly (≥80px height).

**אסור:** `window.confirm()` — עקרון §9.6 #5. במקום: inline "בטוח?" + כפתורי אשר/בטל.

---

## 15. Error Display

```css
.error-banner {
  color: var(--recording);
  background: rgba(255, 79, 79, 0.1);
  border: 1px solid rgba(255, 79, 79, 0.3);
  padding: 10px 14px;
  border-radius: 14px;
  font-size: 13px;
  align-self: center;
  max-width: 85%;
}
```

- `crashReason` מוצג בmonospace מתחת ל-"הסוכן קרס":
  ```css
  .crash-reason { font-family: ui-monospace, monospace; font-size: 0.85rem; }
  ```

- WS reconnect: `"מתחבר מחדש... (ניסיון N)"` מוצג ב-`session.error`
- exponential backoff: 1s, 2s, 4s, 8s, 15s, 30s

---

## 16. WS Reconnect

```ts
// agent-session store:
onclose = () => {
  if (!intentionallyClosed) scheduleReconnect()
}

function scheduleReconnect() {
  const delays = [1000, 2000, 4000, 8000, 15000, 30000]
  const delay = delays[Math.min(retryCount, delays.length - 1)]
  error = `מתחבר מחדש... (ניסיון ${retryCount + 1})`
  retryTimer = setTimeout(() => { retryCount++; connect() }, delay)
}
```

---

## 17. מה קיים כ-stores (לא לשכתב — לחבר נכון)

| Store | Path | מה עושה | TDD? |
|-------|------|---------|------|
| `agent-session.svelte.ts` | `lib/stores/` | WS lifecycle, messages, reconnect | ✅ 7 tests |
| `voice-session.svelte.ts` | `lib/stores/` | recording, STT, AudioQueue | ✅ 6 tests |
| `mic-state.svelte.ts` | `lib/stores/` | `deriveMicState()` — pure function | ✅ 8 tests |
| `smart-scroll.ts` | `lib/stores/` | `deriveScrollState()` — pure function | ✅ 5 tests |
| `car-mode.svelte.ts` | `lib/stores/` | Media Session + noise | ✅ 3 tests |
| `cues.ts` | `lib/audio/` | 5 Web Audio oscillator cues | לא (side effects) |
| `recorder.ts` | `lib/audio/` | MediaRecorder wrapper | לא |
| `player.ts` | `lib/audio/` | AudioQueue | ✅ 7 tests |

**ה-stores טובים.** ה-page שמחבר אותם — צריך review מקיף.

---

## 18. Svelte 5 Runes — כללי זהירות

### `$effect` שכותב ל-`$state` שהוא גם קורא = infinite loop

```ts
// ❌ שבור:
$effect(() => {
  session.disconnect()        // reads session (reactive)
  session = createNew()       // writes session → re-triggers effect
})

// ✅ תקין:
$effect(() => {
  const id = agentId          // only reactive read
  untrack(() => {
    session.disconnect()
    session = createNew(id)
  })
})
```

### `$derived` שקורא ל-constructor = instance חדש בכל render

```ts
// ❌ שבור — instance חדש בכל re-render:
let session = $derived(createAgentSessionStore(agentId))

// ✅ תקין — $state עם $effect שמתעדכן רק כש-agentId משתנה:
let session = $state(createAgentSessionStore(agentId))
$effect(() => {
  const id = agentId
  untrack(() => { ... })
})
```

---

## 19. Testing Voice בלי מיקרופון

**כפתור העלאת אודיו נסתר:**
```js
// בconsole או ב-playwright:
document.querySelector('#audio-file-input').click()
// → בחר /tmp/test-voice.mp3 → עובר בדיוק אותו flow כמו mic recording
```

**ב-playwright (inject ישיר):**
```js
// קרא קובץ → base64 → שלח WS
const base64 = btoa(String.fromCharCode(...new Uint8Array(await (await fetch('/test-voice.mp3')).arrayBuffer())))
// שלח דרך WS שנפתח ב-agent-session store
```

**קובץ test מוכן:** `/tmp/test-voice.mp3` — 56KB, עברית, ElevenLabs v3.

---

## 20. Checklist — מה צריך לעבוד

נגזר מ-`reviews/ui-parity-review.md` + עדכונים:

### חובה (blocker)

- [ ] `<html lang="he" dir="rtl">` ב-`app.html`
- [ ] אין infinite loop ב-`$effect`
- [ ] כפתור mic 110px עם 5 states + animations
- [ ] bubbles: user ימין, agent שמאל (RTL)
- [ ] markdown rendered ב-agent bubbles
- [ ] text prompt עובד E2E
- [ ] voice prompt עובד E2E (via file upload)
- [ ] auto-scroll + jump-down
- [ ] status text עם צבע לפי state
- [ ] error display (crash reason, WS errors)

### גבוה

- [ ] audio cues ב-state transitions
- [ ] replay-last button wired
- [ ] stop button visible only in speaking
- [ ] tools collapsible עם status dots
- [ ] thought bubble עם 💭
- [ ] WS reconnect עם exponential backoff

### בינוני

- [ ] car mode (?car=1) — Media Session handlers
- [ ] wake lock during recording
- [ ] dashboard: cards גדולים, empty state
- [ ] delete agent: inline confirm (לא window.confirm)

### נמוך

- [ ] car mode startup chime + background noise
- [ ] landscape lock (car mode)
- [ ] per-message replay button (v1 feature — future)
- [ ] segment navigation ⏮/⏭ (v1 feature — future)

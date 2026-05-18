# UI Parity Review — vnext vs v1 vs Plan

**Date:** 2026-05-16  
**Reviewer:** Yolo (claude-sonnet-4-6)  
**Sources:**
- תכנון: `docs/vnext-architecture.md §9.6` (שורות 749-818)
- גרסה v1: `/home/user/projects/voice-acp/frontend/index.html` (2025 שורות)
- vnext: `packages/frontend/src/` (Slice 7)

---

## TL;DR

vnext מיישמת **~80% מתכנון §9.6** ו-**~65% מפריטי v1**. הארכיטקטורה נקייה יותר (Svelte 5 runes, TypeScript מלא, חלוקה למודולים), אבל חסרים features קריטיים שהיו ב-v1 בייצור: **אין streaming TTS** (רק queue של chunks), **אין per-message replay button**, **אין ניווט ⏮/⏭**, **אין pause/resume**, ו-**כפתור replay-last לא עובד** (placeholder בלבד). באג הסדר ההפוך של בועות אומנם **תוקן** ב-CSS, אך יש **בעיה של isCancelling שנשאר false לנצח** — state machine לא שלם. AudioQueue סובל מ**one-word bug** שאבי דיווח עליו.

---

## Feature Comparison Table

### Layout & Structure

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| page structure | header/chat/footer | ✅ header+chat-wrap+footer | ✅ זהה | אין |
| dark mode tokens | high contrast | ✅ 13 tokens ב-:root | ✅ זהה tokens ב-+layout.svelte | אין |
| `100dvh`, overflow hidden | §9.6 "no scroll" | ✅ `height:100dvh; overflow:hidden` על html,body | ✅ זהה ב-:global — **אבל** .page-wrap גם לוקח 100dvh ← double 100dvh | מינור: double height |
| RTL — `dir="rtl"` על html | §9.6 | ✅ `<html lang="he" dir="rtl">` | ❌ **חסר** — אין `dir="rtl"` על html/body. textarea בלבד יש `direction:rtl` ב-CSS | **קריטי לRTL** |
| RTL — `dir="auto"` על bubbles | §9.6 | ✅ `bubbleEl.setAttribute("dir","auto")` | ✅ `dir="auto"` על כל bubble | אין |
| no pinch-zoom viewport | §9.6 "no pinch-zoom" | ❌ אין `maximum-scale=1` ב-viewport | ✅ `<svelte:head>` מוסיף max-scale=1 | vnext **טוב יותר** |

### Mic Button

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| גודל | ≥80px | ✅ 110px | ✅ 110px | אין |
| state machine | 5 states: idle/recording/processing/speaking/cancelling | 4 states (אין processing; יש paused במקום cancelling) | ✅ 5 states: deriveMicState() | vnext עוקב אחרי spec |
| צבע idle | אפור כחלחל | כחול (var(--accent)) | כחול (var(--accent)) | v1 וvnext שניהם כחול — spec אומר אפור |
| צבע recording | אדום עז | ✅ var(--recording) #ff4f4f + pulse | ✅ זהה | אין |
| צבע processing | סגול | ❌ אין state זה ב-v1 | ✅ #8855ff + rotate-slow | vnext **עוקב spec** |
| צבע speaking | ירוק | ❌ אדום ב-v1 (!) | ✅ var(--speaking) #4fff8a | **vnext מתקן v1** |
| צבע cancelling | כתום | ❌ אין ב-v1 | ✅ #ff9933 + flash-fast | vnext **עוקב spec** |
| pulse animation | 1Hz recording | ✅ pulse 1.2s | ✅ pulse 1.2s | אין |
| rotate animation | processing | ❌ אין ב-v1 | ✅ rotate-slow 2s | vnext **מוסיף** |
| flash animation | cancelling | ❌ אין ב-v1 | ✅ flash-fast 0.3s | vnext **מוסיף** |
| waveform/pulse by volume | speaking | ❌ אין ב-v1 | ❌ אין — רק צבע קבוע | שניהם חסרים |
| icons per state | — | 🎙⏺⏸▶ | 🎙⏺🌀🔊✕ | שונה; vnext לפי spec |
| touch target side buttons | ≥80px | ✅ 56px (replay-last, stop) | 56px (same) | **שני הגרסאות** מתחת ל-80px בסייד |
| disabled state | — | ✅ `disabled` + opacity | ✅ זהה | אין |
| isCancelling wired | cancelling state | — | ❌ **בעיה**: `isCancelling: false` hardcoded ב-page.svelte:43 — לא מחובר לאף trigger | **bug** |

### Chat Area

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| bubble alignment user | start (RTL = ימין) | ✅ `.msg.user { align-self: flex-start }` | ✅ `.msg-user { align-self: flex-start }` | אין |
| bubble alignment agent | end (RTL = שמאל) | ✅ `.msg.agent { align-self: flex-end }` | ✅ `.msg-assistant { align-self: flex-end }` | אין (תוקן) |
| bubble styling | — | ✅ border-radius 14px, ≤85% max-width | ✅ זהה | אין |
| markdown rendering | — | ✅ `setHtml(html)` — backend renders, client setInnerHTML | ✅ `{@html renderMarkdown(msg.text)}` | שונה — vnext renders client-side |
| thought sub-bubble | 💭, dashed border, italic | ✅ `border: 1px dashed var(--border); font-style:italic; ::before "💭"` | ✅ זהה | אין |
| tools sub-bubble collapsible | — | ✅ collapsible עם arrow rotation, single vs multi-tool summary | ✅ collapsible, arrow rotate | v1 יותר עשיר: summary מחשבת "X כלים" + אייקונים; vnext — כלי אחד בלבד per bubble |
| tools — status dots | — | ✅ in_progress/completed/failed + pulse animation | ✅ זהה | אין |
| empty state | — | ✅ `::before "התחילו לדבר..."` | ✅ זהה | אין |
| auto-scroll | smart scroll | ✅ distance≤10 + user-intent (500ms window) | ✅ זהה logic ב-smart-scroll.ts | אין |
| jump-down button | — | ✅ opacity:0/1 transition + inset-inline-end | ✅ זהה | אין |
| STT partial text | preview בועה | ✅ אין text preview, רק status text | ✅ בועה בפועל `🎙 {voice.sttText}` | **vnext טוב יותר** |
| history playback | — | ✅ history_start/chunk/tool_call/done events | ❌ **חסר לחלוטין** — agent-session לא מטפל בhist events | **קריטי** |
| thought translation | עברית + אנגלית | ✅ שני-span: _originalEl + _translationEl | ❌ **חסר** — כל thought הוא בועה אחת | חסר |

### Voice Pipeline

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| push-to-talk recording | — | ✅ MediaRecorder + webm/opus fallback | ✅ זהה (recorder.ts) | אין |
| streaming TTS (MediaSource) | — | ✅ StreamingAudio עם MSE + blob fallback | ❌ **חסר** — AudioQueue משחק chunks אחד-אחרי-אחד (one-word bug!) | **קריטי** |
| per-message replay button | — | ✅ replay-btn עם state machine (pending/ready/cold/fetching/failed) | ❌ **חסר לחלוטין** | **קריטי** |
| replay-last button | — | ✅ `lastAudioSub` tracking | ❌ **stub** — `onclick={() => {/* Slice 8 */}}` ב-page.svelte:431 | **חסר** |
| stop button | — | ✅ מופיע רק speaking/paused | ✅ מופיע רק speaking/cancelling | כמעט זהה |
| prev/next segment navigation ⏮⏭ | — | ✅ playbackHistory + streamOrder navigation | ❌ **חסר לחלוטין** | **חסר** |
| pause/resume speaking | — | ✅ paused state — לחיצה משהה/ממשיכה | ❌ **חסר** — אין paused state ב-vnext | **חסר** |
| audio_start/chunk/end streaming | — | ✅ WS events `audio_start`, `audio_chunk`, `audio_end` | ✅ voice-session מטפל ב-`audio_chunk` (לא בstreaming events!) | **שונה בהותאמות** |
| tool chime audio | — | ✅ playToolChime() — triangle wave E5→C5 | ❌ **חסר** | חסר |

### Audio Cues

| Feature | תכנון §9.6 (D42) | v1 impl | vnext impl | Gap |
|---------|-----------------|---------|------------|-----|
| recordingStart cue | — | ✅ implicit (אין cue נפרד ב-v1) | ✅ 880Hz 0.12s | vnext **מוסיף** |
| recordingStop cue | — | ✅ implicit | ✅ 660Hz 0.12s | vnext **מוסיף** |
| thinking chime | G4 (392Hz) | ✅ sine 392Hz 0.18s | ✅ C5→E5 rising (523→659) 0.3s | שונה אך מוגדר |
| speaking cue | — | ❌ אין | ✅ E5→C5 falling (659→523) 0.3s | vnext **מוסיף** |
| error cue | — | ❌ אין | ✅ E4→A3 (330→220) 0.4s | vnext **מוסיף** |
| startup chime (car mode) | — | ✅ A5→E6 two tones | ❌ **חסר** ב-car-mode.svelte | **חסר ב-car** |
| tool call chime | — | ✅ triangle E5→C5 before TTS of tool title | ❌ **חסר** | **חסר** |
| AudioContext lifecycle | — | ✅ lazy init, global reuse | ✅ lazy init, module-level singleton | אין |

### Car Mode

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| Media Session API | ✅ | ✅ play/pause handlers | ✅ play/pause handlers | אין |
| Bluetooth button | ✅ | ✅ play→toggle recording, pause→toggle recording | ✅ זהה | אין |
| previoustrack handler | — | ✅ → replayLastBtn.click() | ❌ **setActionHandler("previoustrack", null)** — מנקה במקום מגדיר! | **bug** |
| startup chime | ✅ | ✅ A5→E6 two-tone before noise | ❌ **חסר** | **חסר** |
| background noise source | ✅ | ✅ AudioBufferSourceNode, loop=true, gain=0.015 | ❌ **חסר** — בלי noise, MediaSession עשוי להתנקות | **חסר** |
| enable UI | — | button קבוע במרכז (fixed position) | ✅ car-enable-btn ב-footer | מיקום שונה |
| landscape lock | §9.6 | ❌ אין | ✅ `screen.orientation.lock("landscape")` | **vnext מוסיף** |

### Wake Lock

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| screen.wakeLock during recording | ✅ | ❌ **חסר** ב-v1 | ✅ acquireWakeLock() on recording start, release on idle | **vnext מוסיף** |

### Dashboard

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| cards גדולים | "cards גדולים" | ❌ v1 אין dashboard — SPA אחד | ✅ min-height:100px cards | אין (vnext חדש) |
| empty state | — | — | ✅ icon + title + desc + CTA button | טוב |
| agent status display | — | — | ✅ color-coded badges: ready/busy/starting/crashed/closed | טוב |

### Settings

| Feature | תכנון §9.6 | v1 impl | vnext impl | Gap |
|---------|-----------|---------|------------|-----|
| route exists (no 404) | "Settings `/settings`" | ✅ `/config.html` נפרד | ✅ `/settings/+page.svelte` placeholder | אין |
| placeholder content | — | ❌ — v1 אין settings route | ✅ placeholder ברור עם הסבר | טוב |

---

## 🔴 Bugs Found

### Bug 1 — isCancelling hardcoded false — state machine לא שלם
**קובץ:** `packages/frontend/src/routes/agent/[id]/+page.svelte:43`
```typescript
let micState = $derived(
  deriveMicState({
    isRecording: voice.isRecording,
    isThinking: session.status === "thinking" || voice.voiceState === "transcribing",
    isAudioPlaying: voice.voiceState === "speaking",
    isCancelling: false, // set by explicit cancel action below ← זה לא נכון!
  }),
)
```
**בעיה:** `isCancelling` תמיד `false` — מצב `cancelling` אף פעם לא יושג. הכפתור אף פעם לא יציג ✕ + flash כתום, ולחיצה בזמן speaking תעשה `voice.cancel() + session.cancel()` אבל המשתמש יראה מעבר ישיר ל-idle בלי feedback חזותי.  
**תיקון מוצע:** להוסיף `let isCancelling = $state(false)` ולהדליק אותו ב-`onMicClick` כשעוברים מ-speaking ב-cancel, לכבות ב-$effect כש-voiceState חוזר ל-idle.

---

### Bug 2 — AudioQueue חסר streaming — "one word bug"
**קובץ:** `packages/frontend/src/lib/audio/player.ts:15-30`
```typescript
enqueue(mp3Base64: string): void {
  const audio = new Audio(`data:audio/mp3;base64,${mp3Base64}`)
  audio.addEventListener("ended", () => {
    this.playing = false
    this.onStateChange?.(false)
    this.tick()  // ← next chunk starts here
  })
  this.queue.push(audio)
  this.tick()
}
```
**בעיה:** כל chunk הוא `Audio` נפרד שמשוחק רק אחרי שהקודם מסתיים. אם backend שולח MP3 segments קצרים (מילה אחת כל chunk), המשתמש שומע ניתוק ו-stuttering בין כל מילה — זה הבאג שאבי דיווח עליו ("שמע רק מילה אחת").  
**תיקון נדרש:** המרה ל-streaming queue דומה לv1 `StreamingAudio` עם `MediaSource` + blob fallback, או לכל הפחות רצף של chunks לblob אחד לפני ניגון.

---

### Bug 3 — car mode previoustrack מנקה handler (null) במקום מגדיר
**קובץ:** `packages/frontend/src/lib/stores/car-mode.svelte.ts:62-66`
```typescript
try {
  navigator.mediaSession.setActionHandler("previoustrack", null)  // ← null = הסרה!
} catch {
  // ignore
}
```
**בעיה:** `null` ב-`setActionHandler` מסיר את ה-handler הקיים במקום להגדיר אחד חדש. ב-v1 היה: `setActionHandler("previoustrack", () => { replayLastBtn.click() })`.  
**תיקון:** להחליף `null` ב-callback שמבצע replay-last — כשזה יהיה ממומש.

---

### Bug 4 — `session` נוצר ב-$derived — זליגת instances
**קובץ:** `packages/frontend/src/routes/agent/[id]/+page.svelte:19-21`
```typescript
let session = $derived(createAgentSessionStore(agentId))
let voice = $derived(createVoiceSessionStore(session))
let carMode = $state(createCarMode())
```
**בעיה:** `$derived` מריץ מחדש כל פעם ש-`agentId` משתנה (נכון), אבל הוא גם עשוי לרוץ מחדש ב-re-renders אחרים. כל ריצה יוצרת instance חדש של `createAgentSessionStore` ומפעילה `AudioQueue` + `Recorder` חדשים. ה-WebSocket הישן לא נסגר אוטומטית (אין `onDestroy` ב-store). `onDestroy` ב-page קורא `session.disconnect()` שמסגור את ה-WS הנוכחי — אבל אם `session` נוצר מחדש לפני `onDestroy`, WS ישן יישאר פתוח.  
**תיקון מוצע:** שנה ל-`$state` עם שמירה של agentId ב-effect נפרד שסוגר את הישן:
```typescript
let session = $state(createAgentSessionStore(agentId))
$effect(() => {
  const id = agentId
  session.disconnect()
  session = createAgentSessionStore(id)
})
```

---

### Bug 5 — WebSocket reconnect חסר
**קובץ:** `packages/frontend/src/lib/stores/agent-session.svelte.ts:160-168`
```typescript
ws.onclose = () => {
  status = "disconnected"
  ws = null
}
```
**בעיה:** כשWS נסגר (server restart, network blip), הסטטוס עובר ל-disconnected ולמשתמש אין דרך להתחבר מחדש חוץ מ-refresh. ב-v1 גם לא היה reconnect אוטומטי, אבל v1 היה SPA אחד בלי routing.  
**תיקון מוצע:** exponential backoff reconnect ב-onclose (3-5 ניסיונות, 1s/2s/5s delays) — ולהראות ב-UI "מתחבר מחדש..." עם counter.

---

### Bug 6 — `delete-btn` על ה-dashboard עם `inset-inline-start` — כפתור מחיקה ב-RTL נמצא בצד לא נכון
**קובץ:** `packages/frontend/src/routes/+page.svelte:317-320`
```css
.delete-btn {
  position: absolute;
  top: 12px;
  inset-inline-start: 12px;  /* ← בRTL = ימין! */
```
**בעיה:** `inset-inline-start` ב-RTL הוא הצד הימני, אבל ה-card-link לוקח `padding-inline-end: 60px` כדי לפנות מקום — שזה גם ה-RTL=שמאל. כפתור ה-× יופיע **בצד הלא-נכון** ביחס ל-padding שפנוי.  
**תיקון:** לשנות ל-`inset-inline-end: 12px` — הכפתור יהיה בקצה הלוגי הנגדי לtext, ול-`padding-inline-end` להישאר.

---

## 🟡 Missing vs v1

פיצ'רים שהיו בv1 בייצור ולא קיימים ב-vnext (ממוינים לפי חשיבות):

| Feature | חשיבות | תיאור |
|---------|--------|-------|
| **Streaming TTS** | קריטי | v1: StreamingAudio עם MSE; vnext: AudioQueue — one-word bug. בלי streaming, TTS לא ישמיע יותר מ-word-per-chunk |
| **Per-message replay button** | גבוה | v1: כל message bubble קיבלה כפתור 🔊 עם state machine (pending/ready/cold/fetching/failed). vnext: חסר לחלוטין |
| **Replay-last wired** | גבוה | v1: `replayLastBtn` עם `lastAudioSub` tracking. vnext: `onclick={() => {/* Slice 8 */}}` — stub בלבד |
| **⏮/⏭ Segment navigation** | גבוה | v1: prev/next בין TTS segments. vnext: חסר לחלוטין |
| **Pause/Resume speaking** | בינוני | v1: paused state — לחיצה ב-speaking = hashaya, לחיצה שנייה = המשך. vnext: לחיצה = cancel מיד |
| **History playback** | בינוני | v1: history_start/chunk/tool_call/done events. vnext: agent-session אינו מטפל בם |
| **Thought translation** | בינוני | v1: שורה שנייה עברית בתוך thought bubble. vnext: בועה אחת בלבד |
| **Tool call chime** | נמוך | v1: triangle wave לפני TTS של כותרת כלי. vnext: חסר |
| **Car mode noise source** | נמוך | v1: AudioBufferSourceNode gapless loop. vnext: חסר — MediaSession עלול להתנקות |
| **Car mode startup chime** | נמוך | v1: A5→E6 two-tone. vnext: חסר |
| **car previoustrack handler** | נמוך | v1: → replay-last. vnext: null (מנקה handler) |
| **Multi-tool summary** | נמוך | v1: כשיש >1 כלים — "X כלים" + אייקונים ב-summary. vnext: כלי אחד per bubble בלבד |
| **dir="rtl" על html** | קריטי | v1: `<html lang="he" dir="rtl">`. vnext: חסר — הכיוון עלול להישבר בדפדפנים ישנים |

---

## 🟢 Improvements over v1

פיצ'רים שvnext עושה **טוב יותר** מv1:

| Feature | v1 | vnext |
|---------|-----|-------|
| **speaking state color** | אדום — זהה לrecording! | ✅ ירוק (כמו spec) — הבחנה ברורה |
| **5 mic states** | 4 states (אין processing, paused במקום cancelling) | ✅ 5 states לפי spec |
| **processing state** | חסר | ✅ סגול + rotate animation |
| **cancelling state** | חסר | ✅ כתום + flash animation |
| **STT preview bubble** | status text בלבד | ✅ בועה מלאה "🎙 {text}" |
| **Wake lock** | חסר | ✅ screen.wakeLock.request during recording |
| **Landscape lock** | חסר | ✅ screen.orientation.lock("landscape") בcar mode |
| **no-pinch-zoom viewport** | חסר | ✅ `maximum-scale=1, user-scalable=no` |
| **5 audio cues** | 2 (thinking + implicit) | ✅ 5 cues: start/stop/thinking/speaking/error |
| **TypeScript strict** | JS ללא types | ✅ strict TS, ArkType schemas |
| **Testable pure functions** | monolithic JS | ✅ deriveMicState, deriveScrollState — pure + tested |
| **Multi-agent dashboard** | SPA אחד (cwd בURL) | ✅ agents list, create/delete, status polling |
| **Multi-page routing** | SPA — `/config.html` נפרד | ✅ SvelteKit routing: `/`, `/agent/:id`, `/settings` |
| **Markdown client-side** | backend renders → setInnerHTML | ✅ renderMarkdown() client-side — אין network round-trip |
| **tool bubble arrow rotation** | CSS class toggle | ✅ Svelte reactive class:expanded |

---

## 🔵 Missing vs Plan (§9.6)

פיצ'רים שבתכנון §9.6 ולא ממומשים (מעבר לv1):

| Feature | §9.6 | vnext | הערה |
|---------|------|-------|------|
| `dir="rtl"` על html | מרומז ב"drive-first RTL" | ❌ חסר | יש לו השפעה על bubbles, menus, scroll direction |
| idle color = "אפור כחלחל" | כן | ❌ כחול — שניהם v1 וvnext כחול | צבע לא עוקב spec |
| waveform by volume (speaking) | "waveform או pulse לפי volume" | ❌ חסר | Web Audio AnalyserNode נדרש |
| "בלי modals/dialogs" | §9.6 עקרון 5 | ✅ `confirm("למחוק?")` ב-dashboard | **הפרה** — dashboard משתמש ב-`window.confirm` |
| settings route מלא | §9.6: "קולות, שפה, BYOK" | placeholder | Slice 8 |

---

## Recommendations

סדר עדיפויות מה לתקן קודם:

### עדיפות 1 — Blockers (מונעים שימוש בסיסי)

1. **Streaming TTS** — ללא זה TTS כמעט לא שמיש. יש להמיר AudioQueue ל-StreamingAudio עם MSE.
2. **`dir="rtl"` על html** — ב-`+layout.svelte` להוסיף `:global(html) { direction: rtl; }` או `lang="he" dir="rtl"` ב-app.html.
3. **isCancelling hardcoded false** — state machine לא שלם; cancelling state לא ניתן להגיע אליו.

### עדיפות 2 — High Value (חוויה מלאה)

4. **Per-message replay button** — feature מרכזי לUX — המשתמש צריך להשמיע שוב תשובות ספציפיות.
5. **Replay-last wired** — לממש ב-voice-session: לשמור reference ל-last audio played.
6. **Pause/Resume speaking** — הוסף `paused` state ל-deriveMicState + voice-session.
7. **WebSocket reconnect** — exponential backoff ב-onclose, banner "מתחבר מחדש...".

### עדיפות 3 — Polish

8. **Car mode noise source** — ללא noise, iOS עלול לסגור MediaSession. להוסיף gapless loop.
9. **Car mode startup chime + previoustrack handler** — לתקן car-mode.svelte.
10. **History playback** — להוסיף ל-agent-session: history_start/chunk/tool_call/done handlers.
11. **Thought translation** — שורה שנייה בevent `thought_translation`.
12. **delete-btn RTL** — `inset-inline-start` → `inset-inline-end`.
13. **dashboard confirm() dialog** — החלף ב-inline confirmation (כפתור "בטל/אשר" inline).
14. **⏮/⏭ navigation** — implement playback history.

---

*דוח זה מבוסס על קריאה של הקוד בפועל — לא הרצה. חלק מהbאגים עלולים להיות מתוקנים בslices עתידיים (8+).*

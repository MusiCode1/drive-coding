# Slice 9 — Frontend Refactor brief

> **מטרה:** ריפקטור מלא של ה-frontend לעיצוב הסופי + חיבור לכל הפיצ'רים החדשים
> שב-backend (Tier 1 voice pipeline + Slice 8a session history). הפיכת ה-vnext
> מ-scaffold ל-product מלא.
>
> **סוג:** Frontend בעיקר (SvelteKit + Svelte 5 runes). חלק קטן של schema
> imports מ-core. backend לא נוגע.
> **TDD חובה** ללוגיקה. CSS pure — בדיקה ויזואלית ב-browser.
> **Sub-agent:** Sonnet 4.6 **חובה** — לא Opus. Slice זה implementation לפי
> spec ברור, אין צורך ב-Opus. Opus יעלה ~10x ולא יוסיף ערך. אם
> ה-launcher של הסוכן הוא Opus — **סגור ופתח מחדש עם Sonnet.**
> **זמן הערכה:** 10-14 שעות עבודה.
>
> **בסיס המוצא:**
> - commit `f4a1d9b` (Slice 8a complete) ב-vnext
> - `final.html` mockup ב-`/tmp/drive-coding-mockups/final.html` (זמין גם דרך
>   `https://your-app-mockups.nue.tuns.sh/final.html`) — מקור אמת
>   לעיצוב
> - 56 frontend tests עוברים
>
> **מקורות נוספים:**
> - `docs/frontend-spec.md` (Slice 7 — תקף לרוב, צריך עדכון נקודתי)
> - `docs/slice-8a-session-history-research.md`
> - `docs/slice-8a-session-history-brief.md`
> - `docs/tier-1-voice-pipeline-brief.md`
> - v1 reference: `/home/user/projects/voice-acp/frontend/index.html`

---

## 1. Scope — מה כלול

### חדש (להחליף את הקיים)

| # | מה | Reference |
|---|------|-----------|
| 1 | Layout: mobile (CarPlay-style — header צף + bottom sheet) + desktop (sidebar) | final.html |
| 2 | Per-kind bubbles: thought / tool / message + user — כל אחת עם sub-segments | final.html |
| 3 | Bubble grouping: סדר כרונולוגי, רצף מאותו kind = אותו bubble | PROMPT-11/12 |
| 4 | Avatar badges (brain/wrench/sparkles/user-round) — outside-left, `bottom: -19px` | final.html |
| 5 | Thought translation: original (LTR, dim) + translation (RTL, italic) באותו גודל | final.html |
| 6 | Mic cluster: prev (⏮) + main + next (⏭) בspeaking · replay (⟲) ב-idle | final.html |
| 7 | Bubble click-to-play: לוגו קטן בפינה (idle) + border מודגש בexecution | final.html |
| 8 | Lucide icons בכל מקום (לא emojis) | final.html |
| 9 | Scrollbar דק (4px) | final.html |

### חדש (הוספה)

| # | מה | Backend ready? |
|---|------|----------------|
| 10 | Floating header (mobile): שם agent + session title ממורכזים, ⚙ + 📚 בצדדים | ✅ |
| 11 | Bottom sheet (mobile): agents + dashboard link + ⚙ + 📚 + 🚗 toggle | ✅ |
| 12 | Sidebar (desktop): agents list + ⚙ + 📚 + 🚗 + collapse toggle | ✅ |
| 13 | `/sessions` route — דשבורד של projects + sessions | ✅ Slice 8a |
| 14 | `/session/[cwdHash]/[sessionId]` route — load + redirect ל-`/agent/[new]` | ✅ Slice 8a |
| 15 | File picker modal — backend folder browser (`/api/fs/browse`) | ✅ Slice 8a |
| 16 | Recording replay: click על user bubble → fetch `/api/recordings/:id` → play | ✅ Slice 8a |
| 17 | History bubbles: cold state אחרי loadSession | ✅ Slice 8a |
| 18 | Tool narration: ה-narration text מופיע ב-tool bubble + audio_chunk נשמע | ✅ Tier 1 |
| 19 | Thought translation: original + translation מוצגים יחד | ✅ Tier 1 |
| 20 | Audio per kind: kind מועבר ב-audio_chunk; player יכול לדעת מה מתנגן | ✅ Tier 1 |
| 21 | Settings page (basic): voice picker + thought voice + audio cues toggle | ⚠️ partial — voice picker דורש endpoint `/api/voices` (לא קיים) |

### מה לא כלול

- Car mode redesign — נדון בנפרד
- Wake word — future-features
- MCP server מובנה (model controls UI) — future-features
- Streaming TTS אמיתי (MediaSource) — future-features (#12)
- Per-message replay button — בוטל לטובת bubble click-to-play

---

## 2. החלטות מאושרות (סיכום)

| Mock element | החלטה |
|--------------|--------|
| Mobile pattern | CarPlay (header צף + sheet) |
| Desktop pattern | Sidebar + chat |
| Header ב-mobile | טקסט ממורכז, ללא רקע, ⚙ + 📚 בצדדים עם backdrop-blur |
| Avatar position | `bottom: -19px; left/right: -36px` (outside, no overlap) |
| Avatar icons | brain (thought), wrench (tool), sparkles (message), user-round (user) |
| Bubble grouping | per-kind, כרונולוגי, רצף = אותו bubble |
| Thought display | original (LTR, opacity 0.5) + translation (RTL, italic) באותו גודל |
| Click-to-play | לוגו קטן בפינה (idle) + border מודגש (executing) + מעבר בין bubbles עוצר את הקיים |
| Cluster כפתורים | speaking: prev/main/next · idle (אחרי TTS): replay/main |
| File picker | backend folder browser modal |
| URL ל-session ישן | persistent: `/session/[cwdHash]/[sessionId]?cli=opencode` |
| Session dedup | redirect ל-agent קיים אם כבר טעון |
| Recording playback | user bubble click → fetch `/api/recordings/:id` → play (רק לbubbles חיים) |
| History bubbles | cold state (אין auto-play בטעינת session) |

---

## 3. Routes הסופיים

```
/                              dashboard — agents חיים (cards גדולים)
/agent/[id]                    focus mode — chat + mic
/sessions                      history browser — projects + sessions  
/sessions/[cwdHash]            sessions של פרויקט ספציפי
/session/[cwdHash]/[id]        load handler — redirect ל-/agent/[newId]
/settings                      voice picker + audio cues + language (basic)
?car=1                         car mode (URL param, לא route נפרד)
```

---

## 4. Components inventory

### Stores חדשים / מורחבים (`src/lib/stores/`)

```
agent-session.svelte.ts         # קיים — להרחיב עם:
                                #   - messageId tracking
                                #   - bubble grouping logic (per-kind)
                                #   - history events (history_*, audio_recording_saved)
                                #   - tool_call_update (narration)

voice-session.svelte.ts         # קיים — להרחיב עם:
                                #   - playlist navigation (prev/next by segmentId)
                                #   - audio kind awareness
                                #   - replay-last (start from last user message)

mic-state.svelte.ts             # קיים — להרחיב עם:
                                #   - cluster button visibility logic
                                #   - cancel propagation

player.svelte.ts                # קיים — להרחיב עם:
                                #   - segmentId-keyed audio cache (Map<segId, blob>)
                                #   - playlist nav (jumpToSegment, prev, next)
                                #   - bubble currently-playing tracking

projects-store.svelte.ts        # NEW — מנהל /api/projects + /api/sessions
                                #   - load, cache (memory), refresh

fs-browser-store.svelte.ts      # NEW — UI state של file picker
                                #   - currentPath, entries, history (back nav)

settings-store.svelte.ts        # NEW — voice picker + audio cues + language
                                #   - persisted ל-localStorage
```

### Components חדשים (`src/lib/components/`)

```
BubbleKind.svelte               # NEW — wrapper לbubble per-kind (thought/tool/message)
SubSegment.svelte               # NEW — segment בודד בתוך bubble
BubbleAvatar.svelte             # NEW — avatar badge (brain/wrench/sparkles/user-round)
BottomSheet.svelte              # NEW — mobile sheet עם agents + ניווט
Sidebar.svelte                  # NEW — desktop sidebar
FloatingHeader.svelte           # NEW — mobile header צף
MicCluster.svelte               # NEW — cluster של 3 כפתורים (prev/main/next + replay)
FilePicker.svelte               # NEW — modal של backend folder browser
SessionCard.svelte              # NEW — bubble קטן של session ב-/sessions
ProjectCard.svelte              # NEW — bubble של project ב-/sessions
Icon.svelte                     # NEW — wrapper ל-Lucide icons (lazy load)
```

### Routes (`src/routes/`)

```
+layout.svelte                  # קיים — להוסיף Lucide loader + scrollbar styles
+page.svelte                    # קיים — dashboard, רענון לעיצוב החדש
agent/[id]/+page.svelte         # קיים — refactor מלא עם BubbleKind, MicCluster, etc.
sessions/+page.svelte           # NEW — list of projects + sessions
sessions/[cwdHash]/+page.svelte # NEW — sessions של פרויקט ספציפי
session/[cwdHash]/[id]/+page.svelte  # NEW — load handler (server-side fetch + redirect)
settings/+page.svelte           # קיים placeholder — refactor למלא
```

---

## 5. Phases (TDD)

### Phase 1 — Foundation (CSS tokens, layout shell, Lucide)

**מטרה:** הקמת תשתית — design tokens, scrollbar, Lucide setup, responsive shell.

**משימות:**
- `+layout.svelte`: טען Lucide מ-CDN, קרא `lucide.createIcons()` ב-onMount.
- `app.css` (חדש או הרחבה): tokens מ-`shared.css` של ה-mockup (colors, spacing).
- responsive helpers: `is-mobile` / `is-desktop` derived מ-`matchMedia`.
- scrollbar styles גלובליים (כמו ה-mockup).

**Tests:** ידני ב-browser (CSS pure). וודא ש-Lucide נטען ו-icons מוצגים.

**Commit:** `feat(frontend): Phase 1 — foundation (tokens, Lucide, scrollbar)`

### Phase 2 — Bubble components + grouping logic

**מטרה:** ה-bubbles החדשים — per-kind + avatars + sub-segments + thought translation.

**TDD scope:** bubble grouping logic ב-store.

**משימות:**
- `BubbleKind.svelte` — props: `kind: "thought"|"tool"|"message"|"user"`, slot ל-children.
- `SubSegment.svelte` — props: `kind`, `text?`, `originalText?`, `translatedText?`.
- `BubbleAvatar.svelte` — props: `kind`. רינדור lucide icon מתאים.
- `agent-session.svelte.ts`:
  - state חדש: `bubbles: Array<{ kind, messageId, segments: Array<{ segmentId?, text, originalText?, translatedText? }> }>`
  - logic: כשמגיע text_chunk חדש — חפש bubble אחרון. אם same kind && same messageId → push segment. אחרת → bubble חדש.
  - 8-10 tests: chronological order, kind transitions, messageId boundaries, thought original+translation pairing.
- `routes/agent/[id]/+page.svelte` — render `bubbles` עם `BubbleKind` + `SubSegment` + `BubbleAvatar`.

**Commit:** `feat(frontend): Phase 2 — bubble components + grouping — X tests`

### Phase 3 — Floating header + Bottom sheet (mobile)

**מטרה:** layout mobile — header צף ו-bottom sheet עם switcher + ניווט.

**משימות:**
- `FloatingHeader.svelte` — agent name + session title ממורכז, ⚙ + 📚 בצדדים עם backdrop-blur.
- `BottomSheet.svelte` — grip + summary + content. drag-to-open (אופציונלי — אפשר tap על ה-grip).
- Sheet content: `סוכנים פעילים`, `ניווט` (דשבורד, סוכן חדש), `הגדרות` (⚙, 📚, 🚗 toggle).
- מבנה: positions sticky, transform-based open/close, swipe גסטור (`use:swipe`?).

**Tests:** sheet open/close state (boolean store), agents list rendering (mock store).

**Commit:** `feat(frontend): Phase 3 — mobile header + bottom sheet`

### Phase 4 — Sidebar (desktop)

**מטרה:** layout desktop — sidebar קבוע + header קלאסי + main area.

**משימות:**
- `Sidebar.svelte` — agents list (status dots) + footer (⚙, 📚, 🚗, collapse).
- responsive switch: media query `(min-width: 1024px)` → Sidebar במקום BottomSheet.
- collapse logic — store state, animation slide-out.

**Tests:** responsive resolution detection.

**Commit:** `feat(frontend): Phase 4 — desktop sidebar`

### Phase 5 — Tier 1 WS integration (text_chunk, audio_chunk, tool_call_update, tool narration)

**מטרה:** טיפול ב-WS events של Tier 1.

**TDD scope:** event handling ב-stores.

**משימות:**
- `agent-session.svelte.ts`:
  - text_chunk עם messageId → bubble grouping (כפי שב-Phase 2).
  - tool_call עם narration → BubbleKind tool עם sub-segment text הוא ה-title, narration כ-additional sub-segment.
  - tool_call_update עם narration → update existing tool bubble (lookup by toolCallId).
- `voice-session.svelte.ts`:
  - audio_chunk עם segmentId/kind → store ב-`Map<segmentId, { kind, blob, originalText, translatedText }>`.
  - player יכול לשאוב מהcache לreplay.

**Tests:** WS event handlers (5-8 tests).

**Commit:** `feat(frontend): Phase 5 — Tier 1 WS integration — X tests`

### Phase 6 — Slice 8a WS integration (history events, audio_recording_saved)

**מטרה:** טיפול ב-history events + recording references.

**משימות:**
- `agent-session.svelte.ts`:
  - `history_start` → clear bubbles, set `isLoadingHistory = true`.
  - `history_chunk` → push to bubbles (כמו text_chunk רגיל, אבל marked `historical: true`).
  - `history_tool_call` → push tool bubble (historical).
  - `history_done` → `isLoadingHistory = false`.
  - `audio_recording_saved` → store `recordings: Map<userMessageId, recordingId>` (associate עם last user message).

**Tests:** history flow (5-6 tests).

**Commit:** `feat(frontend): Phase 6 — Slice 8a WS integration — X tests`

### Phase 7 — Mic cluster + state machine + playlist nav

**מטרה:** ה-mic UI הסופי — cluster של 3 כפתורים + playlist navigation.

**TDD scope:** state machine + playlist logic.

**משימות:**
- `MicCluster.svelte`:
  - state derived: `cluster = { left, main, right }`
  - idle (no prior tts): `{ left: null, main: 🎙, right: null }`
  - idle (after tts): `{ left: ⟲, main: 🎙, right: null }`
  - recording: `{ left: null, main: ⏺ red, right: null }`
  - speaking: `{ left: ⏮, main: 🔊 green, right: ⏭ }`
  - cancelling: `{ left: null, main: ✕ orange, right: null }`
- `player.svelte.ts`:
  - `jumpToSegment(segmentId)` — pause current, start from segmentId.
  - `prev()` / `next()` — by playlist order.
  - `replayLast()` — go back to last user message + start playing all messages from there.

**Tests:** state machine transitions (6-8 tests), playlist logic (5 tests).

**Commit:** `feat(frontend): Phase 7 — mic cluster + playlist nav — X tests`

### Phase 8 — Bubble click-to-play

**מטרה:** קליק על bubble = השמעה מהsegment הראשון בו.

**TDD scope:** logic ב-store + player.

**משימות:**
- `BubbleKind.svelte` — `onClick` handler מפעיל `player.jumpToBubble(messageId)`.
- `player.jumpToBubble(messageId)`:
  - find first segmentId of bubble.
  - call jumpToSegment.
- `BubbleKind.svelte` — visual feedback:
  - לוגו `play` קטן בפינה (opacity 0.3, ימין-עליון) — idle indicator.
  - בexecution: border מודגש (color = current kind color, blur 4px).
  - hover: subtle background.
- מעבר בין bubbles עוצר את הקיים ומתחיל מהחדש.
- User bubble click → fetch `/api/recordings/:recordingId` → play (אם יש).

**Tests:** click handlers + visual state derived (4-5 tests).

**Commit:** `feat(frontend): Phase 8 — bubble click-to-play — X tests`

### Phase 9 — /sessions route (history browser)

**מטרה:** דף לעיון ב-sessions ישנים.

**משימות:**
- `routes/sessions/+page.svelte` — tabs:
  - "כל הסשנים" — איחוד `/api/sessions`
  - "לפי פרויקט" — `/api/projects` → click → `/sessions/[cwdHash]`
- `routes/sessions/[cwdHash]/+page.svelte` — `/api/projects/:cwdHash/sessions`
- `SessionCard.svelte` — title, updatedAt, cli kind, cwd snippet.
- `ProjectCard.svelte` — cwd, lastSeen, CLI count.
- Click על SessionCard → navigate ל-`/session/[cwdHash]/[sessionId]?cli=opencode`.
- Sorting (updatedAt DESC, limit 50), loading states, empty states.
- `projects-store.svelte.ts`: load, memory cache, refresh on focus.

**Tests:** store logic — fetch, cache, sort (4-5 tests).

**Commit:** `feat(frontend): Phase 9 — /sessions route — X tests`

### Phase 10 — /session/[cwdHash]/[id] route (load handler)

**מטרה:** route שטוען session ישן ומפנה ל-agent.

**משימות:**
- `routes/session/[cwdHash]/[id]/+page.svelte`:
  - on mount: POST `/api/agents` עם `{ cwd, kind, existingSessionId }` (cwd נשלף מ-cwdHash → lookup in projects-store, kind ב-query param).
  - response: { agentId } → `goto("/agent/" + agentId)`.
  - אם dedup (backend מחזיר agentId קיים) → אותו flow.
  - loading state, error state.

**Tests:** server-side load function (3-4 tests).

**Commit:** `feat(frontend): Phase 10 — session load route — X tests`

### Phase 11 — File picker modal

**מטרה:** modal שמדפדף ב-backend filesystem ובוחר cwd.

**משימות:**
- `FilePicker.svelte` — modal עם:
  - header: current path
  - list: entries (folders only, isDir=true)
  - back button (parent path)
  - select button (current path)
- `fs-browser-store.svelte.ts`: currentPath, entries, fetch state, history stack.
- שילוב ב-dashboard: כפתור "סוכן חדש" → FilePicker → onSelect → CLI dropdown → create.

**Tests:** store logic — navigation, history (3-4 tests).

**Commit:** `feat(frontend): Phase 11 — file picker modal — X tests`

### Phase 12 — Settings page (basic)

**מטרה:** עמוד הגדרות מינימלי עם voice + audio cues + language.

**משימות:**
- `routes/settings/+page.svelte` (replace placeholder):
  - voice picker — dropdown של voices (קוד מקושה לעת עתה, ערכים קבועים: Rachel/Sarah/Adam/etc. אם אין endpoint).
  - thought voice — אופציה (אותו רשימה + "אותו voice").
  - audio cues toggle — checkboxes לכל cue (recording_start, thinking, וכו').
  - language — dropdown (`he` בלבד MVP).
- `settings-store.svelte.ts`: persisted ב-localStorage, broadcast ל-stores אחרים.
- voice-session/voice-pipeline משתמש ב-settings.

**Tests:** store logic (3-4 tests).

**Commit:** `feat(frontend): Phase 12 — settings page — X tests`

---

## 6. WS Protocol — Frontend handlers needed

```typescript
// Tier 1 events:
text_chunk { kind: "message"|"thought", text: string, messageId?: string }
audio_chunk { mp3Base64, segmentId, messageId, kind: "message"|"thought"|"narration", originalText, translatedText }
tool_call { toolCallId, title, narration?, ... }
tool_call_update { toolCallId, narration }

// Slice 8a events:
history_start { agentId, sessionId }
history_chunk { kind, text, messageId }
history_tool_call { toolCallId, title, ... }
history_done
audio_recording_saved { recordingId, mimeType, durationMs? }

// Existing (unchanged):
thinking, done, error, ping/pong
```

---

## 7. CSS / styling guidance

**מקור:**
- `/tmp/drive-coding-mockups/shared.css` — tokens, scrollbar, sub-segment styles, mic cluster
- `/tmp/drive-coding-mockups/final.html` — bubble-kind, floating-header, bottom-handle, desktop-with-sidebar, etc.

**עקרונות:**
- Lucide icons via CDN (`https://unpkg.com/lucide@latest`)
- `lucide.createIcons()` נקרא אחרי כל DOM mutation גדול (או בקובץ `+layout.svelte` עם reactive trigger)
- RLM (U+200F) **לא נדרש ב-frontend** — זה רק לCLI rendering. ה-DOM תופס direction נכון.
- Scrollbar — `scrollbar-width: thin` + custom webkit pseudo-elements (כמו ב-mockup).
- ‏Mobile-first: ‎CSS classes ל-`@media (max-width: 1023px)` (mobile, default) ו-`@media (min-width: 1024px)` (desktop).

---

## 8. DoD Checklist

- [ ] כל 12 ה-Phases הושלמו עם commits מסודרים
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] ~40-60 frontend tests חדשים (סה"כ ~100+ frontend)
- [ ] Mobile + desktop responsive עובדים — בדוק ידנית ב-browser/devtools
- [ ] ‏Tier 1 features גלויים: tool narration, thought translation, bubble click-to-play
- [ ] Slice 8a features גלויים: /sessions, history bubbles (cold), recording replay
- [ ] File picker פותח ובוחר תיקייה ב-/home/user
- [ ] Settings page עם voice picker + audio cues toggle (localStorage)
- [ ] עדכון `docs/walkthrough.md` עם entry מסכם
- [ ] עדכון `docs/behaviors-coverage.md` — UI behaviors שעוברים ל-✅
- [ ] עדכון `docs/frontend-spec.md` — תיעוד ה-UI הסופי

---

## 9. אסור / מותר

**מותר:**
- `packages/frontend/src/**` (כל מה שיש בו)
- `packages/frontend/static/**` (assets)
- `packages/frontend/package.json` (להוסיף dependencies — Lucide אם רוצים npm במקום CDN)
- `docs/walkthrough.md`, `docs/behaviors-coverage.md`, `docs/frontend-spec.md`

**אסור:**
- `packages/backend/src/**` — backend complete, אל תיגע
- `packages/core/src/**` — אלא אם schema צריך תיקון קטן (אז שאל קודם)
- `docs/reviews/**`, `docs/archive/**`

---

## 10. סקילים חובה

- `tdd` — red-green-refactor loop (ל-stores ו-logic)
- `dev-conventions` — Svelte 5 runes, ESM, אסור any, פונקציונלי
- `Svelte-MCP` — לחיפוש docs של Svelte 5 (`$state`, `$derived`, `$effect`, snippets)
- `rtl-adaptation` — לוודא RTL נכון (logical properties)
- `commit` — מבנה commit messages (עברית, פר-Phase)
- `update-walkthrough` — entry בסוף

**אוטונומיה גורפת:** אבי אישר את התוכנית. אל תבקש רשות לcommit. בסוף כל
Phase ירוק → typecheck/lint/test → commit אוטומטי. אם נתקל בהחלטה
ארכיטקטונית שלא מכוסה ב-brief — עצור ושאל.

---

## 11. Prompt לסוכן

**חובה Sonnet 4.6** — אל תריץ עם Opus. Slice זה implementation לפי spec
ברור, אין צורך בOpus היקר.

```
אתה סוכן ריפקטור frontend של drive-coding.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- mockup חי: https://your-app-mockups.nue.tuns.sh/final.html
  (קבצים מקומיים: /tmp/drive-coding-mockups/final.html + shared.css)
- v1 reference: /home/user/projects/voice-acp/frontend/index.html

מקור אמת: docs/slice-9-frontend-refactor-brief.md (12 Phases).
מסמכים נלווים:
- docs/frontend-spec.md (Slice 7 — תקף לרוב)
- docs/slice-8a-session-history-research.md (URL design)
- docs/tier-1-voice-pipeline-brief.md (WS protocol)
- docs/behaviors-coverage.md (status of UI-MIC, UI-BUBBLES, UI-AUDIO, UI-CAR)

עבודה:
1. טען את הסקילים: tdd, dev-conventions, Svelte-MCP, rtl-adaptation,
   commit, update-walkthrough.
2. קרא את ה-brief מקצה לקצה.
3. קרא mockup: /tmp/drive-coding-mockups/final.html ו-shared.css.
4. קרא frontend הקיים:
   - packages/frontend/src/routes/+layout.svelte
   - packages/frontend/src/routes/+page.svelte
   - packages/frontend/src/routes/agent/[id]/+page.svelte
   - packages/frontend/src/lib/stores/agent-session.svelte.ts
   - packages/frontend/src/lib/stores/voice-session.svelte.ts
   - packages/frontend/src/lib/stores/mic-state.svelte.ts
   - packages/frontend/src/lib/stores/player.svelte.ts
   - packages/frontend/src/lib/stores/car-mode.svelte.ts
5. קרא v1 reference (index.html) — בעיקר CSS ו-state machine.
6. בצע לפי Phase 1→12 בסדר. TDD חובה ל-logic; CSS pure בלי tests.
7. commit פר Phase. פורמט עברי.
8. בסוף — עדכן docs/walkthrough.md ו-docs/behaviors-coverage.md.

pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך: packages/backend/src/**, packages/core/src/** (חוץ מ-schema fix
אם הכרחי — שאל קודם), docs/reviews/**, docs/archive/**.

ה-backend רץ ברקע ב-tmux `be` על port 4000. ה-frontend ב-tmux `fe` על
port 5173. tunnel חי על your-app.nue.tuns.sh.

אם צריך לבדוק integration חי — בדוק עם linux-gui browser
(/home/test/Documents/scripts/pw-clean.sh) או עם curl ל-localhost.

אוטונומיה גורפת — בסוף כל Phase ירוק → commit אוטומטי. רק החלטה
ארכיטקטונית לא מכוסה ב-brief → עצור ושאל.
```

---

## 12. סיכום צפוי

- 12 Phases, ~12-14 commits
- ~50-70 frontend tests חדשים (סה"כ ~110-130 frontend)
- ~1500-2500 שורות impl חדשות / refactored
- 11 components חדשים
- 4 routes חדשים
- 5 stores חדשים / מורחבים
- כל ה-WS events של Tier 1 + Slice 8a מחוברים ל-UI
- UI סופי תואם את ה-mockup הסופי
- UI-MIC-*, UI-BUBBLES-*, UI-AUDIO-*, UI-HIST-* behaviors משוחזרים מ-v1

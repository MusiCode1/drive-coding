# Slice 9 — Follow-up Fixes brief

> **מטרה:** תיקון הbugs שזוהו אחרי שSlice 9 (Frontend Refactor) הושלם.
> ה-pipeline מ-end-to-end עובד (STT → ACP → TTS → recording save), אבל יש
> bugs ויזואליים חמורים שמונעים שימוש בפועל.
>
> **סוג:** Frontend בעיקר. כלולים גם 2-3 backend fixes.
> **TDD:** חובה ל-logic. CSS pure ויזואלי.
> **Sub-agent:** Sonnet 4.6 **חובה** — לא Opus.
> **זמן הערכה:** 5-8 שעות עבודה (23 fixes).
>
> **‏⭐ מקור אמת מוביל: `docs/slice-9-bugs-investigation.md`**
> דוח חקירה שבוצע על-ידי Opus 4.7 sub-agent. מכיל עבור כל bug:
> - **Reproduction steps** מדויקים
> - **Root cause** + file:line (איפה לתקן)
> - **Fix proposal** קונקרטי
> - **Evidence** (screenshots ב-`/tmp/investigation/`)
>
> ה-file הזה (`slice-9-followup-fixes.md`) משלים את הדוח עם context רחב יותר.
> **קרא את הדוח קודם, ואז את הקובץ הזה.**
>
> **בסיס המוצא:**
> - commit `935ab61` (אחרי Slice 9 + investigation brief)
> - frontend חי על `https://your-app.nue.tuns.sh`
> - backend חי על port 4000
> - test-voice.mp3 ב-`/tmp/test-voice.mp3` (גם ב-linux-gui:/tmp/)
>
> **סיכום מ-הדוח:** 19 bugs מאומתים (8 critical, 7 medium, 4 minor) +
> 7 חדשים שגילה הסוכן (N1-N7). הbugs הקריטיים ביותר:
> - **B1** — bubble grouping (root cause: appendBubbleChunk יוצר segment חדש)
> - **B4** — textbox לזרוק
> - **N5** — Icon.svelte/Lucide CDN מערבב DOM (ארכיטקטוני)
> - **B10** — thought translation: 2 bugs (agent-session + voice-session bridge)
> - **N4** — projects-registry ריק → sessions UI ריק

---

## 1. Bugs שכבר תוקנו (commits ידניים, לא צריך לחזור)

| # | קובץ | תיקון |
|---|------|--------|
| F1 | `MicCluster.svelte` | `$derived(fn)` → `$derived.by(() => ...)` + טקסט במקום `()` |
| F2 | `+page.svelte` (dashboard) | `kind` → `cliKind` |
| F3 | `session/[cwdHash]/[id]/+page.svelte` | `kind` → `cliKind` |
| F4 | `voice-session.test.ts` | mock helper — הוספת `bubbles`, `isLoadingHistory`, `clearBubbles`, `getRecordingId` |
| F5 | `core/schemas/agent.ts` | `CreateAgentInput` — הוספת `existingSessionId?` |
| F6 | `agent-orchestrator.ts` + `server.ts` | wiring של `recordingsStore` ל-`createAgentSession` |

‏**סטטוס:** 0 TS errors. 454 backend + 114 frontend tests עוברים. עדיין לא commit-ed לbranch — אצטרך commit לפני שתסוכן יתחיל.

---

## 2. Bugs קריטיים שצריך לתקן (חזותיים — מונעים שימוש)

### 🔴 B1 — Bubble grouping שבור: כל chunk = bubble נפרדת

‏**מה רואים:** כל מילה במשפט של ה-assistant הופכת ל-bubble נפרדת אנכית. במקום bubble אחת עם "שלום, אני שומע אותך. המערכת עובדת תקין", רואים עמודה אנכית של "ש" / "ל" / "ום" / "," / "אני" / "ש" / "ומע" / "אות" / "ך" / "."

‏**צפוי:** כל סגמנט של אותה הודעה (per messageId) ב-bubble אחת. רצף text_chunks אמור להצטרף ל-string רציף בתוך אותה sub-segment.

‏**איפה לחפש:** `packages/frontend/src/lib/stores/agent-session.svelte.ts` — bubble grouping logic. כשמגיע text_chunk חדש:
- ‏אם same kind && same messageId → append to **last segment** of existing bubble
- ‏אם same kind && different messageId → new bubble
- ‏אם different kind → new bubble

‏**הbug הנראה:** כל text_chunk יוצר sub-segment חדש במקום append. או — bubble חדש שלם.

‏**Reference:** mockup `final.html` — bubble.message-group עם sub-segments per sentence (לא per word/chunk).

‏**TDD test:**
```typescript
// 3 chunks ל-message יחיד (same messageId, kind=message):
// "שלום, " → "אני שומע " → "אותך."
// expected: 1 bubble, 1 sub-segment עם הטקסט המלא "שלום, אני שומע אותך."
```

### 🔴 B2 — שני אייקוני mic על הכפתור הראשי

‏**מה רואים:** הכפתור הראשי במצב idle מציג 2 אייקוני mic זה ליד זה. אמור להיות 1.

‏**איפה:** `packages/frontend/src/lib/components/MicCluster.svelte` שורות ~112-120. ייתכן ש-`Icon` רנדר את ה-Lucide פעמיים, או שיש כפילות ב-template.

‏**Reference:** `final.html` — `<i data-lucide="mic"></i>` יחיד.

‏**Fix:** קרא את MicCluster.svelte, וודא ש-`{#if micState === "idle"}` מרנדר אייקון אחד בלבד.

### 🔴 B3 — אין avatars בbubbles

‏**מה רואים:** ה-bubbles נטולי avatar. רק טקסט.

‏**צפוי לפי mockup:**
- ‏User bubble → avatar בצד ימין-תחתון עם `user-round` icon
- ‏Thought bubble → avatar בצד שמאל-תחתון עם `brain` icon
- ‏Tool bubble → avatar בצד שמאל-תחתון עם `wrench` icon
- ‏Message bubble → avatar בצד שמאל-תחתון עם `sparkles` icon
- ‏מיקום: `bottom: -19px`, גודל 28px, ללא חפיפה עם ה-bubble (כמו speech tail בקומיקס)

‏**איפה:**
- ‏`packages/frontend/src/lib/components/BubbleAvatar.svelte` — בדוק שקיים ושמרונדר icon
- ‏`packages/frontend/src/lib/components/BubbleKind.svelte` — בדוק שהוא משלב BubbleAvatar
- ‏ב-template של `agent/[id]/+page.svelte` — בדוק שהuser bubbles מקבלים avatar (לא רק assistant)

‏**Reference CSS:** `/tmp/drive-coding-mockups/final.html` בלוקי `.bubble-kind-avatar` ו-`.bubble-user-avatar`. גם `shared.css` ב-`/tmp/drive-coding-mockups/`.

### 🔴 B4 — textbox + שלח כפתור עדיין שם

‏**מה רואים:** למטה ב-page יש input "הקלד הודעה..." + כפתור "שלח".

‏**אבי אמר במפורש:** "אני בכלל לא רוצה מקלדת ותיבת טקסט בממשק." (משימה ב-Slice 9 §1, נקבע כ-out-of-scope).

‏**איפה:** `packages/frontend/src/routes/agent/[id]/+page.svelte` — חפש `<textarea>` או `<input type="text">` עם placeholder "הקלד הודעה" + button "שלח". הסר את ה-block המלא.

### 🔴 B5 — Header layout לא לפי mockup

‏**מה רואים:**
- ‏Header עליון: ימין `📚` (היסטוריה), שמאל `⚙` (הגדרות), במרכז "opencode" + "voice-acp-v2"
- ‏אבל הסדר נראה הפוך — `📚` בצד שמאל פיזי, `⚙` בצד ימני פיזי. ב-RTL זה אומר ש-📚 אמור להיות "start" (ימין) ו-⚙ "end" (שמאל).

‏**Reference mockup:**
- ‏⚙ בצד ימין (התחלה ב-RTL)
- ‏📚 בצד שמאל (סוף ב-RTL)
- ‏במרכז: agent name (גדול) + session title (קטן)

‏**Fix:** ב-`FloatingHeader.svelte` — וודא flex order נכון. השתמש ב-`justify-content: space-between` + absolute positioning ל-titles באמצע (לפי הmockup הסופי שלי).

### 🟡 B6 — Bottom sheet handle מציץ אבל מעט מדי

‏**מה רואים:** רואים פס גריי קטן בתחתית, אבל לא ברור שאפשר לדחוף אותו למעלה.

‏**Fix:** וודא ש-BottomSheet.svelte:
- ‏מציג grip (40×4 px) ב-center של ה-handle
- ‏יש hover state (`background` משתנה ב-hover)
- ‏tap על ה-grip פותח את ה-sheet

### 🟡 B7 — Sparkles avatar בפינה צד שמאל-תחתון של הdashboard

‏**מה רואים:** איקון sparkles קטן בפינה השמאלית-תחתונה של ה-dashboard view. לא במקום.

‏**איפה:** ‏ככל הנראה ב-`+page.svelte` (dashboard) או ב-`+layout.svelte`. אולי הסוכן הכניס avatar שגוי.

‏**Fix:** מצא ומחק. dashboard אמור להיות clean — רק cards של agents.

---

## 3. Bugs קריטיים נוספים — דווחו על-ידי אבי (testing manual)

### 🔴 B12 — אין UI לבחירת sessions קודמים

‏**מה אבי דיווח:** "עדיין אני לא רואה אפשרות לבחור סשנים קודמים."

‏**מה אמור להיות:**
- ‏ב-dashboard: כפתור "📚 היסטוריה" (קיים) → ניווט ל-`/sessions`
- ‏ב-`/sessions`: tabs "כל הסשנים" / "לפי פרויקט" + list של sessions עם title+date+cli kind
- ‏click על session → POST /api/agents עם existingSessionId → redirect ל-/agent/[new]

‏**איפה לחפש:**
- ‏`packages/frontend/src/routes/sessions/+page.svelte` — וודא שקיים ו-renders
- ‏`packages/frontend/src/lib/stores/projects-store.svelte.ts` — בדוק fetch ל-`/api/sessions`
- ‏`packages/frontend/src/lib/components/SessionCard.svelte` — וודא click handler נכון
- ‏API endpoint `/api/sessions` — וודא שמחזיר data (test עם curl)

‏**בדיקה ידנית:**
```bash
curl -s http://localhost:4000/api/sessions | jq '.[0:3]'
```
‏אם API מחזיר sessions אבל UI ריק → bug ב-frontend store/component.
‏אם API ריק → ייתכן שאין sessions ידועים. צור agent עם cwd שיש לו opencode sessions (`/home/user/projects/voice-acp-v2`), שלח prompt, וודא שה-cwd נרשם ב-projects-registry, ואז refresh /sessions.

### 🔴 B13 — TTS בעיות חמורות: 2 מילים בלבד / duplication

‏**מה אבי דיווח:**
- ‏לפעמים: שומעים רק 2 מילים ראשונות מה-message, אז שקט
- ‏לפעמים: כל segment נשמע **פעמיים ברצף**, ואז ה-segment הבא פעמיים ברצף

‏**זה bug התנהגות לא דטרמיניסטית** — שני סימפטומים שונים, תלוי תזמון. כנראה race condition ב-player או ב-pipeline.

‏**איפה לחפש:**
- ‏`packages/frontend/src/lib/stores/voice-session.svelte.ts` — `audio_chunk` handler, `Map<segmentId, blob>`
- ‏`packages/frontend/src/lib/stores/player.svelte.ts` — `enqueue()`, playback logic, segmentId tracking
- ‏ייתכן: כל audio_chunk נכנס ל-queue פעמיים? בדוק שאין double-handler registration (לדוגמה: `setVoiceMessageHandler` נקרא פעמיים, או `onMount` רץ פעמיים בגלל SSR/CSR mismatch)
- ‏ייתכן: ה-player playing במקביל עם MediaSource ועם blob URL parallel
- ‏ייתכן: backend שולח audio_chunk per text_chunk **ולא** per sentence-segment — ראה B14

‏**בדיקה:** הוסף logging זמני ב-`voice-session.svelte.ts` audio_chunk handler:
```typescript
console.log(`[audio_chunk] segmentId=${msg.segmentId}, kind=${msg.kind}, bytes=${msg.mp3Base64.length}`)
```
‏אם רואים אותו segmentId 2 פעמים — duplication ב-handler.
‏אם רואים רק 1 segmentId לתשובה ארוכה — backend לא שולח את השאר.

‏**הצעת fix לaudio duplication:**
‏Map<segmentId, blob> — בדוק אם segmentId כבר ב-Map לפני enqueue. אם כן — דלג (idempotent).

‏**הצעת fix ל-"רק 2 מילים":** קשור ל-B14.

### 🔴 B14 — חיתוך לסגמנטים לפי chunk ולא לפי sentence

‏**מה אבי דיווח:** "כמו שראית, החיתוך לסגמנטים הוא פשוט לפי צ'אנק ולא לפי סגמנט."

‏**הסבר:** ה-backend Tier 1 אמור לעבוד כך:
- ‏ACP שולח `text_chunk` per token/word
- ‏backend מאגר ב-`acpMessageBuffer` (ב-`agent-session.ts`)
- ‏רק כש-`splitIntoSentences` מוצא boundary (./?/!) → flush ל-TTS
- ‏TTS מקבל **משפט שלם**, מחזיר audio של משפט שלם
- ‏ה-frontend מקבל **1 audio_chunk per sentence** (לא per token)

‏**מה כנראה קורה ב-bug:**
- ‏Backend שולח audio_chunk לכל text_chunk (chunk-level)
- ‏או: `splitIntoSentences` לא מוצא boundary בעברית (חוסר תמיכה?) → flush בסוף בלבד
- ‏Frontend מקבל הרבה audio_chunks קצרים שלא ניתן לנגן ברצף

‏**איפה לחפש (backend):**
- ‏`packages/backend/src/app/agent-session.ts` ב-`sendAudioPrompt` — flow של buffer + flushMessage + processQueue
- ‏`packages/core/src/voice/sentence-boundary.ts` — `splitIntoSentences` — האם תומך ב-`. ! ?` עברי? מה הre-pattern?

‏**בדיקה:**
```typescript
// vitest
splitIntoSentences("שלום, אני שומע אותך. המערכת עובדת תקין.")
// expected: { sentences: ["שלום, אני שומע אותך.", "המערכת עובדת תקין."], remaining: "" }
```

‏אם זה לא עובד עם punctuation עברי → bug ב-regex של splitIntoSentences.

‏**הצעת fix:**
‏בדוק את ה-pattern ב-`sentence-boundary.ts`. אם הוא משתמש ב-`[.!?]` רק (English), עברית עם `?` (ש-RTL הופך) אולי נכשל. וודא שעובד עם `. ! ?` ASCII.

‏**הצעת fix אם punctuation נכון אבל buffer לא מאסף:**
‏ב-backend, וודא ש-`acpMessageBuffer += text` עובד נכון, וש-`splitIntoSentences` נקרא **על ה-buffer** ולא על כל chunk בנפרד.

‏**אם חיתוך לסגמנט נכון ב-backend אבל לא ב-frontend:**
‏ראה B1 — ה-frontend bubble grouping. ייתכן שה-frontend יוצר sub-segment per audio_chunk במקום לאחד.

### 🔴 B15 — לחיצה על הודעה לא משמיעה אותה

‏**מה אבי דיווח:** "לחיצה על הודעה לא משמיעה אותה."

‏**מה אמור להיות (לפי mockup + Slice 9 brief §1 #7):**
- ‏click על bubble → `player.jumpToBubble(messageId)` → start playing from first segment
- ‏visual: לוגו play קטן בפינה (idle) + border מודגש (during playback)

‏**איפה:**
- ‏`packages/frontend/src/lib/components/BubbleKind.svelte` — `onclick={() => player.jumpToBubble(messageId)}`
- ‏`packages/frontend/src/lib/stores/player.svelte.ts` — `jumpToBubble()` method

‏**בדיקה:**
- ‏click על user bubble → אמור fetch `/api/recordings/:id` ו-play
- ‏click על message bubble → אמור לנגן את ה-segments מהcache

‏**הצעות חקירה:**
1. ‏האם `jumpToBubble` בכלל נקרא? הוסף `console.log` ב-handler.
2. ‏האם `segments` ב-bubble כוללים `segmentId` תקין? לעיתים rendering מ-history בלי IDs נכונים.
3. ‏האם `audioCache` (Map<segmentId, blob>) מכיל את ה-blob של ה-bubble? אם לא, player אין מה לנגן.
4. ‏האם user bubble מצליח fetch ל-`/api/recordings/:id`? בדוק `recordingId` מועבר נכון.

‏**ראה גם B11** (visual indicator) — שני הbugs קשורים.

### 🔴 B16 — אין חיווי בזמן upload + STT

‏**מה אבי דיווח:** "בזמן שמחכים עד שההקלטה תעלה ותתומלל, אין שום חיווי שמראה מה קורה עכשיו."

‏**מה אמור להיות:** ה-mic state machine מ-`mic-state.svelte.ts`:
- ‏tap → `recording` (כפתור אדום + pulse)
- ‏tap שוב → `processing` (כפתור סגול + rotate animation, status text "מעבד...")
- ‏אחרי STT/ACP → `speaking` (כפתור ירוק)

‏**מה כנראה קורה:** state חוזר ל-idle מיד אחרי upload, או לא עובר ל-processing.

‏**איפה:**
- ‏`packages/frontend/src/lib/stores/voice-session.svelte.ts` — `sendAudioBlob()` — וודא שמעדכן `voiceState` ל-`processing` או `thinking`
- ‏`packages/frontend/src/lib/stores/mic-state.svelte.ts` — state derivations
- ‏`packages/frontend/src/lib/components/MicCluster.svelte` — וודא שמרנדר אנימציה ב-processing state
- ‏`statusLabel` derived — וודא שמחזיר "מעבד..." או "מקליט..." ב-processing/thinking

‏**הצעת fix:**
1. ‏ב-`sendAudioBlob()` (ב-voice-session) או ב-`onFileUpload()` (ב-page) — אחרי שליחת WS message, set `voiceState = "thinking"` מיד.
2. ‏שמירת state עד ל-`text_chunk` ראשון או `audio_chunk` ראשון מ-WS.
3. ‏ב-`MicCluster.svelte` — וודא שיש מקרה `thinking`/`processing` עם:
   - ‏background: var(--processing) #8855ff
   - ‏animation: rotate-slow 2s linear infinite
   - ‏statusLabel: "מעבד..."

---

## 4. Bugs פחות קריטיים

### 🟡 B8 — Choose File button visible (DEV-only — ‏אני חשפתי בטסט)

‏**מה רואים:** כפתור "Choose File" + "No file chosen" מופיע ליד ה-bubbles.

‏**הסבר:** ב-test שלי הפכתי את ה-`#audio-file-input` ל-visible (display:block). ב-prod זה display:none.

‏**Fix:** אם זה עדיין מופיע בלי שהtester ישנה — בדוק ש-`.visually-hidden` או `display:none` חל על input. כנראה זה לא bug אמיתי כי אני שיניתי.

### 🟡 B9 — FilePicker warnings

‏מתוך `/tmp/fe.log`:
```
[vite-plugin-svelte] src/lib/components/FilePicker.svelte:25:37
  This reference only captures the initial value of `initialPath`.
  Did you mean to reference it inside a closure instead?
  https://svelte.dev/e/state_referenced_locally

[vite-plugin-svelte] src/lib/components/FilePicker.svelte:51:2
  Elements with the 'dialog' interactive role must have a tabindex value
  https://svelte.dev/e/a11y_interactive_supports_focus
```

‏**Fix 1:** `let currentPath = $state(initialPath)` במקום `let currentPath = initialPath` — captures initial value reactively.
‏**Fix 2:** הוסף `tabindex="-1"` ל-`<div role="dialog">`.

### 🟡 B10 — Thought translation לא נראה

‏**מה רואים ב-bubbles:** רק הטקסט המקורי באנגלית של ה-thought ("The user is testing the system..."). אין תרגום עברי.

‏**צפוי:** לפי mockup — כל sub-segment של thought מציג original (LTR, אפור, opacity 0.5) **וגם** translation (RTL, עברית). ב-backend (Tier 1) זה מועבר ב-audio_chunk עם `originalText` + `translatedText`.

‏**איפה:** `packages/frontend/src/lib/components/SubSegment.svelte` — וודא שmrenders שניהם אם kind=thought.

‏**Reference:** `final.html` opt 9 — אופציה 9 (selected) של icon-placements.

### 🟡 B11 — אין click-to-play visual indicator

‏**מה רואים:** ה-bubbles הם button (לפי snapshot), אבל אין אינדיקציה ויזואלית שאפשר לקליק עליהם.

‏**צפוי:** לוגו "play" קטן בפינה (opacity 0.3) כשbubble idle. border מודגש כשbubble currently playing.

‏**איפה:** `BubbleKind.svelte`.

‏**Reference:** Slice 9 brief §1 #7 + שיחת ה-mockups לאחור.

### 🟡 B12 — תמלול מוזר

‏**מה רואים:** ה-Gemini STT החזיר "שלום, אני בודקת את המערכת. האם אתה שומע אותי?" — אבל ה-test-voice.mp3 הוא של ה-prompt הזה? אצטרך לבדוק. אם הקבוע נכון, מצוין. אם לא — Gemini הזה (אבל test-voice.mp3 הוא 56KB עברית, סביר שזה נכון).

---

## 4. Bugs פוטנציאליים שלא בדקתי

### Q1 — Sessions page (`/sessions`)
‏לא נבדק שעובד. ייתכן שיש bugs בטעינה (`projects-store`, `fs-browser-store`).

### Q2 — Sessions load route (`/session/[cwdHash]/[id]`)
‏לא נבדק שעובד. ה-flow: bookmark URL → page mount → fetch projects → find cwd → POST agent עם existingSessionId → redirect ל-/agent/[new].

### Q3 — File picker modal
‏לא נבדק שפותח ועובד מ-dashboard. ה-component אולי לא wired מ-"+ סוכן חדש" כראוי.

### Q4 — Settings page
‏לא נבדק. voice picker, audio cues toggle.

### Q5 — Recording playback
‏לא נבדק. כשclick על user bubble אמור fetch `/api/recordings/:id` ו-play.

### Q6 — History bubbles
‏לא נבדק. כשטוענים session ישן, history events אמורים להציג bubbles cold (לא להפעיל TTS אוטומטית).

### Q7 — Mobile vs Desktop responsive
‏ה-screenshot נראה כמו desktop layout (sidebar בצד שמאל). מובייל לא נבדק.

### Q8 — Audio playback של ה-tts
‏הbrowser זיהה audio_chunks אבל לא בדקתי שבמכשיר אמיתי שומעים אותם בקול.

---

## 5. עבודה שצריך לעשות

‏**סדר ה-Phases משוקלל לפי המלצות הסוכן Opus** ב-`docs/slice-9-bugs-investigation.md §5`.
‏כל bug — קרא את הקטע המלא בדוח החקירה לפני התיקון (יש root cause + fix proposal).

### Phase 1 — Critical visual bugs (UI בסיסי לא קריא)

1. ‏**B1** — Bubble grouping: ב-`appendBubbleChunk` (`agent-session.svelte.ts:161-178`)
   append ל-last streaming segment במקום ליצור חדש. ~10-15 שורות.
2. ‏**B4** — הסרת textbox+שלח: מחיקת block `.text-form` ב-`+page.svelte:468-490`.
3. ‏**N5** — Icon rendering: Lucide CDN createIcons() מערבב DOM tree של Svelte.
   **Fix ארכיטקטוני** — החלף Icon.svelte ל-inline SVG דרך `lucide-svelte` npm package.
   מתקן גם את N5 וגם את B2 ועוד.

### Phase 2 — Data flow bugs (פיצ'רים שבורים)

4. ‏**B10** — Thought translation: bridge metadata מ-voice-session ל-agent-session.
   2 root causes ב-קבצים שונים. ראה דוח חקירה §B10.
5. ‏**B15** — Click-to-play: pass `audio_chunk.messageId` ל-`player.addSegment` ב-`+page.svelte:51`.
6. ‏**N1** — Header text: swap props ב-`+page.svelte:346`:
   `agentName={agent.cwd.split("/").pop()}`, `sessionTitle={sessionTitle ?? agent.cliKind}`.

### Phase 3 — Infrastructure (sessions backend)

7. ‏**N4** — Projects registry: וודא `recordCwd()` נקרא ב-`agent-orchestrator.ts:create()`.
   בלי זה כל פיצ'ר sessions לא שמיש.
8. ‏**B12** — Sessions page: אחרי N4, וודא שה-data זורם לUI.

### Phase 4 — TTS/voice pipeline (לא ניתן לאמת ללא הקלטה חיה)

9. ‏**B13** — TTS duplication: root cause חשוד = handler stale אחרי disconnect (ראה דוח §B13).
   Fix: ב-`disconnect()` של agent-session, נקה `voiceMessageHandler`. הוסף idempotency
   במ-Map ב-`audioCache` (skip כbר אם segmentId קיים).
10. ‏**B14** — Sentence boundary (backend): בדוק `splitIntoSentences` עם עברית.
    אם הוא נכשל על `?` או `!` עברי → תקן regex.
11. ‏**B16** — Loading indicator: minimum display time (1500ms) ל-processing state.

### Phase 5 — Medium polish

12. ‏**B3** — Avatars visibility (ייפתר אוטומטית אחרי B1, אבל אמת)
13. ‏**B5** — Header layout (ייפתר אחרי N1)
14. ‏**B6** — Bottom sheet handle יותר visible.
15. ‏**B9** — FilePicker warnings (initialPath ↔ $state, tabindex).
16. ‏**B11** — Click-to-play visual indicator (play icon בפינה).
17. ‏**N2** — Replace emojis עם Lucide icons ב-dashboard.
18. ‏**N3** — Desktop header refactor לפי mockup.
19. ‏**N6** — Wire audio cues settings ל-cues module.
20. ‏**N7** — BottomSheet grip click handler.

### Phase 6 — בדיקות flows שלא נבדקו (Q2-Q8 — אופציונלי)

21. ‏Q2 — `/session/[cwdHash]/[id]` route
22. ‏Q3 — file picker modal flow
23. ‏Q5 — recording playback
24. ‏Q6 — history bubbles cold state
25. ‏Q7 — mobile responsive (390×780 viewport)
26. ‏Q8 — audio playback בקול אמיתי

‏**Bugs שלא בסקופ** (לפי דוח §5):
- ‏B2, B7, B8 — לא קיימים (false positives שלי בbrief המקורי)
- ‏B9 — warnings build-time בלבד, low priority

---

## 6. DoD Checklist

- [ ] כל ה-B1-B11 תוקנו, נבדקו ב-browser
- [ ] Q1-Q8 נבדקו ידנית (linux-gui + playwright); תיקנו אם יש bugs
- [ ] `pnpm typecheck` + `pnpm lint` + `pnpm test` ירוקים
- [ ] tests חדשים ל-bubble grouping fix (B1) — לפחות 4 tests
- [ ] עדכון `docs/walkthrough.md` עם entry מסכם
- [ ] screenshot סופי שמראה את ה-UI הנכון (mobile + desktop)

---

## 7. אסור / מותר

**מותר:**
- ‏`packages/frontend/src/**`
- ‏`packages/backend/src/**` (אם צריך תיקון קטן)
- ‏`packages/core/src/schemas/agent.ts` (כבר תוקן)
- ‏`docs/walkthrough.md`

**אסור:**
- ‏`packages/core/src/**` חוץ מ-schemas/agent.ts ו-schemas/ws-messages.ts
- ‏`docs/reviews/**`, `docs/archive/**`
- ‏`docs/slice-9-followup-fixes.md` (זה הbrief — קרא אבל אל תערוך)

---

## 8. סקילים חובה

- ‏`tdd` — red-green-refactor loop
- ‏`dev-conventions` — Svelte 5 runes, ESM, אסור any
- ‏`Svelte-MCP` — לחיפוש docs של Svelte 5
- ‏`rtl-adaptation` — לוודא RTL נכון
- ‏`commit` — מבנה commit messages (עברית, פר-fix או פר-Phase)
- ‏`update-walkthrough` — entry בסוף

**אוטונומיה גורפת:** אבי אישר את התוכנית. אל תבקש רשות לcommit. בסוף כל
fix ירוק → typecheck/lint/test → commit אוטומטי. רק החלטה ארכיטקטונית
שלא מכוסה ב-brief → עצור ושאל.

---

## 9. Prompt לסוכן

**חובה Sonnet 4.6** — לא Opus.

```
אתה סוכן תיקון bugs של drive-coding frontend. Slice 9 הושלם, סוכן Opus
עשה חקירה יסודית, ועכשיו תורך לתקן.

נתיבים:
- worktree (CWD): /home/user/projects/voice-acp-v2
- mockup: https://your-app-mockups.nue.tuns.sh/final.html
  + קבצים: /tmp/drive-coding-mockups/final.html + shared.css
- v1 reference: /home/user/projects/voice-acp/frontend/index.html

⭐ מקור אמת מוביל: docs/slice-9-bugs-investigation.md
   דוח חקירה מפורט (374 שורות) שעשה Opus. מכיל לכל bug:
   - status (אומת/חלקי/לא קיים)
   - reproduction steps
   - root cause + file:line מדויק
   - fix proposal קונקרטי
   - evidence (screenshots ב-/tmp/investigation/)

קובץ משלים: docs/slice-9-followup-fixes.md
   context רחב יותר + Phases מסודרות + DoD + רשימת מותר/אסור.

עבודה:
1. טען skills: tdd, dev-conventions, Svelte-MCP, rtl-adaptation,
   commit, update-walkthrough.
2. קרא את docs/slice-9-bugs-investigation.md מקצה לקצה — זה המקור העיקרי.
3. קרא את docs/slice-9-followup-fixes.md לcontext + Phases.
4. עיין ב-screenshots ב-/tmp/investigation/ (6 קבצים).
5. בצע לפי Phase 1 → 2 → 3 → 4 → 5 בסדר.
   לכל bug — קרא את הקטע ב-investigation report (יש file:line מדויק).
   TDD חובה ל-logic. CSS pure ויזואלי בלי tests.
6. commit פר fix או פר Phase. פורמט עברי. ‏ראה דוגמאות בהיסטוריה.
7. בסוף — עדכן docs/walkthrough.md.

pnpm typecheck + pnpm lint + pnpm test לפני כל commit.

אסור לערוך:
- packages/core/src/** חוץ מ-schemas/agent.ts ו-schemas/ws-messages.ts
- docs/reviews/**, docs/archive/**
- docs/slice-9-bugs-investigation.md (זה מקור האמת — לא לערוך)
- docs/slice-9-followup-fixes.md (זה הbrief — לא לערוך)
- docs/slice-9-investigation-brief.md (היה לסוכן הקודם)

מותר:
- packages/frontend/src/**
- packages/backend/src/** (לתיקון N4 ייתכן נדרש)
- packages/frontend/package.json (אם N5 דורש lucide-svelte npm package)
- docs/walkthrough.md (entry בסוף)

ה-backend רץ ברקע ב-tmux `be` על port 4000. ה-frontend ב-tmux `fe` על
port 5173. tunnel: https://your-app.nue.tuns.sh

לטסט ב-browser: linux-gui עם pw-clean.sh על port 9333. test-voice.mp3
על /tmp/test-voice.mp3 ועל linux-gui:/tmp/test-voice.mp3.

לטסט upload — input #audio-file-input מוסתר. כדי לחשוף ידנית:
  playwright-cli eval "(() => { document.querySelector('#audio-file-input').style.cssText = 'position:fixed;top:10px;z-index:9999;display:block'; })()"
ואז click + upload.

יצרת agent עם cwd שתבחר (לדוגמה /home/user/projects/voice-acp-v2)
דרך POST /api/agents עם cliKind=opencode.

חשוב — Phase 1 fix N5 (Icon.svelte / Lucide CDN) הוא ארכיטקטוני:
שינוי מ-CDN ל-lucide-svelte דורש pnpm install + שינוי בכל 11 components
שמשתמשים ב-Icon. אם זה גדול מדי — תיקון חלקי (clear DOM לפני update)
מספיק בינתיים. תעדוף שיעבור.

אוטונומיה גורפת — בסוף כל fix ירוק → commit אוטומטי. רק החלטה
ארכיטקטונית לא מכוסה ב-brief → עצור ושאל.
```

---

## 10. Bugs חדשים שנמצאו בחקירה (2026-05-17)

> נמצאו על-ידי Opus 4.6 investigation agent. דוח מלא: `docs/slice-9-bugs-investigation.md`.

### 🟡 N1 — Header text מציג CLI kind במקום project name

‏**מה רואים:** FloatingHeader מציג "opencode" כ-agent name ו-"voice-acp-v2" כ-session title. צריך להיות הפוך (project name → agent-line, session title + cli → session-line).

‏**איפה:** `packages/frontend/src/routes/agent/[id]/+page.svelte:346-348`
```svelte
<FloatingHeader
  agentName={agent?.cliKind ?? ""}           <!-- צריך: agent.cwd.split("/").pop() -->
  sessionTitle={agent.cwd.split("/").pop()}  <!-- צריך: session title -->
/>
```

### 🟡 N2 — Dashboard משתמש ב-emojis במקום Lucide icons

‏**מה רואים:** 📚 ו-⚙ ו-🎙 כ-emojis בדשבורד. ה-brief מציין Lucide icons בכל מקום.

‏**איפה:**
- `packages/frontend/src/routes/+page.svelte:115` — `📚` → `<Icon name="book-open" />`
- `packages/frontend/src/routes/+page.svelte:128` — `🎙` → `<Icon name="mic" />`
- `packages/frontend/src/routes/+page.svelte:175` — `⚙` → `<Icon name="settings" />`

### 🟡 N3 — Desktop header בסגנון ישן (pre-refactor)

‏**מה רואים:** ב-desktop mode ה-header ב-agent page מציג "← חזרה", badge, ו-"⚙" — כולם בסגנון ישן. ה-mockup מצפה ל-classic header עם project name + session title.

‏**איפה:** `packages/frontend/src/routes/agent/[id]/+page.svelte:350-360`

### 🔴 N4 — Projects registry ריק — sessions לא נשמרים

‏**מה רואים:** `GET /api/projects` ו-`GET /api/sessions` מחזירים מערכים ריקים, למרות ש-2 agents פעילים. `/sessions` מציג "אין שיחות קודמות".

‏**איפה:** Backend — `packages/backend/src/app/agent-orchestrator.ts` — ה-`recordCwd()` call ככל הנראה חסר/לא מחובר.

### 🔴 N5 — Icon.svelte: Lucide createIcons() מערבב DOM → double icons

‏**מה רואים:** כשה-mic עובר ל-speaking, ייתכן ש-2 SVGs (mic + volume-2) מוצגים. Lucide מחליף `<i>` ב-`<svg>` ישירות ב-DOM מאחורי הגב של Svelte.

‏**איפה:** `packages/frontend/src/lib/components/Icon.svelte:30-41`
- `lucide.createIcons()` נקרא **גלובלית** ומחליף DOM elements ש-Svelte לא מודע להם.
- **הצעת fix:** מעבר ל-`lucide-svelte` (npm package) שמרנדר SVG inline — מונע DOM manipulation.

### 🟡 N6 — Audio cues settings toggle לא מחובר

‏**מה רואים:** Settings page מציג 4 checkboxes (כולם ✅), אבל `cues.ts` לא קורא מ-`settings-store`. ה-cues תמיד מופעלים.

‏**איפה:**
- `packages/frontend/src/lib/audio/cues.ts` — אין import של settings store
- `packages/frontend/src/routes/agent/[id]/+page.svelte:110-128` — קורא ל-cues ישירות בלי בדיקת settings

### 🟡 N7 — BottomSheet grip לא מגיב ל-click

‏**מה רואים:** ה-grip (40×4px) נראה בתחתית אבל לא פותח את ה-sheet ב-click.

‏**איפה:** `packages/frontend/src/lib/components/BottomSheet.svelte` — בדוק שה-click handler על ה-grip מחובר ל-`sheetState.toggle()`.

---

## 11. סיכום צפוי (מעודכן)

- 23 fixes (B1-B16 + N1-N7)
- 7 בדיקות + תיקונים פוטנציאליים (Q2-Q8; Q1 הפך ל-B12)
- ~25-30 commits
- ~20-30 tests חדשים
- 6-10 שעות עבודה

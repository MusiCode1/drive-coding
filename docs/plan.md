# Plan — voice-acp v2

> תוכנית עבודה אקטיבית. **המבצע קורא רק את הסעיף "משימות לביצוע"**.
> ארכיטקטורה כללית: `docs/spec.md`. רעיונות נדחים: `docs/future-features.md`.

---

## מצב נוכחי (2026-05-14)

**v1 + v2 + v3 הושלמו וקומטו.** ה-stack פעיל E2E. ראה `docs/walkthrough.md` ו"משימות שבוצעו" למטה.

**v4 = תיקון נקודתי.** באיטרציית v3, משימה D הוסיפה חיתוך לפי משפט ל-message אבל לא ל-thought. בבדיקה empirical של Avi ב-16:30 התגלה שהתרגום של thoughts קורה רק בסוף ה-thought block ולא פר-משפט — חוויית UX לא טובה. משימה P מתקנת את זה בהיקף ממוקד.

עיקרון מנחה כללי נשאר: Gemini (Flash Lite לעזרים, Flash הרגיל ל-STT) כשכבת הנגשה — בכל מקום שטקסט מהמערכת לא נשמע טבעי. גנרי, זול, מהיר.

---

## ארכיטקטורת `gemini-helper.ts` (מקובע)

מודול חדש: `backend/src/gemini-helper.ts`. כל מקומות הנגשה האודיו עוברים דרכו.

```
gemini-helper.ts
├── ai (instance יחיד של GoogleGenAI, apiKey: "placeholder" — OneCLI מטפל)
├── DEFAULT_MODEL = "gemini-flash-lite-latest"
├── translationCache: Map<string, string>
├── narrationCache: Map<string, string>  (key = toolCallId)
├── translateThought(text): Promise<string>
└── narrateToolCall(ctx, tool): Promise<string>
```

---

## הסכמות מקובעות

1. **תצוגת thought:** שתי שפות בבועה אחת — אנגלית מקור (קטן/אפור) + תרגום עברי (בולט). מפריד עדין.
2. **Bash commands ב-narration:** לא מזכירים את הפקודה עצמה — רק את התכלית.
3. **STT עם context:** מצרפים את הודעת המודל הקודמת ל-prompt התמלול.
4. **Voice ל-thoughts:** אותו voice של המסר הראשי. toggle לקול שני נדחה ל-future-features.

---

## משימות לביצוע

> איטרציית v4 (תיקון נקודתי) — משימה P שזוהתה בבדיקה empirical של Avi ב-16:30 אחרי שהמבצע סיים את v3.
> בכל משימה: **commit יחיד**, הודעה בעברית, פורמט `(scope): כותרת\n\n- שינוי 1\n- שינוי 2`.

---

### P. חיתוך לפי משפט גם ל-thoughts (אנלוגי ל-D)

**מטרה:** תרגום המחשבות לעברית והקראה דרך אילבן יקרו פר-משפט בזמן ש-thought מצטבר, לא בבת אחת בסוף. המשתמש יתחיל לשמוע את התרגום של המשפט הראשון תוך כדי שהמודל עוד חושב את ההמשך — בדיוק כמו שזה עובד למסר רגיל מאז משימה D.

**הקשר:** ב-`server.ts`, ה-`onChunk` handler עבור `kind === "message"` עושה loop של `findSentenceBoundary` ועושה flush פר-משפט. אבל ה-handler עבור `kind === "thought"` רק עושה `thoughtBuffer += chunk` בלי חיתוך. תוצאה: `flushThought` נקרא רק כש-message מתחיל, כש-tool_call create, או בסוף תור. כל ה-thought block (יכול להיות אלפי תווים) מתורגם בקריאה אחת ל-Gemini ומוקרא ברצף, מה שיוצר השהיה ארוכה לפני שמשהו נשמע.

ה-helper `findSentenceBoundary` כבר קיים ב-`server.ts` (נכתב במשימה D, כולל הגנה מקיצורים ומספרים עשרוניים, forced flush ב-200 תווים). הוא תומך גם באנגלית וגם בעברית. כל מה שצריך זה לחבר אותו לזרם ה-thought.

**קובץ:** `backend/src/server.ts`

**שינוי ב-`onChunk` של ה-`prompt`, בענף `kind === "thought"` (סביב שורות 478-482):**

החליפי את:
```ts
} else if (kind === "thought") {
  // thought באמצע — flush של ה-message הנוכחי (לחלוקת בועות ב-frontend).
  if (messageBuffer.length > 0) flushMessage();
  thoughtBuffer += chunk;
}
```

ב:
```ts
} else if (kind === "thought") {
  // thought באמצע — flush של ה-message הנוכחי (לחלוקת בועות ב-frontend).
  if (messageBuffer.length > 0) flushMessage();
  thoughtBuffer += chunk;
  // חיתוך לפי גבול משפט — מאפשר התחלת תרגום+TTS מהר ולא לחכות לסוף ה-thought.
  // אותה לוגיקה כמו במשימה D עבור message.
  let boundary = findSentenceBoundary(thoughtBuffer);
  while (boundary !== -1) {
    const head = thoughtBuffer.slice(0, boundary);
    const rest = thoughtBuffer.slice(boundary);
    thoughtBuffer = head;
    flushThought();           // שולח head ל-תרגום + TTS, מאפס thoughtBuffer ל-""
    thoughtBuffer = rest;
    boundary = findSentenceBoundary(thoughtBuffer);
  }
}
```

**הערה:** הלולאה זהה במבנה ללוגיקת ה-message ב-onChunk (סביב שורות 466-475 בקוד הקיים). אפשר להעתיק את התבנית.

**שיקולי עלות:** כל סגמנט = קריאה אחת ל-Gemini + stream אחד מאילבן. אם המחשבה ארוכה (נגיד 8 משפטים), זה יוצר 8 קריאות במקום אחת. עלות Gemini Flash Lite זניחה (~$0.01 ל-1M tokens), עלות אילבן זהה לעלות הנוכחית של אותו טקסט בסך הכל (אותם תווים עוברים, רק בקבצים נפרדים). לא צריך אופטימיזציה נוספת.

**אינטראקציה עם L (קפיצה אוטומטית ממחשבות לתשובה):** כש-P מאומץ, ה-thoughts פעילים יותר ב-TTS — יש יותר סגמנטים בתור הניגון. ה-cut של L (חיתוך כש-message מתחיל) מקבל יותר ערך — הוא יחתוך לא רק את המחשבה הנוכחית אלא גם thoughts pending שלא הספיקו לנגן. הקוד של L כבר מטפל בזה דרך ניקוי `streamOrder`. אין שינוי נדרש ב-L.

**בדיקה:**
- `cd backend && bunx tsc --noEmit` — חובה.
- בדיקה empirical: לשאול שאלה שמייצרת thought ארוך (למשל "תכין תוכנית מפורטת לפיצ'ר חדש"). לבדוק שהתרגום והקראת המחשבה מתחילות תוך שניות, לא רק בסוף החשיבה.
- בדיקת unit: אם findSentenceBoundary כבר עם unit tests מ-D, הם עדיין תקפים — לא נגעת בפונקציה עצמה.

**Commit suggestion:** `(thoughts): חיתוך thoughts לפי גבול משפט בנוסף למעבר kind`

---

## משימות בעבודה (executor)

— (אין כרגע. **v3 הושלם** — ראה "משימות שבוצעו".)

---

## משימות שבוצעו

### O — שיפור פרומפט STT + מעבר ל-Flash (2026-05-14 15:30)
backend: `stt.ts` — `DEFAULT_MODEL` עבר מ-`gemini-flash-lite-latest` ל-`gemini-flash-latest`. `TRANSCRIBE_PROMPT` הורחב עם הוראות פיסוק (פסיק/נקודה/?/!), שבירת פסקאות (`\\n\\n`) בשינויי נושא, "preserve intent" ב-disfluencies, "do NOT add content". `bunx tsc --noEmit` עבר. **v3 הושלם.**

### N — שמירת הקלטות לדיסק (2026-05-14 15:20)
backend: מודול חדש `recordings.ts` עם `saveRecording` + `saveRecordingMetadata`, controlled by `VOICE_ACP_SAVE_RECORDINGS` (ברירת מחדל ON). נתיב: `$XDG_CACHE_HOME/voice-acp/recordings`. `ConnState` קיבל `cwd` + `sessionId`. ב-`handleAudio`: שמירה ברקע במקביל ל-STT, metadata אחרי transcript (בלי await). לוג סטטוס בתחילת ריצה. `bunx tsc --noEmit` עבר.

### M — גלילה חכמה לפי user intent (2026-05-14 15:05)
frontend: הסרת `SCROLL_THRESHOLD_PX` + `suppressScrollEvents`. מודל חדש מבוסס `userInteractionAt` + listeners על wheel/touch/keyboard/mousedown. ה-scroll handler מכבה אוטו רק אם פעולת קלט קרתה תוך 500ms. תוכן שמתווסף לא יכבה. distance ≤ 10 מחזיר אוטו. `node --check` עבר.

### L — קפיצה אוטומטית ממחשבות לתשובה (2026-05-14 14:55)
frontend: `StreamingAudio.stop()` חדש — pause + src="" + endOfStream. ב-`handleAudioStart` בלוק חדש כשמתחיל `kind="message"`: עוצר את ה-currentStream אם הוא thought, ומסיר thoughts פנדינג מ-streamOrder/activeStreams (משאיר tool_title וכו'). חיתוך אגרסיבי באמצע chunk. `node --check` עבר.

### K — CSS revert ל-`thought-translation` (2026-05-14 14:45)
frontend: הוסרו padding-top, border-top, color, font-size, font-style מ-`.thought-translation`. נשארו רק `display:block` + `margin-top:4px`. כל השאר יורש מהבועה ההורית. `node --check` עבר.

### J — `translateThought` מחזיר null בכישלון (2026-05-14 14:40)
backend: `gemini-helper.ts` — חתימה `Promise<string | null>`, כל כשלון מחזיר null (timeout/exception/empty). cache שומר רק non-null. `server.ts` — `flushThought` בודק null ומדלג על text_chunk + TTS. CLI test הראה happy-path עובד (930ms דרך OneCLI). `bunx tsc --noEmit` עבר.

### I — `dir="auto"` לבועות (2026-05-14 13:05)
frontend: `SubBubble.bubbleEl.setAttribute("dir","auto")` בconstructor. `renderToolItem`: `<span dir="auto">` ישירות ב-innerHTML. `setHtml`: iterate על children ומוסיף dir=auto לכל מי שאין לו. `node --check` עבר. **v2 הסתיים.**

### H — גלילה חכמה (2026-05-14 12:55)
frontend: עטיפת `#chat` ב-`#chat-wrap` (position:relative). כפתור `#jump-down` absolute. קבוע `SCROLL_THRESHOLD_PX=60`, state `autoScrollEnabled` + `suppressScrollEvents`. listener על scroll. `scrollChatToBottom` מוקדם-יציאה אם autoScroll כבוי. כפתור click מאפס למטה. `node --check` עבר.

### G — mic button state machine + stop button (2026-05-14 12:40)
frontend: 4 states (idle/recording/speaking/paused) דרך `data-state`. helpers: getMicButtonState, updateMicButton, pauseAllAudio, resumeAllAudio, stopAllAudio. StreamingAudio.resume(). שדה global `audioIsPaused`. click handler חדש עם switch על המצבים. stop-btn חדש (hidden until speaking/paused). CSS מעבר מ-class ל-attribute selectors. MutationObserver של car mode עבר ל-data-state. `node --check` עבר.

### F — נראציה של tool calls (2026-05-14 12:20)
backend: ConnState קיבל `lastUserText` + `recentMessages` (FIFO max 3). `handleUserInput` שומר את הטקסט. `flushMessage` מוסיף ל-recentMessages. `onToolCall(create)` עובר דרך ttsQueue → `narrateToolCall` + `streamTts(narrate, "tool_title")`. snapshot של context נלקח ב-create כדי שעדכונים async מאוחרים לא ישנו את הנראציה. אין שינוי ב-frontend (אותו `kind: "tool_title"`). `bunx tsc --noEmit` עבר.

### E — תרגום thoughts + הקראה (2026-05-14 12:05)
backend: `text_chunk.kind: "thought_translation"`, `audio_start.kind: "thought"`, `thoughtBuffer`, `flushThought()` (translate→text_chunk→TTS דרך ttsQueue), קריאות מ-onChunk/onToolCall/end-of-turn. frontend: שדה `hasTranslation`, `_originalEl` כדי לא לדרוס children ב-appendText של thought, `setThoughtTranslation()`, handler ל-`text_chunk thought_translation`, `handleAudioStart` ל-`kind=thought`, `handleAudioEnd` שומר audioBase64 רק ל-message. הסדר נשמר דרך ttsQueue. `bunx tsc --noEmit` + `node --check` עברו.

### D — חיתוך `flushMessage` לפי גבול משפט (2026-05-14 11:40)
ב-`server.ts`: `findSentenceBoundary` חדשה (export, יחידה ניתנת לבדיקה). הגנה מקיצורים (Mr./Dr./i.e./e.g.) ומספרים עשרוניים. forced flush ב-200 תווים לעברית. ה-`onChunk` של `message` עושה loop של חיתוך וזרימה. אומת ב-unit test על 8 מקרים. `bunx tsc --noEmit` עבר.

### C — `gemini-helper.ts` (2026-05-14 11:25)
קובץ חדש: `backend/src/gemini-helper.ts`. שני exports: `translateThought` (timeout 2500ms, cache לפי טקסט) ו-`narrateToolCall` (timeout 1500ms, cache לפי toolCallId). שתי הפונקציות מטופלות עם withTimeout + try/catch שמחזירים fallback (טקסט מקורי / title גולמי). אומת שה-fallback עובד גם בלי auth.

### B — STT prompt טכנולוגי + context (2026-05-14 11:15)
`stt.ts`: TRANSCRIBE_PROMPT חדש (עברית טכנולוגית, תיקוני disfluencies, שפה מקורית); שדה `previousResponse` ב-SttOptions; אם הועבר נשלח כ-text part לפני האודיו.
`server.ts`: שדה `lastAgentMessage` ב-ConnState; נשמר ב-flushMessage; מועבר ב-handleAudio. `bunx tsc --noEmit` עבר.

### A — חיזוק `system-prompt.ts` (2026-05-14 11:05)
הוספת שתי שורות לסעיף "חוקי תגובה" של `VOICE_SYSTEM_PROMPT`: דגש שהתשובה תוקרא ולא תוצג, ושלמשתמש אין מסך. `bunx tsc --noEmit` עבר.

### תיקון באג `playQueue` residual (commit 77f32bb, 2026-05-14)
ב-`frontend/index.html` שורות 1197/1205, ההתייחסות ל-`playQueue.length === 0` הוחלפה ב-`!currentlyPlaying && !currentStream && streamOrder.length === 0`. בוצע בסשן הקודם של הסוכן הקודם.

### POC v1 — תשתית מלאה (commits 77f32bb..5650fba, 2026-05-14)
Backend מלא: `server.ts`, `acp-bridge.ts`, `stt.ts`, `tts.ts`, `system-prompt.ts`, `markdown.ts`. Frontend מלא: `index.html` (chat + streaming + car mode + history), `config.html`. תועד ב-`docs/walkthrough.md` 2026-05-14 08:45.

### תשתית קואורדינציה בין סוכנים (commits 4fff13a..1fbdb00, 2026-05-14)
יצירת `docs/agents/` עם README + planner.md + executor.md. הוספת סעיף "פרוטוקול עבודה מקבילית" ל-AGENTS.md. כללי Edit/Write לקבצים משותפים, וקומיטים אוטונומיים בלי אישור Avi.

---

## רעיונות לדיון (טרם הוחלט)

### א. התראות אקטיביות מהמבצע ל-Avi

היום הקואורדינציה מבוססת על `tail -f docs/agents/*.md` בטרמינל. אם Avi לא בודק — שאלות מהמבצע עלולות להתעכב.

**אפשרויות:**
1. Linux desktop notification (libnotify) כשהמבצע כותב ❓.
2. ntfy.sh / Telegram bot push.
3. דחיפה ל-voice-acp עצמו: הbackend מאזין לשינויים ב-`docs/agents/*.md` ומשמיע התראה דרך WebSocket לדפדפן.

**ממתין להחלטת Avi.** כרגע "לא דחוף" — המודל עובד מצוין ידנית.

### ב. הפרדת `plan.md` ל-`plan.md` + `discussion.md`

הסעיף הזה ("רעיונות לדיון") עלול לבלבל את המבצע אם הוא יקרא מעבר ל"משימות לביצוע". שלוש אופציות:
1. **להשאיר כפי שהוא** — כותרת ברורה, ופרוטוקול המבצע מורה לקרוא רק "משימות לביצוע".
2. **לפצל**: `plan.md` (אקטיבי בלבד) + `discussion.md` (טיוטות).
3. **לתייג כל סעיף** עם "לביצוע"/"לדיון"/"דחוי".

**ממתין להחלטת Avi.** כרגע אופציה 1 בתוקף.

---

## תוכניות ארוכות טווח / future-features

ראה `docs/future-features.md`. הסיכום: 16 פיצ'רים דחויים מודעת. הבולטים: קול משני ל-thoughts, VAD + Gemini decision-maker, permission UI, full input streaming ל-ElevenLabs WS, LRU+disk cache ל-TTS, PWA ל-iOS car mode.

---

## תלויות בין משימות (v4)

משימה יחידה — אין תלויות.

**הערה:** P מסתמכת על `findSentenceBoundary` שכבר נכתבה ב-D ועל `flushThought` שכבר נכתבה ב-E + J. כל הבסיס קיים, P היא רק חיבור של חיתוך-לפי-משפט לזרם ה-thought.

---

## הערכת זמן (גס) — v4

| משימה | זמן |
|--------|-----|
| P | 10-15 דק' |
| **סה"כ** | **~15 דק'** |

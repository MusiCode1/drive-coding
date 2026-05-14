# Plan — voice-acp v2

> תוכנית עבודה אקטיבית. **המבצע קורא רק את הסעיף "משימות לביצוע"**.
> ארכיטקטורה כללית: `docs/spec.md`. רעיונות נדחים: `docs/future-features.md`.

---

## מצב נוכחי (2026-05-14)

**v1 + v2 + v3 הושלמו וקומטו.** ה-stack פעיל E2E. ראה `docs/walkthrough.md` ו"משימות שבוצעו" למטה.

**v4 (משימה P) ממתינה למבצע** — תיקון UX של חיתוך thoughts לפי משפט (ראה תיאור מטה).

**v5 = ניווט בתור הניגון.** Avi הביעה צורך דחוף בכפתורי קדימה־אחורה בתור הניגון של ה-frontend, כדי שתוכל לדלג כש-ElevenLabs "משתגע" באמצע סגמנט (חוזר על עצמו, מדבר ג'יבריש). זה הבלוקר היחיד מבחינת UX לפני שמתחילים את הריפקטור הגדול.

**v6 = ריפקטור עם בדיקות (מתוכנן, טרם מומש).** אחרי v5: חילוץ behaviors.md מהקוד והשיחות, כתיבת בדיקות אינטגרציה, ריפקטור של server.ts (handler ענק → ConnectionState class + פונקציות טהורות). יבוצע ב-worktree נפרד כדי לא לחסום את הריצה הנוכחית של Avi.

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

> בכל משימה: **commit יחיד**, הודעה בעברית, פורמט `(scope): כותרת\n\n- שינוי 1\n- שינוי 2`.
> **סדר ביצוע מומלץ:** Q ראשונה (דחיפות UX), אחר כך P (תיקון UX קיים).

---

### Q. כפתורי קדימה/אחורה בתור הניגון (frontend)

**מטרה:** Avi צריכה דרך מהירה לדלג קדימה כש-ElevenLabs נכשל באמצע סגמנט (חוזר על עצמו, מדבר ג'יבריש למשך דקות). וגם לחזור לסגמנט קודם אם הוצגה הודעה שלא הספיקה לעבד. שני כפתורים חדשים בממשק: ⏮ (הקודם) ו-⏭ (הבא), שעובדים על תור הניגון של ה-frontend בלבד.

**הקשר ארכיטקטוני:**

ב-`frontend/index.html` יש שתי שכבות של ניגון אודיו, ושני סוגי בועות:
1. **`StreamingAudio`** (live) — מנגן progressively MP3 chunks תוך כדי קבלה. מנוהל דרך `streamOrder[]` + `activeStreams` Map + `currentStream` (שורות 1188-1191). הכפתור ⏸/▶ הראשי של המיקרופון שולט בזה.
2. **`Audio` רגיל (replay)** — נוצר ב-`playSubBubbleAudio` משדה `audioBase64` שנשמר על ה-SubBubble אחרי `audio_end` (שורה 1298). מנוהל דרך `currentlyPlaying`. כפתור 🔊 על כל בועה מפעיל את זה.

יש ארבעה סוגי בועות (`SubBubble.kind`): `user`, `thought`, `tools`, `message`. רק `message` ו-`tool_title` ו-`thought` נשמעים. רק `message` שומר `audioBase64` (שורה 1296: "שמירת האודיו על ה-sub לreplay — רק ל-message"). מחשבות ו-tool titles לא נשמרים ל-replay אחרי שהם הסתיימו.

**עקרון מנחה לעיצוב הקפיצה:**

תור הניגון "האקטיבי" הוא מה ש-Avi רוצה לנווט בו. זה כולל:
- **סגמנטים שעדיין לא ניגנו** ב-`streamOrder` (FIFO של live streams) — קדימה ייקפצו אליהם.
- **סגמנטים שכבר ניגנו** והם בועות `message` עם `audioBase64` שמור — אחורה יחזיר אליהם.

מחשבות ו-tool titles שכבר ניגנו — אבודים. אין `audioBase64`. אחורה ידלג עליהם.

**State חדש לתחזק:**

```js
// playbackHistory: רשימת ה-bubbles שניגנו (כולם message). מתעדכן ב-onComplete של live
// או בכל לחיצה על 🔊 / kbd. מהווה את "מה שעבר" — אחורה חוזר אליהם.
const playbackHistory = []; // SubBubble[] (רק message, רק עם audioBase64)
```

**שינויים ב-frontend:**

1. **HTML חדש** — שני כפתורים בצד שמאל וימין של כפתור המיקרופון בשורת הקלט הראשית. עיצוב דומה ל-stop-btn (עיגול קטן, רקע שקוף עד hover). מומלץ:
   - `<button id="prev-btn" class="nav-btn" hidden aria-label="סגמנט קודם">⏮</button>`
   - `<button id="next-btn" class="nav-btn" hidden aria-label="סגמנט הבא">⏭</button>`
   - מיקום: בתוך אותו container של mic + stop. שני הכפתורים מוסתרים ב-idle, מופיעים ב-`speaking` או `paused` או כשיש הקלטות זמינות.

2. **CSS חדש** — בלוק `.nav-btn` בסטייל של `#stop-btn` (עיגול ~36px, hover effect). יש להוסיף ליד CSS של `#stop-btn` בקובץ.

3. **`updateMicButton()`** (סביב שורה 971) — להוסיף בסוף לוגיקה לחשיפת prev/next. הכלל:
   - `prev-btn` מופיע אם `playbackHistory.length > 0` או יש סגמנט נוכחי שמתנגן (אז prev = restart הנוכחי).
   - `next-btn` מופיע אם `streamOrder.length > 0` או `currentStream` קיים (יש מה לדלג ממנו).
   - אם idle לחלוטין ואין היסטוריה — שניהם hidden.

4. **`playbackHistory` push** — שתי נקודות:
   - ב-`stream.onComplete` של live message (סביב שורות 1296-1303) — אחרי שמירת `audioBase64`, push `stream.sub` ל-`playbackHistory`.
   - ב-`playSubBubbleAudio(sub)` (שורה 1315) — אם sub לא ב-history, push (כך שהפעלת replay ידני גם נכנסת להיסטוריה).
   - **לא כפילויות**: לבדוק `if (!playbackHistory.includes(sub))` לפני push.

5. **`handleNext()`** — פונקציה חדשה. הלוגיקה:
   - אם יש `currentStream` (live מנגן עכשיו): לקרוא `currentStream.stop()`, להסיר אותו מ-`activeStreams` ו-`streamOrder`, אם זה `kind === "message"` ויש `audioBase64` ב-sub → push ל-history (חצי-מנוגן). לקרוא `playNextStream()`.
   - אם אין live אבל `currentlyPlaying` (replay): לקרוא pause עליו, לאפס `currentlyPlaying = null`. אם אחרי זה יש streams בתור → `playNextStream()`. אחרת — `setStatus("מוכן")` ועדכון state.
   - אם אין שום דבר מתנגן ויש פריטים ב-`streamOrder` שלא התחילו — `playNextStream()` (זה מקרה קצה, בדרך כלל לא יקרה).
   - בכל מקרה — לקרוא `updateMicButton()` בסוף.

6. **`handlePrev()`** — פונקציה חדשה. הלוגיקה:
   - אם יש `currentlyPlaying` (replay מתנגן): pause + restart מההתחלה (יצירת Audio חדש על אותו base64). זה "אחורה לתחילת הסגמנט הנוכחי".
   - אם יש `currentStream` live: pause + restart לא אפשרי (זה stream). אז לקחת את האחרון מ-`playbackHistory` (ה-element הקודם, לא הנוכחי) ולהפעיל replay עליו דרך `playSubBubbleAudio`. אם history ריק — תגובה ויזואלית קצרה (flash) או disable.
   - אם אין שום דבר מתנגן: pop מ-`playbackHistory` (האחרון) ולהפעיל `playSubBubbleAudio` עליו. אם history ריק — disable.
   - **חשוב**: לפני replay לעצור הכל אחר עם `pauseAllAudio()`.

7. **Click handlers** — `prevBtn.addEventListener("click", handlePrev)` ו-`nextBtn.addEventListener("click", handleNext)`.

8. **Keyboard shortcuts** (אופציונלי, אבל נחמד) — `←` קורא ל-handlePrev, `→` קורא ל-handleNext. רק כש-document.activeElement אינו input/textarea. להוסיף ליד shortcut הקיים של `replayLastBtn.click()` (שורה 1814).

9. **`stopAllAudio()`** (שורה 1008) — לאפס גם `playbackHistory.length = 0`? **לא**. היסטוריה צריכה להישאר זמינה גם אחרי stop. רק `currentStream`/`currentlyPlaying`/`streamOrder` מתאפסים שם. ה-history נשאר עד שינוי session או reload.

**Edge cases לזכור:**

- **history מתוך bubble שעדיין ניגן live ונקטע ע"י next**: אם המשתמש דילג באמצע live של message שצריך `audioBase64`, ייתכן שה-`getBase64()` יחזיר רק את ה-chunks שהגיעו עד אותו רגע. זה בסדר — הוא ישוחזר ב-replay כקובץ קצר. עדיף מאשר לאבד את הסגמנט.
- **next על תור ריק וגם currentStream ריק**: לא לעשות כלום, אולי flash על הכפתור (CSS `:active`).
- **prev על תור ריק והיסטוריה ריקה**: זהה — disable או flash.
- **משתמש לוחץ next מהר ברצף**: כל לחיצה רק מקדמת אחד — אסור שיתבצעו שני dispatch מקבילים. ה-onComplete עשוי לא להגיע מיידית כש-stop נקרא; להשתמש בקוד הקיים שמטפל בזה (`activeStreams.delete` בקריאה ידנית).

**קבצים:** `frontend/index.html` בלבד.

**בדיקה:**
- syntax: `node --check` על הסקריפט המוטמע (להוציא את ה-`<script>` ל-temp file).
- empirical: בריצה אמיתית — לדבר עם המודל, לקבל מסר ארוך עם 3+ סגמנטים. ללחוץ ⏭ באמצע סגמנט אחד → צריך להתחיל את הסגמנט הבא מיד. ללחוץ ⏮ אחרי 2 סגמנטים → צריך לחזור לסגמנט הקודם מההתחלה. אם ה-history ריק (תחילת שיחה) → ⏮ disabled.

**Commit suggestion:** `(ui): כפתורי קדימה/אחורה לניווט בתור הניגון`

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

## תלויות בין משימות (v4 + v5)

- **Q** עצמאית לחלוטין — frontend בלבד, אין תלויות.
- **P** עצמאית — backend בלבד. מסתמכת על `findSentenceBoundary` (קיים מ-D) ועל `flushThought` (קיים מ-E + J).
- **Q ו-P לא מתנגשות** — קבצים שונים. אפשר לבצע ברצף או במקביל (אם היו שני מבצעים).

**סדר מומלץ:** Q קודם (Avi צריכה את זה בריצה החיה), P אחרי. שניהם לפני v6 (ריפקטור).

---

## הערכת זמן (גס)

| משימה | זמן | קובץ |
|--------|-----|------|
| Q | 30-45 דק' | `frontend/index.html` |
| P | 10-15 דק' | `backend/src/server.ts` |
| **סה"כ v4 + v5** | **~60 דק'** | |

---

## v6 — תכנון ריפקטור (טרם מומש, רק כיוון)

> **לא משימה לביצוע — רק רישום של הכיוון לאיטרציה הבאה.** ה-planner יפרק לפרוטוקול מפורט אחרי ש-Q ו-P מסתיימות וחוזרים empirically יציבות.

### הרציונל

`backend/src/server.ts` הוא 939 שורות. הפונקציה `handlePrompt` תופסת ~240 שורות (440-677), עם 5 buffers + queue + 3 helpers מקוננים בתוך closure אחד. כל מצב חדש דורש נגיעה במקומות מרוחקים. גם יש בזבוז — מחשבות וקריאות לכלים מתורגמות ומוקראות גם כשמסר עוקף אותם מיד (משימה L חותכת ב-frontend, אבל ה-Gemini call וה-ElevenLabs call כבר נעשו).

### עקרונות העבודה

1. **בדיקות לפני ריפקטור.** כותבים סוויטת בדיקות אינטגרציה שמכסה את כל ההתנהגויות הקיימות (כולל באגים שתוקנו ועקיפות). הסוויטה רצה על הקוד הנוכחי ועוברת.
2. **חילוץ behaviors.md.** מקור: שיחות OpenCode הקודמות (`conversations_search` + קריאה), `walkthrough.md`, `learnings.md`, וקריאת הקוד עצמו. כל באג שתוקן → התנהגות. כל workaround → התנהגות. כל פיצ'ר → התנהגות.
3. **ריפקטור עם הבדיקות עוברות בכל commit.** מחלקת `ConnectionState`, פונקציות טהורות (`processChunk`, `decideTtsPriority`), חלוקה לקבצים נפרדים (אולי `prompt-handler.ts`, `tts-queue.ts`).
4. **בזבוז המחשבות מטופל כחלק מהארכיטקטורה החדשה** — TTS queue מבוסס priority עם hold/cancel: מחשבות וקריאות-לכלים ב-"hold" עד שיודעים שאין מסר אחריהן (delay קטן, או cancellation token).
5. **ב-worktree נפרד** — `git worktree add ../voice-acp-refactor refactor`. ה-master ממשיך לרוץ אצל Avi, מקבל hot-fixes רק במידת הצורך. כשהריפקטור גמור — merge חזרה. ראה `learnings.md` לגבי git-worktree-shared-assets אם רלוונטי.
6. **אין שרת חי ב-worktree של הריפקטור** — הבדיקות רצות עם `bun test`, בלי OneCLI, בלי tunnel. רק בסוף, כשהכל ירוק, מקימים שרת זמני על port נפרד לבדיקה empirical.

### תוצרים צפויים

- `docs/behaviors.md` — תיעוד אנושי של כל ההתנהגויות (גם פיצ'רים, גם עקיפות, גם באגים-שתוקנו).
- `backend/tests/` — סוויטת בדיקות ש-100% ממנה עוברת לפני ואחרי הריפקטור.
- `backend/src/connection-state.ts` (חדש) — class שאוסף את state per-WS connection.
- `backend/src/prompt-handler.ts` (חדש) — לוגיקת ה-prompt streaming, נטו.
- `backend/src/tts-queue.ts` (חדש) — תור עם priority, hold, cancel.
- `backend/src/server.ts` (קצוץ) — נשאר רק WebSocket routing + HTTP endpoints.
- תיקון אגב: בזבוז Gemini/ElevenLabs על מחשבות שייקטעו (`tts-queue` יבטל אותן לפני שליחה).

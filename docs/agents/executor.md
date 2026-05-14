# executor — סוכן הביצוע

## תפקיד

אתה סוכן הביצוע של voice-acp. תפקידך לקחת תוכניות שהמתכנן כתב ב-`docs/plan.md` ולממש אותן בקוד.

**אתה לא מקיים שיחה עם Avi.** הוא מדבר עם המתכנן. אתה רק עובד ברקע.

אם בכל זאת Avi פונה אליך ישירות — ענה בקצרה ובעניין, בעברית TTS-friendly (פרוזה זורמת, בלי טבלאות / רשימות / קוד / אימוג'ים).

## פרוטוקול עבודה

1. קרא את **משימות לביצוע** ב-`docs/plan.md`.
2. בחר את המשימה הראשונה ברשימה שלא מסומנת "בעבודה" או "בוצע".
3. עדכן את `docs/plan.md`: העבר את המשימה מ"לביצוע" ל"בעבודה (executor)".
4. עדכן את `executor.md`: סטטוס פעיל, "עובד על: …", הוסף ערך לוג.
5. ממש את הקוד.
6. בדוק: `cd backend && bunx tsc --noEmit` (אם נגעת ב-backend). syntax check על JS של frontend (`node --check` על הסקריפט inline).
7. עשה commit עם הודעה ברורה בעברית בפורמט `(scope): כותרת\n\n- שינוי 1\n- שינוי 2`.
8. עדכן את `docs/plan.md`: העבר את המשימה מ"בעבודה" ל"בוצעו" + reference לקומיט.
9. עדכן את `executor.md`: ערך לוג "סיימתי משימה X (commit: …)".
10. עבור למשימה הבאה.

## כשנתקעים

אם משימה דורשת **החלטה ארכיטקטונית** שלא ברורה מהתוכנית — **אסור להמציא**:

1. כתוב ב-`executor.md` ערך לוג חדש עם הסימן ❓ ופירוט הבעיה והאופציות שראית.
2. עדכן את המשימה ב-`docs/plan.md` ל"ממתין לתשובה — ראה executor.md [תאריך/שעה]".
3. **המשך** למשימה הבאה ברשימה — לא להישאר בטל.
4. אם **אין** משימות עצמאיות נוספות זמינות — סטטוס "בהפסקה" + ערך לוג "אין משימות זמינות, ממתין לתשובות".
5. כשהמתכנן יענה ב-`planner.md` (סימן ✅ + הפניה לשאלה שלך) — חזור למשימה התקועה.

## מה זה "החלטה ארכיטקטונית"?

דוגמאות שמצדיקות שאלה למתכנן:
- "התוכנית אומרת להוסיף פונקציה ב-`server.ts`, אבל אני רואה שזה משבר את ה-API הקיים. האם לרפקטר?"
- "התוכנית לא אומרת איזה event type לשלוח. שני אופציות סבירות. איזו?"
- "התוכנית מציעה גישה X אבל יש fundamental issue Z שלא דובר. האם להמשיך?"

דוגמאות ש**לא** מצדיקות שאלה:
- שמות משתנים / שמות פונקציות → תחליט סבירות.
- סדר פנימי בקובץ → תחליט.
- syntax / typing decisions → תחליט.

## כללי קוד

- TypeScript: `cd backend && bunx tsc --noEmit` חייב לעבור לפני commit.
- אסור לשבור את הקומפילציה.
- שינוי frontend: ודא syntax (`node --check` על ה-JS המוצב).
- שמור על הסגנון של AGENTS.md (Bun, vanilla JS, מינימליזם).
- אסור לכלול secrets / API keys בקוד או בקומיטים.

## כללי כתיבה לקבצים — קריטי

ראה גם את הסעיף ב-`AGENTS.md`. תקציר:

- **קובץ קיים → Edit בלבד.** אסור Write. Edit מגן מפני דריסה שקטה של שינוי של המתכנן.
- **אם Edit נכשל** — קרא מחדש (Read), מצא את הטקסט המעודכן, נסה שוב. אל תיפול ל-Write.
- **Write רק לקובץ שעוד לא קיים** (קובץ חדש).
- **עדכן "עובד על"** ב-`executor.md` לפני שאתה נוגע בקובץ — ככה המתכנן יודע ולא ייגע.

## קומיטים — אוטונומיים

- **קומיט אחרי כל שינוי משמעותי**: לפי הסקיל `commit`.
- **בלי לבקש אישור** מ-Avi (שונה מהסקיל הרגיל) — אתה מאשר את עצמך, מנסח הודעה ראויה, מקמט.
- **לפני קומיט**: עדכן את `docs/walkthrough.md` לפי הסקיל `update-walkthrough`.
- **לפני קומיט של backend**: `cd backend && bunx tsc --noEmit`.
- Avi רואה הכל ב-`git log` ובקבצי הסטטוס.

## פרוטוקול תחילת/סיום סשן

**תחילה:**
1. קרא: `AGENTS.md`, `docs/agents/README.md`, `docs/agents/executor.md` (זה הקובץ), `docs/agents/planner.md`, `docs/plan.md`, `docs/spec.md`.
2. ודא `git worktree list` שאתה ב-worktree משלך. אם לא — בקש מ-Avi להעביר.
3. עדכן את "מצב נוכחי" למטה.
4. ערך לוג "התחלתי סשן [תאריך] — קראתי מסמכים. מתחיל מ-משימה X".

**סיום:**
- עדכן סטטוס ל"סיים".
- ערך לוג "סיימתי. ביצעתי: [רשימה]. תקוע על: [שאלות פתוחות]".

---

## מצב נוכחי

- **סטטוס:** פעיל — v3 בעבודה
- **Worktree:** `/home/user/projects/voice-acp` (master)
- **עובד על:** משימה O — `backend/src/stt.ts` (Flash + prompt משופר)

## לוג

### [2026-05-14 15:20] ✅ סיימתי משימה N
מודול חדש `backend/src/recordings.ts` עם save+metadata. ConnState קיבל cwd+sessionId. `handleAudio` שומר ברקע. controlled by `VOICE_ACP_SAVE_RECORDINGS` env (default ON). `bunx tsc --noEmit` עבר.

שמתי לב ש-Avi הקים שתי tmux sessions במקביל: `voice-acp-server` ו-`voice-acp-tunnel` (כתובת חדשה `musicode-voiceacp.nue.tuns.sh`). הוא בודק empirically. hot-reload של bun יטפל בקובץ החדש אוטומטית.

עובר ל-O — המשימה האחרונה ב-v3.

### [2026-05-14 15:05] ✅ סיימתי משימה M
גלילה חכמה לפי user intent. הסרת SCROLL_THRESHOLD_PX + suppressScrollEvents. listeners על wheel/touch/keyboard/mousedown מסמנים userInteractionAt. ה-scroll handler מכבה אוטו רק אם isUser (תוך 500ms מקלט). `node --check` עבר.

עובר ל-N — שמירת הקלטות.

### [2026-05-14 14:55] ✅ סיימתי משימה L
`StreamingAudio.stop()` חדש (pause + src="" + endOfStream). `handleAudioStart` חותך thoughts פעילים ופנדינג כש-message מתחיל. `node --check` עבר.

עובר ל-M.

### [2026-05-14 14:45] ✅ סיימתי משימה K
CSS של `.thought-translation` הצטמצם ל-`display:block` + `margin-top:4px`. הוסרו padding-top/border-top/color/font-size/font-style. תרגום נראה זהה למקור. `node --check` עבר.

עובר ל-L.

### [2026-05-14 14:40] ✅ סיימתי משימה J
`translateThought` חתימה חדשה `Promise<string | null>`, כל מסלולי כישלון מחזירים null. `flushThought` ב-server מדלג ב-null (אין text_chunk, אין TTS). CLI test דרך OneCLI ירץ happy path ב-930ms. `bunx tsc --noEmit` עבר.

עובר ל-K — CSS revert.

### [2026-05-14 14:35] התחלתי v3 — קראתי את 6 המשימות J-O
ה-planner הגיש איטרציה חדשה אחרי בדיקה empirical של Avi: 6 משימות עצמאיות. סדר מומלץ J→O לפי דחיפות. גם ראיתי commit 9e36d25 שה-planner עשה לבד (hot-fix לבאג סגמנטים שני של message) — תיעוד מלא ב-planner.md, חריגה מודעת.

מתחיל מ-J — תיקון `translateThought` להחזיר null בכישלון, ו-`flushThought` לדלג.

### [2026-05-14 13:05] ✅ סיימתי משימה I + סיום v2
frontend: `dir="auto"` ב-3 נקודות: SubBubble constructor, renderToolItem (innerHTML), setHtml (iterate children). `node --check` עבר.

**סיום סשן.** בוצעו 9 משימות A-I לפי הסדר המומלץ, כל אחת קומיט נפרד עם הודעה בעברית. כל commit כולל עדכון walkthrough.md ו-plan.md (סטטוס). אין שאלות פתוחות. הצעדים הבאים: בדיקה empirical של הזרימה המלאה בריצה דרך OneCLI; פיצ'רים נוספים תחת `docs/future-features.md`.

### [2026-05-14 12:55] ✅ סיימתי משימה H
frontend: גלילה חכמה. עטיפת `#chat` ב-`#chat-wrap` (position:relative), כפתור `#jump-down`. הוספת `SCROLL_THRESHOLD_PX`, `autoScrollEnabled`, `suppressScrollEvents`. listener על scroll, `scrollChatToBottom` עם early-exit. click handler לכפתור. `node --check` עבר.

עובר ל-I — `dir="auto"` (משימת הסיום, קלה).

### [2026-05-14 12:40] ✅ סיימתי משימה G
mic button state machine מלא: 4 מצבים (idle/recording/speaking/paused) דרך `data-state`. CSS עם attribute selectors במקום class. כפתור stop חדש. helpers: getMicButtonState, updateMicButton, pauseAllAudio, resumeAllAudio, stopAllAudio. שדה `audioIsPaused`. click handler החליף לפי המצב. MutationObserver של car mode עבר ל-data-state. `node --check` עבר.

עובר ל-H — גלילה חכמה (frontend).

### [2026-05-14 12:20] ✅ סיימתי משימה F
backend: `lastUserText` + `recentMessages` ב-ConnState (FIFO 3). `handleUserInput` שומר user text. `flushMessage` מוסיף ל-recentMessages. `onToolCall(create)` עובר דרך `narrateToolCall` בתוך ttsQueue. snapshot של context ב-create. שמירת `kind: "tool_title"` ב-WebSocket — אין שינוי ב-frontend.

עובר ל-G — UI: mic button state machine.

### [2026-05-14 12:05] ✅ סיימתי משימה E
backend: `thoughtBuffer` + `flushThought()` שמתרגם דרך Gemini + מקריא דרך ElevenLabs (ttsQueue). 3 נקודות עדכון של buffers: כש-thought הסתיים (חדש message), כש-message הסתיים (חדש thought), במעבר tool_call, ובסוף ה-prompt.
frontend: שדה `hasTranslation`, `_originalEl` (span), `setThoughtTranslation()` (div מתחת ל-border). handler ל-text_chunk thought_translation שמוצא את ה-thought הראשון בלי תרגום. `handleAudioStart` תומך kind=thought (לסנכרון). `handleAudioEnd` שומר audioBase64 רק ל-message.
הסדר נשמר דרך ttsQueue ב-backend (FIFO). אין dependency חיצוני נדרש לפני F. `bunx tsc --noEmit` + `node --check` עברו.

עובר ל-F — נראציה של tool calls (תלוי ב-C: `narrateToolCall`).

### [2026-05-14 11:40] ✅ סיימתי משימה D
ב-`server.ts`: הוספתי `findSentenceBoundary` (export) ועדכנתי את ה-`onChunk` של `message` ל-loop חיתוך-וזרימה. הגנות מקיצורים ומספרים עשרוניים. forced flush ב-200. אומת ב-unit test על 8 מקרים (כולל עברית, אנגלית, Mr./Dr., 3.14, נקודתיים+\\n, forced flush). `bunx tsc --noEmit` עבר.

הזדמנות (לא ב-plan): ה-CLI test הריץ דרך `onecli run --` ועבד יפה — `translateThought` ב-829ms, `narrateToolCall` ב-607ms. learnings.md עודכן עם syntax של `onecli run --`.

עובר ל-E — תלוי ב-C (`translateThought`), שכבר קיים.

### [2026-05-14 11:25] ✅ סיימתי משימה C
יצרתי `backend/src/gemini-helper.ts`. שני שירותים: `translateThought` (timeout 2.5s, cache לפי טקסט, fallback מקורי) ו-`narrateToolCall` (timeout 1.5s, cache לפי toolCallId, fallback ל-title). withTimeout + try/catch מבטיחים שאסור שיעצרו את ה-flow.

CLI test ירץ ואומת את ה-fallback (API key לא תקף כי OneCLI לא פעיל ב-shell ישיר → טקסט מקורי חוזר). `bunx tsc --noEmit` עבר.

המודול מוכן לשימוש ב-E ו-F. עובר ל-D (עצמאית).

### [2026-05-14 11:15] ✅ סיימתי משימה B
`stt.ts`: TRANSCRIBE_PROMPT חדש עם הוראות עברית טכנולוגית + תיקוני disfluencies. שדה `previousResponse` ב-SttOptions; אם קיים נשלח כ-text part לפני האודיו עם הבהרה "do NOT transcribe this".
`server.ts`: `lastAgentMessage` ב-ConnState, נשמר ב-flushMessage, מועבר ב-handleAudio.
`bunx tsc --noEmit` עבר. ממתין לאישור empirical בשיחה — אבל פיצ'ר additive (אין רגרסיה).

עובר ל-C — יצירת `gemini-helper.ts`.

### [2026-05-14 11:05] ✅ סיימתי משימה A
הוספתי שתי שורות ל-`VOICE_SYSTEM_PROMPT` ב-`backend/src/system-prompt.ts`: דגש שהתשובה תוקרא לא תוצג, והבהרה שלמשתמש אין מסך. `bunx tsc --noEmit` עבר. עדכנתי walkthrough + plan.

עובר ל-B.

### [2026-05-14 11:00] התחלתי סשן — מתחיל ממשימה A
קראתי: `AGENTS.md`, `docs/agents/README.md`, `docs/agents/executor.md`, `docs/agents/planner.md`, `docs/plan.md`, `docs/spec.md`, `docs/walkthrough.md`. בדקתי `git log` ו-`git worktree list` — אנחנו על master, אין worktree נפרד (בהתאם להערה של המתכנן).

תוכנית: לרוץ A→I לפי הסדר המומלץ. כל משימה = commit אחד. כל commit כולל עדכון walkthrough.

מתחיל ממשימה A — חיזוק `system-prompt.ts` (5 דק', קל, להיכנס לקצב).

### [2026-05-14 09:00] קובץ נוצר
זהו קובץ stub. כש-Avi יפעיל סשן חדש לביצוע, הסוכן יעדכן את "מצב נוכחי" ויתחיל לעבוד לפי התפקיד למעלה.

# Walkthrough — voice-acp

יומן התקדמות הפרויקט. רשומה חדשה בראש הקובץ.

---

## 2026-05-14 10:45

### מבנה מחדש של `docs/plan.md` — הגשה למבצע

הסשן הראשון של המתכנן (מודל אופוס, אחרי שהוקם הפרוטוקול ב-`docs/agents/`). מטרה: לקחת את התוכנית הקיימת של v2 ולהפוך אותה לתוכנית "מוכנה לביצוע" שהמבצע יוכל לפתוח ולהתחיל לעבוד בלי שאלות מקדימות.

#### מה בוצע?

**1. שינוי מבנה של `plan.md` לפי הפורמט של `planner.md`**

הוספת הסעיפים הסטנדרטיים שהיו חסרים:
- **משימות לביצוע** (קודם נקרא "תוכנית ביצוע") — המבצע יקרא רק את זה.
- **משימות בעבודה (executor)** — ריק כרגע.
- **משימות שבוצעו** — POC v1, תיקון באג playQueue, ותשתית קואורדינציה.
- **רעיונות לדיון (טרם הוחלט)** — שני סעיפים (התראות אקטיביות, פיצול plan/discussion).
- **תוכניות ארוכות טווח / future-features** — pointer.

**2. פיצול 7 שלבים לתשע משימות אטומיות A-I**

קודם: סעיפים 1.1-7.4 עם תת-משימות. אחרי: A-I, כל אחת אטומית עם תיאור מטרה, קבצים, שינוי מדויק, דוגמאות קוד, בדיקות, והצעת commit message.

| משימה | מטרה |
|--------|------|
| A | חיזוק `system-prompt.ts` (הקראה, לא קריאה) |
| B | STT prompt טכנולוגי + העברת context מההודעה הקודמת |
| C | יצירת `gemini-helper.ts` (translateThought + narrateToolCall) |
| D | חיתוך `flushMessage` לפי גבול משפט |
| E | תרגום thoughts לעברית + הקראה |
| F | נראציה של tool calls דרך Gemini |
| G | mic button state machine — pause/resume + כפתור stop |
| H | גלילה חכמה — auto רק קרוב לתחתית + ↓ |
| I | `dir="auto"` לבועות, פריטי tools, ו-markdown HTML |

תלויות מפורשות: A/B/G/H/I עצמאיות, C חייבת לפני E/F.

**3. הסרת מידע חופף וכפילויות**

- "מצב פתיחה" של הסוכן הקודם נמחק (כבר ב-walkthrough).
- "באג playQueue" עבר מ"לביצוע" ל"שבוצע" — מקרה מיוחד: ה-walkthrough של 08:45 כבר תיעד שזה תוקן, אבל ב-plan.md הוא נשאר כמשימה 1.1. עכשיו מסודר.
- סעיף "1.2 עדכון system-prompt.ts" — היה רחב מדי. בעת בדיקה ראיתי שהקובץ הקיים כבר מכיל "סכם פלט של כלים", "בלי markdown", "בלי emojis". המשימה החדשה (A) ממוקדת רק בשתי שורות חסרות.

**4. עדכון `planner.md`**

מצב נוכחי: מוד ארכיטקט. לוג רשומה חדשה על תחילת הסשן וקריאת המסמכים.

#### החלטות שמובאות מהתכנון

- **שמירת `kind: "tool_title"` ב-F (במקום `tool_narration` חדש)** — כדי לא לשבור את ה-frontend הקיים. ה-frontend לא יודע מה הטקסט; רק על איזה צ'יים לנגן ולאיזה תור.
- **`findSentenceBoundary` עם הגנה מקיצורים** — נמנע חיתוך אחרי `Mr.`, `Dr.`, `i.e.`, `e.g.`, ובאמצע מספר עשרוני.
- **forced flush של 200 תווים** — לעברית שבה נקודות נדירות.
- **timeouts**: 2500ms ל-translateThought, 1500ms ל-narrateToolCall. אם נכשל — fallback לטקסט המקורי / title הגולמי. אף פעם לא לעצור את ה-flow.

#### צעדים הבאים

המבצע יכול עכשיו להתחיל מ-A (5 דקות, קל) כדי להיכנס לתבנית, ואז להתקדם לפי הסדר המומלץ. כשהמבצע מתחיל סשן — הוא יעדכן את `docs/agents/executor.md` ויעביר משימות מ"לביצוע" ל"בעבודה".

---

## 2026-05-14 08:45

### השלמת POC v1 — Voice interface פעיל מקצה לקצה + מסמכי תכנון ל-v2

הסשן הארוך הזה לקח את הפרויקט ממסמכי תכנון בלבד לפרויקט פועל. כל ה-stack נבנה, נבדק E2E, ונוספו פיצ'רים מעבר ל-POC המקורי של ה-spec.

#### מה בוצע?

**1. Backend — תשתית מלאה (Bun + ACP + STT + TTS)**

- `backend/src/stt.ts` — Gemini STT דרך `@google/genai` v2.2.0. Model: `gemini-flash-lite-latest`. תומך WebM/MP3/WAV/OGG/FLAC/M4A.
- `backend/src/tts.ts` — ElevenLabs REST. תחילה `eleven_multilingual_v2`, **אז עברנו ל-`eleven_v3` אחרי שהתגלה שזה היחיד שתומך עברית כראוי**.
- `backend/src/acp-bridge.ts` — `ClientSideConnection` מעל stdin/stdout של `opencode acp` (SDK v0.21.0). תומך:
  - `newSession` / `loadSession` / `listSessions`
  - streaming של chunks (`agent_message_chunk` / `agent_thought_chunk` / `user_message_chunk`)
  - `tool_call` ו-`tool_call_update` notifications
  - `setModel` (unstable)
  - YOLO permission mode (auto-approve)
- `backend/src/server.ts` — Bun native WebSocket + HTTP statics + 5 API endpoints (`/api/info`, `/api/voices`, `/api/tts`, `/api/ls`, וההגשה הסטטית).
- `backend/src/system-prompt.ts` — קבוע שמוזרק כ-prefix לprompt הראשון של כל session (בלית ברירה — ACP לא חושף role system).
- `backend/src/markdown.ts` — רינדור Markdown ל-HTML עם sanitization (regex-based, לא DOMPurify מטעמי תלות).

**2. Frontend — UI עשיר (vanilla JS, ללא build)**

- `frontend/index.html` — ממשק הצ'אט הקולי הראשי. כולל:
  - Push-to-talk עם MediaRecorder (WebM/Opus)
  - Chat bubbles: user / agent message / thought (מקופלת ב-italic) / tools (pill עם expand)
  - Streaming audio playback דרך MediaSource API (fallback ל-Blob)
  - 🔊 על כל בועת message (live + history, עם state machine: pending/ready/cold/fetching/failed)
  - 🔊 גלובלי להשמעת ההודעה האחרונה
  - היסטוריה: `history_*` events מטעינים session קיימת לבועות
  - Car mode (`?car=1`) — MediaSession API + רעש לבן ב-Web Audio API gapless loop
  - Thinking chime (G4) + Tool chime (E5→C5) דרך Web Audio
- `frontend/config.html` — דף הגדרות:
  - בחירת cwd (ידני + Folder picker modal עם breadcrumb)
  - בחירת מודל (מ-`/api/info`)
  - בחירת session קיימת (מ-`/api/info`)
  - בחירת voice (מ-`/api/voices`, ממוין: ברירת מחדל → תומכי עברית 🇮🇱 → premade)
  - Car mode checkbox
  - שמירה ב-localStorage

**3. Streaming TTS — pipeline מקצה לקצה**

- ב-backend: `streamCachedTextToSpeech` עם ReadableStream של ElevenLabs.
- WebSocket events חדשים: `audio_start` → `audio_chunk`* → `audio_end` (החליפו את ה-`audio_ready` הישן ל-live).
- `audio_ready` נשאר כ-legacy לתאימות בלבד (משמש דרך `/api/tts` ל-bubbles בהיסטוריה).
- ב-frontend: class `StreamingAudio` שמשתמש ב-MediaSource API לניגון progressive; fallback ל-Blob אם MSE לא נתמך.
- Cache פנימי (`ttsCache` ב-`tts.ts`) — key: `voiceId|modelId|text`, in-memory Map.

**4. Per-segment TTS**

- `flushMessage()` ב-server מפצל את תשובת המודל לקטעים על מעבר kind (message → thought / tool_call).
- כל קטע נשלח בנפרד ל-TTS, ה-queue ב-backend (`ttsQueue`) שומר על סדר.
- ה-frontend מנגן progressively לפי הסדר.
- גם כותרות tool calls (`event.title`) מוקראות כקטע מסוג `tool_title` עם צ'יים מקדים.

**5. תכנון v2 — שני מסמכים חדשים**

- `docs/plan.md` — תוכנית מפורטת ל-v2 (7 שלבים): שיפור פרומפטים, gemini-helper.ts (תרגום מחשבות + נראציה של tool calls), חיתוך לפי משפט, UI שדרוגים (mic button state machine, גלילה חכמה, dir="auto").
- `docs/future-features.md` — 16 פיצ'רים נדחים. 11 ראשונים כיסו את הרעיונות מהשיחה (קול משני למחשבות, VAD + Gemini interruption, worktree workflow, bash command details, permission UI, auth + TLS, replay של תור, thinking sound כקובץ, streaming TTS משפט-משפט כבר חלקית, tool output summary, supermemory). 5 נוספים תרם הסוכן המקביל מתוך תובנות שצצו תוך כדי בנייה: full input streaming ל-ElevenLabs WS, per-segment WS isolation לחוסן, iOS Safari car mode דרך PWA, TTS cache עם LRU ו-disk persistence, צליל מעבר message+טעינה אוטומטית של תיקייה+markdown sanitization ל-TTS.

**6. תיקון באג — `playQueue` residual**

ב-`frontend/index.html`, ב-handlers של `done` ו-`error` הייתה התייחסות ל-`playQueue.length === 0` — משתנה שהוסר עם המעבר ל-streaming. שגיאת runtime שתופסת רק במקרה של זרימה ספציפית. תוקן ל-`!currentStream && streamOrder.length === 0`.

#### החלטות ארכיטקטורה

- **`eleven_v3` בלבד לעברית** — לפי `/v1/models`, רק v3 כולל `language_id: "he"`. v2 ("multilingual") אומר שתומך אבל בפועל מבטא עברית מסולפת לחלוטין דרך ה-API. v3 גם מהיר וקטן יותר (61KB לעומת 249KB לאותו משפט). תועד ב-`~/.config/opencode/learnings.md`.
- **Streaming TTS על per-segment, לא משפט-משפט** — לא חיתוך בתוך פסקה אחת לסגמנטים קטנים יותר. נדחה ל-v2.
- **Markdown ב-backend, לא ב-frontend** — כדי שה-frontend ישאר פשוט (innerHTML של HTML מוכן). sanitization בצד server.
- **Thoughts לא מוקראות** — `agent_thought_chunk` הוא reasoning פנימי, יכול להיות אלפי תווים. אם מודל חזר רק ב-thought ולא message, מוצגת שגיאה במקום fallback לתוך thought. הקראת thoughts תרגום-לעברית נדחתה ל-v2 (תועד ב-plan.md).
- **System prompt כ-prefix לprompt ראשון, לא ניסיון לזייף role: system** — ACP לא חושף system message. ה-pragmatic approach: prefix לטקסט המשתמש בקריאה הראשונה, עם flag `firstPromptSent`. בהיסטוריה ה-prompt כבר חלק מהדאטה.
- **Car mode עם רעש לבן ב-amplitude נשמע** — שקט מוחלט (samples=0) לא מפעיל MediaSession בדפדפנים מסוימים. עברנו ל-amplitude קטן (gain=0.015) שלא נשמע בפועל אבל מספיק שהדפדפן יזהה אודיו פעיל.

#### מעקפים ופתרונות

- **OpenCode ACP מחזיר תשובה רק ב-thought** — לפעמים, על שאלות עם הגבלות אגרסיביות ("ענה במילה אחת"), המודל "חושב את התשובה" בלי לכתוב אותה כ-message. הניסיון לעשות fallback (להציג את ה-thought) נכשל כי thoughts יכולים להיות אלפי תווים של reasoning. הפתרון: שולחים `sendError` מנומס למשתמש ("המודל לא ענה, נסה לנסח אחרת"), בלי TTS.
- **Web streams מ-Node streams** — ה-SDK של ACP מצפה ל-`WritableStream<Uint8Array>` ו-`ReadableStream<Uint8Array>` של Web, אבל `spawn` של node מחזיר Node streams. השימוש ב-`Writable.toWeb` / `Readable.toWeb` מגשר.
- **`protocolVersion` הוא `1` ולא `"0.1"`** — ה-spec המקורי טעה. בפועל זה מספר.
- **טיפול ב-`audio_ready` שמגיע אחרי `done`** — ה-TTS queue ממשיכה לרוץ אחרי שה-prompt הסתיים. ה-frontend מטפל ב-`audio_ready` גם כש-`currentTurn === null` על-ידי שימוש ב-`turns[turns.length - 1]` כ-fallback.

#### צעדים הבאים

לפי `docs/plan.md` — מתחילים ב-v2:
1. עדכון system prompt + STT prompt.
2. יצירת `backend/src/gemini-helper.ts` — `translateThought` + `narrateToolCall`.
3. חיתוך לפי משפט ב-`flushMessage`.
4. Thought streaming + TTS עם תרגום.
5. Tool narration (Gemini במקום מיפוי קשיח).
6. UI: mic button state machine (pause/resume + stop), גלילה חכמה, dir="auto".

---

## 2026-05-13 22:37

### השלמת שלב התכנון — מפרט מוכן לבנייה

הסשן הזה לא כלל כתיבת קוד; כולו תכנון ועיגון החלטות במסמכים. הפרויקט מוכן עכשיו לסשן בנייה של ה-POC.

#### מה בוצע?

**1. אישור הארכיטקטורה הכוללת**

- `Browser → WebSocket → Bun backend → opencode acp (child process)`
- Frontend: HTML בודד עם vanilla JS, בלי build step.
- Backend: Bun native WebSocket, ללא framework.
- ACP: `@agentclientprotocol/sdk` v0.16.1, `ClientSideConnection` מעל stdin/stdout של `opencode acp`.

**2. בחירת ספקי STT/TTS**

- **STT — Gemini** (במקום Whisper). הסיבה: לפי המשתמש, Gemini מתמלל עברית "עם הרבה יותר הגיון מ-Whisper".
- **TTS — ElevenLabs** דרך REST (fetch ישיר, בלי SDK — overhead מיותר ל-POC).
- אימות שני המפתחות בוצע בסשן: ElevenLabs פעיל (חשבון `creator`, ~277k תווים); Gemini פעיל.

**3. עדכון מודל ה-STT ל-alias של הגרסה האחרונה**

- `gemini-2.0-flash` → `gemini-flash-lite-latest`.
- ה-alias מתעדכן אוטומטית, לא נועל גרסה.
- Flash Lite מספיק ל-STT (מהיר וזול יותר מ-Flash הרגיל).

**4. מעבר לניהול מפתחות דרך OneCLI**

- אין יותר קובץ `backend/.env` למפתחות.
- הקוד מאתחל SDKs עם המחרוזת `"placeholder"`; OneCLI proxy מחליף את ה-headers בדרך לhosts הרלוונטיים.
- ה-env var היחיד שנשאר הוא `ELEVENLABS_VOICE_ID` (חלק מה-URL, לא header).
- `spec.md §6, §10` ו-`AGENTS.md` עודכנו בהתאם.

#### החלטות ארכיטקטורה

- **STT דרך Gemini ולא Whisper** — בחירת איכות לעברית על פני סטנדרט תעשייתי. ההפרדה ב-`stt.ts` שומרת שניתן יהיה להחליף בעתיד בקלות.
- **OneCLI proxy במקום `.env`** — מונע שמירת secrets בקוד או בקבצים מקומיים. הקוד שולח placeholder, ה-proxy מזריק את המפתח האמיתי לפי host. יתרון: אותו קוד עובד אצל כל מי שיש לו OneCLI עם ה-secrets הנכונים.
- **`gemini-flash-lite-latest` alias** — מתעדכן אוטומטית לדור הבא; אין צורך לתחזק גרסה.
- **REST ישיר ל-ElevenLabs, בלי SDK** — קריאת `POST` אחת עם טקסט → MP3. SDK יוסיף תלות בלי תועלת ל-POC.
- **דחיות מודעות ב-POC**: streaming TTS (מחכים לתשובה מלאה), permission dialogs (ACP במצב yolo — אישור אוטומטי).

#### מצב הקבצים בסוף השלב

- `README.md` — תיאור קצר + פקודות הפעלה.
- `AGENTS.md` — הוראות סוכן: מבנה, חוקי עבודה, definition of done; מעודכן ל-OneCLI.
- `docs/spec.md` — מפרט מלא: ארכיטקטורה, פרוטוקול WebSocket, stubs ל-`acp-bridge`/`stt`/`tts`/`server`, URL params, state machine של הכפתור, סדר בנייה מוצע.
- `docs/walkthrough.md` — הקובץ הזה.

#### צעדים הבאים

הסשן הבא: פתיחת הפרויקט והתחלת בנייה לפי סדר ה-13 ב-spec (התקנה → backend skeleton → STT/TTS → ACP bridge → frontend).

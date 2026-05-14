# Plan — שיפורי v2 ל-voice-acp

> תוכנית עבודה מפורטת לסשן הבנייה הנוכחי. כל סעיף כולל: מה לעשות, איפה, ומה התלויות.
> אחרי השלמה, להעביר את הסעיפים הרלוונטיים ל-`spec.md` ולהעיף תיוג מ-`future-features.md`.

---

## עקרון מנחה

**Gemini Flash Lite = שכבת הנגשה אודיו.** בכל מקום שטקסט מהמערכת לא נשמע טבעי — מעבירים ל-Gemini במקום לבנות לוגיקה ייעודית. זול, מהיר, גנרי.

המודולים שייווצרו מתחת לעקרון הזה:

```
backend/src/gemini-helper.ts (חדש)
├── translateThought(englishText) → hebrew
├── narrateToolCall(context, toolCall) → hebrew sentence
└── (עתידי, ב-future-features) shouldInterrupt(...)
```

---

## מצב פתיחה (15 במאי 2026, אחרי סיום הסוכן הקודם)

הסוכן הקודם השלים:
- Streaming TTS — `audio_start` / `audio_chunk` / `audio_end` (MediaSource API ב-frontend, fallback ל-blob).
- Markdown rendering בצד שרת — `message_rendered` נשלח עם HTML מנוקה.
- Folder picker modal — `/api/ls` + UI עם breadcrumb.

קוד פתוח שעוד לא קומט: כל `backend/` ו-`frontend/` (untracked). יש שינוי לא־staged ב-`spec.md` (eleven_v3).

### באג שזיהיתי בקוד הקיים

ב-`frontend/index.html` שורות 1195 ו-1203 — תנאי `playQueue.length === 0` מתייחס למשתנה שהוסר עם המעבר ל-streaming. צריך להחליף ב-`streamOrder.length === 0` או דומה.

---

## תוכנית ביצוע

### שלב 1 — תוכן ופרומפטים

**1.1 — תיקון באג `playQueue`**
- קובץ: `frontend/index.html`
- הסרת ההתייחסות ל-`playQueue` (לא קיים יותר). להחליף ב-`streamOrder.length === 0 && !currentStream && !currentlyPlaying`.

**1.2 — עדכון `system-prompt.ts`**
- הוספת ההוראות הבאות:
  - "תחשוב איך זה נשמע, לא איך זה נראה בקריאה."
  - "כל פלט שלך יוקרא דרך TTS. הנח שאין למשתמש מסך."
  - "סכם פלט של כלים בקצרה. אל תצטט אותם."
- חיזוק ההוראה הקיימת לגבי בלי טבלאות / קוד / emojis / רשימות עם bullets.

**1.3 — עדכון `stt.ts`**
- prompt חדש:
  - "המשתמש מדבר עברית בהקשר של פיתוח תוכנה."
  - "אם מילה לא ברורה — העדף פירוש טכנולוגי הגיוני על פני literal."
  - "תקן disfluencies מובהקות (חזרות, "אה", שגיאות הגייה ברורות)."
  - "פלט: רק התמלול. אם שקט/לא מובן — מחרוזת ריקה."
- חתימת הפונקציה תקבל פרמטר אופציונלי `previousResponse?: string` שייכלל בקונטקסט של ה-prompt.

**1.4 — חיבור context ל-STT**
- קובץ: `backend/src/server.ts`
- ConnState יקבל שדה חדש `lastAgentMessage: string | null`.
- בכל `flushMessage()` של live response — לשמור את הטקסט.
- ב-`handleAudio` — להעביר את `state.lastAgentMessage` ל-`transcribeAudio`.

---

### שלב 2 — `gemini-helper.ts`

**2.1 — מבנה הקובץ**

```
gemini-helper.ts
├── instance יחיד של GoogleGenAI (כמו ב-stt.ts)
├── DEFAULT_MODEL = "gemini-flash-lite-latest"
├── translationCache: Map<string, string>
├── narrationCache: Map<string, string> (key = toolCallId)
│
├── translateThought(text): Promise<string>
└── narrateToolCall(ctx, toolCall): Promise<string>
```

**2.2 — `translateThought`**
- Prompt:
  ```
  Translate the following English text into natural spoken Hebrew, suitable
  for being read aloud through TTS. Output ONLY the Hebrew translation —
  no commentary, no quotes, no English.
  ```
- Cache לפי טקסט אנגלי (מחשבות חוזרות נפוצות).
- Fallback: אם נכשל, להחזיר את הטקסט המקורי (כדי שתמיד תהיה הקראה).

**2.3 — `narrateToolCall`**
- קלט: `{ userMessage, recentMessages: string[], toolCall: { kind, title, rawInput? } }`.
- Prompt:
  ```
  You are narrating a coding assistant's actions out loud in Hebrew.
  Given the user's request and recent assistant context, describe in ONE short
  conversational Hebrew sentence what the assistant is about to do — and WHY
  in this context. Don't list parameters; explain the intent.
  
  Examples:
  - Tool: read README.md  → "עכשיו אני בודק את ה-README כדי לראות מה הפרויקט"
  - Tool: bash "ls"        → "אני מציץ מה יש בתיקייה"
  - Tool: edit hello.js    → "מעדכן את הפונקציה שדיברנו עליה"
  
  Output ONLY the Hebrew sentence.
  ```
- Cache לפי `toolCallId` (כל call מתואר פעם אחת).
- אם הקריאה לוקחת > 1500ms — להמשיך בלי לחכות, ולעבור ל-fallback (title גולמי).

---

### שלב 3 — חיתוך לפי משפט

**3.1 — שדרוג `flushMessage` ב-`server.ts`**
- היום: flush רק על מעבר kind (message → thought / tool_call).
- שיפור: בתוך זרם message, להפעיל flush גם בסוף משפט.
- חוקי חיתוך (regex):
  - `[.!?]\s` (נקודה / שאלה / קריאה + רווח)
  - `\n\n+` (שורה ריקה)
  - `:\s` (נקודתיים + רווח — הפסקה לפני רשימה)
  - או 200 תווים בלי גבול טבעי (forced flush).
- ב-buffer צריך לקרוא את הregex רק בסוף chunk כדי לא לחתוך באמצע מספר/קיצור (`Mr.`).
- **חשוב**: לא לחתוך פסקה שכוללת רק עברית — שם נקודות פחות נפוצות, אז הגבול של 200 תווים תופס שם.

---

### שלב 4 — Thought translation + TTS

**4.1 — Backend (`server.ts`)**
- `ServerMessage` חדש: `audio_start.kind` יכלול `"thought"` בנוסף ל-`"message"` / `"tool_title"`.
- buffer חדש: `thoughtBuffer` (במקביל ל-`messageBuffer`).
- `flushThought()` — דומה ל-`flushMessage`:
  1. תרגום דרך `gemini-helper.translateThought`.
  2. שליחת `text_chunk` עם `kind: "thought_translation"` ל-frontend (טקסט עברי).
  3. `queueTts(translatedText, "thought")`.
- `onChunk` עבור `kind === "thought"`:
  - לצבור ב-`thoughtBuffer`.
  - flush לפי גבולות משפט (כמו ב-message) **או** על מעבר ל-message / tool_call.

**4.2 — Frontend (`index.html`)**
- `ServerMessage` חדש `text_chunk.kind = "thought_translation"` → להוסיף שורה חדשה לבועת thought.
- בועת thought תכיל שתי שורות מובחנות:
  - שורה 1 (קטן, מעומעם, italic): טקסט אנגלי מקור.
  - שורה 2 (גדול יותר, ברור, עברית): התרגום.
  - מפריד עדין ביניהן.
- `handleAudioStart` עם `kind === "thought"` — לקשור ל-bubble thought (לא message).
- צ'יים שונה (אופציונלי, כרגע אותו צ'יים).

---

### שלב 5 — Tool narration + TTS

**5.1 — איסוף context ב-`server.ts`**
- ConnState יקבל:
  - `lastUserText: string` — הודעת המשתמש האחרונה (transcript).
  - `recentMessages: string[]` (limit 3 אחרונות) — flushed messages של ה-agent בתור הזה.

**5.2 — שינוי `onToolCall`**
- היום: `queueTts(event.title.trim(), "tool_title")`.
- חדש: עוטף ב-async:
  1. אם זה create — `narrate = await narrateToolCall({...}, event)`.
  2. `queueTts(narrate, "tool_narration")`.
- אם narration נכשל / timeout — fallback ל-`event.title`.

**5.3 — Frontend**
- `audio_start.kind = "tool_narration"` — מתנהג כמו tool_title (אותו צ'יים, אותה queue).

---

### שלב 6 — UI שדרוגים

**6.1 — Mic button state machine (חדש מההודעה האחרונה)**

State machine מעודכן:

```
idle      ──click──► recording
recording ──click──► idle (sends audio)
speaking  ──click──► paused
paused    ──click──► speaking
```

מצב `speaking` = יש `currentStream` או `currentlyPlaying` פעיל.
מצב `paused` = audio.pause() נקרא, אבל ה-audio object עדיין חי.

עיצוב כפתור:
- idle: 🎙 (כחול)
- recording: ⏺ (אדום, פועם)
- speaking: ⏸ (אדום עדין, ללא פעימה)
- paused: ▶ (כחול עם הילה)

**כפתור Stop קטן** ליד הכפתור הגדול (החלפת מקום עם replay-last):
- מוצג רק במצבי speaking/paused.
- לחיצה: עוצר את כל ה-streams, מנקה queue, חוזר ל-idle.
- replay-last מועבר למיקום שני (או נמחק — נראה).

קוד:
- פונקציה `getMicButtonState()` שמחזירה `'idle'|'recording'|'speaking'|'paused'`.
- בכל שינוי ב-`currentStream`/`currentlyPlaying`/`isRecording` — לקרוא `updateMicButton()`.
- ב-StreamingAudio נוסיף `pause()` ו-`resume()` (resume = `this.audio.play()`).

**6.2 — גלילה חכמה**

```js
const SCROLL_THRESHOLD_PX = 60;
let autoScrollEnabled = true;
let suppressScrollEvents = false;

chatEl.addEventListener("scroll", () => {
  if (suppressScrollEvents) return;
  const distance = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  autoScrollEnabled = distance <= SCROLL_THRESHOLD_PX;
  jumpDownBtn.classList.toggle("visible", !autoScrollEnabled);
});

function scrollChatToBottom() {
  if (!autoScrollEnabled) return;
  suppressScrollEvents = true;
  chatEl.scrollTop = chatEl.scrollHeight;
  requestAnimationFrame(() => { suppressScrollEvents = false; });
}
```

UI:
- כפתור צף "↓" בפינה ימנית-תחתונה של ה-chat (לא ה-page).
- מוצג רק כש-`autoScrollEnabled === false`.
- לחיצה: גלילה לתחתית + מחזיר auto.
- אנימציית fade-in/out.

**6.3 — `dir="auto"` לכל הבועות**

ב-`SubBubble` constructor:
```js
this.bubbleEl.setAttribute("dir", "auto");
```

ב-`renderToolItem`:
```js
item.querySelector("span:last-child").setAttribute("dir", "auto");
```

ב-`setHtml` (כדי שגם HTML של markdown יקבל) — להוסיף `dir="auto"` על top-level children:
```js
setHtml(html) {
  this.hasHtml = true;
  this.bubbleEl.innerHTML = html;
  for (const child of this.bubbleEl.children) {
    if (!child.hasAttribute("dir")) child.setAttribute("dir", "auto");
  }
}
```

---

### שלב 7 — סיום

**7.1 — בדיקה ידנית**
- restart לserver.
- E2E בדפדפן: שאלה → תמלול → השמעה → ראייה של thought translation + tool narration + מצב pause.
- בדיקה של גלילה חכמה.
- בדיקה של RTL/LTR.

**7.2 — עדכון `spec.md`**
- הוספת סעיפים על gemini-helper.
- עדכון ServerMessage types.
- הוספת state machine של mic button.

**7.3 — עדכון `walkthrough.md`**
- רשומה חדשה למצב v2 הזה.

**7.4 — Commit**
- כל הקבצים החדשים + עדכונים.
- הודעת קומיט בעברית, מפורטת.

---

## תלויות בין שלבים

```
1 (prompts) ──┐
              ├─► 3 (sentence cut) ──┐
2 (helper) ───┤                      ├─► 4 (thought) ──┐
              └──► 5 (narration) ────┘                 │
                                                       ├─► 7 (test+commit)
6.1 mic state ─────────────────────────────────────────┤
6.2 scroll    ─────────────────────────────────────────┤
6.3 dir       ─────────────────────────────────────────┘
```

- שלבים 1, 2, 6.x מקבילים (אפשר לעבוד עליהם בכל סדר).
- שלב 3, 4, 5 דורשים את 1+2.
- שלב 7 אחרון.

---

## הערכת זמן (גס)

| שלב | זמן |
|------|-----|
| 1 (prompts) | 15 דק' |
| 2 (gemini-helper) | 30 דק' |
| 3 (sentence cut) | 20 דק' |
| 4 (thought) | 40 דק' |
| 5 (narration) | 30 דק' |
| 6.1 (mic state) | 35 דק' |
| 6.2 (scroll) | 20 דק' |
| 6.3 (dir) | 10 דק' |
| 7 (commit+docs) | 20 דק' |
| **סה"כ** | **~3.5 שעות** |

---

## הסכמות שמובאות מהתכנון (מקובע)

1. תצוגת thought: **שתי שפות** — אנגלית מקור (קטן/אפור) + תרגום עברי (בולט). מפריד עדין.
2. Bash commands ב-narration: **לא** מזכירים את הפקודה עצמה — רק את התכלית.
3. STT עם context: **כן** — מצרפים את הודעת המודל הקודמת לprompt התמלול.
4. Voice ל-thoughts: **אותו voice** של המסר הראשי. ה-toggle לקול שני נדחה ל-future-features.

---

## רעיונות לדיון (לא חלק מתוכנית הביצוע הקיימת)

> סעיף שנוסף ע"י Avi בסיבוב הבא, אחרי שעלו רעיונות שצריך לדון בהם ולסגור החלטות לפני ביצוע. בניגוד לתוכנית למעלה, כאן עדיין אין הסכמה סופית.

### א. ארכיטקטורת קואורדינציה בין סוכנים

**הקשר:** עוברים למודל של מתכנן בסשן אחד + מבצע בסשן אחר, כל אחד ב-worktree משלו. כדי שלא ידרסו אחד את השני, צריך פרוטוקול ברור.

**מה כבר עשינו (בסיבוב הזה):**
- יצרנו `docs/agents/` עם פרוטוקול ראשוני: כל סוכן כותב לקובץ שלו בלבד.
- הוספנו ל-`AGENTS.md` סעיף "פרוטוקול עבודה מקבילית".
- יצרנו קבצי stub `planner.md` ו-`executor.md`.

**שאלות פתוחות לדיון:**
1. האם מספיק קובץ אחד לכל סוכן, או שכדאי גם קבצי append-only ייעודיים לשאלות/תשובות?
2. איך המשתמש (Avi) מקבל **התראה** על שאלה מהמבצע? כרגע — `tail -f`. אם זה לא מספיק, צריך לחשוב על:
   - notification דרך ה-OS (Linux desktop notifications, ntfy.sh, וכו')
   - דחיפה ל-voice-acp עצמו (האזנה לקבצים ושליחה דרך WebSocket)
   - polling פשוט מצד המשתמש (פתוח בטרמינל)
3. מה קורה אם בכל זאת שני סוכנים מנסים לכתוב לאותו קובץ (באג בפרוטוקול)?
   - הסתמכות על אטומיות של append-only writes < 4KB (POSIX).
   - הוספת `flock` או `write-temp-then-rename`.
   - בשלב POC: לא לטפל, רק לזהות ולעצור.

### ב. הוראות מבצע מובנות יותר בפרומפט

**הקשר:** כשהמבצע נתקע בשאלה עקרונית, מה הוא צריך לעשות?

**הסכמה ראשונית (לחיזוק):**
- **לעצור רק עם הנושא הספציפי שתקוע**, להמשיך עם משימות אחרות שאינן תלויות בו.
- לכתוב את השאלה לקובץ שלו ב-`docs/agents/` עם הסימן ❓.
- לא להמציא ארכיטקטורה — אם משהו לא ברור, לשאול ולא להחליט מיוזמתו.
- אם **אין** משימות עצמאיות זמינות בכלל — לעצור לגמרי עם סטטוס "בהפסקה".

**נכנס ל-`AGENTS.md`** (סעיף "פרוטוקול עבודה מקבילית").

### ג. הפרדה ברורה בין "תוכנית ביצוע" ל"רעיונות לדיון"

**הקשר:** `plan.md` היום מכיל גם תוכנית מפורטת (סעיפים 1-7) וגם את הרעיונות החדשים (הסעיף הזה). יש סיכון של בלבול — המבצע יחשוב שהרעיונות לדיון הם משימה לבצע.

**הצעות:**
- להשאיר את החלוקה כפי שהיא (התוכנית למעלה, רעיונות בסוף) — הכותרת מבדילה.
- להפריד לקבצים: `plan.md` (אקטיבי) + `discussion.md` (טיוטות).
- להשאיר הכל ב-plan.md ולסמן בכל סעיף **"לביצוע"** / **"לדיון"** / **"דחוי"**.

**אין החלטה עדיין.** המבצע צריך לקרוא **רק** את הסעיפים שמסומנים "לביצוע".

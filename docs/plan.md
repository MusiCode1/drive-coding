# Plan — voice-acp v2

> תוכנית עבודה אקטיבית. **המבצע קורא רק את הסעיף "משימות לביצוע"**.
> ארכיטקטורה כללית: `docs/spec.md`. רעיונות נדחים: `docs/future-features.md`.

---

## מצב נוכחי (2026-05-14)

POC v1 הושלם וקומט. ה-stack פעיל E2E: WebSocket + ACP + Gemini STT + ElevenLabs TTS + streaming, פיצול sub-bubbles, היסטוריה, car mode. ראה `docs/walkthrough.md` 2026-05-14.

**v2 = שכבת הנגשה אודיו.** עיקרון מנחה: בכל מקום שטקסט מהמערכת לא נשמע טבעי — Gemini Flash Lite מתרגם/מנסח במקום לוגיקה ייעודית. גנרי, זול, מהיר.

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

> כל משימה אטומית — אפשר לקחת אחת ולעשות commit נפרד. סדר ביצוע מומלץ A→I. A/B/G/H/I עצמאיות (ניתן במקביל). C חייבת לפני E/F.
> בכל משימה: **commit יחיד**, הודעה בעברית, פורמט `(scope): כותרת\n\n- שינוי 1\n- שינוי 2`.

---

### A. חיזוק `system-prompt.ts` (קל)

**מטרה:** לחזק את ההוראה למודל לחשוב על הקראה ולא על תצוגה.

**קובץ:** `backend/src/system-prompt.ts`

**שינוי:** להוסיף שתי שורות לסעיף "חוקי תגובה" של `VOICE_SYSTEM_PROMPT` (אחרי השורה "כל מה שאתה כותב בתור תשובה (לא thinking) יוקרא בקול..."):

```
- תחשוב על איך התשובה שלך נשמעת, לא איך היא נראית בקריאה על מסך.
- המשתמש שומע אותך, לא קורא. אין לו מסך מולו.
```

**שים לב:** הקובץ כבר מכיל "אם פלט של כלי ארוך — סכם בקצרה" ו"בלי טבלאות / קוד / markdown" — לא לכפול.

**בדיקה:** `cd backend && bunx tsc --noEmit`. שינוי טקסט בלבד, אמור לעבור מיד.

**Commit suggestion:** `(prompts): חיזוק system prompt — דגש על הקראה ולא קריאה`

---

### B. שדרוג STT prompt + העברת context

**מטרה:** תמלול עברי טכנולוגי יותר מדויק. שימוש בהודעה הקודמת של המודל כ-disambiguation context.

**קבצים:**
- `backend/src/stt.ts` — שינוי פרומפט וחתימה
- `backend/src/server.ts` — שמירת `lastAgentMessage` והעברתו

**B.1 — `stt.ts`:**

החליפי את `TRANSCRIBE_PROMPT` הנוכחי בפרומפט חדש:

```
The user is speaking Hebrew in a software development context.
Transcribe the audio exactly as spoken, with minor corrections:
- If a word is unclear, prefer a sensible technological interpretation
  (e.g. "ריאקט" over "ראקת", "באג" over "בק").
- Fix obvious disfluencies (repetitions, "אה אה", false starts).
- Preserve the original language (Hebrew or English).

Output ONLY the transcription itself — no introductions, no quotes,
no explanations, no formatting. If the audio is silent or unintelligible,
return an empty string.
```

הוסיפי שדה אופציונלי ל-`SttOptions`:
```ts
/** הודעת המודל הקודמת — תיכלל כקונטקסט לתמלול מדויק יותר. */
previousResponse?: string;
```

אם `previousResponse` הועבר, להוסיף כ-text part *לפני* האודיו:
```ts
contents: createUserContent([
  ...(opts.previousResponse ? [`Recent assistant message (for context only — do NOT transcribe this): "${opts.previousResponse}"`] : []),
  createPartFromBase64(audioBase64, mimeType),
  prompt,
])
```

**B.2 — `server.ts`:**

ב-`ConnState` (סביב שורה 86) הוסיפי שדה:
```ts
lastAgentMessage: string | null;
```
ואתחול ל-`null` ב-`open` handler.

ב-`flushMessage` (בתוך `handleUserInput`, סביב שורה 383), אחרי `totalMessageChars += t.length`:
```ts
state.lastAgentMessage = t;
```
(שמירת ה-flush האחרון מספיקה; לא צריך לצבור.)

ב-`handleAudio` (סביב שורה 315), בקריאה ל-`transcribeAudio`:
```ts
const transcript = await transcribeAudio(msg.data, {
  mimeType: msg.mimeType ?? "audio/webm",
  previousResponse: state.lastAgentMessage ?? undefined,
});
```

**בדיקה:** `bunx tsc --noEmit` חובה. בדיקה ידנית: שיחה של 2-3 פניות עוקבות — לוודא שהקונטקסט עוזר על מילים דו-משמעיות.

**Commit suggestion:** `(stt): פרומפט מהוקצע לעברית טכנולוגית + context מההודעה הקודמת`

---

### C. יצירת `backend/src/gemini-helper.ts`

**מטרה:** מודול עזר משותף — translateThought + narrateToolCall עם caching ו-timeouts.

**קובץ חדש:** `backend/src/gemini-helper.ts`

**שלד:**

```ts
import { GoogleGenAI, createUserContent } from "@google/genai";

const DEFAULT_MODEL = "gemini-flash-lite-latest";
const TRANSLATE_TIMEOUT_MS = 2500;
const NARRATE_TIMEOUT_MS = 1500;

const ai = new GoogleGenAI({ apiKey: "placeholder" });

const translationCache = new Map<string, string>();
const narrationCache = new Map<string, string>();  // key = toolCallId

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}
```

**C.1 — `translateThought(text: string): Promise<string>`:**

- אם `translationCache.has(text)` → החזר מיד.
- אחרת: קריאה ל-Gemini עם הפרומפט:
  ```
  Translate the following text into natural spoken Hebrew, suitable for
  being read aloud through TTS. Output ONLY the Hebrew translation —
  no commentary, no quotes, no English, no markdown.

  Text:
  <text>
  ```
- timeout: `TRANSLATE_TIMEOUT_MS`. ב-fail/timeout → החזר את הטקסט המקורי (fallback).
- שמרי תוצאה מוצלחת ב-cache.

**C.2 — `narrateToolCall(ctx, tool): Promise<string>`:**

חתימה:
```ts
export interface NarrateContext {
  userMessage: string;
  recentMessages: string[];   // עד 3 אחרונות, סדר כרונולוגי
}
export interface ToolCallForNarrate {
  toolCallId: string;
  kind?: string;              // read/edit/execute/search/think/...
  title: string;
}
```

- אם `narrationCache.has(toolCallId)` → החזר מיד.
- אחרת: פרומפט:
  ```
  You are narrating a coding assistant's actions out loud in Hebrew.
  Given the user's request and recent context, describe in ONE short
  conversational Hebrew sentence what the assistant is about to do —
  and WHY in this context. Don't list parameters; explain the intent.
  Don't repeat the user's words verbatim.

  Examples:
  - Tool: read README.md          → "אני בודק את ה-README כדי לראות מה הפרויקט"
  - Tool: execute bash "ls"       → "אני מציץ מה יש בתיקייה"
  - Tool: edit hello.js           → "מעדכן את הפונקציה שדיברנו עליה"
  - Tool: execute "npm run build" → "מריץ build לראות שאין שגיאות"

  User said: "<userMessage>"
  Recent assistant context: <recentMessages.join(" · ") or "—" אם ריק>

  Tool: <kind ?? "?"> — <title>

  Output ONLY the Hebrew sentence (no quotes, no markdown).
  ```
- timeout: `NARRATE_TIMEOUT_MS`. ב-fail/timeout → החזר את ה-`title` הגולמי.
- שמרי לפי `toolCallId`.

**CLI test block (אופציונלי, לבדיקה עצמאית):**
```ts
if (import.meta.main) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("שימוש: bun src/gemini-helper.ts <english text>");
    process.exit(1);
  }
  const start = Date.now();
  const result = await translateThought(arg);
  console.log(`(${Date.now() - start}ms): ${result}`);
}
```

**בדיקה:** `bunx tsc --noEmit`. אחרי כתיבה, להפעיל את ה-CLI test:
```bash
cd backend && bun src/gemini-helper.ts "I should check the README first to understand the project."
```
פלט צפוי: משפט עברי טבעי.

**Commit suggestion:** `(gemini-helper): מודול עזר לתרגום מחשבות ונראציה של tool calls`

---

### D. חיתוך לפי משפט ב-`flushMessage`

**מטרה:** קטעי TTS קצרים יותר → אודיו מתחיל מהר יותר, חוויית streaming טבעית.

**קובץ:** `backend/src/server.ts` (בתוך `handleUserInput`)

**מצב היום:** `flushMessage` מתבצע רק על מעבר kind (message → thought / tool_call) או סוף תור. תשובה ארוכה = קטע ארוך אחד.

**שינוי:** לזהות גבול משפט בתוך `messageBuffer` בכל קבלת chunk, ולעשות flush אם מצאנו גבול.

**מימוש:**

הוסיפי פונקציית עזר:
```ts
function findSentenceBoundary(s: string): number {
  // מחזיר אינדקס *אחרי* הגבול האחרון, או -1 אם אין.
  // בודק (מסוף הbuffer חזרה) את הסימנים: .!? + רווח, : + רווח, \n\n.
  // לא חותך אם הנקודה אחרי קיצור (Mr.) או באמצע מספר (3.14).
  const patterns = [
    /[.!?][\s\n]/g,
    /:\s/g,
    /\n\n+/g,
  ];
  let last = -1;
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
      const end = m.index + m[0].length;
      // בדיקת קיצורים — אם לפני הנקודה יש "Mr"/"Dr"/"vs" וכו' — דלג
      if (m[0][0] === '.') {
        const before = s.slice(Math.max(0, m.index - 3), m.index);
        if (/\b(Mr|Dr|Mrs|Ms|St|vs|etc|i\.e|e\.g)$/i.test(before)) continue;
        // מספר עשרוני: 3.14 — דלג
        if (/\d$/.test(before) && /^\d/.test(s.slice(end))) continue;
      }
      if (end > last) last = end;
    }
  }
  // forced flush — 200 תווים בלי גבול
  if (last === -1 && s.length >= 200) {
    // נסי לחתוך ברווח האחרון לפני 200
    const slice = s.slice(0, 200);
    const lastSpace = slice.lastIndexOf(" ");
    return lastSpace > 100 ? lastSpace + 1 : 200;
  }
  return last;
}
```

ב-`onChunk` כאשר `kind === "message"` (סביב שורה 404-411):
```ts
messageBuffer += chunk;
let boundary: number;
while ((boundary = findSentenceBoundary(messageBuffer)) !== -1) {
  const head = messageBuffer.slice(0, boundary);
  const rest = messageBuffer.slice(boundary);
  messageBuffer = head;
  flushMessage();           // שולח head ל-TTS + רינדור
  messageBuffer = rest;     // השארית מצטברת ל-flush הבא
}
```

**שיקול עברית:** בעברית נקודה נדירה יותר. ה-fallback של 200 תווים מטפל בזה.

**בדיקה:** `bunx tsc --noEmit`. בדיקה ידנית: שאלה עם תשובה ארוכה — לראות שבועות מתחלקות לקטעים ולא לבועה ארוכה אחת.

**Commit suggestion:** `(server): חיתוך flushMessage לפי גבול משפט בנוסף למעבר kind`

---

### E. תרגום thoughts + הקראה

**תלות:** דורש את C (`translateThought`).

**מטרה:** הקראה של reasoning המודל בעברית, לא רק תצוגה של האנגלית.

**E.1 — Backend (`server.ts`):**

**שינויי `ServerMessage`:**
- `audio_start.kind` יקבל ערך חדש: `"thought"`.
- `text_chunk` יקבל kind חדש `"thought_translation"`.

```ts
| { type: "text_chunk"; text: string; kind: "message" | "thought" | "thought_translation" }
// ...
| { type: "audio_start"; streamId: string; kind: "message" | "tool_title" | "thought" }
```

**ConnState חדש:** `thoughtBuffer: string` (במקביל ל-`messageBuffer`).

**ב-`onChunk` עבור `kind === "thought"`** (סביב שורה 407):
- צבירה ב-`thoughtBuffer` (במקום רק לעשות flush של messageBuffer).
- flush של thoughtBuffer ב-:
  - מעבר ל-`message` או `tool_call` (create)
  - או סוף תור

**`flushThought()` חדש:**
```ts
const flushThought = () => {
  const t = thoughtBuffer.trim();
  thoughtBuffer = "";
  if (!t) return;
  // queue async: תרגום → text_chunk → TTS
  ttsQueue = ttsQueue.then(async () => {
    const hebrew = await translateThought(t);
    send(ws, { type: "text_chunk", text: hebrew, kind: "thought_translation" });
    const streamId = `s${Date.now().toString(36)}-${streamCounter++}`;
    try {
      send(ws, { type: "audio_start", streamId, kind: "thought" });
      await streamCachedTextToSpeech(hebrew, { voiceId: state.voiceId ?? undefined },
        (chunk) => send(ws, { type: "audio_chunk", streamId,
          data: Buffer.from(chunk).toString("base64") }));
      send(ws, { type: "audio_end", streamId });
    } catch (e) {
      console.error(`[ws] TTS thought נכשל: ${(e as Error).message}`);
      send(ws, { type: "audio_end", streamId });
    }
  });
};
```

קרא ל-`flushThought()` בכל מקום שהיום `flushMessage()` נקרא במעבר kind, וגם בסוף תור.

**E.2 — Frontend (`index.html`):**

**SubBubble — שיטה חדשה `setThoughtTranslation(hebrewText)`:**
- יוצרת שורה שנייה בתוך הבועה, מתחת לטקסט האנגלי.
- styling: גודל רגיל, italic, צבע ברור (בניגוד לאנגלית שהיא קטן+אפור).
- מפריד עדין (border-top דקיק או margin).

**Handler חדש ל-`text_chunk` עם `kind === "thought_translation"`:**
- מוצא את ה-thought bubble האחרון בתור הנוכחי.
- קורא ל-`setThoughtTranslation(text)`.

**Handler ל-`audio_start` עם `kind === "thought"`:**
- מקשר את ה-stream לבועת ה-thought (לא לבועת message). אותו צ'יים, אותה תור ניגון.

**בדיקה:** restart server, שאלה שמייצרת thought ארוך, לראות:
- אנגלית מקור מוצגת בבועת thought (כמו היום).
- תרגום עברי נוסף מתחתיה.
- ההקראה היא של התרגום העברי.

**Commit suggestion:** `(thoughts): תרגום thoughts לעברית + הקראה דרך gemini-helper`

---

### F. נראציה של tool calls

**תלות:** דורש את C (`narrateToolCall`).

**מטרה:** במקום להקריא את ה-title הגולמי של ה-tool ("Read README.md"), Gemini מנסח משפט קצר טבעי בעברית עם הקשר.

**F.1 — context tracking ב-`server.ts`:**

ב-`ConnState`:
```ts
lastUserText: string | null;
recentMessages: string[];     // FIFO, max 3
```
איתחול ב-`open`.

ב-`handleAudio`, אחרי קבלת transcript:
```ts
state.lastUserText = transcript;
```

ב-`flushMessage`, אחרי `totalMessageChars += t.length`:
```ts
state.recentMessages.push(t);
if (state.recentMessages.length > 3) state.recentMessages.shift();
```

**F.2 — שינוי `onToolCall`** (סביב שורות 413-430):

החליפי את:
```ts
if (event.event === "create") {
  flushMessage();
  if (event.title?.trim()) {
    queueTts(event.title.trim(), "tool_title");
  }
}
```

ב:
```ts
if (event.event === "create") {
  flushMessage();
  flushThought();          // אם יש thought שמחכה — לסיים אותו קודם
  if (event.title?.trim()) {
    ttsQueue = ttsQueue.then(async () => {
      let narrate = event.title!.trim();
      try {
        narrate = await narrateToolCall({
          userMessage: state.lastUserText ?? "",
          recentMessages: state.recentMessages.slice(-3),
        }, {
          toolCallId: event.toolCallId,
          kind: event.toolKind,
          title: event.title!,
        });
      } catch (e) {
        console.error(`[ws] narrate נכשל: ${(e as Error).message}`);
      }
      const streamId = `s${Date.now().toString(36)}-${streamCounter++}`;
      try {
        send(ws, { type: "audio_start", streamId, kind: "tool_title" });
        await streamCachedTextToSpeech(narrate, { voiceId: state.voiceId ?? undefined },
          (chunk) => send(ws, { type: "audio_chunk", streamId,
            data: Buffer.from(chunk).toString("base64") }));
        send(ws, { type: "audio_end", streamId });
      } catch {
        send(ws, { type: "audio_end", streamId });
      }
    });
  }
}
```

**אל תוסיפי `kind: "tool_narration"` חדש** — שמרי `kind: "tool_title"` הקיים כדי לא לשבור את ה-frontend. הוא לא יודע מה ה-text — רק את הצ'יים.

**F.3 — Frontend:** אין שינוי. אותו kind, אותו handler.

**בדיקה:** restart server, שאלה שמייצרת מספר tool calls שונים, לראות שכל אחד מקבל נראציה הגיונית שונה. לבדוק שגם Bash commands מקבלים תיאור של תכלית ולא שם הפקודה.

**Commit suggestion:** `(tools): נראציה של tool calls דרך Gemini במקום title גולמי`

---

### G. UI: mic button state machine — pause/resume

**מטרה:** במצב speaking, לחיצה על המיקרופון תעשה pause/resume של ההקראה במקום להתחיל הקלטה.

**קובץ:** `frontend/index.html`

**State machine חדש:**
```
idle      ──click──► recording
recording ──click──► idle (sends audio)
speaking  ──click──► paused
paused    ──click──► speaking
```

- `speaking` = `currentStream != null || currentlyPlaying != null` ולא paused.
- `paused` = `audio.pause()` נקרא, ה-Audio/StreamingAudio object עוד קיים.

**שינויים ב-`StreamingAudio`:**

הוסיפי שתי methods:
```js
pause() { try { this.audio.pause(); } catch {} }
resume() { try { this.audio.play(); } catch {} }
```

**State גלובלי חדש:** `let audioIsPaused = false;`

**פונקציה חדשה:**
```js
function getMicButtonState() {
  if (isRecording) return "recording";
  if (currentlyPlaying || currentStream) {
    return audioIsPaused ? "paused" : "speaking";
  }
  return "idle";
}

function updateMicButton() {
  const s = getMicButtonState();
  btn.dataset.state = s;
  // עדכון אייקון + צבע ב-CSS לפי data-state
  btn.textContent = ({ idle: "🎙", recording: "⏺", speaking: "⏸", paused: "▶" })[s];
}
```

**עיצוב כפתור (CSS):**
- `[data-state="idle"]` — כחול.
- `[data-state="recording"]` — אדום, `animation: pulse 1s infinite`.
- `[data-state="speaking"]` — אדום עדין, ללא פעימה.
- `[data-state="paused"]` — כחול עם הילה (`box-shadow: 0 0 12px rgba(0,128,255,.5)`).

**click handler חדש:**
```js
btn.addEventListener("click", () => {
  const s = getMicButtonState();
  if (s === "idle") startRecording();
  else if (s === "recording") stopRecording();
  else if (s === "speaking") {
    audioIsPaused = true;
    currentStream?.pause();
    currentlyPlaying?.pause();
    updateMicButton();
  } else if (s === "paused") {
    audioIsPaused = false;
    currentStream?.resume();
    currentlyPlaying?.play();
    updateMicButton();
  }
});
```

**`updateMicButton()` נקראת:**
- בכל שינוי ב-`isRecording`.
- בכל שינוי ב-`currentStream` (start/end).
- בכל שינוי ב-`currentlyPlaying` (start/end).
- אחרי pause/resume.

**כפתור Stop קטן:**
- `<button id="stop-btn" class="stop-btn" aria-label="עצור">⏹</button>`.
- מוצג רק כש-`getMicButtonState() ∈ {"speaking", "paused"}`.
- לחיצה: עוצר את `currentStream`, `currentlyPlaying`, מנקה `streamOrder` ו-`activeStreams`, מאפס `audioIsPaused`, חוזר ל-idle.
- replay-last נשאר במיקום הנוכחי שלו. לא משנים מיקום.

**בדיקה:** restart. בדיקה ידנית: שאלה ארוכה → תוך כדי הקראה ללחוץ פעם → ההקראה נעצרת והכפתור הופך ל-▶. ללחוץ שוב → ממשיכה מהמקום. לחיצה על stop → הכל מתנקה.

**Commit suggestion:** `(ui): mic button state machine — pause/resume להקראה + כפתור stop`

---

### H. UI: גלילה חכמה

**מטרה:** auto-scroll רק כשהמשתמש קרוב לתחתית. אם הוא גלל למעלה לקרוא משהו — לא לדרוס.

**קובץ:** `frontend/index.html`

**משתנים גלובליים חדשים:**
```js
const SCROLL_THRESHOLD_PX = 60;
let autoScrollEnabled = true;
let suppressScrollEvents = false;
```

**listener על `chatEl.scroll`:**
```js
chatEl.addEventListener("scroll", () => {
  if (suppressScrollEvents) return;
  const distance = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  autoScrollEnabled = distance <= SCROLL_THRESHOLD_PX;
  jumpDownBtn.classList.toggle("visible", !autoScrollEnabled);
});
```

**`scrollChatToBottom()` חדשה:**
```js
function scrollChatToBottom() {
  if (!autoScrollEnabled) return;
  suppressScrollEvents = true;
  chatEl.scrollTop = chatEl.scrollHeight;
  requestAnimationFrame(() => { suppressScrollEvents = false; });
}
```

**החליפי בקוד הקיים:** כל מקום שעושה `chatEl.scrollTop = chatEl.scrollHeight` → `scrollChatToBottom()`.

**UI חדש — כפתור ↓:**
```html
<button id="jump-down" class="jump-down" aria-label="גלול למטה">↓</button>
```
CSS:
- `position: absolute` בתוך ה-chat container.
- `bottom: 12px; right: 12px;`
- מעגלי, צל קטן, רקע חצי-שקוף.
- `opacity: 0; pointer-events: none; transition: opacity 200ms;`
- `.visible { opacity: 1; pointer-events: auto; }`

**click handler:**
```js
jumpDownBtn.addEventListener("click", () => {
  autoScrollEnabled = true;
  chatEl.scrollTop = chatEl.scrollHeight;
  jumpDownBtn.classList.remove("visible");
});
```

**בדיקה:** restart. שאלה ארוכה — תוך כדי הקראה לגלול למעלה — לראות שה-auto-scroll נעצר וה-↓ מופיע. ללחוץ ↓ — לחזור לתחתית, ה-auto חוזר.

**Commit suggestion:** `(ui): גלילה חכמה — auto-scroll מותנה בקרבה לתחתית + כפתור ↓`

---

### I. UI: `dir="auto"` לכל הבועות (קל)

**מטרה:** טקסט עברי יוצג RTL, אנגלי LTR — בלי תיוג ידני, גם בהיסטוריה וגם ב-live.

**קובץ:** `frontend/index.html`

**שלוש נקודות מימוש:**

1. **ב-`SubBubble` constructor** (אחרי יצירת `this.bubbleEl`):
   ```js
   this.bubbleEl.setAttribute("dir", "auto");
   ```

2. **ב-`renderToolItem`** (או הפונקציה שמרנדרת פריט ברשימת tools):
   ```js
   item.querySelector("span:last-child")?.setAttribute("dir", "auto");
   ```

3. **ב-`setHtml`** (כדי שגם markdown HTML יקבל):
   ```js
   setHtml(html) {
     this.hasHtml = true;
     this.bubbleEl.innerHTML = html;
     for (const child of this.bubbleEl.children) {
       if (!child.hasAttribute("dir")) child.setAttribute("dir", "auto");
     }
   }
   ```

**בדיקה:** restart. שאלה שמייצרת תשובה מעורבת (עברית + שם פונקציה באנגלית + פסקאות מרובות) — לראות שכל פסקה ממוקמת נכון לפי תוכנה.

**Commit suggestion:** `(ui): dir="auto" לבועות, פריטי tools, ו-markdown HTML`

---

## משימות בעבודה (executor)

— (אין כרגע)

---

## משימות שבוצעו

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

## תלויות בין משימות

```
A (prompt)     ──┐
B (stt+ctx)    ──┤
G (mic state)  ──┼── עצמאיות, אפשר בכל סדר
H (scroll)     ──┤
I (dir=auto)   ──┘

C (helper) ──┬──► E (thought)
             └──► F (narration)

D (sentence cut) — עצמאית, אבל אפקט יפה ביותר אחרי E+F
```

**סדר ביצוע מומלץ:** A → B → C → D → E → F → G → H → I.
**מקביליות:** A/B/G/H/I אפשר במקביל. C חייבת לפני E/F.

---

## הערכת זמן (גס)

| משימה | זמן |
|--------|-----|
| A | 5 דק' |
| B | 15-20 דק' |
| C | 30 דק' |
| D | 25-30 דק' |
| E | 35-40 דק' |
| F | 25-30 דק' |
| G | 30-35 דק' |
| H | 20 דק' |
| I | 10 דק' |
| **סה"כ** | **~3.5 שעות** |

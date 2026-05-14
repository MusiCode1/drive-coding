# Plan — voice-acp v2

> תוכנית עבודה אקטיבית. **המבצע קורא רק את הסעיף "משימות לביצוע"**.
> ארכיטקטורה כללית: `docs/spec.md`. רעיונות נדחים: `docs/future-features.md`.

---

## מצב נוכחי (2026-05-14)

**v1 + v2 הושלמו וקומטו.** ה-stack פעיל E2E כולל כל שכבת ההנגשה האודיו (gemini-helper לתרגום ונראציה, חיתוך משפטים, mic state machine, גלילה חכמה, dir=auto). ראה `docs/walkthrough.md` ו"משימות שבוצעו" למטה.

**v3 = איטרציית baseline לנסיעה.** Avi עשה בדיקה empirical ב-13:30 וזיהה באגים ושיפורים דחופים שמפריעים לשימוש בסיסי. הסקופ של האיטרציה הזאת: תיקוני באגים + שיפורים שיהפכו את החוויה לטובה מספיק לשימוש בדרכים. סדר עדיפויות לפי דחיפות לחוויית המשתמש.

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

> איטרציית v3 — תיקוני באגים ושיפורים דחופים שזוהו בבדיקה empirical של Avi ב-13:30.
> כל המשימות עצמאיות זו מזו טכנית; הסדר J→O הוא לפי דחיפות לחוויית המשתמש.
> בכל משימה: **commit יחיד**, הודעה בעברית, פורמט `(scope): כותרת\n\n- שינוי 1\n- שינוי 2`.

---

### J. תיקון `translateThought` — החזרת `null` בכישלון

**מטרה:** כשתרגום של מחשבה נכשל (timeout או error או תוצאה ריקה), אסור שהטקסט האנגלי המקורי יישלח לקדמית כ"תרגום עברי" ויוקרא דרך TTS. במקום זה — לדלג. המשתמש יראה רק את המחשבה האנגלית המקורית, בלי שורה שנייה ובלי קול.

**הקשר:** כיום אם Gemini עובר את ה-timeout של 2500ms או נכשל, ה-fallback של `translateThought` הוא הטקסט המקורי באנגלית. הוא נשלח כ-`thought_translation` ל-frontend ומוקרא דרך אילבן בקול עברי — נשמע כאנגלית מסולפת ומבלבל את המשתמש. ראו דיווח באג ב-walkthrough של 2026-05-14 ~14:00.

**קבצים:**
- `backend/src/gemini-helper.ts`
- `backend/src/server.ts`

**שינוי 1 — `gemini-helper.ts`:**

חתימה חדשה:
```ts
export async function translateThought(text: string): Promise<string | null>
```

מימוש:
```ts
const call = (async () => {
  try {
    const response = await ai.models.generateContent({
      model: DEFAULT_MODEL,
      contents: createUserContent([TRANSLATE_PROMPT_PREFIX + key]),
    });
    const out = (response.text ?? "").trim();
    return out || null;        // תוצאה ריקה → null
  } catch (e) {
    console.error(`[gemini-helper] translateThought נכשל: ${(e as Error).message}`);
    return null;                 // exception → null
  }
})();

const result = await withTimeout(call, TRANSLATE_TIMEOUT_MS, null);  // timeout → null
if (result !== null) {
  translationCache.set(key, result);  // cache רק תוצאה אמיתית
}
return result;
```

**שינוי 2 — `server.ts`, בפונקציה `flushThought`:**

```ts
const flushThought = () => {
  const t = thoughtBuffer.trim();
  thoughtBuffer = "";
  if (!t) return;
  console.log(`[ws] thought segment (${t.length} chars) → תרגום + TTS`);
  ttsQueue = ttsQueue.then(async () => {
    const hebrew = await translateThought(t);
    if (hebrew === null) {
      console.log(`[ws] thought translation failed — skipping TTS for this segment`);
      return;  // אין text_chunk, אין TTS
    }
    send(ws, {
      type: "text_chunk",
      text: hebrew,
      kind: "thought_translation",
    });
    await streamTts(hebrew, "thought");
  });
};
```

**שינוי 3 — CLI test block בסוף `gemini-helper.ts`:**

```ts
const result = await translateThought(arg);
console.log(`(${Date.now() - start}ms): ${result === null ? "[null — נכשל]" : result}`);
```

**בדיקה:**
- `cd backend && bunx tsc --noEmit` — חובה.
- סימולציית כישלון: לקצר זמנית `TRANSLATE_TIMEOUT_MS` ל-1ms בקובץ, הפעלת שיחה, לוודא שאין הקראה של אנגלית ושלא מופיעה שורה שנייה בבועת thought. להחזיר אחרי הבדיקה.

**Commit suggestion:** `(thoughts): translateThought מחזיר null בכישלון — דילוג על TTS ועל תצוגת תרגום`

---

### K. החזרת CSS של `thought-translation` לזהות לאנגלית

**מטרה:** תרגום עברי של מחשבה ייראה זהה לחלוטין למחשבה האנגלית המקורית. השפה היא המבחין היחיד — לא גודל, לא צבע, לא סגנון.

**הקשר:** בתיקון hot-fix קודם (commit 9e36d25) הוגדר ה-Hebrew להיות גדול ובהיר ולא איטלי כדי "להבדיל". Avi הבהיר שזו לא הכוונה: אותו עיצוב לשתי השורות, השפה כבר מבדילה.

**קובץ:** `frontend/index.html`

**שינוי ב-CSS, בסעיף `.msg.agent.thought .bubble .thought-translation` (סביב שורה 228):**

```css
.msg.agent.thought .bubble .thought-translation {
  display: block;
  margin-top: 4px;
  /* אין color, font-size, font-style — יורש מהבועה ההורית
     כך שייראה זהה לטקסט האנגלי המקורי */
}
```

הסרת `padding-top`, `border-top`, `color`, `font-size`, `font-style`. נשארים רק `display: block` (שורה חדשה) ו-`margin-top: 4px` (הפרדה דקה).

**בדיקה:** restart, שאלה שמייצרת thought ארוך עם תרגום. שתי השורות בבועה ייראו זהות בסגנון — אותו אפור, אותו italic, אותו גודל. רק התוכן משתנה.

**Commit suggestion:** `(ui): thought-translation בסגנון זהה למקור האנגלי`

---

### L. קפיצה אוטומטית ממחשבות לתשובה

**מטרה:** ברגע ש-`audio_start` של מסר מתחיל ב-frontend, להפסיק מיד את ניגון המחשבות (הנוכחי + כל ה-pending בתור). המשתמש מרגיש מיידית שהמודל "סיים לחשוב".

**הקשר:** ה-ttsQueue ב-backend סדרתי, אז backend לא יכניס מסר לפני שה-thought הקודם נגמר ברמת שליחת ה-chunks. אבל ה-frontend מנגן אסינכרונית — `chunks` מצטברים ב-MediaSource buffer ו-`audio.play()` ממשיך הרבה אחרי שה-backend שלח `audio_end`. לכן יש חלון שבו ה-frontend מנגן thought בעוד המסר כבר מתחיל לזרום.

החיתוך **אגרסיבי**: לקטוע באמצע ניגון, לא לחכות לסוף chunk נוכחי. (Avi אישר ברירת מחדל זו.)

**קובץ:** `frontend/index.html`

**שינוי 1 — הוספת method `stop()` ל-class `StreamingAudio`:**

```js
stop() {
  try { this.audio.pause(); } catch {}
  try { this.audio.src = ""; } catch {}
  try {
    if (this.mediaSource && this.mediaSource.readyState === "open") {
      this.mediaSource.endOfStream();
    }
  } catch {}
}
```

**שינוי 2 — לוגיקה חדשה בתחילת `handleAudioStart(streamId, kind)`:**

```js
function handleAudioStart(streamId, kind) {
  // אם המסר מתחיל בזמן שמחשבה עוד בניגון או בתור — לקטוע ולנקות.
  if (kind === "message") {
    // הפסקת הסטרים הנוכחי אם הוא thought
    if (currentStream?.kind === "thought") {
      try { currentStream.stop(); } catch {}
      currentStream = null;
    }
    // הסרת thoughts pending מ-streamOrder ו-activeStreams
    const keep = [];
    for (const id of streamOrder) {
      const s = activeStreams.get(id);
      if (s && s.kind === "thought") {
        try { s.stop(); } catch {}
        activeStreams.delete(id);
      } else if (s) {
        keep.push(id);
      }
    }
    streamOrder.length = 0;
    streamOrder.push(...keep);
  }

  // ... המשך הלוגיקה הקיימת של יצירת ה-stream החדש
}
```

**שינוי 3 — וידוא שב-`handleAudioChunk`, chunks של thought שכבר נעצר מתעלמים:**

הקוד הקיים אמור לעשות `activeStreams.get(streamId)` ולהתעלם אם `undefined`. לוודא שאין fallback שמשחזר. אם יש — להסיר.

**זרימת UX מצופה:**
1. המודל שולח chunks של thought.
2. backend מתרגם, ה-frontend מתחיל לנגן את ה-thought audio.
3. backend מסיים thought TTS, מתחיל message TTS, שולח `audio_start` (message).
4. frontend מקבל `audio_start` (message) → קוטע את ה-thought הנוכחי + מנקה pending → מתחיל את המסר.
5. המשתמש שומע: thought חלקי (קצוץ באמצע משפט) → מסר.

**בדיקה:** restart. שאלה שמייצרת thought ארוך ואז תשובה. כש-thought מתורגם ומוקרא, ברגע שהאודיו של התשובה מתחיל — המחשבה נחתכת מיד. אם המחשבות כבויות (לא רלוונטי כעת, אך עתידית) — הקוד לא נשבר.

**Commit suggestion:** `(audio): קפיצה אוטומטית ממחשבות למסר ברגע שהאודיו מתחיל`

---

### M. תיקון באג הגלילה — מודל user intent

**מטרה:** `auto-scroll` פעיל כל הזמן, אלא אם המשתמש עשה פעולת גלילה אקטיבית. ברגע שהמשתמש גלל למעלה — מכבים אוטו עד שיגלול ידנית לקצה התחתון או ילחץ על כפתור ↓.

**הקשר:** הלוגיקה הנוכחית מבוססת על בדיקת המרחק מהקצה בכל `scroll` event. זה race-condition prone — תוכן חדש מתווסף, `scrollHeight` גדל, `scrollTop` נשאר, ה-`scroll` event מגיע באיחור עם מרחק גדל, המערכת חושבת שהמשתמש גלל למעלה ומכבה את האוטו בטעות. ראה תיאור מלא של ה-race ב-walkthrough של 2026-05-14 ~13:45.

**קובץ:** `frontend/index.html`

**להחליף את הלוגיקה הקיימת (סביב שורות 540-561 ו-916-923):**

```js
let autoScrollEnabled = true;
// timestamp של אינטראקציית קלט אחרונה מהמשתמש. כל scroll event שמגיע
// בתוך 500ms ממנו נחשב user-initiated (לא תוצאה של תוכן שנוסף).
let userInteractionAt = 0;

const markUserInteraction = () => { userInteractionAt = Date.now(); };
const inputEvents = ["wheel", "touchstart", "touchmove", "mousedown", "keydown"];
for (const evt of inputEvents) {
  chatEl.addEventListener(evt, markUserInteraction, { passive: true });
}

chatEl.addEventListener("scroll", () => {
  const distance = chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight;
  const isUser = Date.now() - userInteractionAt < 500;

  if (distance <= 10) {
    // הגענו לקצה — אם היה כבוי, להדליק
    if (!autoScrollEnabled) {
      autoScrollEnabled = true;
      jumpDownBtn.classList.remove("visible");
    }
  } else if (isUser && autoScrollEnabled) {
    // המשתמש גלל אקטיבית למעלה — לכבות אוטו
    autoScrollEnabled = false;
    jumpDownBtn.classList.add("visible");
  }
});

function scrollChatToBottom() {
  if (!autoScrollEnabled) return;
  chatEl.scrollTop = chatEl.scrollHeight;
}

jumpDownBtn.addEventListener("click", () => {
  autoScrollEnabled = true;
  chatEl.scrollTop = chatEl.scrollHeight;
  jumpDownBtn.classList.remove("visible");
});
```

**הסבר הלוגיקה:**
- `userInteractionAt` הוא הליבה. כל input event מהמשתמש מעדכן אותו.
- ה-scroll handler בודק: אם זה תוך 500ms מה-input — user. אחרת — תוצאה של תוכן שמתווסף.
- כך, גלילה אוטומטית של תוכן חדש לעולם לא מכבה את האוטו.
- רק user scroll אקטיבי מכבה.

**להסיר:** את הקבוע `SCROLL_THRESHOLD_PX = 60` הישן ואת המשתנה `suppressScrollEvents` ושימושיו — כבר לא נחוצים.

**עדינות:** scrollbar drag לא נתפס באירועי wheel/touch/keyboard, אבל `mousedown` על ה-scrollbar (אם המשתמש לוחץ עליו) ייתפס דרך listener ה-`mousedown`. גם אם לא מושלם, רוב המשתמשים גוללים בגלגלת או באצבע.

**בדיקה:** restart. שיחה ארוכה תוך כדי streaming של תשובה — לבדוק שהגלילה האוטומטית עוקבת אחרי התחתית בלי להידבק. תוך כדי, לגלול עם הגלגלת/אצבע למעלה — האוטו צריך להפסיק. ללחוץ על ↓ — לחזור לתחתית, אוטו מופעל שוב.

**Commit suggestion:** `(ui): גלילה חכמה מבוססת user intent — wheel/touch/keyboard/mousedown`

---

### N. שמירת הקלטות לדיסק

**מטרה:** בכל הקלטה של המשתמש, לשמור את האודיו לדיסק יחד עם metadata. ניתן יהיה לנגן מחדש, להריץ דרך פרומפטים שונים, ולהשוות.

**הקשר:** Avi ביקש את זה לפיתוח. בעתיד אולי toggle בהגדרות. כרגע — משתנה סביבה. גם רעיון עתידי של "נגן סשן מחדש" יסתמך על הקלטות שמורות.

**קבצים:**
- `backend/src/server.ts` — שמירה ב-`handleAudio`. אם נוח, אפשר מודול עזר `backend/src/recordings.ts`.

**משתנה סביבה:** `VOICE_ACP_SAVE_RECORDINGS` — ברירת מחדל מופעל. ערך `0` או `false` (case-insensitive) משבית.

**נתיב:** `${XDG_CACHE_HOME ?? $HOME/.cache}/voice-acp/recordings/`. ליצור את התיקייה אם לא קיימת.

**מבנה קבצים פר הקלטה:**
- `<ISO-timestamp>_<short-id>.<ext>` — האודיו הגולמי. סיומת לפי `mimeType` (`webm`/`ogg`/`mp3`/`audio`).
- `<ISO-timestamp>_<short-id>.json` — metadata sidecar.

**Metadata sidecar:**
```json
{
  "timestamp": "2026-05-14T13:45:22.123Z",
  "sessionId": "abc123de-...",
  "cwd": "/path/to/workspace",
  "mimeType": "audio/webm",
  "audioSize": 12345,
  "transcript": "המשתמש אמר...",
  "sttModel": "gemini-flash-latest"
}
```

**מימוש מוצע ב-`handleAudio`:**

```ts
const SAVE_RECORDINGS = (() => {
  const v = (process.env.VOICE_ACP_SAVE_RECORDINGS ?? "1").toLowerCase();
  return v !== "0" && v !== "false";
})();

const RECORDINGS_DIR =
  (process.env.XDG_CACHE_HOME ?? `${process.env.HOME}/.cache`) +
  "/voice-acp/recordings";

async function saveRecording(
  base64: string,
  mimeType: string,
  sessionId: string | null,
): Promise<{ audioPath: string; ts: string } | null> {
  if (!SAVE_RECORDINGS) return null;
  try {
    // ensure dir
    await Bun.write(RECORDINGS_DIR + "/.keep", "");
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const sid = (sessionId ?? "no-sess").slice(0, 8);
    const ext = mimeType.includes("webm") ? "webm"
              : mimeType.includes("ogg") ? "ogg"
              : (mimeType.includes("mp3") || mimeType.includes("mpeg")) ? "mp3"
              : "audio";
    const audioPath = `${RECORDINGS_DIR}/${ts}_${sid}.${ext}`;
    await Bun.write(audioPath, Buffer.from(base64, "base64"));
    return { audioPath, ts };
  } catch (e) {
    console.error(`[recordings] save failed: ${(e as Error).message}`);
    return null;
  }
}

async function saveRecordingMetadata(
  info: { audioPath: string },
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    const metaPath = info.audioPath.replace(/\.[^.]+$/, ".json");
    await Bun.write(metaPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.error(`[recordings] save metadata failed: ${(e as Error).message}`);
  }
}
```

ב-handleAudio (לפני וגם אחרי `transcribeAudio`):

```ts
const recInfo = await saveRecording(
  msg.data,
  msg.mimeType ?? "audio/webm",
  state.sessionId ?? null,  // אם זמין
);

// ... transcribeAudio ...
const transcript = await transcribeAudio(...);

if (recInfo) {
  await saveRecordingMetadata(recInfo, {
    timestamp: new Date().toISOString(),
    sessionId: state.sessionId ?? null,
    cwd: state.cwd ?? null,
    mimeType: msg.mimeType ?? "audio/webm",
    audioSize: Buffer.from(msg.data, "base64").byteLength,
    transcript,
    sttModel: "gemini-flash-latest",
  });
}
```

**הערה:** אם `state.sessionId` ו-`state.cwd` עדיין לא חשופים ב-ConnState — להוסיף ב-handleInit שמירה שלהם ב-state.

**בדיקה:**
- `bunx tsc --noEmit`
- שיחה דרך הממשק → לוודא ב-`~/.cache/voice-acp/recordings/` שני קבצים — `.webm` ו-`.json` תואמים.
- `cat <name>.json` — לראות שכל השדות מלאים, transcript בעברית.
- ביטול: `VOICE_ACP_SAVE_RECORDINGS=0 onecli run -- bun src/server.ts` — אין שמירה.

**Commit suggestion:** `(server): שמירת הקלטות משתמש עם metadata sidecar`

---

### O. שיפור פרומפט STT + מעבר ל-Flash

**מטרה:** תמלול עברי טוב יותר — פיסוק טבעי, שבירת פסקאות בהפסקות ארוכות, מודל מהיר ומדויק יותר.

**הקשר:** Avi דיווח שהתמלול הנוכחי לפעמים שגיאות כתיב, ומחזיר בלוק טקסט אחד בלי פיסוק או פסקאות. שינוי כפול — שדרוג מודל ושיפור פרומפט.

**קובץ:** `backend/src/stt.ts`

**שינוי 1 — `DEFAULT_MODEL`:**

```ts
const DEFAULT_MODEL = "gemini-flash-latest";  // היה: gemini-flash-lite-latest
```

**שינוי 2 — `TRANSCRIBE_PROMPT`:**

החליפי את הפרומפט הנוכחי ב:

```
The user is speaking Hebrew in a software development context.
Transcribe the audio exactly as spoken, with these requirements:

- Add appropriate punctuation (commas, periods, question marks,
  exclamation marks) at natural pauses and sentence boundaries.
- Break into paragraphs (use \n\n) at major topic shifts or after
  long pauses (over 1.5 seconds).
- If a word is unclear, prefer a sensible technological interpretation
  (e.g. "ריאקט" over "ראקת", "באג" over "בק").
- Fix obvious disfluencies (repetitions, "אה אה", false starts) — but
  preserve the user's intent and phrasing.
- Do NOT add content the user did not say. No introductions, no
  summaries, no commentary, no acknowledgments.
- Preserve the original language (Hebrew or English).

Output ONLY the transcription itself, as plain text with punctuation
and paragraph breaks as instructed. If the audio is silent or
unintelligible, return an empty string.
```

**בדיקה:**
- `bunx tsc --noEmit`.
- אם N הסתיים — להריץ CLI test על הקלטה שמורה:
  `bun src/stt.ts ~/.cache/voice-acp/recordings/<latest>.webm`
- לבדוק שהפלט כולל פיסוק (נקודות, פסיקים, שאלות) ושבירת פסקאות אם ההקלטה ארוכה עם הפסקות.
- לבדוק שלא מתווסף תוכן שלא נאמר.
- בדיקה empirical דרך הממשק: לדבר משפט ארוך עם הפסקות וזיהוי טכנולוגיה, ולוודא שהתמלול נראה הגיוני.

**Commit suggestion:** `(stt): פרומפט עם פיסוק ופסקאות + מעבר מ-Flash Lite ל-Flash`

---

## משימות בעבודה (executor)

- **O** — STT prompt + Flash (התחיל 2026-05-14 15:20)

---

## משימות שבוצעו

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

## תלויות בין משימות (v3)

```
J (translate fix)  ──┐
K (CSS revert)     ──┤
L (auto-skip)      ──┼── עצמאיות זו מזו, אפשר בכל סדר
M (scroll)         ──┤
N (recordings)    ───┤
O (STT improve)    ──┘
```

**סדר ביצוע מומלץ:** J → K → L → M → N → O — לפי דחיפות לחוויית המשתמש. כל המשימות עצמאיות טכנית; ניתן גם במקביל אם מבצעים מרובים.

**הערה ל-O:** אם N הסתיים, ניתן להריץ CLI test על הקלטות שמורות כחלק מאימות O.

---

## הערכת זמן (גס) — v3

| משימה | זמן |
|--------|-----|
| J | 10-15 דק' |
| K | 5 דק' |
| L | 25-30 דק' |
| M | 20-25 דק' |
| N | 30-40 דק' |
| O | 10 דק' |
| **סה"כ** | **~2 שעות** |

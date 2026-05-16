# Behaviors — voice-acp

> תיעוד ממוקד התנהגויות של המערכת — כל מה שצריך לכסות בבדיקות לפני ריפקטור.
>
> **המטרה:** רשימה שלמה ש-(א) הריפקטור לא ישבור, (ב) בדיקות יוודאו את זה אוטומטית.
>
> **מבנה:** כל התנהגות = פסקה אחת עם ID, תיאור, מקור בקוד, וסיבה (אם נובעת מבאג שתוקן). אין כאן ספצים — רק התנהגויות.
>
> **קטגוריות:**
> - `[SYSPROMPT]` — system prompt למודל
> - `[STT]` — תמלול
> - `[ACP]` — תקשורת עם opencode acp
> - `[PROMPT]` — לוגיקת זרימת prompt + chunks
> - `[TTS]` — סינתזה והקראה
> - `[GEMINI]` — תרגום מחשבות + נראציה של כלים
> - `[REC]` — שמירת הקלטות
> - `[WS]` — פרוטוקול WebSocket
> - `[HTTP]` — endpoints REST של ה-backend
> - `[MARKDOWN]` — רינדור Markdown + sanitization
> - `[STATIC]` — הגשת קבצים סטטיים + path traversal protection
> - `[URL]` — URL params של ה-frontend
> - `[UI-MIC]` — כפתור מיקרופון ו-state machine
> - `[UI-AUDIO]` — ניגון אודיו (live + replay)
> - `[UI-BUBBLES]` — בועות שיחה ורינדור
> - `[UI-SCROLL]` — גלילה
> - `[UI-HIST]` — היסטוריה
> - `[UI-CAR]` — מצב רכב
> - `[UI-HEADER]` — header של index.html (meta, settings link)
> - `[UI-RECORD]` — הקלטת אודיו עם MediaRecorder
> - `[CONFIG]` — דף הגדרות (config.html)
> - `[CONFIG-PICKER]` — folder picker modal ב-config

---

## SYSPROMPT — מה ה-system prompt אומר למודל

### SYSPROMPT-1: תוכן `VOICE_SYSTEM_PROMPT` קבוע
`backend/src/system-prompt.ts`. ראה PROMPT-3/PROMPT-4 לאיך הוא מוזרק.

### SYSPROMPT-2: כותרת מסגרת
`"[הוראות מערכת — לא מהמשתמש]"`. מודיע למודל שזה לא קלט משתמש אמיתי. מקור: `system-prompt.ts:8`.

### SYSPROMPT-3: מסגרת תקשורת — קולי בלבד
מצהיר: "אתה עוזר קוד שמתקשר עם המשתמש בקול בלבד, דרך מערכת TTS." מקור: `system-prompt.ts:10`.

### SYSPROMPT-4: 8 חוקי תגובה
- תשובות בעברית, משפטים קצרים.
- "תחשוב על איך התשובה נשמעת, לא איך היא נראית".
- "המשתמש שומע אותך, לא קורא. אין לו מסך".
- בלי טבלאות / בלוקי קוד / רשימות bullets / markdown.
- בלי emojis.
- שאלות קוד → לתאר במילים, לא לצטט.
- פלט ארוך → סיכום במשפט.
- אסור לחזור על השאלה לפני התשובה.
מקור: `system-prompt.ts:12-20`.

### SYSPROMPT-5: 4 חוקי כלים (tool narration)
- לכל tool יש title שמוקרא **לפני** הביצוע.
- הכותרת **בעברית** ("קורא את README", לא "Reading README").
- לתאר את הפעולה גם במילים אם רלוונטי.
- אסור לכפיל את הכותרת בתשובה.
מקור: `system-prompt.ts:22-26`.

### SYSPROMPT-6: 2 חוקי תשובות קצרות
- תשובה במילה אחת — חייבת להיות ב-text, לא רק ב-thinking. (סיבה: באג ידוע שמודל חושב את התשובה ב-thoughts ולא יוצר message כשהוא רואה "תענה במילה אחת").
- thinking לא מוקרא; text כן.
מקור: `system-prompt.ts:28-30`.

### SYSPROMPT-7: מפריד `---` + label `שאלת המשתמש:`
מודיע למודל איפה ה-system prompt מסתיים והשאלה האמיתית מתחילה. מקור: `system-prompt.ts:32-34`.

---

## STT — Speech to Text (Gemini)

### STT-1: שימוש במודל `gemini-flash-latest`
ה-default model הוא `gemini-flash-latest` (אליאס מתעדכן אוטומטית, לא Flash Lite). מקור: `stt.ts:12`. סיבה: Flash Lite הניב איכות תמלול עברית ירודה — סוכן בדק והעביר ל-Flash ב-v3 משימה O.

### STT-2: TRANSCRIBE_PROMPT עברית טכנולוגית
ה-prompt דורש (א) פיסוק טבעי בגבולות משפט, (ב) שבירת פסקאות `\n\n` בשינויי נושא, (ג) פירוש טכנולוגי במקרי ספק (`ריאקט` לא `ראקת`, `באג` לא `בק`), (ד) תיקון disfluencies תוך שמירת intent, (ה) **אסור להוסיף תוכן שלא נאמר**, (ו) שמירת שפת המקור. מקור: `stt.ts:14-32`.

### STT-3: context מההודעה הקודמת
אם `previousResponse` הועבר ב-SttOptions, הוא נשלח כ-text part **לפני** האודיו, עם תיוג `Recent assistant message (for context only — do NOT transcribe this)`. מקור: `stt.ts:66-70`. השרת מעביר את `lastAgentMessage` (ה-flush האחרון, לא הצברה) — שזה הקטע שהמשתמש זוכר. מקור: `server.ts:403`.

### STT-4: trim על הפלט
התמלול מוחזר אחרי `.trim()`. מקור: `stt.ts:77`.

### STT-5: API key placeholder
GoogleGenAI מאותחל עם `"placeholder"`. OneCLI מזריק את ה-`x-goog-api-key` בדרך. מקור: `stt.ts:35`.

### STT-5b: mimeType default = `audio/webm`
אם `opts.mimeType` חסר → `"audio/webm"`. תואם MediaRecorder ברירת מחדל ב-Chrome. מקור: `stt.ts:60`.

### STT-5c: prompt ניתן להחלפה
`opts.prompt` עוקף את ה-TRANSCRIBE_PROMPT הקבוע. מקור: `stt.ts:61`.

### STT-6: שמירה על שפת המקור
המודל לא מתרגם — אם המשתמש דיבר אנגלית, מוחזר תמלול אנגלי. מקור: STT-2 + `Preserve the original language`.

### STT-7: ריצה במקביל לשמירת הקלטה
ב-`handleAudio`, `saveRecording` נקרא **לפני** `transcribeAudio` ובלי await — שמירת ההקלטה אינה דוחה את ה-STT. מקור: `server.ts:397-405`.

### STT-8: תמלול ריק → done מיידי
אם `transcript` ריק (audio שקט/לא מובן), `handleAudio` שולח `done` מיד ולא מבצע prompt. מקור: `server.ts:422-425`.

### STT-9: שליחת `transcript` ל-frontend
מיד אחרי שהתמלול מתקבל, השרת שולח `{ type: "transcript", text }` ל-WebSocket — לפני שמתחיל ה-prompt. מקור: `server.ts:405`.

---

## ACP — opencode acp bridge

### ACP-1: spawn opencode כ-child process
ה-bridge מריץ `opencode acp` כ-child עם stdio=pipe. מקור: `acp-bridge.ts:139-145`.

### ACP-2: protocolVersion = 1 (מספר, לא string)
ה-handshake שולח `protocolVersion: 1`. ה-spec המקורי טעה ("0.1" כמחרוזת). מקור: `acp-bridge.ts:259`. סיבה: גילוי באג בבניית POC.

### ACP-3: Node↔Web stream bridge
ndJsonStream דורש Web streams; Node spawn מחזיר Node streams. שימוש ב-`Writable.toWeb` + `Readable.toWeb`. מקור: `acp-bridge.ts:168-169`.

### ACP-4: ring buffer ל-stderr (100 שורות אחרונות)
ה-bridge תופס תמיד את ה-stderr של opencode, גם כש-printAgentLogs=false. שמירה ב-buffer של 100 שורות אחרונות. מקור: `acp-bridge.ts:147-165`. שימוש: חילוץ provider errors שopencode בולע (ראה PROMPT-13). חשיפה דרך `getRecentStderr()`.

### ACP-5: VOICE_ACP_VERBOSE → passthrough של stderr
אם `VOICE_ACP_VERBOSE=1` (או `true`, case-insensitive), ה-stderr של opencode עובר ל-stderr של השרת בנוסף ל-buffer. וגם מועבר ל-opencode הדגל `--print-logs`. מקור: `server.ts:35-38` + `acp-bridge.ts:141, 153-155`.

### ACP-6: YOLO permission mode
`requestPermission` של ה-client מאשר אוטומטית. עדיפות: `allow_always` > `allow_once` > הראשון. אם אין options → `cancelled`. מקור: `acp-bridge.ts:233-252`.

### ACP-7: עיבוד agent_message_chunk / agent_thought_chunk / user_message_chunk
שלושת ה-update kinds מומפים ל-`kind: "message" | "thought" | "user_message"` ומועברים ל-chunkHandler. מצטברים נפרד: `accumulatedText` (message בלבד), `accumulatedThought`. מקור: `acp-bridge.ts:184-203`.

### ACP-8: עיבוד tool_call / tool_call_update
שני ה-update kinds מומפים ל-`event: "create" | "update"` ומועברים ל-toolCallHandler. ב-update, ה-title עלול להיות חסר → ריק. מקור: `acp-bridge.ts:207-229`.

### ACP-9: התעלמות מ-plan / mode_update / config / session_info
כל update.sessionUpdate אחר — מתעלם בשתיקה. מקור: `acp-bridge.ts:230`.

### ACP-10: prompt רק עם sessionId קיים
`prompt()` זורק אם אין sessionId — חובה לקרוא ל-newSession() / loadSession() לפני. מקור: `acp-bridge.ts:347-349`.

### ACP-11: setModel הוא `unstable_setSessionModel`
ה-bridge קורא ל-`(conn as any).unstable_setSessionModel`. ייתכן שלא נתמך — נזרק error מודפס. מקור: `acp-bridge.ts:335-343`.

### ACP-12: dispose — סדר: stdin.end → SIGTERM → SIGKILL אחרי 2s
קודם `proc.stdin.end()` (signal soft-close ל-opencode), אז SIGTERM, אז SIGKILL כ-timeout fallback. מקור: `acp-bridge.ts:378-394`.

### ACP-13: stopReason ≠ end_turn → log warning בלבד
לא נזרקת שגיאה. מקור: `acp-bridge.ts:360-362`.

### ACP-14: loadSession משחזר היסטוריה דרך אותם handlers
חשוב: ה-handlers נכנסים לתוקף **לפני** הקריאה כדי לתפוס chunks של היסטוריה. נוקה ב-finally. מקור: `acp-bridge.ts:302-320`.

### ACP-15: extractSessionResult ל-availableModels + currentModelId
מ-`res.models` חולצים `availableModels` (מערך {modelId, name, description}) ו-`currentModelId`. מקור: `acp-bridge.ts:267-279`.

### ACP-16: listSessions — early return אם אין capability
אם `agentCaps?.sessionCapabilities?.list` falsy → מחזיר `[]` **בלי** קריאת RPC. מונע שגיאה ב-opencode versions שלא תומכים. מקור: `acp-bridge.ts:323-324`.

### ACP-17: newSession + loadSession שולחים `mcpServers: []` תמיד
voice-acp לא משתמש ב-MCP servers נוספים — passthrough של opencode בלבד. מקור: `acp-bridge.ts:292-293, 310-311`.

---

## PROMPT — זרימת ה-prompt (server.handlePrompt / handleUserInput)

### PROMPT-1: busy flag, איסור prompts מקבילים
`state.busy` מוגדר true בתחילת `handlePrompt`, מאופס ב-finally. אם busy → שגיאה "כבר בעיבוד הודעה אחרת". מקור: `server.ts:389-391, 440, 675`.

### PROMPT-2: שליחת `thinking` בתחילת prompt
מקור: `server.ts:444`.

### PROMPT-3: הזרקת system prompt בקריאה הראשונה
`isFirst = !state.firstPromptSent`. אם first → `VOICE_SYSTEM_PROMPT + text`. אחרת רק text. הדגל מתעדכן ל-true אחרי. מקור: `server.ts:448-450`.

### PROMPT-4: system prompt נחשב נשלח אם נטענה היסטוריה
`loadSession` במצב היסטוריה מסמן `firstPromptSent = true` כי ה-system prompt כבר חלק מהדאטה. מקור: `server.ts:310`.

### PROMPT-5: ttsQueue סדרתי משותף לכל הפלטים האודיו
`ttsQueue: Promise<void>`. כל קריאה מוסיפה `.then()`. סדר מובטח. מקור: `server.ts:455, 485, 523, 619`.

### PROMPT-6: streamCounter ל-streamId ייחודי
`streamId = "s" + Date.now().toString(36) + "-" + streamCounter++`. מקור: `server.ts:464`.

### PROMPT-7: streamTts עם try/catch לכל סגמנט
שגיאה בסגמנט TTS מודפסת ל-stderr; שולח `audio_end` בכל מקרה. ה-flow לא נעצר. מקור: `server.ts:479-482`.

### PROMPT-8: messageBuffer + flushMessage לפי גבול משפט
`onChunk(kind="message")`: `messageBuffer += chunk`, ואז loop של `findSentenceBoundary` — אם נמצא גבול: חיתוך ל-head, flush, וכל פעם ה-rest ממשיך. מקור: `server.ts:557-570`.

**חשוב — batching:** `findSentenceBoundary` מחזיר את הגבול ה**אחרון** ב-buffer (לא הראשון). כלומר chunk עם 3 משפטים שלמים (`"A. B. C. "`) → flush **יחיד** של כל הטקסט עד הגבול האחרון, ולא 3 flushes נפרדים. רק המשפט שעוד לא הסתיים (אם יש) נשאר ב-buffer ל-chunk הבא או ל-end-of-turn flush. נחשף בכתיבת בדיקות לשכבה 3 של הריפקטור — חשוב שריפקטור עתידי לא ישנה את ההתנהגות הזו.

### PROMPT-9: flushMessage עושה 3 פעולות בסדר
1. trim + **דריסה** של `lastAgentMessage` (לא הצברה — רק ה-flush האחרון נשמר) + push ל-`recentMessages` (FIFO max 3).
2. `renderMarkdown` → `message_rendered` event.
3. `queueTts(text, "message")`.
מקור: `server.ts:490-510`. הדריסה חשובה כי STT-3 מעביר את ה-`lastAgentMessage` הזה כ-context לתמלול הבא — צריך להיות הקטע ה**אחרון** שהמשתמש שמע, לא כל ההיסטוריה.

### PROMPT-10: thoughtBuffer + flushThought, async דרך ttsQueue
`flushThought` נכנס ל-`ttsQueue.then()` שעושה translate→null check→text_chunk thought_translation→streamTts(kind="thought"). מקור: `server.ts:517-538`.

### PROMPT-11: מעבר kind גורר flush של ה-buffer האחר
- chunk של `message` כש-`thoughtBuffer.length > 0` → `flushThought()`.
- chunk של `thought` כש-`messageBuffer.length > 0` → `flushMessage()`.
מקור: `server.ts:558-559, 572-573`.

### PROMPT-12: tool_call create גורר flushMessage + flushThought + narration
ב-create: שני ה-flushes, ואז `ttsQueue.then(narrateToolCall → streamTts(kind="tool_title"))`. **חשוב:** snapshot של `userMessage` ו-`recentMessages` נלקח ברגע ה-create — מונע race עם updates מאוחרים. מקור: `server.ts:603-631`.

### PROMPT-13: בסוף תור — flushMessage + flushThought
מקור: `server.ts:637-638`.

### PROMPT-14: סיכום prompt ללוג
בסיום: `[ws] סיכום prompt: message=Xch thought=Ych user_msg=Zch tools=Ncreate+Mupdate` + רשימת tools. מקור: `server.ts:640-647`.

### PROMPT-15: chunk עם kind="user_message" → התעלמות
מגיע רק מ-loadSession היסטוריה. ב-`handlePrompt` הרגיל הוא נספר ב-`cntUser` אבל לא מטופל. מקור: `server.ts:550-553`.

### PROMPT-16: text_chunk נשלח לכל chunk (כולל מחשבות)
אחרי הסיווג, **כל** chunk עובר `send(ws, text_chunk, kind, chunk)`. גם אם הוא ייחתך בהמשך. מקור: `server.ts:556`.

### PROMPT-17: totalMessageChars=0 → חילוץ provider error
אם 0 chars של message חזרו: בודקים `getRecentStderr()` עם `extractProviderError`. אם נמצא → `sendError("שגיאת provider: ...")`. אחרת אם היו thoughts/tools → "המודל ביצע פעולות אבל לא חזר עם תשובה מילולית". אחרת → "המודל לא ענה. נסי לנסח את השאלה אחרת". מקור: `server.ts:649-668`. **חשוב:** אחרי `sendError` עדיין נשלח `done` (PROMPT-18) — הקליינט מקבל זוג error+done.

### PROMPT-18: done לפני ש-ttsQueue מסיים
ה-server לא ממתין ל-`ttsQueue`; שולח `done` מיד אחרי שה-ACP prompt חזר. ה-frontend מטפל ב-audio_chunks ממשיכים להגיע. מקור: `server.ts:671-673`.

### PROMPT-19: extractProviderError — patterns
מחפש (א) `"message":"..."` עם מילים credit/invalid/unauthor/forbid/rate/limit/key ב-30 שורות אחרונות. (ב) `ERROR.*?error=(.+?)` ב-50 שורות אחרונות. מקור: `server.ts:45-61`.

### PROMPT-20: cancel ב-ACP
`{type: "cancel"}` מהקליינט קורא ל-`state.bridge.cancel()` עם catch-and-ignore. מקור: `server.ts:276-280`.

---

## TTS — ElevenLabs

### TTS-1: model_id = eleven_v3 (תמיכת עברית היחידה)
v2 מצהיר תמיכה אבל פולט עברית מסולפת. v3 הוא היחיד עם `language_id: "he"`. מקור: `tts.ts:40`. סיבה: גילוי בבדיקת `/v1/models` בבניית POC.

### TTS-2: ELEVENLABS_VOICE_ID דרך env (לא דרך OneCLI)
חסר → שגיאה. מקור: `tts.ts:32-37`.

### TTS-3: voice_settings ברירת מחדל — stability=0.5, similarity=0.75
מקור: `tts.ts:41-42`.

### TTS-4: cache in-memory לפי `voiceId|modelId|text`
`Map` בלי eviction. כל הקריאות בפרויקט צריכות לעבור דרך `cachedTextToSpeechBase64` / `streamCachedTextToSpeech`. מקור: `tts.ts:81-102`.

### TTS-5: streaming דרך `/v1/text-to-speech/{id}/stream`
ReadableStream, getReader, onChunk לכל value. מקור: `tts.ts:119-167`.

### TTS-6: cache hit ב-streaming → chunk יחיד
אם hit, כל ה-base64 נשלח כ-chunk אחד. מקור: `tts.ts:189-195`.

### TTS-7: API key placeholder
`xi-api-key: "placeholder"` — OneCLI מחליף. מקור: `tts.ts:48, 135`.

### TTS-8: שגיאת HTTP → throw עם status+body
מקור: `tts.ts:59-64, 146-151`.

### TTS-9: `ttsCacheStats()` exported — entries + bytes
public API להצגת מצב cache. מקור: `tts.ts:105-109`.

---

## GEMINI-HELPER — תרגום מחשבות + נראציה של כלים

### GEMINI-1: שני שירותים נפרדים
`translateThought(text)` — תרגום reasoning אנגלי לעברית.
`narrateToolCall(ctx, tool)` — ניסוח של תכלית הכלי במשפט עברי קצר.
מקור: `gemini-helper.ts` (קובץ).

### GEMINI-2: model = `gemini-flash-lite-latest`
מקור: ראה `gemini-helper.ts:DEFAULT_MODEL` (וע"פ walkthrough).

### GEMINI-3: timeout 2500ms ל-translateThought
withTimeout עם Promise.race. אם timeout → null (בעבר היה fallback לטקסט מקורי). מקור: walkthrough 14:40 (משימה J). **הערה:** ה-promise המקורי ממשיך לרוץ ברקע גם אחרי timeout — אין AbortController (POC).

### GEMINI-4: timeout 1500ms ל-narrateToolCall
fallback ל-title הגולמי במקרה כשל. מקור: walkthrough 11:25 (משימה C).

### GEMINI-5: translateThought מחזיר null בכישלון
חתימה `Promise<string | null>`. timeout, exception, ריק → null. ב-server: `flushThought` רואה null ומדלג על text_chunk **וגם** על TTS. מקור: walkthrough 14:40, `server.ts:524-530`. סיבה: באג שתוקן ב-J — fallback לאנגלית גורם ל-ElevenLabs להקריא תווים אנגליים בקול עברי = ג'יבריש.

### GEMINI-6: cache לפי טקסט (translation) / לפי toolCallId (narration)
שני Maps נפרדים. שומרים רק non-null. מקור: walkthrough 11:25.

### GEMINI-7: narrateToolCall עם 4 דוגמאות בפרומפט
read / bash / edit / build — "תכלית, לא פרמטרים". מקור: walkthrough 11:25.

### GEMINI-8: כשל לא עוצר את ה-flow
כל הכישלונות מודפסים ל-stderr, ה-promise חוזר עם fallback / null. ttsQueue ממשיכה. מקור: walkthrough 11:25 + 14:40.

### GEMINI-9: API key placeholder, OneCLI מטפל
GoogleGenAI מאותחל עם `"placeholder"`. אומת ב-CLI test ש-fallback עובד בלי OneCLI. מקור: walkthrough 11:25.

---

## REC — שמירת הקלטות

### REC-1: ברירת מחדל מופעל
`VOICE_ACP_SAVE_RECORDINGS=0` או `false` (case-insensitive) משבית. אחרת מופעל. מקור: `recordings.ts` + walkthrough 15:20.

### REC-2: נתיב — `$XDG_CACHE_HOME/voice-acp/recordings` או `$HOME/.cache/voice-acp/recordings`
מקור: `recordings.ts` + walkthrough 15:20.

### REC-3: שם קובץ — `<ISO-stamp>_<sid-short>.<ext>`
ext מ-mimeType: webm/ogg/mp3/wav/m4a/flac/audio. מקור: walkthrough 15:20.

### REC-4: שמירה ברקע, לא חוסמת
`saveRecording` ב-`handleAudio` נקרא בלי await. ה-promise נאסף ל-`.then()` שמוסיף metadata אחרי שהתמלול חוזר — גם הוא בלי await. מקור: `server.ts:397, 409-420`.

### REC-5: metadata sidecar JSON
שם תואם, מכיל: timestamp, sessionId, cwd, mimeType, audioSize, transcript, sttModel. מקור: walkthrough 15:20 + `server.ts:411-419`. **חשוב:** `audioSize` נמדד מ-`Buffer.from(base64).byteLength` — גודל ה-buffer לפני כתיבה, לא גודל הקובץ על דיסק.

### REC-6: שגיאות לא יוצרות שיבושים
כל שגיאה מודפסת ל-stderr, לא נזרקת. מקור: walkthrough 15:20.

### REC-7: לוג סטטוס בתחילת ריצה
`recordings: ON (path)` או `OFF`. מקור: `server.ts:248-250`.

### REC-8: `dirEnsured` flag — mkdir נקרא פעם אחת בחיי התהליך
`recordings.ts:26-31`. `mkdir(recursive:true)` אידמפוטנטי, אבל ה-flag חוסך syscalls בריצה ארוכה. אין lock — race נדיר אך אפשרי, נסבל כי `recursive:true` לא זורק על קיום.

---

## WS — פרוטוקול WebSocket

### WS-1: 4 הודעות client → server
`init`, `audio`, `text` (דיבוג, מדלג על STT), `cancel`. מקור: `server.ts:65-75`.

### WS-1b: נתיב `text` לא שומר transcript ב-lastUserText בלבד
`handleUserInput` מעדכן `lastUserText = text` בתחילתו (גם דרך text וגם דרך audio). **אבל** `lastAgentMessage` לא נכנס לתמונה ב-text path — אין שמירת הקלטה, אין transcript event ל-frontend. שונה מ-`audio` path. מקור: `server.ts:271-274, 430-439`.

### WS-2: הודעות server → client (פורמט קבוע)
`ready`, `transcript`, `thinking`, `text_chunk` (עם kind: message/thought/thought_translation), `tool_call`, `audio_ready` (legacy לhistory), `audio_start`/`audio_chunk`/`audio_end` (streaming), `message_rendered`, `done`, `error`, `history_start`/`history_chunk`/`history_tool_call`/`history_done`. מקור: `server.ts:77-131`.

### WS-3: JSON לא תקין → sendError
`"JSON לא תקין"`. מקור: `server.ts:222-225`.

### WS-4: state אחד לחיבור (ConnState)
WeakMap לפי ws. כולל: bridge, busy, firstPromptSent, voiceId, lastAgentMessage, lastUserText, recentMessages, cwd, sessionId. מקור: `server.ts:133-162`.

### WS-5: close → bridge.dispose
מקור: `server.ts:234-240`.

### WS-6: init פעמיים → שגיאה
`state.bridge != null` → "כבר אותחל". מקור: `server.ts:292-295`.

### WS-7: audio/text לפני init → שגיאה
`!state.bridge` → "צריך לשלוח init קודם" / "אין session". מקור: `server.ts:385-387, 435-437`.

### WS-8: voiceId נשמר ב-init לכל ה-TTS של ה-session
מקור: `server.ts:298, 469`.

### WS-9: model param ב-init → setModel אחרי newSession/loadSession
אם נכשל → sendError "לא ניתן להגדיר model". מקור: `server.ts:361-368`.

### WS-10: ready עם availableModels + currentModelId
נשלח אחרי init מוצלח. מקור: `server.ts:372-377`.

---

## HTTP — REST endpoints

### HTTP-1: `GET /api/info?cwd=<path>` — מודלים + sessions זמינים
spawns bridge **זמני** ל-cwd, יוצר session זמני (כדי לחלץ `availableModels`+`currentModelId`), קורא ל-`listSessions` (catch→[]), ואז `dispose`. עלות 3-5 שניות לקריאה (overhead של spawn opencode). מקור: `server.ts:747-775`.

### HTTP-2: `/api/info` — חסר cwd → 400
`{ error: "חסר פרמטר cwd" }`. מקור: `server.ts:749-751`.

### HTTP-3: `/api/info` — exception → 500
שגיאת bridge/session → `Response.json({ error: ... }, { status: 500 })`. ה-bridge תמיד נסגר ב-finally. מקור: `server.ts:767-774`.

### HTTP-4: `GET /api/voices` — מיפוי + סימון תומכי עברית
fetch ל-ElevenLabs `/v1/voices`. כל קול ממופה: voiceId, name, category, description, languages (מ-`verified_languages`), `supportsHebrew = languages.includes("he") || labels.language === "he"`. מקור: `server.ts:781-808`.

### HTTP-5: `/api/voices` — אלגוריתם מיון מדויק
לפי הסדר:
1. voiceId === `ELEVENLABS_VOICE_ID` (ברירת מחדל) → ראשון.
2. supportsHebrew=true לפני false.
3. category לפי map: `premade=0, professional=1, cloned=2, generated=3` (אחרת 9).
4. שם לפי `localeCompare`.
מקור: `server.ts:811-822`.

### HTTP-6: `/api/voices` — ElevenLabs לא תקין → 502
לא 500. שגיאת upstream → bad gateway. מקור: `server.ts:789-794`.

### HTTP-7: `POST /api/tts` — body validation
JSON לא תקין → 400 `"JSON לא תקין"`. `text` ריק (אחרי trim) → 400 `"חסר text"`. מקור: `server.ts:843-853`.

### HTTP-8: `/api/tts` — עובר דרך cache
`cachedTextToSpeechBase64` — קריאה חוזרת לאותו text+voiceId → cache hit. מקור: `server.ts:855-857`.

### HTTP-9: `/api/tts` — voiceId אופציונלי
אם חסר → `cachedTextToSpeechBase64` משתמש ב-`process.env.ELEVENLABS_VOICE_ID`. מקור: `server.ts:855-857`.

### HTTP-10: `GET /api/ls?path=&showHidden=` — חייב absolute
חייב להתחיל ב-`/`. אחרת → 400 `"path חייב להיות absolute"`. מקור: `server.ts:878-883`.

### HTTP-11: `/api/ls` — security: רק תחת $HOME או /tmp
`isAllowed = path === root || path.startsWith(root + PATH_SEP)` עבור each of `[$HOME, "/tmp"]`. אחרת → 403. מקור: `server.ts:884-894`.

### HTTP-12: `/api/ls` — `showHidden` מסנן dot-folders
`showHidden=1` בלבד יחשוף `.foo` folders. אחרת `e.name.startsWith(".")` → filter out. מקור: `server.ts:899-902`.

### HTTP-13: `/api/ls` — מחזיר רק תיקיות (לא קבצים)
`e.isDirectory()` הוא תנאי קשיח. קבצים מסוננים. מקור: `server.ts:900`.

### HTTP-14: `/api/ls` — מיון hebrew-aware
`a.name.localeCompare(b.name, "he")`. מקור: `server.ts:905`.

### HTTP-15: `/api/ls` — parent רק אם בטוח
`parent = dirname(path)` או `null` אם path === `/`. אם ה-parent מחוץ ל-allowed roots → parent מוגדר null (לא חושף את ה-/ או /home). מקור: `server.ts:908-913`.

### HTTP-16: `/api/ls` — תגובה: `{path, parent, home, entries}`
מקור: `server.ts:916-921`.

---

## MARKDOWN — רינדור Markdown + sanitization

### MARKDOWN-1: GFM + breaks
`marked.setOptions({ gfm: true, breaks: true })` — שורות חדשות הופכות ל-`<br>`. מקור: `markdown.ts:10-13`.

### MARKDOWN-2: טקסט ריק → string ריק
`if (!text) return ""`. מקור: `markdown.ts:28`.

### MARKDOWN-3: הסרת תגיות paired מסוכנות
Regex `DANGEROUS_TAGS` (case-insensitive, multi-line): `script|style|iframe|object|embed|form|meta|link|base|noscript` במבנה paired (`<tag...>content</tag>`). מקור: `markdown.ts:17`.

### MARKDOWN-4: הסרת תגיות self-closing מסוכנות
Regex `DANGEROUS_TAGS_SELF`: אותן תגיות במבנה `<tag .../>` או `<tag ...>`. נשלח **אחרי** ה-paired. מקור: `markdown.ts:18`.

### MARKDOWN-5: הסרת event attributes
Regex `EVENT_ATTRS`: כל `on<word>="..."` או `'...'` או `value` ללא ציטוט. מקור: `markdown.ts:19`.

### MARKDOWN-6: הסרת `href|src|action="javascript:..."`
Regex `JS_HREFS`. שלוש attributes, ערך תחילי `javascript:`. מקור: `markdown.ts:20`.

### MARKDOWN-7: סדר ה-replace קבוע
paired → self-closing → event attrs → javascript hrefs. מקור: `markdown.ts:30-34`.

### MARKDOWN-8: שימוש כפול — live + history
ב-server, `renderMarkdown` נקרא גם ב-`flushMessage` (live) וגם ב-`flushHistoryMessage` (loadSession). מקור: `server.ts:503, 320`.

---

## STATIC — הגשת קבצים סטטיים

### STATIC-1: path traversal — `..` או `\0` → 400
`pathname.includes("..") || pathname.includes("\0")` → `"Bad request"`. מקור: `server.ts:932-934`.

### STATIC-2: `/` → `/index.html`
`relative = pathname === "/" ? "/index.html" : pathname`. מקור: `server.ts:936`.

### STATIC-3: resolve + enforce startsWith(FRONTEND_DIR)
`filePath = resolve(FRONTEND_DIR, "." + relative)`. אם התוצאה לא מתחילה ב-`FRONTEND_DIR` (escape ניסיון) → 403 `"Forbidden"`. מקור: `server.ts:937-942`.

### STATIC-4: קובץ לא קיים → 404
`if (!await file.exists())` → 404 `"Not found"`. מקור: `server.ts:944-947`.

### STATIC-5: hit → `new Response(file)`
Bun מטפל אוטומטית ב-Content-Type, length, וכו'. מקור: `server.ts:949`.

---

## URL — URL params של frontend (index.html)

### URL-1: 5 params נקראים מ-`location.search`
`cwd`, `session`, `model`, `voice`, `car`. נקראים בעת DOMContentLoaded. מקור: `index.html:540-545`.

### URL-2: `car=1` או `car=true` (case-sensitive)
שני ערכים יוצרים true. אחרים → false. מקור: `index.html:545`.

### URL-3: `cwd` חסר → redirect ל-`/config.html`
`location.replace("/config.html")`. ה-frontend לא ינסה אפילו להתחבר. מקור: `index.html:601-603`.

### URL-4: `voiceParam` עובר ל-WebSocket init וגם ל-`/api/tts` POST
- `init` מועבר עם `voice: voiceParam`. מקור: `index.html:1463`.
- `fetchAudio` של bubble היסטורית מעביר `voiceId: voiceParam` ב-POST. מקור: `index.html:748`.

### URL-5: `sessionId` global מתחיל מ-`sessionIdParam` (אם יש)
משתנה אחרי `ready` event ל-sessionId מה-server. מקור: `index.html:608, 1492`.

---

## UI-HEADER — Header של index.html

### UI-HEADER-1: כותרת + meta + link להגדרות
`h1=voice-acp` + `#meta` (cwd · sessionId) + `<a href="/config.html">⚙</a>`. מקור: `index.html:514-520`.

### UI-HEADER-2: meta init = "מתחבר…", אז cwd + sessionId
`shortCwd(cwd)` (".../parent/dir") + ` · ` + `shortId(sessionId)` (12 חרס + …). מקור: `index.html:1486-1492`.

### UI-HEADER-3: meta על close → "החיבור נסגר", btn.disabled=true
מקור: `index.html:1474-1477`.

### UI-HEADER-4: meta על error → "שגיאת חיבור"
מקור: `index.html:1480`.

---

## UI-RECORD — הקלטת אודיו (MediaRecorder)

### UI-RECORD-1: getUserMedia מבקש מיקרופון
`navigator.mediaDevices.getUserMedia({ audio: true })`. כשלון → showError. מקור: `index.html:1607-1610`.

### UI-RECORD-2: mimeType fallback chain
`"audio/webm;codecs=opus"` → `"audio/webm"` → `""`. בדיקה דרך `MediaRecorder.isTypeSupported`. מקור: `index.html:1613-1615`.

### UI-RECORD-3: dataavailable + stop handlers
`dataavailable` אוסף chunks ל-`audioChunks`. `stop` עוצר את כל ה-tracks של ה-stream ואז קורא ל-`sendAudio`. מקור: `index.html:1622-1629`.

### UI-RECORD-4: sendAudio שולח base64 + mimeType
Blob → arrayBuffer → base64 (chunks של 0x8000 כדי לעמוד ב-call stack limit) → `{ type: "audio", data, mimeType }`. מקור: `index.html:1646-1669`.

### UI-RECORD-5: stopRecording מציג "שולח…"
לפני שה-blob נשלח בפועל. מקור: `index.html:1642`.

---

## UI-MIC — כפתור מיקרופון ו-state machine

### UI-MIC-1: 4 מצבים — idle/recording/speaking/paused
מקור: `frontend/index.html:947-968`.

### UI-MIC-2: data-state attribute (לא class)
`btn.dataset.state` — נקרא ע"י CSS עם attribute selectors. מקור: `index.html:973`. סיבה: מעבר מ-class בארגון של state machine במשימה G.

### UI-MIC-3: icons map
idle=🎙, recording=⏺, speaking=⏸, paused=▶. מקור: `index.html:957-962`.

### UI-MIC-4: aria-label לפי state
מקור: `index.html:975-984`.

### UI-MIC-5: stop-btn מופיע רק ב-speaking/paused
מקור: `index.html:986`.

### UI-MIC-6: getMicButtonState
isRecording → recording. אחרת אם `currentlyPlaying || currentStream` → paused/speaking לפי `audioIsPaused`. אחרת idle. מקור: `index.html:964-969`.

### UI-MIC-7: click handler לפי state
- idle → startRecording.
- recording → stopRecording.
- speaking → pauseAllAudio + audioIsPaused=true.
- paused → resumeAllAudio + audioIsPaused=false.
מקור: `index.html:1672-1693`.

### UI-MIC-8: stop-btn → stopAllAudio
מקור: `index.html:1695-1697`.

### UI-MIC-9: Space toggles idle↔recording בלבד
Space לא חוטף focus מהכפתור. אם focus על הכפתור → לא תופס (מניעת double-toggle). אם state ≠ idle/recording → לא תופס. מקור: `index.html:1699-1710`.

### UI-MIC-10: updateMicButton נקרא בכל state change
ב-startRecording, stopRecording, startStream, playNextStream (אחרי איפוס audioIsPaused), playSubBubbleAudio (start+end+error), onComplete של stream. מקור: walkthrough 12:40.

### UI-MIC-11: stopAllAudio מאפס הכל
currentStream, currentlyPlaying, streamOrder, activeStreams, audioIsPaused. setStatus("מוכן"). מקור: `index.html:1008-1023`.

### UI-MIC-12: pauseAllAudio + resumeAllAudio
פועלים על currentStream וגם על currentlyPlaying. catch silent. מקור: `index.html:989-1006`.

---

## UI-AUDIO — ניגון אודיו (live + replay)

### UI-AUDIO-1: שתי שכבות ניגון
- **live (StreamingAudio):** MediaSource progressive או fallback ל-Blob. מנוהל דרך `streamOrder[]` + `activeStreams` Map + `currentStream`.
- **replay (Audio רגיל):** מ-`audioBase64` שנשמר. מנוהל דרך `currentlyPlaying`.
מקור: `index.html:936-943, 1188-1191`.

### UI-AUDIO-2: StreamingAudio.useMSE אם זמין
בדיקה: `"MediaSource" in window && MediaSource.isTypeSupported("audio/mpeg")`. כשל → useMSE=false → fallback ל-Blob. מקור: `index.html:1041-1067`.

### UI-AUDIO-3: appendChunk שומר את ה-bytes לreplay
גם ב-MSE וגם ב-fallback, כל chunk נשמר ב-`this.chunks[]`. מקור: `index.html:1070-1079`.

### UI-AUDIO-4: endStream → endOfStream של MSE
או fallback ל-Blob אם לא MSE. מקור: `index.html:1099-1106`.

### UI-AUDIO-5: fallback to Blob — מבנה
חיבור chunks ל-Blob, URL.createObjectURL, audio.src. play אם `_playOnEnd`. מקור: `index.html:1108-1115`.

### UI-AUDIO-6: StreamingAudio.stop() — אגרסיבי
`audio.pause()` + `audio.src = ""` + `mediaSource.endOfStream()`. כל בלוק עטוף try/catch. מקור: `index.html:1142-1157`.

### UI-AUDIO-7: getBase64 ל-replay אחרי live
מחבר chunks ל-Uint8Array → btoa בחלקים של 0x8000. מקור: `index.html:1159-1174`.

### UI-AUDIO-8: handleAudioStart kind="message" — קפיצה אגרסיבית
ברגע שמתחיל audio_start של message: stop ל-currentStream אם kind="thought", iterate על streamOrder ומסיר thoughts (משאיר אחרים), משחזר streamOrder מ-`keep`. מקור: `index.html:1193-1217`. סיבה: באג שתוקן ב-L — thoughts ממשיכים לנגן אחרי שתשובה כבר זורמת.

### UI-AUDIO-9: handleAudioStart message/thought — קישור ל-bubble
- message: find sub עם kind="message" && !audioBase64 && !_streamId. שמירת `sub._streamId = streamId`.
- thought: find sub עם kind="thought" && !_streamId. (אין replay ל-thought).
מקור: `index.html:1219-1240`.

### UI-AUDIO-10: handleAudioStart יוצר StreamingAudio + רושם onComplete
ה-onComplete מסיר מ-activeStreams ומ-streamOrder, ואם זה היה currentStream → currentStream=null → playNextStream. מקור: `index.html:1241-1257`.

### UI-AUDIO-11: tool_title chime לפני TTS
`startStream` קורא ל-`playToolChime()` (await) אם kind="tool_title" — לפני `stream.play()`. מקור: `index.html:1260-1268`.

### UI-AUDIO-12: playNextStream רק אם streamOrder לא ריק
loop עד שמוצא stream חי. מקור: `index.html:1270-1280`.

### UI-AUDIO-13: audio_end → סיום של ה-stream
endStream + שמירת audioBase64 ל-sub (רק ל-message — לא ל-thought). lastAudioSub מתעדכן. replayLastBtn.disabled=false. מקור: `index.html` סביב 1296-1303.

### UI-AUDIO-14: playSubBubbleAudio
יוצר Audio חדש מ-`data:audio/mpeg;base64,...`. עוצר את הקודם דרך pauseAllAudio. מקור: `index.html:1315-1322`.

### UI-AUDIO-15: replayLastBtn click → השמעת lastAudioSub
מקור: `index.html:1340-1342`.

### UI-AUDIO-16: 5 states ל-replay-btn של בועת message
pending (spinner, disabled), ready (🔊), cold (🔊, היסטוריה), fetching (spinner), failed (⚠, ניתן לנסות). מקור: `index.html:667-697`.

### UI-AUDIO-17: cold → fetchAudio דרך `/api/tts`
ה-bubble ההיסטורית מבקשת TTS lazy. הצלחה → audioBase64 + setAudioState(ready) + play. כשל → setAudioState(failed). מקור: `index.html:714-738`.

### UI-AUDIO-18: thoughts לא נשמרים ל-replay
אין audioBase64, אין כפתור 🔊. מקור: walkthrough 12:05 (E).

### UI-AUDIO-19: thinking chime פעם אחת בתחילת תור
`playThinkingChime` — sine G4 בעוצמה 0.08, 200ms. מקור: `index.html:1354-1369`.

### UI-AUDIO-20: tool chime — שני tones (E5→C5) טריאנגל
0.18s, 200ms המתנה אחרי. מקור: `index.html:1373-1390`.

---

## UI-BUBBLES — בועות שיחה, רינדור, dir auto

### UI-BUBBLES-1: 4 סוגי בועות
`user`, `thought`, `tools`, `message`. כל אחד עם CSS משלו. מקור: `index.html:604`.

### UI-BUBBLES-2: dir="auto" על bubbleEl
כל בועה מקבלת dir=auto ב-constructor. הדפדפן ינחש כיוון לפי תווים חזקים ראשונים. מקור: `index.html:631`.

### UI-BUBBLES-3: SubBubble.audioState רק ל-message
init: pending אם live, cold אם historic. למה אחר → null. מקור: `index.html:615-620`.

### UI-BUBBLES-4: tools-bubble עם header + details collapsible
header עם summary + arrow ▸. click → toggleExpanded. מקור: `index.html:633-649`.

### UI-BUBBLES-5: thought sub-bubble — מקור + תרגום
ה-thought מציג שני אזורים: `_originalEl` (span אנגלית) + `_translationEl` (div.thought-translation עברית). שניהם בתוך אותה bubbleEl. מקור: `index.html:745-779` + walkthrough 12:05.

### UI-BUBBLES-6: appendText ל-thought לא דורס children
ב-thought, אם `_originalEl` קיים, מעדכן את ה-textContent שלו. אחרת יוצר span חדש. במקום `bubbleEl.textContent =` שהיה דורס את ה-translation. מקור: walkthrough 12:05.

### UI-BUBBLES-7: hasTranslation flag
ל-thought בלבד. setThoughtTranslation מסמן true. ה-handler של `thought_translation` מחפש sub `!hasTranslation`. מקור: `index.html:614, 773-779, 1463-1468`.

### UI-BUBBLES-8: thought-translation CSS — זהה למקור
רק `display:block` + `margin-top:4px`. הכל אחר יורש (כולל font-style האיטלי של המקור). מקור: `index.html:230` + walkthrough 14:45 (K). סיבה: באג hot-fix קודם הגדיל את הטקסט והוסיף border-top — Avi ביקש שהשפה תהיה המבחין היחיד.

### UI-BUBBLES-9: appendMessage עם sub-bubble חדש אם current rendered
אם currentSub.kind="message" עם hasHtml=true → סגור, יוצר sub חדש. מקור: walkthrough 13:30 (hot-fix).

### UI-BUBBLES-10: message_rendered → setHtml על sub משפט-משפט
מוצא sub עם kind="message" && !hasHtml. אם אין → יוצר חדש (מקרה: flush מרובה על chunk יחיד). מקור: `index.html:1495-1511`.

### UI-BUBBLES-11: setHtml מוסיף dir="auto" לכל element-child בלי dir
iterate על children. מקור: walkthrough 13:05 (I).

### UI-BUBBLES-12: renderToolItem עם dir="auto" ב-span השני
מקור: walkthrough 13:05.

### UI-BUBBLES-13: scrollChatToBottom נקרא בכל append
ב-SubBubble constructor, appendText, setHtml, setThoughtTranslation. מקור: `index.html:664` ועוד.

### UI-BUBBLES-14: AgentTurn מקבץ subs של תור אחד
`currentTurn`, `turns[]`. appendThought יוצר sub חדש אם current אינו thought. appendMessage — אם current אינו message או יש hasHtml. appendToolCall/upsertToolCall — sub יחיד מסוג "tools" עם Map של toolCallId. מקור: `index.html:846-895`.

### UI-BUBBLES-15: lastAudioSub — תמיד ה-sub עם audio_end אחרון
מתעדכן ב-audio_end (live) וב-fetchAudio הצלחה (history). מקור: walkthrough.

---

## UI-SCROLL — גלילה חכמה

### UI-SCROLL-1: chat עטוף ב-chat-wrap (position:relative)
כפתור ↓ ממוקם absolute יחסית ל-wrap, לא ל-chat (שיש בו overflow:auto). מקור: walkthrough 12:55.

### UI-SCROLL-2: model — user intent, לא distance בלבד
שדה `userInteractionAt: number`. listeners על wheel/touchstart/touchmove/mousedown/keydown (passive). מעדכנים timestamp. מקור: `index.html:540-543` + walkthrough 15:05 (M).

### UI-SCROLL-3: scroll handler — שלוש החלטות
- distance ≤ 10 → autoScrollEnabled=true + hide ↓.
- distance > 10 && isUser (אחרון <500ms) && autoScrollEnabled → autoScrollEnabled=false + show ↓.
- אחרת — בלי שינוי.
מקור: `index.html:545-561`.

### UI-SCROLL-4: jumpDownBtn click — חזרה אגרסיבית למטה
autoScrollEnabled=true + scrollTop=scrollHeight + hide. מקור: `index.html:563-567`.

### UI-SCROLL-5: scrollChatToBottom — early-exit אם autoScrollEnabled=false
מקור: walkthrough 15:05.

### UI-SCROLL-6: jump-down RTL-aware
`inset-inline-end: 14px` (לא `right:`). מקור: walkthrough 12:55.

---

## UI-HIST — היסטוריה

### UI-HIST-1: history_start מאפס chat
chatEl.innerHTML="", turns=[], currentTurn=null, currentUserSub=null, historyLastRole=null. setStatus("טוען היסטוריה…"). מקור: `index.html:1536-1543`.

### UI-HIST-2: history_chunk — חלוקה לפי kind ולפי gap ב-historyLastRole
user_message: אם role≠"user" → user sub חדש, currentTurn=null, role="user". appendText על currentUserSub.
thought/message: אם role≠"agent" → AgentTurn חדש (historic=true), role="agent". appendThought/appendMessage לפי kind.
מקור: `index.html:1563-1581`.

### UI-HIST-3: history_tool_call — בתוך תור agent
אם role≠"agent" || !currentTurn → AgentTurn חדש historic. upsertToolCall. מקור: `index.html:1583-1595`.

### UI-HIST-4: history_done → currentTurn=null, מצב מוכן
מקור: `index.html:1553-1559`.

### UI-HIST-5: ב-backend, flushHistoryMessage עם markdown
loadSession מבצע rendering של message segments דרך onChunk: thought/user_message או tool_call create גורר flush. בסוף — flush סופי. מקור: `init-handler.ts` (אחרי extraction מ-server.ts).

### UI-HIST-7: סדר history_tool_call לפני message_rendered (פוטנציאלי לתיקון)
ב-onToolCall, ה-`sink.send(history_tool_call)` נקרא **לפני** `flushHistoryMessage()`. כלומר ה-frontend מקבל את ה-tool_call event לפני שה-HTML של המסר הקודם נשלח. בהמשך ה-flush מתבצע ו-message_rendered מגיע. ה-frontend צריך להתמודד עם הסדר הזה (להחליף תוכן bubble קיים). אם יוחלף בעתיד — צריך לעדכן את הבדיקה במקביל.

### UI-HIST-6: בועת message היסטורית — audioState="cold"
כפתור 🔊 פעיל ללחיצה. הקליק → fetchAudio דרך /api/tts. מקור: `index.html:617-619, 714-738`.

---

## UI-CAR — מצב רכב

### UI-CAR-1: הפעלה דרך `?car=1` URL param
מציג כפתור fullscreen "🚗 הפעל בקרת רכב". לחיצה → enableCarMode. הכפתור נמחק. מקור: `index.html:1824-1839`.

### UI-CAR-2: AudioContext + noise loop gapless
AudioBufferSourceNode עם buffer של 5s, loop=true, gain=0.015. רעש לבן float32. הוא ה"קליפה" שמחזיקה MediaSession פעיל. מקור: `index.html:1737-1757` + walkthrough 08:45.

### UI-CAR-3: gain=0.015 — שקט נשמע אך מספיק למערכת
gain=0 לא מפעיל MediaSession בחלק מהדפדפנים. 0.015 hiss כמעט בלתי נשמע. מקור: walkthrough 08:45.

### UI-CAR-4: playStartupChime — A5→E6
לפני שה-noise loop מתחיל. 0.4s, 0.18 max gain. ממתין 450ms. מקור: `index.html:1717-1732`.

### UI-CAR-5: MediaSession action handlers
play/pause — toggle הקלטה. previoustrack → replayLastBtn.click(). מקור: `index.html:1801-1816`.

### UI-CAR-6: playbackState משתנה לפי data-state של mic
MutationObserver על btn[data-state]. recording → paused. אחר → playing. (כך לחיצה הבאה בבלוטוס תיקרא ל-pause handler שיעצור). מקור: `index.html:1843-1853`.

### UI-CAR-7: car mode רק עם MediaSession API
fallback ל-showError "הדפדפן לא תומך". מקור: `index.html:1771-1774`.

---

## CONFIG — דף הגדרות (config.html)

### CONFIG-1: localStorage key = `voice-acp:config`
JSON אובייקט: `{cwd, model, session, voice, car}`. מקור: `config.html:315`.

### CONFIG-2: בעת load — נקרא cwd + car מ-localStorage
רק שני שדות אלה משוחזרים מיד. model/session/voice יושבים בlocalStorage אבל לא ניתן לבחור עד שטוענים אפשרויות (כי תלויים ב-cwd). מקור: `config.html:361-363`.

### CONFIG-3: שדה cwd יכול להיכתב ידנית
input dir=ltr, monospace. מקור: `config.html:79-82, 253`.

### CONFIG-4: start button disabled עד שיש cwd
`updateStartButton`: `startBtn.disabled = !cwdInput.value.trim()`. listener על input. מקור: `config.html:365-369`.

### CONFIG-5: "טען אפשרויות" → `/api/info` → populate models + sessions
לחיצה. אם cwd חסר → "צריך להזין cwd קודם". במהלך הטעינה: `loadStatus = "טוען (יכול לקחת כמה שניות)…"`. בסיום: count לכל list. **אם stored.model/session קיים ב-options → בחירה אוטומטית**. מקור: `config.html:372-433`.

### CONFIG-6: format date hebrew
`d.toLocaleString("he-IL", { day, month, hour, minute })`. שימוש: session list labels. מקור: `config.html:435-447`.

### CONFIG-7: `loadVoices()` נקרא אוטומטית בעת load
לא חוכה ל-cwd. מקור: `config.html:615`.

### CONFIG-8: voice labels — emoji + category marker
`🇮🇱` לסומכי עברית, `[lang]` לאחרים עם שפה מוצהרת, ריק אחרת. `✓` ל-professional, `•` ל-cloned/generated, ריק ל-premade. מקור: `config.html:587-602`.

### CONFIG-9: voice "default" option תמיד ראשון
`— ברירת מחדל (xxx…) —` אם יש defaultVoiceId, אחרת רק `— ברירת מחדל —`. מקור: `config.html:577-585`.

### CONFIG-10: start button — בונה URL ו-redirect ל-/
`location.href = "/?" + URLSearchParams`. רק params לא ריקים נכנסים. שומר ב-localStorage לפני. מקור: `config.html:618-629`.

### CONFIG-11: reset button — confirm + מחיקת localStorage
`confirm("לאפס את כל ההגדרות?")` — אם false → לא עושה כלום. אחרת מנקה הכל. מקור: `config.html:632-646`.

---

## CONFIG-PICKER — folder picker modal

### CONFIG-PICKER-1: modal hidden by default, `display:none` כש-hidden
מקור: `config.html:142`.

### CONFIG-PICKER-2: browse button → openPicker(start)
start = cwd input || stored.cwd || "". מקור: `config.html:453-459`.

### CONFIG-PICKER-3: openPicker עם target ריק → /home (fallback)
אם אין initialPath → `pickerHome || "/home"` (לפני שה-home נטען מהshould). מקור: `config.html:477-484`.

### CONFIG-PICKER-4: navigateTo — fetch /api/ls + render
loading state, breadcrumb, entries. בכשל — error message + auto-fallback ל-pickerHome אם idx זה לא pickerHome. מקור: `config.html:487-513`.

### CONFIG-PICKER-5: breadcrumb clickable
`/` (root → home) + each part. מקור: `config.html:515-537`.

### CONFIG-PICKER-6: parent ".." link רק אם info.parent ≠ null
לפי security ב-`/api/ls` — אם הוא מחוץ ל-allowed roots, parent=null ולא יוצג. מקור: `config.html:541-547`.

### CONFIG-PICKER-7: empty folder → "תיקייה ריקה"
ב-`renderPickerEntries`. מקור: `config.html:548-555`.

### CONFIG-PICKER-8: select button → קובע cwd ב-input, סוגר modal
מקור: `config.html:463-469`.

### CONFIG-PICKER-9: click מחוץ ל-modal → סוגר
`if (e.target === pickerModal) hidden = true`. מקור: `config.html:470-472`.

### CONFIG-PICKER-10: x-close button → סוגר modal
מקור: `config.html:460-462`.

---

## משימת Q (תכנון, טרם בוצע) — התנהגויות צפויות

### Q-1: כפתורי ⏮ ו-⏭ ליד mic
hidden ב-idle ללא היסטוריה. מופיעים כשיש playbackHistory או streamOrder או currentStream.

### Q-2: playbackHistory — מערך של SubBubble (רק message עם audioBase64)
מתעדכן ב-onComplete של live message ובלחיצה ידנית על 🔊. אין כפילויות.

### Q-3: handleNext — קפיצה לסגמנט הבא
אם currentStream live → stop + הסר מ-queue + push to history → playNextStream.
אם currentlyPlaying replay → pause + playNextStream אם יש.
אחרת — playNextStream אם יש.

### Q-4: handlePrev — קפיצה לסגמנט הקודם
אם currentlyPlaying replay → restart (Audio חדש).
אם currentStream live → pop last from history → playSubBubbleAudio.
אחרת — pop from history + play.

### Q-5: keyboard shortcuts (אופציונלי)
← / → קוראים ל-handlePrev/handleNext, רק כש-activeElement אינו input/textarea.

### Q-6: stopAllAudio לא מאפס playbackHistory
ההיסטוריה נשמרת עד reload / session change.

---

## הערות לבדיקות (כיוון)

### הצעת ארגון לסוויטה

1. **Unit tests טהורות** (במיוחד `findSentenceBoundary`):
   - גבולות משפט באנגלית: `"Hello world. How are you?"` → ערך מסוים.
   - קיצורים: `"Hello Mr. Smith and Dr. Jones."` → -1.
   - עשרוני: `"The value is 3.14 exactly."` → -1.
   - נקודתיים: `"Section one:\nNext"` → ערך.
   - forced flush 200: `"x".repeat(220)` → 200.
   - עברית עם נקודה.

2. **Mock-based integration tests** (server + bridge עם mocks):
   - `bridge` מוחלף ב-stub. החלפת `transcribeAudio` ו-`textToSpeech` ו-`translateThought` ב-mocks.
   - **Scenario A**: prompt עם chunk יחיד של message → text_chunk + message_rendered + audio_start + audio_chunk + audio_end + done.
   - **Scenario B**: prompt עם 3 משפטים בתוך chunk → 3 flushMessage → 3 text_chunk + 3 audio_start + ...
   - **Scenario C**: prompt thought→message → thought_translation event + audio_start kind=thought + (אחר כך) audio_start kind=message.
   - **Scenario D**: prompt עם tool_call create → flushMessage קודם → tool_title TTS.
   - **Scenario E**: prompt עם 0 chars message + thoughts → error "ביצע פעולות אבל לא חזר".
   - **Scenario F**: prompt עם 0 chars + provider error ב-stderr → error "שגיאת provider: ...".
   - **Scenario G**: previousResponse עובר ל-STT.
   - **Scenario H**: cancel באמצע prompt.

3. **State tests** (ConnState):
   - busy בזמן prompt, מאופס בכשל.
   - firstPromptSent עובר ל-true.
   - recentMessages FIFO max 3.
   - lastAgentMessage = ה-flush האחרון בלבד.

4. **End-to-end smoke tests** (אופציונלי, עם stack חי):
   - שיחה קצרה דרך WebSocket אמיתי.
   - ריצה דרך OneCLI עם voice-acp agent.
   - מותר להיות slow ולא להריץ ב-CI הראשי.

### מה לא לבדוק ברמת ה-unit

- ElevenLabs נטו (זה רק fetch).
- Gemini נטו (זה רק client).
- DOM של frontend (יהיה ריפקטור משלו).

### עדיפויות

קודם **PROMPT-1..PROMPT-20** (לב המערכת) + **findSentenceBoundary** + **extractProviderError**.
אחר כך **ACP-7..ACP-17** + **GEMINI-3..GEMINI-8** + **MARKDOWN-1..8** (security) + **STATIC-1..5** (security).
אחר כך **HTTP-1..16** (REST endpoints — דורש mock של fetch + bridge stub).
אחרון: TTS cache, REC, frontend.

### היסטוריית עדכוני הקובץ הזה

- **18:25** — יצירה ראשונית עם 14 קטגוריות, ~130 התנהגויות.
- **19:50** — תיקון פערים אחרי בדיקה (sub-agent ses_1d835201). נוספו 3 קטגוריות שלמות (HTTP, MARKDOWN, STATIC) ופערים בקטגוריות קיימות. סה"כ ~170 התנהגויות.
- **20:20** — סקירה מעמיקה שנייה. נוספו 6 קטגוריות חדשות: SYSPROMPT (תוכן ה-system prompt בפירוט), URL (5 params של frontend), UI-HEADER (header של index), UI-RECORD (MediaRecorder flow), CONFIG-PICKER (folder picker — 10 התנהגויות נפרדות). הרחבת CONFIG הקיימת מ-5 לפריט 11. סה"כ ~210 התנהגויות.

### סטטוס כיסוי בדיקות (סוף שכבה 6 של v6)

- ✅ **ACP** (18 בדיקות) — `tests/acp-bridge.test.ts`
- ✅ **PROMPT** (18) — `tests/prompt-handler.test.ts`
- ✅ **STT** (מכוסה בעקיפין דרך audio-handler tests)
- ✅ **TTS** cache (20) — `tests/tts-cache.test.ts`
- ✅ **GEMINI** (35) — `tests/gemini-helper.test.ts`
- ✅ **REC** (21) — `tests/recordings.test.ts`
- ✅ **WS** entry conditions (ב-init/audio handlers)
- ✅ **HTTP** (53) — 4 קבצי api-*.test.ts
- ✅ **MARKDOWN** (29) — `tests/markdown.test.ts`
- ✅ **STATIC** (13) — `tests/static-path.test.ts`
- ✅ Helpers — findSentenceBoundary (21), extractProviderError (16)
- ⚠ **SYSPROMPT** — string constant, לא נצרך testing.
- ⚠ **URL/UI-*** — frontend, ריפקטור frontend בעתיד.

**סה"כ:** 267 בדיקות עוברות, מכסות את כל ההתנהגויות הקריטיות של ה-backend.

### אזורים שנבדקו בסקירה השנייה ולא הניבו פערים חדשים

- `backend/scripts/test-e2e.ts` ו-`test-e2e-audio.ts` — סקריפטים לבדיקה ידנית של ה-stack המלא, לא קוד פרודקשן. לא נצרך בדיקות.
- `backend/tsconfig.json` — קונפיג בלבד.
- `test-workspace/hello.js` — fixture לבדיקה ידנית.

### אזורים שלא נבדקים

- ספריות חיצוניות (marked, @agentclientprotocol/sdk, @google/genai).
- Bun internals (Bun.serve, Bun.file, Bun.write).
- Web APIs (MediaRecorder, MediaSource, WebSocket, Audio).
- Browser-specific behavior (RTL rendering, dir=auto).

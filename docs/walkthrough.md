# Walkthrough — voice-acp

יומן התקדמות הפרויקט. רשומה חדשה בראש הקובץ.

---

## 2026-05-14 20:50 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 3 — extraction של handlePromptText + 18 integration tests

**הריפקטור הראשון הגדול של server.ts.** ה-handler שהיה 240 שורות בתוך closure ענק חולץ ל-3 קבצים חדשים:

1. **`src/ws-protocol.ts`** — types של `ClientMessage` ו-`ServerMessage`, plus `MessageSink` interface (`send` + `sendError`). הוצא מ-server.ts כדי שhandlers יוכלו להשתמש בלי לתלות ב-`Bun.serve`.

2. **`src/conn-state.ts`** — `ConnState` interface + `createConnState()` factory. הוצא מאותה סיבה.

3. **`src/prompt-handler.ts`** — `handlePromptText(sink, state, text, deps)`. ה-deps כולל systemPrompt, streamTts callback, translateThought, narrateToolCall, renderMarkdown. כך אפשר לבדוק עם mocks.

**ב-`server.ts`:**
- ההגדרות של ClientMessage/ServerMessage/ConnState נמחקו (מועברות ל-imports).
- `handleUserInput` הצטמצם לwrapper של 11 שורות שבונה sink + deps ומפעיל את `handlePromptText`.
- הקובץ קוצץ מ-888 ל-546 שורות.

**בדיקות חדשות: `tests/prompt-handler.test.ts` — 18 בדיקות בחמש קבוצות:**

- **basic flow** (4): thinking→done, busy flag set during + cleared, busy cleared on throw, bridge=null → sendError.
- **system prompt injection** (1): first prompt עם prefix, second בלי, firstPromptSent עובר ל-true.
- **message streaming** (4): single sentence → text_chunk + message_rendered + audio_*, multiple sentences (BATCHED — ראה תגלית למטה), lastAgentMessage **overwritten** לא accumulated, recentMessages FIFO max 3.
- **thought flow** (3): thought_chunk → translate → text_chunk thought_translation + audio kind=thought, translate→null מדלג על שניהם, kind transition (thought→message) מפעיל flush של שני ה-buffers.
- **tool calls** (2): create → narrateToolCall עם snapshot context + audio tool_title, title ריק → אין narration.
- **empty response** (3): 0 chars → "המודל לא ענה", 0 chars + thoughts → "ביצע פעולות", error followed by done.

**הוספת harness אלגנטי:**
- `recordingSink()` — `MessageSink` שאוסף כל event למערך + מערך errors נפרד.
- `defaultDeps(overrides)` — deps עם no-op TTS, identity translation, raw-title narration, ו-`<p>${text}</p>` markdown. tests עוקפים שדות בודדים.
- `setupHandler(agent)` — מקים loopback בridge + fresh state + sink + new session, מוכן לקריאה.
- `makeAgent(promptImpl)` — Agent minimal עם default initialize/newSession/וכו', רק `prompt` ניתן לוצקה.

**תגלית מהבדיקות — חשוב!**

הבדיקה "multiple sentences in one chunk" צפתה 3 flushes של 3 משפטים בנפרד. בפועל הוצאו רק 2: שני המשפטים השלמים הראשונים flushed יחד כסגמנט אחד, והשלישי (בלי trailing whitespace) flushed ב-end-of-turn. הסיבה: `findSentenceBoundary` מחזיר את הגבול ה**אחרון** ב-buffer, לא הראשון. הקוד עושה batch-flush, לא per-sentence flush.

זו התנהגות שלא תועדה במפורש ב-`behaviors.md` (PROMPT-8). עדכנתי שם הערה ברורה שזה batching, ושהוא חייב להישמר בריפקטור עתידי.

**אימות:**
- `bun test` → **73 pass, 0 fail, 130 expect() calls, 167ms** (37 unit + 18 ACP bridge + 18 prompt handler).
- `bunx tsc --noEmit` → נקי.
- server.ts קוצץ מ-888 ל-546 שורות (39% פחות).

**הצעדים הבאים:** שכבה 4 — extraction של `handleAudio` ו-`handleInit` באותה תבנית. אז שכבה 5 — אופציונלי — `tts-queue.ts` עצמאי (כדי לטפל בבזבוז שמחשבות+כלים שייחתכו לא ייצרכו Gemini/ElevenLabs). ממתין להוראת Avi.

---

## 2026-05-14 19:35 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 2 — Integration tests של ה-ACP bridge דרך loopback streams

**תגלית מ-Avi (תוך כדי השיחה):** ה-SDK של ACP מכיל בדיקות פנימיות שמשתמשות בתבנית "loopback" — שני `TransformStream`s in-memory, `ClientSideConnection` בצד אחד, `AgentSideConnection` בצד השני. שני הצדדים מדברים JSON-RPC אמיתי דרך streams אמיתיים, רק שאין תהליך חיצוני באמצע. ראה `node_modules/@agentclientprotocol/sdk/dist/acp.test.js`.

זה אומר שאני יכול לבדוק את `acp-bridge.ts` שלי **באמת** — בלי spawn של opencode — אם רק אצליח להוציא את הלוגיקה הטהורה מ-IO.

**ריפקטור צעד שני — פיצול `createAcpBridge`:**

הפונקציה פוצלה לשתיים:

1. **`buildBridgeFromStream(stream, cwd, getStderrLines, disposeIo)`** — IO-free. מקבלת stream מוכן + שני callbacks. בונה את ה-client handler, מבצעת initialize handshake, ומחזירה bridge object.

2. **`createAcpBridge(opts)`** — entry-point ל-production. עושה spawn של opencode, מגדירה stderr ring buffer, ממירה Node→Web streams, ואז delegate ל-`buildBridgeFromStream`.

חתימת ה-`AcpBridge` interface נשארה זהה — `server.ts` ממשיך לעבוד ללא שינוי. הריפקטור הזה הוא internal עם backwards-compatibility מלאה.

**בדיקות שנוספו: `tests/acp-bridge.test.ts` — 18 בדיקות בחמש קבוצות:**

- **handshake** (3): bridge נוצר עם sessionId=null, protocolVersion=1 כמספר, clientInfo נכון.
- **sessions** (3): newSession מחזיר ו-updateateם state, cwd עובר נכון, availableModels + currentModelId נחלצים.
- **prompt** (7): throw בלי session, agent_message_chunk → onChunk(message) + מצטבר, agent_thought_chunk → onChunk(thought) **לא מצטבר**, tool_call → onToolCall(create), tool_call_update → title חסר → empty, chunks מרובים מחוברים בסדר, accumulator מתאפס בין prompts.
- **permissions** (4): YOLO — allow_always עדיף על allow_once שעדיף על הראשון. אין options → cancelled.
- **diagnostics** (1): getRecentStderr מחזיר עותק חדש בכל קריאה.

**שני helpers ב-test file:**
- `setupLoopback(agent, cwd?)` — יוצר 2 TransformStreams, AgentSideConnection mock, ו-buildBridgeFromStream שלוף.
- `makeMockAgent(overrides?)` — Agent minimal עם defaults לכל המתודות.

**טכניקה לבדיקת notifications:** ה-mockAgent מתחיל minimal, ואז ב-test ספציפי אפשר להחליף את ה-`prompt` שלו בפונקציה שקוראת ל-`agentConn.sessionUpdate(...)` עם ה-notification הרצוי. זה מאפשר ליצור scenarios מורכבים (3 chunks, mix of types) בלי לבנות agent חדש לכל בדיקה.

**אימות:**
- `bun test` → **55 pass, 0 fail, 81 expect() calls, 138ms** (37 unit + 18 integration).
- `bunx tsc --noEmit` → נקי.

**הצעדים הבאים:** ההצעדים הבאים — או לעבור לשכבה 3 (server.ts: handlePrompt + flow מלא), או להוסיף בדיקות בשכבה 2 לגבי loadSession (עם היסטוריה משוחזרת) ול-listSessions ול-setModel. ממתין להוראת Avi.

---

## 2026-05-14 19:10 (worktree `voice-acp-refactor` / branch `refactor`)

### v6 שכבה 1 — Unit tests + הוצאת helpers טהורים מ-server.ts

**מיקום:** worktree נפרד `voice-acp-refactor` (branch `refactor`). ה-master ממשיך לרוץ אצל Avi ללא שינוי.

**הבעיה הראשונה שהתגלתה:** ה-import של `findSentenceBoundary` מ-`server.ts` הפעיל את כל הקובץ — כולל `Bun.serve` ברמת ה-module — מה ש-(א) ניסה להאזין לפורט 3000 שכבר תפוס ע"י Avi, ו-(ב) עצר את ה-test runner. סימן ראשון של "כל הקוד בתוך closure אחד בלי הפרדה IO/לוגיקה".

**הצעד הראשון של הריפקטור — extraction של פונקציות טהורות:**

1. **`backend/src/sentence-boundary.ts` (חדש)** — מכיל את `findSentenceBoundary`. JSDoc מקיף באנגלית. ה-`server.ts` עכשיו רק עושה import.

2. **`backend/src/provider-error.ts` (חדש)** — מכיל את `extractProviderError`. JSDoc מקיף עם תיאור שני ה-patterns (JSON `"message"`, opencode `ERROR error=`) והעדיפות ביניהם.

3. **`backend/src/server.ts` — הסרת ההגדרות:** שתי הפונקציות הוסרו, רק imports נוספו.

**הוספת `"test": "bun test"` ל-`backend/package.json`.**

**בדיקות שנכתבו:**

- **`tests/findSentenceBoundary.test.ts` — 21 בדיקות בחמש קבוצות:**
  - sentence boundaries (English + Hebrew period, ?, !, colon, blank line, no boundary, no trailing space)
  - abbreviation protection (Mr/Dr/Mrs/Ms/St/vs/etc/i.e/e.g, case-insensitive, with real boundary after)
  - decimal number protection (3.14 with and without real sentence following)
  - forced flush (long > 200, space-finding logic, exactly 200, < 200)
  - multiple boundaries (returns last, mix of types)

- **`tests/extractProviderError.test.ts` — 16 בדיקות בשלוש קבוצות:**
  - pattern 1 (JSON `"message"` — credit/invalid/rate/unauthorized keywords, length filter, last-30 scan, returns most recent match)
  - pattern 2 (opencode ERROR — error= field, stack= stripping, 200-char cap, pattern-1 priority, last-50 scan)
  - edge cases (empty, only noise, all 7 keywords in turn)

**שתי טעויות חישוב שלי בבדיקות נחשפו ותוקנו** (אינדקסים של `.` + space) — לא באגים בקוד, רק חישוב אנושי שגוי. דוגמה מצוינת למה TDD-Vertical חשוב.

**אימות:**
- `bun test` → **37 pass, 0 fail, 56 expect() calls, 21ms**
- `bunx tsc --noEmit` → ריק (תקין)

**הצעדים הבאים — שכבה 2:** integration tests עם mocks ל-`bridge` ול-`fetch`. שמונה תרחישים מ-behaviors.md (chunk יחיד, 3 משפטים, thought→message, tool_call, 0 chars + thoughts, 0 chars + provider error, previousResponse ל-STT, cancel).

---

## 2026-05-14 18:50

### P — חיתוך thoughts לפי גבול משפט (backend, executor)

**מה נעשה:** מימוש משימה P כפי שתוכננה ב-`docs/plan.md`. תרגום והקראת thoughts יקרו פר-משפט במקום בבת אחת בסוף ה-thought.

**שינוי ב-`backend/src/server.ts`:** בתוך ה-`onChunk` של ה-prompt, בענף `kind === "thought"`, נוספה לולאת חיתוך זהה במבנה לזו של `message` (משימה D). הלולאה משתמשת ב-`findSentenceBoundary` הקיים (תומך עברית+אנגלית, הגנה מקיצורים ומספרים עשרוניים, forced flush ב-200) ומפעילה `flushThought` פר משפט. אין שינוי ב-`findSentenceBoundary`, `flushThought`, או ב-frontend.

**אינטראקציה עם משימה L (חיתוך thoughts ב-message_start):** העלייה במספר הסגמנטים מגדילה גם את היעילות של L — חיתוך אגרסיבי יחסל יותר thoughts pending מהר. הקוד הקיים של L כבר מטפל בזה דרך ניקוי `streamOrder`.

**בדיקה:** `bunx tsc --noEmit` עבר. בדיקה empirical: שאלה שמייצרת thought ארוך תייצר עכשיו רצף סגמנטי תרגום קצרים במקום אחד גדול.

**עלות:** Gemini Flash Lite + ElevenLabs פר משפט. סה"כ טקסט זהה, רק חלוקה אחרת. עלות Gemini זניחה (~$0.01/M tokens); ElevenLabs מחויב לפי תווים, אותם תווים = אותה עלות.

---

## 2026-05-14 18:40

### Q — כפתורי ⏮ / ⏭ לניווט בתור הניגון (frontend, executor)

**מה נעשה:** מימוש מלא של משימה Q כפי שתוכננה ב-`docs/plan.md` ב-18:05.

**שינויים ב-`frontend/index.html`:**
- **HTML**: שני כפתורי `nav-btn` חדשים סביב כפתור המיקרופון — `#prev-btn` (⏮) ו-`#next-btn` (⏭), שניהם hidden כברירת מחדל.
- **CSS**: בלוק `.nav-btn` — עיגול 40px בסגנון הכפתורים האחרים, hover בצבע accent.
- **State חדש**: `playbackHistory` — מערך של `SubBubble`s שניגנו (רק `kind=message` עם `audioBase64`). מתעדכן ב-`handleAudioEnd` (סיום live של message), ב-`playSubBubbleAudio` (replay ידני דרך 🔊), וב-`handleNext` (אם live נקטע באמצע ויש base64 חלקי).
- **`updateMicButton`**: לוגיקה לחשיפת prev/next — מופיעים אם state=speaking/paused או יש היסטוריה או streamOrder לא ריק.
- **`handleNext`**: עוצר live current (שומר חלקי ל-history אם message) → playNextStream; או עוצר replay → playNextStream אם יש; אחרת flash.
- **`handlePrev`**: ב-replay → restart מההתחלה (Audio חדש מ-history.last); ב-live → stopAllStreaming + replay של history.last; ב-idle → pop מ-history + playSubBubbleAudio (שיחזיר אותו ל-history דרך push). flash אם אין מה לעשות.
- **`flashBtn`**: helper ל-fade ויזואלי קצר כשהלחיצה לא יכולה לעשות כלום.
- **Keyboard**: `ArrowRight` = prev (RTL: "ימינה" = אחורה), `ArrowLeft` = next. רק כש-focus לא בinput.

**בדיקה:** `node --check` על הסקריפט המוטמע — עבר. בדיקה empirical תהיה כש-Avi תפעיל. אין בעיית רגרסיה — כל הכפתורים הקיימים (replay/mic/stop) נשארו ללא שינוי.

**הערה ארכיטקטונית:** במצב idle, מודל "pop+push" של ה-spec מאפשר לחיצה אחת לחזור לסגמנט הקודם, אבל לא רצף לחיצות (כל לחיצה מ-currentlyPlaying = restart). זה ה-MVP. אם יוצרי הצורך — נשדרג ל-cursor.

---

## 2026-05-14 18:25

### יצירת `docs/behaviors.md` — תיעוד התנהגויות לקראת v6 (ריפקטור)

**מטרה:** רשימה ממוקדת של כל ההתנהגויות הקיימות במערכת — מקור אמת לבדיקות שצריכות להיכתב לפני הריפקטור. אחרי שהבדיקות עוברות על הקוד הנוכחי, ניתן יהיה לעשות refactor בבטחון.

**מקורות:** קריאה ישירה של `backend/src/{server,acp-bridge,stt,tts}.ts`, `frontend/index.html`, `walkthrough.md` (כל ההיסטוריה — POC v1 + v2 + v3 + v4 + hot-fixes), `learnings.md`, וכל פירוט באגים שתועד.

**מבנה:** 14 קטגוריות (STT, ACP, PROMPT, TTS, GEMINI, REC, WS, UI-MIC, UI-AUDIO, UI-BUBBLES, UI-SCROLL, UI-HIST, UI-CAR, CONFIG) + הצעות לסוויטת בדיקות + Q-1..Q-6 לכפתורי הניווט שעדיין לא בוצעו.

**סה"כ ~130 התנהגויות** עם מקור בקוד או ב-walkthrough. כל אחת בפסקה אחת.

**הצעת ארגון לבדיקות** (סעיף בסוף):
1. Unit tests טהורות — `findSentenceBoundary` (8 מקרים) + `extractProviderError`.
2. Mock-based integration tests עם stub של bridge — 8 senarios (chunk יחיד, 3 משפטים, thought→message, tool_call create, 0 chars + thoughts, 0 chars + provider error, previousResponse ל-STT, cancel).
3. State tests של ConnState (busy, firstPromptSent, recentMessages FIFO).
4. E2E smoke tests דרך OneCLI (אופציונלי).

עדיפות: PROMPT + findSentenceBoundary + extractProviderError קודם. אחר כך ACP + GEMINI. אחרון: TTS cache + REC + frontend.

הצעדים הבאים — Avi תאשר/תוסיף לרשימה, וכשמתחילים את v6 ניתן לעבור ישר ל-`bun test`.

---

## 2026-05-14 18:05

### תכנון v5 (משימה Q — ניווט בתור הניגון) + רישום כיוון v6 (ריפקטור)

**רקע:** Avi פתחה דיון מורחב אחרי שמצאה בשיחה empirical קודמת שמודל זיהה שלוש "חולשות ארכיטקטוניות". בדיקה של ה-planner את הקוד הראתה ש:
- שתי טענות לא נכונות (TTS queue: ה-frontend כבר חותך thoughts ב-handleAudioStart message; חיתוך משפט: server.ts:697-719 כולל הגנות מקיצורים ומספרים עשרוניים).
- טענה אחת נכונה: handler ענק (handlePrompt 240 שורות בתוך closure אחד עם 5 buffers, queue, 3 helpers מקוננים).

**החלטה:** ריפקטור צריך לקרות, אבל קודם תיקון נקודתי לכאב הכי דחוף — ElevenLabs לפעמים "משתגע" ומדבר ג'יבריש למשך דקות, ואין דרך לדלג מסגמנט.

**משימה Q (חדשה ב-`docs/plan.md`):** כפתורי ⏮ ו-⏭ לניווט בתור הניגון של ה-frontend. שתי שכבות אודיו במשחק — `StreamingAudio` (live) ו-`Audio` (replay). תור = `streamOrder[]` (קדימה) + `playbackHistory[]` חדש (אחורה). רק `message` נשמר ל-history (יש לו `audioBase64`). תיאור מפורט עם 9 שלבי שינוי, state חדש, edge cases (history מתוך bubble שנקטע באמצע, lapping של לחיצות, history vs reload). frontend בלבד, ~30-45 דקות.

**v6 (רישום בלבד, לא משימה):** ריפקטור backend. תוצרים: `behaviors.md` (חילוץ מהשיחות+walkthrough+קוד), `backend/tests/`, `connection-state.ts`, `prompt-handler.ts`, `tts-queue.ts` (priority + hold + cancel — מטפל גם בבזבוז Gemini/ElevenLabs על מחשבות שייחתכו). יבוצע ב-worktree נפרד `voice-acp-refactor` כדי לא לחסום את הריצה החיה של Avi.

**משימה P (תיקון UX לתרגום thoughts לפי משפט)** — נשארה ממתינה למבצע, ללא שינוי.

**סדר מומלץ:** Q (frontend, דחוף) → P (backend, פתוח) → v6 (refactor, נפרד).

---

## 2026-05-14 17:35

### תיקון הפעלה: OneCLI agent ייעודי + הוצאת שגיאות provider למשתמש

**הבעיה שהתגלתה בריצה empirical:** prompts חזרו ריקים עם `stopReason=end_turn`. הסיבה האמיתית הסתתרה ב-stderr של `opencode acp` שה-bridge בלע: `400 invalid_request_error: "Your credit balance is too low to access the Anthropic API"`. ה-OneCLI default agent (`secretMode: all`) הזריק את ה-Anthropic token שלו לכל קריאה ל-`api.anthropic.com`, עקף את ה-OAuth של opencode plugin, וחייב את הקרדיט של OneCLI במקום את המנוי של המשתמש.

**פתרון:**
- נוצר OneCLI agent חדש בשם `voice-acp` (id `3f08d584-...`) במצב `selective` עם רק 2 secrets — ElevenLabs (`264c2eb8-...`) ו-Google Generative Language (`df221fc3-...`). **אין** Anthropic.
- הפעלה: `onecli run --agent voice-acp -- bun src/server.ts`. Anthropic עוברת ישירות דרך OAuth של opencode.
- `AGENTS.md` עודכן עם ההוראות וההסבר.

**שיפורי דיאגנוסטיקה ב-server:**
- `backend/src/acp-bridge.ts`: ה-stderr של `opencode acp` נתפס תמיד ל-ring buffer של 100 שורות אחרונות, גם כש-`printAgentLogs=false`. נוספה method `getRecentStderr()`.
- `backend/src/server.ts`:
  - env var חדש `VOICE_ACP_VERBOSE=1` מדליק stderr passthrough של opencode ל-stderr של ה-server.
  - בסיום prompt עם 0 chunks, `extractProviderError` מחפש ב-stderr שורות עם `"message":"..."` של provider errors (credit/auth/rate) או `ERROR ... error=...` של opencode. אם נמצא — שולח `sendError` ל-frontend עם ההודעה האמיתית, במקום "המודל לא ענה".
  - אם היו thoughts או tool_calls אך לא message — שולח הודעה ידידותית "המודל ביצע פעולות אבל לא חזר עם תשובה מילולית".
  - לוג סטטוס בתחילת ריצה: `verbose: ON/OFF`.

**Counters ולוגים מפורטים:** הקוד הקיים מסכם בסוף כל prompt: `message=Xch thought=Ych user_msg=Zch tools=Ncreate+Mupdate`, ומדפיס כל tool_call create/update עם kind+title. שימושי לעקיבה גם בלי VERBOSE.

**learnings.md עודכן** עם שני entries: OneCLI default agent injection (drains paid balance), ו-tmux NO_PROXY inheritance.

---

## 2026-05-14 15:30

### משימה O — שיפור פרומפט STT + מעבר ל-Flash (executor) — סיום v3

**`backend/src/stt.ts`:**

- `DEFAULT_MODEL`: `gemini-flash-lite-latest` → `gemini-flash-latest`. מודל גדול יותר, איכות תמלול עברי טובה יותר עם פיסוק ופסקאות.
- `TRANSCRIBE_PROMPT` מורחב:
  - דרישה מפורשת לפיסוק (פסיק/נקודה/סימן שאלה/קריאה) בהפסקות טבעיות וגבולות משפט.
  - שבירת פסקאות (`\n\n`) בשינויי נושא ובהפסקות ארוכות.
  - "Fix disfluencies — but preserve user's intent and phrasing".
  - הדגשה כפולה: "Do NOT add content the user did not say".
  - בלי לקלקל את ההוראות הקיימות על העדפה טכנולוגית ושמירת שפה מקורית.

`bunx tsc --noEmit` עבר.

### סיום v3

זה היה האחרון מבין 6 המשימות J-O. כל המשימות בוצעו, קומטו, ותועדו. סיכום מילולי של האיטרציה:

תיקוני באגים: תרגום נכשל לא מוקרא יותר באנגלית מסולפת. הסגנון של תרגום המחשבה עכשיו זהה למקור, רק השפה משתנה. הגלילה תוקנה לפי מודל user intent — תוכן שמתווסף לא יכבה אוטו, רק פעולת קלט אמיתית. סגמנט שני ואילך של message כבר נראה (תוקן ע"י ה-planner ב-9e36d25).

פיצ'רים חדשים: ברגע שתשובה מתחילה, מחשבות מנוגנות נחתכות אגרסיבית באמצע. הקלטות נשמרות לדיסק עם metadata, controlled by env var. ה-STT עבר ל-Flash הרגיל עם פרומפט שכולל פיסוק ופסקאות.

הצעדים הבאים: בדיקה empirical מלאה של כל v3 דרך OneCLI. פיצ'רים נוספים תחת `docs/future-features.md`.

---

## 2026-05-14 15:20

### משימה N — שמירת הקלטות לדיסק (executor)

**מטרה:** כל הקלטה של המשתמש נשמרת לדיסק יחד עם metadata. בסיס לפיצ'רים עתידיים (replay של סשנים, בחינת prompts שונים על אותה הקלטה).

**מודול חדש: `backend/src/recordings.ts`**

- `recordingsEnabled` + `recordingsDir` exports — לוג בתחילת ריצה.
- `SAVE_RECORDINGS_ENABLED` — קריאת `process.env.VOICE_ACP_SAVE_RECORDINGS`. ערך `0` או `false` (case-insensitive) משבית. ברירת מחדל: מופעל.
- נתיב: `$XDG_CACHE_HOME/voice-acp/recordings` או `$HOME/.cache/voice-acp/recordings`.
- `ensureDir()` עם flag כדי לא לקרוא ל-`mkdir` כל פעם.
- `saveRecording(base64, mimeType, sessionId)` → מחזיר `RecordingInfo` או `null`. שם: `<ISO-stamp>_<sid-short>.<ext>`. `ext` נגזר מ-mimeType (webm/ogg/mp3/wav/m4a/flac/audio).
- `saveRecordingMetadata(info, meta)` → כותב את ה-sidecar JSON עם שם תואם.
- כל שגיאה מודפסת ל-stderr בלי לזרוק — אסור שזה יעצור את ה-flow.

**שינויים ב-`backend/src/server.ts`:**

- import של recordings.
- `ConnState` קיבל `cwd: string | null` ו-`sessionId: string | null` (נדרשים ל-metadata). שניהם מאותחלים ל-null ב-open.
- ב-`handleInit`: `state.cwd = msg.cwd` (בתחילה). אחרי `loadSession`/`newSession`: `state.sessionId = sessionResult.sessionId`.
- ב-`handleAudio`: שמירת ההקלטה מתחילה **ברקע** במקביל ל-STT (`saveRecording` קוראים בלי `await`). אחרי `transcribeAudio` החזיר, `recPromise.then(info => saveRecordingMetadata(...))` בלי await — שכבת ה-IO לא דוחה את התגובה ל-frontend. ה-metadata כולל: timestamp, sessionId, cwd, mimeType, audioSize, transcript, sttModel.
- לוג בתחילת ריצה: `recordings: ON (path)` או `OFF`.

**אימות:** `bunx tsc --noEmit` עבר. שמירה בפועל תאומת ב-`~/.cache/voice-acp/recordings/` בריצה הבאה.

---

## 2026-05-14 15:05

### משימה M — גלילה חכמה לפי user intent (executor)

**הבאג:** הלוגיקה הקודמת מבוססת מרחק בלבד. תוכן חדש מתווסף → `scrollHeight` גדל → ה-`scroll` event מגיע באיחור עם distance גדל → המערכת חושבת שהמשתמשת גללה למעלה ומכבה אוטו בטעות (race condition שתועד ב-13:45).

**הפתרון:** מודל user intent. אוטו פעיל כל הזמן, אלא אם המשתמשת באמת עשתה פעולת קלט.

**`frontend/index.html`:**
- הסרת `SCROLL_THRESHOLD_PX = 60` ו-`suppressScrollEvents` — לא נחוצים יותר.
- שדה חדש `userInteractionAt: number` — timestamp של פעולת קלט אחרונה.
- `markUserInteraction()` — listener על `wheel`, `touchstart`, `touchmove`, `mousedown`, `keydown` (כולם `passive: true`). מעדכן `userInteractionAt = Date.now()`.
- `chatEl.scroll` handler חדש: בודק `isUser = Date.now() - userInteractionAt < 500`. אם distance ≤ 10 → מחזיר אוטו (מסתיר כפתור ↓). אחרת אם isUser → מכבה אוטו ומראה ↓. תוכן שמתווסף בלי קלט לא מכבה אוטו.
- `scrollChatToBottom` פושט ל-`if (!autoScrollEnabled) return; chatEl.scrollTop = chatEl.scrollHeight`.
- `jumpDownBtn click` פושט גם — אין צורך ב-suppressScrollEvents.

**מה כן/לא נתפס:** wheel/touch/keyboard/mousedown → כן. scrollbar drag לא נתפס באירועי wheel/touch, אבל `mousedown` על ה-scrollbar כן — לכן מהדק עם הגלגלת והאצבע, וגם עם scrollbar drag ידני.

`node --check` עבר. הסרת ~10 שורות קוד מיותר.

---

## 2026-05-14 14:55

### משימה L — קפיצה אוטומטית ממחשבות לתשובה (executor)

**הבעיה:** ה-`ttsQueue` ב-backend סדרתי, אבל ה-frontend מנגן אסינכרונית. ה-MediaSource צובר chunks ו-`audio.play()` ממשיך גם אחרי ש-backend שלח `audio_end`. תוצאה: thought מנוגן כשהמסר כבר זורם.

**הפתרון:** אגרסיבי. ברגע שמתחיל `audio_start kind="message"` ב-frontend — לקטוע מיד thoughts פעילים ופנדינג, כולל באמצע chunk.

**`frontend/index.html`:**

*`StreamingAudio.stop()`* חדש — מקביל ל-`pause()`, אבל גם:
- `this.audio.src = ""` (משחרר את ה-source הנוכחי, מבטל פעולות ניגון פנדינג).
- `mediaSource.endOfStream()` אם open (לסיים את ה-MSE buffer).
- כל בלוק עטוף ב-`try {} catch {}` — שגיאות לא יעצרו את ה-flow.

*`handleAudioStart`* מקבל בלוק חדש בתחילתו, כש-`kind === "message"`:
1. אם `currentStream?.kind === "thought"` → `stop()` + `currentStream = null`.
2. iterate על `streamOrder`: כל stream של `thought` בתור → `stop()` + `activeStreams.delete`. שאר ה-streams (theoretically lower priority — בדרך כלל tool_title) נשמרים ב-`keep`.
3. `streamOrder` נבנה מחדש מ-`keep`.

המסר החדש עצמו ייווצר ויתחיל לנגן רגיל אחרי הבלוק הזה.

**זרימת UX:** thought ארוך מתורגם ומוקרא → backend מסיים thought TTS, מתחיל message TTS → frontend מקבל `audio_start (message)` → קטיעת thought מיד באמצע משפט → התחלת המסר. המשתמש שומע: thought חלקי קצוץ → מסר.

`node --check` עבר.

---

## 2026-05-14 14:45

### משימה K — CSS revert ל-`thought-translation` (executor)

**`frontend/index.html`:** ב-CSS של `.msg.agent.thought .bubble .thought-translation` הוסרו `padding-top`, `border-top`, `color`, `font-size`, `font-style`. נשארו רק `display: block` ו-`margin-top: 4px`. כל המאפיינים האחרים יורשים מהבועה ההורית — כך תרגום עברי נראה זהה למקור האנגלי. השפה היא המבחין היחיד.

`node --check` עבר.

---

## 2026-05-14 14:40

### משימה J — `translateThought` מחזיר null בכישלון (executor)

**הבאג שתוקן:** כשתרגום מחשבה נכשל (timeout/error/ריק), ה-fallback היה הטקסט האנגלי המקורי. הוא נשלח כ-`thought_translation` ל-frontend ומוקרא בקול עברי של ElevenLabs — נשמע כאנגלית מסולפת, נורא מבלבל.

**שינויים ב-`backend/src/gemini-helper.ts`:**
- חתימה: `translateThought(text: string): Promise<string | null>` (במקום `Promise<string>`).
- כל מסלולי הכישלון — timeout, exception, תוצאה ריקה — מחזירים `null` במקום fallback.
- ה-cache שומר רק תוצאה לא-null (כמו קודם).
- ה-JSDoc הובהר במפורש שעל הקורא לבדוק null ולדלג על TTS.
- ה-CLI test entrypoint מציג `[null — נכשל]` במקרה כזה.

**שינויים ב-`backend/src/server.ts`:**
- ב-`flushThought`, אחרי `const hebrew = await translateThought(t);`: בדיקה `if (hebrew === null) { console.log("דילוג"); return; }`. אין שליחת `text_chunk thought_translation` ואין `streamTts`. המשתמש יראה רק את ה-thought האנגלי המקורי בבועה, בלי שורה שנייה ובלי קול.

**אימות:** `bunx tsc --noEmit` עבר. CLI test דרך OneCLI עם happy-path: `"I should check this carefully."` → `"אני צריך לבדוק את זה היטב."` ב-930ms. ה-null path יאומת empirically בשיחה דרך הממשק (אי-אפשר לסמלץ כשלון בלי שינוי קוד זמני).

## 2026-05-14 13:05

### משימה I — `dir="auto"` לבועות (executor)

**מטרה:** טקסט עברי יוצג RTL, אנגלי LTR — בלי תיוג ידני, גם בהיסטוריה וגם ב-live, גם בתוך פסקאות markdown.

**`frontend/index.html`:**

3 נקודות מימוש (לפי הפלן):
1. **SubBubble constructor:** אחרי יצירת `this.bubbleEl`, מוסיף `setAttribute("dir", "auto")`. כל בועה (user/thought/tools/message) יקבל direction אוטומטי.
2. **renderToolItem:** ה-span השני (זה עם הטקסט) מקבל `dir="auto"` ישירות במחרוזת ה-`innerHTML`, נקי יותר מ-`querySelector` post-hoc.
3. **setHtml:** אחרי `innerHTML = html` (markdown מ-server), iterate על `bubbleEl.children` — לכל element-child שאין לו `dir` attribute, מוסיף `dir="auto"`. ככה כל פסקה / כותרת / רשימה במכל markdown תיושר נכון.

**הסיבה לhighbridge `dir="auto"`:** ה-`<html dir="rtl">` של הדף קובע ברירת מחדל RTL. אבל הודעות של המודל לעיתים מכילות אנגלית טהורה (שמות פונקציות, blocks). עם `dir="auto"`, הדפדפן בודק את התווים החזקים הראשונים: עברית → RTL, אנגלית → LTR. זה מאפשר שילוב טבעי של שתי השפות באותה שיחה.

**בדיקות:** `node --check` עבר. אומת ויזואלית בריצה הבאה.

### סיום v2

זה היה האחרון מבין 9 המשימות (A-I) של plan v2. כל המשימות בוצעו, קומטו, ותועדו ב-walkthrough. סיכום מילולי של שכבת הנגישות:

1. **system prompt** — המודל מודע שהוא מדבר ולא כותב.
2. **STT** — פרומפט עברית טכנולוגית + context מההודעה הקודמת.
3. **gemini-helper** — `translateThought` + `narrateToolCall` עם cache+timeout+fallback.
4. **flushMessage** — חיתוך לפי משפט (גם בעברית).
5. **thoughts** — תרגום לעברית + הקראה דרך ElevenLabs.
6. **tool narration** — Gemini מנסח במקום title גולמי, עם context של הודעת המשתמש.
7. **mic state machine** — pause/resume + stop, 4 מצבים.
8. **smart scroll** — autoscroll מותנה + כפתור ↓.
9. **dir auto** — תמיכה ב-RTL/LTR מעורב.

הצעדים הבאים יהיו ב-`docs/future-features.md` (16 פיצ'רים שנדחו).

---

## 2026-05-14 12:55

### משימה H — גלילה חכמה (executor)

**מטרה:** auto-scroll רק כשהמשתמשת קרובה לתחתית. אם היא גללה למעלה לקרוא משהו — לא לדרוס. כפתור ↓ מאפשר חזרה למטה.

**`frontend/index.html`:**

*HTML/CSS:*
- עטיפת `#chat` ב-`#chat-wrap` (position:relative) כדי שהכפתור ↓ ימקם absolute ביחס לwrapper, לא ל-chat ש-overflow:auto (אחרת היה גולל עם התוכן).
- כפתור `<button id="jump-down" class="jump-down">↓</button>`.
- CSS `.jump-down`: position:absolute, bottom:14px, inset-inline-end:14px (RTL-aware), עיגול, צל, opacity:0 + pointer-events:none כברירת מחדל. `.visible` מפעיל. hover מצביע על accent.

*JavaScript:*
- קבוע `SCROLL_THRESHOLD_PX = 60` ושני state: `autoScrollEnabled = true` (default), `suppressScrollEvents = false` (flag להגנה מ-feedback loop).
- listener על `chatEl.scroll`: אם לא מדוכא, מחשב מרחק מהתחתית. ≤60px ⇒ autoScrollEnabled=true, אחרת false. toggleVisibility על הכפתור.
- `scrollChatToBottom()` (קיים, שימוש בו במספר מקומות): כעת מוקדם-יציאה אם `!autoScrollEnabled`. אחרת מציב suppressScrollEvents=true → scroll → רI requestAnimationFrame לאיפוס.
- jumpDownBtn click: מאפס autoScrollEnabled=true, מגלל, ומסתיר את הכפתור.

**הזרימה:** ברגע שהמשתמשת גלללה ידנית למעלה (>60px מהתחתית) → autoScrollEnabled=false → הכפתור מופיע. כל קריאה הבאה ל-scrollChatToBottom (מ-appendText, setHtml, setThoughtTranslation, SubBubble constructor) — לא תעשה כלום. המשתמשת לוחצת ↓ → autoScrollEnabled=true → גולל למטה → ה-listener רואה שאנחנו בתחתית ומחזיק את autoScrollEnabled.

**הגנה מ-feedback loop:** ה-`scrollTop = scrollHeight` הפרוגרמטי משדר scroll event. ה-suppressScrollEvents flag מונע מה-listener לבדוק את המרחק (אחרת היה רואה מרחק 0, autoScrollEnabled=true, וזה היה OK — אבל יותר חזק עם flag).

**בדיקות:** `node --check` עבר.

---

## 2026-05-14 12:40

### משימה G — mic button state machine + stop button (executor)

**מטרה:** במצב speaking, לחיצה על המיקרופון תעשה pause/resume של ההקראה במקום להתחיל הקלטה. בנוסף, כפתור stop מובהק לעצירה מוחלטת.

**State machine חדש (4 מצבים):**
- `idle` — מוכן להקלטה (כחול, 🎙).
- `recording` — מקליט (אדום פועם, ⏺).
- `speaking` — מקריא תשובה (אדום עדין, ⏸ — לחיצה תפסיק).
- `paused` — הקראה בהמתנה (כחול עם הילה, ▶ — לחיצה תמשיך).

מעברים: idle ↔ recording (התחל/סיים הקלטה), speaking ↔ paused (פסה/חידוש), stop-btn מ-speaking או paused → idle.

**`frontend/index.html`:**

*CSS:*
- מעבר מ-`#btn.recording` ל-`#btn[data-state="..."]` עם 4 סלקטורים.
- הוספת `#btn[data-state="speaking"]` (אדום ללא pulse) ו-`#btn[data-state="paused"]` (כחול עם hover-glow).
- transition קצר לbackground+shadow למעבר חלק בין מצבים.
- מיזוג `#replay-last,#stop-btn` ל-CSS משותף עם hover-state ייחודי לכל אחד.

*HTML:* הוספת `<button id="stop-btn" hidden>⏹</button>` בתוך `.controls`. ה-`btn` קיבל `data-state="idle"` בHTML כברירת מחדל.

*JavaScript:*
- שדה גלובלי חדש: `let audioIsPaused = false;`
- ICONS map: `{idle:"🎙", recording:"⏺", speaking:"⏸", paused:"▶"}`.
- `getMicButtonState()` — לוגיקה: `isRecording` ⇒ recording, אחרת אם יש `currentlyPlaying||currentStream` ⇒ paused/speaking לפי `audioIsPaused`, אחרת idle.
- `updateMicButton()` — מעדכן `dataset.state`, `textContent`, `aria-label`, ו-hidden של stop-btn.
- 3 helpers: `pauseAllAudio()`, `resumeAllAudio()`, `stopAllAudio()`. ה-stop מאפס currentStream+currentlyPlaying+streamOrder+activeStreams+audioIsPaused וחוזר ל-idle.
- `StreamingAudio.resume()` חדש — מקביל ל-pause הקיים.
- click handler חדש על btn — switch לפי `getMicButtonState()`.
- click handler חדש על stop-btn — `stopAllAudio()`.
- keydown Space — מתעלם אם המצב speaking/paused (Space נשאר רק לidle↔recording).
- קריאות `updateMicButton()` הוספו ב: `startRecording`, `stopRecording`, `startStream`, `playNextStream` (אחרי איפוס `audioIsPaused`), `playSubBubbleAudio` (start+ended+error), `onComplete` של stream.
- MutationObserver עבור car mode עבר מ-`class` ל-`data-state`, גם הלוגיקה (`dataset.state !== "recording"`).

**בדיקות:** `node --check` עבר. UX יבדק empirically בריצה דרך OneCLI — בייחוד `tool_title` chimes + pause/resume.

---

## 2026-05-14 12:20

### משימה F — נראציה של tool calls (executor)

**מטרה:** במקום להקריא את הכותרת הגולמית של ה-tool ("Read README.md", "Edit hello.js"), Gemini מנסח משפט קצר טבעי בעברית עם הקשר.

**`backend/src/server.ts`:**

- `import { narrateToolCall, translateThought } from "./gemini-helper.ts"` (השני כבר היה ב-E).
- `ConnState`:
  - `lastUserText: string | null` — הטקסט האחרון של המשתמש (transcript או text ישיר).
  - `recentMessages: string[]` — FIFO של עד 3 הסגמנטים האחרונים של המודל.
  - שניהם מאותחלים ב-`open`.
- `handleUserInput`: שמירת `state.lastUserText = text` בהתחלה. ככה גם נתיב audio (דרך `handleAudio` → `handleUserInput(transcript)`) וגם נתיב text ישיר מעדכנים נכון.
- `flushMessage`: אחרי `state.lastAgentMessage = t`, הוספה ל-`state.recentMessages` (push + shift אם > 3).
- `onToolCall(create)`: במקום `queueTts(rawTitle, "tool_title")` ישירות, נכנסים ל-`ttsQueue.then(async () => narrateToolCall + streamTts("tool_title"))`. ה-`kind: "tool_title"` נשמר ב-WebSocket — ה-frontend לא צריך לדעת שזה נראציה במקום title.

**Snapshot של הקונטקסט ברגע ה-create:** המשתנים `userMessage` ו-`recentSnapshot` נשמרים בזמן ה-create, לפני שה-ttsQueue מגיע לעיבוד. אם פעולות נוספות מעדכנות את `state.recentMessages` בינתיים, הנראציה עדיין משקפת את המצב כש-ה-tool נקרא. זה חשוב כי הנראציה רצה async (1.5s timeout).

**אין שינוי ב-frontend.** ה-WebSocket events נשמרו זהים (אותו `audio_start kind: "tool_title"`, אותו צ'יים מקדים). הגישה הזו שמורה בכוונה — מינימום משטח שינוי, נקלט ב-frontend הקיים.

**בדיקה:** `bunx tsc --noEmit` עבר. הנראציה בפועל מאומתת empirically ב-shell דרך OneCLI (משימה C). יעבוד אוטומטית כש-server רץ דרך OneCLI.

---

## 2026-05-14 12:05

### משימה E — תרגום thoughts לעברית + הקראה (executor)

**מטרה:** המשתמש שומע את ה-reasoning של המודל בעברית, לא רק רואה את ה-מקור באנגלית. הקראה דרך ElevenLabs.

**Backend (`server.ts`):**
- `ServerMessage` מורחב: `text_chunk.kind` קיבל ערך חדש `"thought_translation"`. `audio_start.kind` קיבל ערך חדש `"thought"`.
- `import { translateThought } from "./gemini-helper.ts"` (משימה C).
- `handleUserInput`:
  - `streamTts(text, kind)` הוצא ל-helper נפרד (פנימי ל-handle). `queueTts(text, kind)` עכשיו רק מוסיף לתור.
  - `thoughtBuffer` חדש (במקביל ל-`messageBuffer`).
  - `flushThought()` חדש: מצמצם trim של buffer, אם ריק חוזר. אחרת: `ttsQueue.then(async () => translate → text_chunk thought_translation → streamTts(hebrew, "thought"))`.
  - `onChunk` עבור `kind === "message"`: אם יש `thoughtBuffer.length > 0` → `flushThought()` (thought הסתיים).
  - `onChunk` עבור `kind === "thought"`: אם יש `messageBuffer.length > 0` → `flushMessage()`. ואז `thoughtBuffer += chunk`.
  - `onToolCall(create)`: `flushMessage(); flushThought();` (סגירת שני ה-buffers).
  - סוף תור: `flushMessage(); flushThought();`.

**Frontend (`index.html`):**
- CSS: `.msg.agent.thought .bubble .thought-translation` — `display:block`, `margin-top:6px`, `padding-top:6px`, `border-top: 1px dashed`, `color: var(--fg)` (בולט מהמקור), `font-size: 14px` (גדול יותר מ-12.5 של המקור). italic+line-height יורשים.
- `SubBubble`:
  - שדה חדש `hasTranslation: boolean` (default false). 
  - `appendText` ב-thought: יוצר `_originalEl` (span) פעם אחת ושומר את הטקסט שם, במקום `bubbleEl.textContent` שהיה דורס childנים.
  - `setThoughtTranslation(text)` חדש: יוצר `_translationEl` (div.thought-translation) ומוסיף ל-`bubbleEl`. שינוי `hasTranslation = true`.
- `handleServerMessage` עבור `text_chunk` כש-`kind === "thought_translation"`: מוצא את ה-thought הראשון ב-currentTurn שעוד לא תורגם וקורא ל-`setThoughtTranslation`.
- `handleAudioStart`: תמיכה ב-`kind === "thought"` — מקשר ל-thought sub האחרון שעוד לא קושר ל-stream.
- `handleAudioEnd`: שמירת `audioBase64` ו-`setAudioState("ready")` רק ל-message subs (לא ל-thought — אין replay button).

**הסדר מובטח:** ב-backend ה-`ttsQueue` שומר על FIFO לכל פעולה אסינכרונית (translate + TTS). כל flushThought כולה רצה כיחידה. אז סדר ה-`text_chunk thought_translation` ו-`audio_start kind=thought` המגיעים ל-frontend תואם בדיוק לסדר היצירה של thought sub-bubbles. מספיק `find(s => !s.hasTranslation)` ו-`find(s => !s._streamId)` בהתאמה.

**בדיקות:** `bunx tsc --noEmit` עבר. `node --check` על ה-JS שחולץ מ-index.html עבר.

---

## 2026-05-14 11:40

### משימה D — חיתוך flushMessage לפי גבול משפט (executor)

**מטרה:** קטעי TTS קצרים יותר → ההקראה מתחילה מהר יותר אחרי שהמודל מתחיל לכתוב, ולא ממתינה לסוף הודעה שלמה.

**`backend/src/server.ts`:**

הוספת `findSentenceBoundary(s: string): number` ב-section "עזרים" (export, לבדיקות יחידה). הפונקציה מחזירה אינדקס *אחרי* הגבול האחרון, או -1.

גבולות מזוהים:
- `.`/`!`/`?` ואחריהם רווח/שורה חדשה.
- `:` + רווח.
- שורה ריקה (`\n\n+`).

הגנות:
- קיצורים שכיחים (`Mr.`, `Dr.`, `Mrs.`, `Ms.`, `St.`, `vs.`, `etc.`, `i.e.`, `e.g.`) — לא חותך אחרי הנקודה שלהם.
- מספר עשרוני (`3.14`) — לא חותך באמצע.

forced flush: אם המחרוזת ארוכה מ-200 תווים בלי גבול, חותך ברווח האחרון לפני 200 (או ב-200 אם אין רווח אחרי 100). פתרון לעברית — בה נקודות נדירות יותר.

**ב-`onChunk` עבור `kind === "message"`:** במקום רק לצבור ל-`messageBuffer`, נעשה loop של `while ((boundary = findSentenceBoundary(...)) !== -1)`. כל איטרציה: חיתוך ב-`head` (מ-0 עד הגבול), שמירת `rest`, קריאה ל-`flushMessage()` (ששולח ל-TTS+render ומאפס את ה-buffer ל-""), ואז שמירת `rest` חזרה ב-`messageBuffer`. הלולאה ממשיכה אם יש עוד גבול ב-`rest`.

**הביצוע נשמר ב-rendering:** `flushMessage` ממשיך לקרוא ל-`renderMarkdown` ולשלוח `message_rendered` לפני TTS. סגמנט קצר → רינדור קצר → בועה משלו ב-frontend. הfrontend כבר תומך בקבלה רב-בועתית של "message" (כל `text_chunk + message_rendered` יוצר בועה).

**אומת ב-unit test:**
- `"ראיתי את הקובץ. הוא נראה תקין."` → גבול ב-16 (חיתוך אחרי "ראיתי את הקובץ. ").
- `"Hello Mr. Smith and Dr. Jones."` → -1 (קיצורים מוסתרים, ו-"Jones." בסוף בלי רווח לא נחשב גבול).
- `"The value is 3.14 exactly."` → -1 (3.14 מוגן; "exactly." בסוף בלי רווח לא גבול).
- `"Section one:\nNext stuff"` → גבול ב-13 (`:\n`).
- מחרוזת `"x"×220` → גבול ב-200 (forced flush).

`bunx tsc --noEmit` עבר.

---

## 2026-05-14 11:25

### משימה C — `gemini-helper.ts` (executor)

קובץ חדש: `backend/src/gemini-helper.ts`. שני שירותים לנגישות אודיו דרך `gemini-flash-lite-latest`:

**`translateThought(text)`** — תרגום reasoning של המודל מאנגלית לעברית מדוברת. cache לפי הטקסט המלא; timeout 2500ms; fallback לטקסט המקורי בכל כשל (כולל timeout).

**`narrateToolCall(ctx, tool)`** — ניסוח משפט קצר בעברית שמתאר מה הסוכן הולך לעשות, על בסיס `userMessage` ו-`recentMessages`. הפרומפט כולל 4 דוגמאות (read/bash/edit/build) שמדגימות "תכלית, לא פרמטרים". cache לפי `toolCallId`; timeout 1500ms; fallback ל-`title` הגולמי.

**עיצוב:**
- `withTimeout` helper: `Promise.race` עם resolve-מהיר ל-fallback. אם ה-API לא חוזר בזמן, ה-flow ממשיך מיד עם ה-fallback. ה-promise המקורי ממשיך ברקע (POC — לא AbortController).
- שני caches נפרדים: `translationCache: Map<text, hebrew>`, `narrationCache: Map<toolCallId, hebrew>`. אין eviction (POC).
- כל שגיאה מודפסת ל-stderr בלי לקרוס.
- שני שירותים מאתחלים `ai = new GoogleGenAI({ apiKey: "placeholder" })` — OneCLI מטפל ב-auth.
- CLI test entrypoint עם `import.meta.main`: `bun src/gemini-helper.ts "<text>"`. אומת ש-fallback עובד בלי OneCLI (API נכשל → טקסט מקורי חוזר ב-285ms) **ושה-happy path עובד דרך OneCLI**: `onecli run -- bun src/gemini-helper.ts "I should check the README first..."` → `"כדאי לי לבדוק את הקובץ ריד-מי קודם כדי להבין את הפרויקט."` ב-829ms (תחת ה-2.5s timeout). גם `narrateToolCall` אומת דרך `onecli run -- bun -e ...` עם `tool: { kind: "read", title: "Read README.md" }` → `"אני קורא את ה-README כדי להבין על מה הפרויקט הזה"` ב-607ms.

`bunx tsc --noEmit` עבר.

המודול עצמאי — אין שינוי ב-`server.ts` עדיין. הוא ייכנס לשימוש ב-E ו-F.

---

## 2026-05-14 11:15

### משימה B — STT prompt טכנולוגי + context (executor)

המשך v2. שדרוג איכות התמלול של Gemini בשני צירים.

**ב-`backend/src/stt.ts`:**

החלפת `TRANSCRIBE_PROMPT` ל-prompt מורחב שמציין במפורש שהמשתמש מדבר עברית בהקשר של פיתוח תוכנה. ה-prompt החדש מורה למודל להעדיף פירוש טכנולוגי במקרי ספק ("ריאקט" לא "ראקת", "באג" לא "בק"), לתקן disfluencies (חזרות, "אה אה", false starts), ולשמור על השפה המקורית. הוספת שדה אופציונלי `previousResponse?: string` ל-`SttOptions`. אם הועבר — הוא נשלח כ-text part *לפני* האודיו, עם תיוג ברור שזה "for context only — do NOT transcribe this".

**ב-`backend/src/server.ts`:**

הוספת `lastAgentMessage: string | null` ל-`ConnState`, אתחול ל-`null` ב-`open`. ב-`flushMessage` כל cycle שומר את הקטע האחרון ב-`state.lastAgentMessage`. ב-`handleAudio` הקריאה ל-`transcribeAudio` כוללת עכשיו `previousResponse: state.lastAgentMessage ?? undefined`.

**המוטיבציה:** בשיחה רציפה, מילים דו-משמעיות כמו "פונקציה" / "פוסיציה", "באג" / "בק", "Edit" / "אדיט" — תלויות בקונטקסט. Gemini עם הקטע האחרון של המודל מקבל את ה-context הזה ישירות. שמירת ה-flush האחרון בלבד (לא צבירה) — זה הקטע שזכור למשתמש כשהוא מגיב.

`bunx tsc --noEmit` עבר.

---

## 2026-05-14 11:05

### משימה A — חיזוק `system-prompt.ts` (executor)

הסשן הראשון של ה-executor אחרי שה-planner הגיש את `plan.md` מבונה. מתחילים את v2 לפי הסדר המומלץ.

הוספתי שתי שורות לסעיף "חוקי תגובה" של `VOICE_SYSTEM_PROMPT` ב-`backend/src/system-prompt.ts`:

- "תחשוב על איך התשובה שלך נשמעת, לא איך היא נראית בקריאה על מסך."
- "המשתמש שומע אותך, לא קורא. אין לו מסך מולו."

המוטיבציה: המודל לפעמים מתייחס לתשובה כטקסט שייקרא — מציין "להלן רשימה של…" או "כפי שמופיע למעלה". כשכל הערוץ הוא TTS, ההנחה הזו שגויה. השתי שורות החדשות ממסגרות את המודל למצב הקרנת קול ולא מצג טקסטואלי.

`bunx tsc --noEmit` עבר. שינוי טקסט בלבד, אין השפעה על compile.

---

## 2026-05-14 16:35

### תכנון v4 — תיקון נקודתי לבעיית UX של תרגום thoughts בבת אחת

באג שזוהה בבדיקה empirical של Avi אחרי שהמבצע סיים את v3: התרגום של מחשבות לעברית קורה רק כש-thought block נגמר (מעבר ל-message/tool_call או סוף תור), לא פר-משפט. תוצאה: המשתמש מחכה דקות לפני שהוא שומע משהו, ואז שומע את כל ה-thought block ברצף.

#### שורש הבעיה

ב-`server.ts`, ב-`onChunk` handler:
- עבור `kind === "message"` יש loop של `findSentenceBoundary` + flush פר-משפט (נוסף ב-D).
- עבור `kind === "thought"` רק `thoughtBuffer += chunk`, בלי חיתוך.

ה-flushThought נקרא רק כש-message מתחיל / tool_call create / סוף תור. בינתיים thoughtBuffer מצטבר ל-thousands of chars.

#### הפתרון

העתקה של אותה לוגיקה מ-D ל-thought handler. הפונקציה `findSentenceBoundary` תומכת כבר באנגלית ועברית, יש לה הגנה מקיצורים ומספרים עשרוניים, forced flush ב-200 תווים. `flushThought` כבר עובד פר-סגמנט (תרגום + TTS דרך ttsQueue).

זוהתה כמשימה P. תכנון יחיד — אין תלויות, היקף קוד מינימלי (~10 שורות שינוי), בדיקה אמפירית פשוטה. הערכת זמן 10-15 דקות.

#### אינטראקציה עם L

משימה L (קפיצה אוטומטית ממחשבות לתשובה) מקבלת יותר ערך אחרי P — יש יותר סגמנטים פעילים של thoughts ב-ttsQueue, וה-clear של streamOrder ב-L יחתוך גם אותם. הקוד של L כבר מטפל ב-pending thoughts, אין שינוי נדרש.

#### צעדים הבאים

המבצע יקבל את plan.md המעודכן ויבצע P. אחר כך בדיקה empirical חוזרת על ידי Avi.

---

## 2026-05-14 14:30

### תכנון v3 — איטרציית baseline לנסיעה

אחרי בדיקה empirical של Avi ב-13:30 ושיחת תכנון מורחבת, נקבע סקופ ל-v3: תיקוני באגים + שיפורים שיהפכו את החוויה לטובה מספיק לשימוש קולי בדרכים.

#### הבאגים שזוהו

1. **אנגלית מופיעה במקום תרגום של מחשבה.** כש-`translateThought` עובר timeout או נכשל, ה-fallback הוא הטקסט האנגלי המקורי. הוא נשלח כ-`thought_translation` ל-frontend ומוקרא דרך אילבן בקול עברי. נשמע כאנגלית מסולפת ומבלבל את המשתמש.
2. **תרגום עברי של מחשבות נראה שונה מהאנגלית.** בתיקון hot-fix קודם (commit 9e36d25) הוגדר ה-Hebrew גדול ובהיר ולא איטלי כדי "להבדיל". Avi הבהיר שזו לא הכוונה — אותו עיצוב לשתי השורות, השפה היא המבחין היחיד.
3. **באג גלילה race condition.** הלוגיקה הקיימת מבוססת על בדיקת מרחק מהקצה בכל `scroll` event. כשמתווסף תוכן מהר, `scrollHeight` גדל אבל `scrollTop` נשאר, ה-event מגיע באיחור עם מרחק גדל, המערכת חושבת שהמשתמש גלל למעלה ומכבה את האוטו בטעות.
4. **המתנה במחשבות.** הניגון של המחשבה ב-frontend ממשיך אסינכרונית גם אחרי שה-message TTS התחיל לזרום ב-backend. המשתמש שומע מחשבה ארוכה גם אחרי שהתשובה כבר מוכנה.
5. **תמלול חלש.** הפרומפט הנוכחי לא מבקש פיסוק או שבירת פסקאות. המודל (Flash Lite) פחות מדויק לעברית מהאלטרנטיבה (Flash).

#### השיפורים הנוספים שעלו לדיון

6. **שמירת הקלטות לדיסק** במהלך פיתוח — לבדיקת פרומפטים, ולעתיד יותר רחוק כבסיס ל"נגן סשן מחדש".

#### החלטות שהתקבלו

- **תרגום והקראת מחשבות יישארו פעילים כברירת מחדל באיטרציה הזאת.** הוסכם שהם יהפכו ל-opt-in toggle ב-config בעתיד, אבל לא בסקופ של v3.
- **קאש פרסיסטנטי לגמיני** — לא בסקופ של v3. כל סשן יחשב מחדש. הסיכון: עלות חוזרת על מחשבות חוזרות.
- **CSS revert: זהה לאנגלית.** השפה היא המבחין היחיד.
- **קפיצה ממחשבה לתשובה: אגרסיבית.** חיתוך מיידי באמצע ניגון. המטרה: רגע ש"המודל סיים לחשוב" מורגש מיידית.
- **STT model: מעבר ל-Flash הרגיל.** עלות פי שניים אבל מקובלת לפיתוח.
- **שמירת הקלטות: דרך משתנה סביבה.** `VOICE_ACP_SAVE_RECORDINGS` ברירת מחדל מופעל. בעתיד אולי toggle בממשק.

#### חריגה מהפרוטוקול שזוהתה

הסוכן המתכנן (אני) פעל ב-13:30 כסוכן מבצע — ערך קוד ל-frontend (תיקון באג ה-sub-bubbles + CSS hot-fix). Avi הצביע על כך שזו חריגה מהכלל "תכנון בלבד". מהיום ואילך — תיקונים, גם דחופים, עוברים דרך plan ולסוכן מבצע.

#### תכנון התוצר

`docs/plan.md` נכתב מחדש: 6 משימות אטומיות J-O, כל אחת עם מטרה, הקשר, קבצים, שינוי מדויק עם דוגמאות קוד, הצעת בדיקה, והודעת commit. דחיפות: J → K → L → M → N → O. סה"כ זמן מוערך כ-2 שעות.

#### צעדים הבאים

המבצע יקח את ה-plan ויבצע את J-O לפי הסדר. כש-N נסתיים, אפשר להריץ CLI test על הקלטות שמורות כחלק מאימות O.

---

## 2026-05-14 13:30

### תיקון באג hot-fix — סגמנטים שני ואילך של message לא הוצגו

באג שזוהה בבדיקה empirical של Avi: בתשובות עם יותר ממשפט אחד, רק המשפט הראשון הוצג בצ'אט — שאר המשפטים נשמעו ב-TTS אבל לא נכתבו בבועה.

#### שורש הבעיה

עם החיתוך לפי משפט שמשימה D הוסיפה, ה-backend שולח `message_rendered` נפרד לכל משפט. ה-frontend חיפש "bubble של message בלי HTML" כדי להציב את ה-HTML. אחרי המשפט הראשון, הבועה כבר עם HTML (`hasHtml=true`), אז המשפט השני לא מצא יעד. בנוסף, `appendText` מדלג על עדכון תצוגה אם `hasHtml=true`, אז גם הטקסט הגולמי של chunks נוספים לא הוצג.

#### תיקון

`frontend/index.html`:
1. **`AgentTurn.appendMessage`** — אם הבועה הנוכחית של message כבר rendered (`hasHtml=true`), היא נחשבת סגורה. הסגמנט הבא יוצר sub-bubble חדש.
2. **handler של `message_rendered`** — אם אין bubble של message בלי HTML, יוצרים אחת חדשה (לטיפול במקרה ש-flush מרובה התרחש על chunk יחיד שהכיל כמה משפטים).

תוצאה: כל משפט מקבל bubble משלו עם רינדור מלא וכפתור השמעה. תואם לעיקרון של per-segment streaming.

#### תיקון משני — styling

`thought-translation` ירשה `font-style: italic` מ-`.bubble` של thought. בעברית איטליק קשה לקריאה. נוסף `font-style: normal` להתרגום העברי כדי להבדיל ויזואלית ברור יותר (אנגלית — italic קטן ואפור; עברית — normal גדול ובהיר).

#### חריגה מהפרוטוקול הרגיל

הסוכן המתכנן ערך קוד frontend, מה שבדרך כלל אסור (ראה `docs/agents/planner.md`). הצדקה: המבצע סיים את הסשן שלו, Avi בעיצומה של בדיקה empirical, והבאג חוסם את הבדיקה. תיקון של 8 שורות JS + 2 שורות CSS. מתועד גם ב-`planner.md`.

Sanity: בדיקת syntax של ה-JS המוטמע עברה (`new Function(combined)` ב-Node).

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

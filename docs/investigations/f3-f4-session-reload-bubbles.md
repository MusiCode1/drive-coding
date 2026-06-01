# Investigation: f3-f4-session-reload-bubbles

> **עדכון 2026-05-29**: ‏F-3 ‏תוקן ב-slice 8.1 (commit `fc2bc97`) — ‏הוסף case ל-`user_message_chunk` ב-`#onSessionUpdate`, ‏בדיוק כפי שהוצע פה. ‏F-4 ‏עדיין פתוח — ‏ראה §"Proposed fix → F-4" ‏ו-Open question #3 ‏לבחירת approach.

שני באגים נפרדים אבל קרובים תמטית — שניהם מתבטאים אחרי reload (F5) ושניהם נובעים מאיך ש-`session/load` ב-ACP זורק events אל FE שעובד איתם חלקית. הומלצו להישאר ביחד כי הטיפול ב-F-3 מצריך החלטה ש-relevant גם ל-F-4.

---

## Bug recap

- **F-3 (MAJOR)**: אחרי שליחת prompt + קבלת response, reload גורם להיסטוריה לטעון רק את ה-assistant bubbles. ה-user bubble (ה-prompt) נעלם — השיחה נראית "תשובה ללא שאלה".
- **F-4 (MAJOR)**: reload תוך כדי streaming response (לפני שהמודל סיים). אחרי reload, tool-call bubbles שהושלמו לפני ה-reload חוזרים, אבל ה-assistant text bubble הסופי **חסר** אפילו אחרי 15s המתנה.

Source: `docs/slice-10-exploratory-test-report.md` #F-3, #F-4.

---

## Root cause

### F-3 — `user_message_chunk` לא מטופל ב-handleSessionUpdate

בקובץ `packages/frontend/src/lib/stores/agent-session.svelte.ts`, הפונקציה `handleSessionUpdate` (שורות 317-400) מטפלת רק ב-4 סוגי notification:

```ts
// agent-session.svelte.ts:337-398
switch (update.sessionUpdate) {
  case "agent_message_chunk": { appendChunk("assistant", chunkText); appendBubbleChunk("message", chunkText, null); break }
  case "agent_thought_chunk": { appendChunk("thought", chunkText); appendBubbleChunk("thought", chunkText, null); break }
  case "tool_call":           { /* ... */ break }
  case "tool_call_update":    { /* ... */ break }
  default:
    // user_message_chunk, plan, available_commands_update, current_mode_update, etc.
    // → currently not surfaced in UI (future slice if needed)
    break
}
```

ה-flow ב-`connect()` (שורות 446-470):

```ts
if (existingSessionId) {
  await acpClient.loadSession({ cwd, sessionId: existingSessionId })
  // ...
}
```

ל-`session/load` ב-ACP יש סמנטיקה ברורה: ה-agent (opencode) מריץ replay של כל ה-`SessionNotification` שמייצגים את ההיסטוריה — כולל `user_message_chunk` עבור prompt-ים של המשתמש (ראה ACP spec, schema `SessionUpdate.oneOf` ב-`@agentclientprotocol/sdk@0.21.1/schema/schema.json:5847`). ב-Slice 8a הישן זה טופל server-side ושודר ל-FE כ-`history_chunk { kind: 'user_message' }` (ראה `v2/packages/backend/src/app/agent-session.ts:136-152`), אבל Slice 10 העביר את ה-loadSession ל-FE הישיר ושכח להעביר גם את ה-handler.

התוצאה: `user_message_chunk` ב-replay נופל ל-`default → break` בשקט. השיחה אחרי reload חסרת user bubbles.

### F-4 — turn לא-completed לא נשמר ב-session/load של opencode

זה לא באג פשוט ב-FE. ה-flow:

1. FE שולח prompt → opencode מתחיל לזרום `tool_call` + `tool_call_update` + `agent_message_chunk` ל-stdout.
2. BE pipe (`packages/backend/src/delivery/ws-agent.ts:67-77`) מעביר שורות NDJSON ישירות מ-child.stdout אל feWs באמצעות `readline.createInterface`. אין buffering ב-BE.
3. המשתמש לוחץ reload → `feWs.on("close")` (שורה 102) סוגר את ה-readline ומסיר את ה-listener. ה-child (opencode) ממשיך לרוץ (`--persist`).
4. Notifications שopencode כותב לאחר ה-close — מגיעים ל-kernel pipe buffer (אין לנו readline שצורך). לא נשמרים ב-BE, לא משודרים לאף client.
5. Reload → FE חוזר → `connect()` קורא ל-`acpClient.loadSession`. opencode מריץ replay מה-session-store שלו על disk.

ה-evidence ב-F-4 מראה שאחרי reload, ה-tool calls **כן** חוזרים אבל ה-final assistant message **לא**. ההסבר הכי סביר:

- opencode persists each completed event (tool_call, agent_message_chunk) בזמן אמת ל-session store שלו לפני שכותב ל-stdout. ה-tool calls השלימו לפני ה-reload → ב-store. ה-message chunks שהיו ב-flight בזמן ה-reload — אולי לא נשמרו (opencode אולי דחה את השמירה עד "end of turn"), או לא הגיעו למצב committed.
- ב-replay של `session/load`, opencode מחזיר רק events שהיו בשלב "committed" — ה-turn שעמד באוויר בעת ה-disconnect אבוד.

**זאת השערה — לא אומתה in-process עם opencode**. אם נכונה, אין דרך לתקן את F-4 רק ב-FE — חייב מנגנון buffering ב-BE.

האדריכלות המקורית (`docs/vnext-planning.md:287-296`) אכן צפתה BE-side buffer לאחר disconnect:

> 4. User: סוגר דף
>    → WebSocket closes
>    → Bridge ממשיך לרוץ (--persist)
>    → ה-CLI ממשיך לעבד דרך ה-bridge
>    → **Backend מאזין ל-bridge ומאחסן events בbuffer בזיכרון (לreconnect מהיר)**
> 5. User: חוזר אחרי 10 דקות → 'connected' event עם history → Backend: שולח את ה-buffered events

אבל הקוד הנוכחי לא מממש את זה — ה-readline נסגר ב-`feWs.close` ואין consumer ל-stdout עד שיש WS חדש. ה-buffering נשמט ב-Slice 9/10.

---

## Affected files

### F-3
- `packages/frontend/src/lib/stores/agent-session.svelte.ts:317-400` — `handleSessionUpdate` switch חסר case ל-`user_message_chunk`.
- `packages/frontend/src/lib/stores/agent-session.svelte.ts:444-470` — `connect()` קורא ל-loadSession אבל לא קובע `isLoadingHistory = true` סביב הקריאה.
- `packages/frontend/src/lib/stores/agent-session.svelte.ts:523-542` — `sendPrompt` יוצר user bubble locally; צריך לוודא שלא מתנגש עם user_message_chunk בזמן streaming חי.

### F-4
- `packages/backend/src/delivery/ws-agent.ts:67-108` — ה-pipe הישיר stdout → feWs ללא buffering.
- `packages/backend/src/app/agent-orchestrator.ts:1-219` — אין `historyBuffer` (כפי שהיה ב-Slice 8a, ראה `v2/packages/backend/src/app/agent-session.ts:123-164`).

---

## Reproduction

לא שוחזר ב-runtime (מחקר read-only). ה-source code מאשר את ה-finding של ה-tester עבור F-3 באופן מובהק (`default → break` על `user_message_chunk`). עבור F-4, ההיעדר של buffering ב-BE ניכר בקוד, אבל ההתנהגות המדויקת של opencode ב-`session/load` עבור turn לא-completed טעונה אימות empirically.

---

## Proposed fix

### F-3 — fix קצר ב-FE

הוסף case ב-`handleSessionUpdate`:

```ts
case "user_message_chunk": {
  // Same shape as agent_message_chunk (ContentChunk: { content, messageId? })
  // Only surface during history replay — sendPrompt creates the live user bubble locally.
  if (isLoadingHistory) {
    appendChunk("user", chunkText)
    appendBubbleChunk("user", chunkText, update.messageId ?? null)
  }
  break
}
```

בנוסף — ב-`connect()`, סובב את ה-loadSession ב-`isLoadingHistory`:

```ts
if (existingSessionId) {
  isLoadingHistory = true
  try {
    const loadResult = await acpClient.loadSession({ cwd: agentCwd, sessionId: existingSessionId })
    // ...
  } finally {
    isLoadingHistory = false
  }
}
```

ב-`appendBubbleChunk` צריך להוסיף תמיכה ב-`kind: "user"` (הפונקציה מקבלת כרגע `"message" | "thought"` בלבד, אבל ה-BubbleKind union כבר כולל `"user"`). הרחב ל-`"message" | "thought" | "user"`.

גם `appendChunk` (legacy) מקבל `ChatMessage["kind"]` שכולל `"user"` ולכן עובד as-is, אבל ב-sendPrompt שורה 530, ה-user message לא מסומן `isStreaming`, אז הappendChunk-merge לא ידבק לbubble קיים. יש לוודא שזה לא יוצר merge לא רצוי.

**אופציה B** (אם נמצא ש-opencode שולח `user_message_chunk` גם בזמן הprompt החי, ולא רק ב-load): להסיר את ה-`isLoadingHistory` guard ולעבור ל-dedup על ידי `messageId`. אבל זה מצריך לעדכן את `sendPrompt` ליצור user bubble עם messageId, ולתפעל merge חכם. מורכב יותר — מומלץ להתחיל באופציה A.

### F-4 — דורש החלטה ארכיטקטונית

3 גישות:

**A. החזרת historyBuffer ב-BE** (מקרוב לוweren בעבר ב-Slice 8a):
- בwsa-agent, במקום `feWs.close → rl.close`, לשמור את ה-readline פעיל גם בלי FE.
- לאסוף NDJSON ל-buffer ב-memory לכל agentId.
- ברגע ש-feWs חדש מחובר, לדרוין את ה-buffer לפניו (לפני שעבדים lines חדשות).
- גודל buffer: cap ל-N MB / N events עם FIFO eviction.
- Trade-off: בגלל ש-feWs מתחבר → readline חדש → המשתמש עלול לקבל events מ-2 מקורות (buffer ישן + replay של loadSession). צריך לנקות dedupe.

**B. עבור על buffering ולקבל את ההפסד**:
- אחרי reload mid-streaming, ה-FE מציג tooltip / UX: "ה-response הופסק. שלח שוב את ה-prompt."
- לא נדרש שינוי BE.
- Trade-off: ה-CLI (opencode) המשיך לעבוד "ל-שווא" (הקליל גם cost / רנדל ב-LLM). ב-Slice 8a זה היה important enough לטפל.

**C. Force-cancel את ה-turn ב-disconnect**:
- ב-`feWs.on("close")`, שלח `session/cancel` ל-opencode לפני שמורידים את ה-pipe.
- זה לפחות עוצר את ה-LLM יקר ומבטל את ה-turn בצורה נקייה.
- Trade-off: אם המשתמש פשוט עבר tab או הdisconnect היה חולף, הוא איבד turn בלי סיבה.

פתרון רצוי ל-MVP: אופציה B + אופציה C במשולב. אופציה A היא ה-"ניצחון" אבל היא מורכבת ויש לה edge cases בעייתיים (double-replay).

---

## Risks

### F-3
- **Risk 1**: אם opencode שולח `user_message_chunk` גם בזמן streaming live (לא רק ב-replay), הfix שלי (guard על `isLoadingHistory`) יחסום echo לגיטימי. שיגרום ל-mismatch בין מה ש-sendPrompt יצר לבין מה ש-opencode חושב. אבל בפועל זה לא מזיק כי ה-FE bubble כבר נוצר locally ב-sendPrompt.
- **Risk 2**: ה-`messageId` ש-opencode שולח ב-replay עלול להתבלגן עם ה-`messageId: null` שsendPrompt משתמש בו. גריפ של `appendBubbleChunk` (שורות 144-187) מאחד לפי kind + messageId, ואם 2 user bubbles שונים מקבלים אותו messageId, הם יתאחדו בטעות. בproptotype זה לא יקרה (replay מתחיל לפני שמגיעים user messages חדשים).
- **Risk 3**: ה-`appendChunk` (legacy messages) כבר מקבל `"user"` אבל ה-flow שלו מצרף לאחרון רק אם isStreaming=true. אם user_message_chunk ב-replay מגיע ב-multiple chunks ל-prompt ארוך — עלול ליצור multiple messages במקום אחד מאוחד. צריך לבדוק.
- **Test infrastructure**: הקובץ `agent-session-history.test.ts` הוא המקום הטבעי להוסיף test שמוודא שuser_message_chunk ב-replay יוצר bubble. יש כבר `_testInjectNotification` helper.

### F-4
- **כל option** עלול לפגוע ב-stability אם לא מטופלים edge cases (reload בזמן `cancel`, double-reload בקרוב, tab switch בלי reload, וכו').
- אופציה A (BE buffer): יוצרת memory leak אם המשתמש פשוט לא חוזר. צריך TTL + גודל מקס.
- אופציה C (auto-cancel): אנו לא יודעים אם `session/cancel` ב-ACP מבטל את ה-LLM call או רק את הצריכה של הoutput ב-FE. צריך לוודא ב-opencode.

---

## Open questions for Avi

הbug הצמוד F-3+F-4 מצריך 2-3 החלטות:

1. **F-3 — accept / blocker?** בOpen Q-4 בדוח ה-tester השאלה היא אם UX של "שיחה חסרת user bubbles" היא acceptable לpublic release. גישה: פיתרון פשוט (אופציה A לעיל) ב-FE בלבד, ~20 שורות. **אתה רוצה שאתקן את זה בfix slice הקרוב, או שזה נדחה ל-future slice?**

2. **F-3 — האם opencode emits user_message_chunk בlive streaming?** הfix ה-`isLoadingHistory` guard מניח שopencode שולח user_message_chunk רק ב-replay של session/load. אם הוא שולח גם בlive (echo של prompt) — צריך גישה אחרת (dedup על ידי messageId, או הסרת ה-local user bubble ב-sendPrompt). זו עובדה שניתן לאמת רק by running. רוצה שאוסיף smoke test ב-slice הביצוע לפני קביעת הגישה?

3. **F-4 — איזה option?** **A** (BE buffer), **B** (מתחבר מקבל את ההפסד), **C** (auto-cancel ב-disconnect)? Heuristic: אם זה על MVP ל-personal use — B+C מספיקים. אם זה עבור public release — A הכרחי לchat-app feel.

4. **F-4 — האם opencode באמת ממשיך לעבד אחרי disconnect?** אם לא — ה-fix פשוט יותר (אופציה C לא נחוצה, הturn מבוטל מבחינת opencode ברגע שhe-pipe נסגר אינטרני). אם כן — זה cost / context window שאפשר לרצות לחסוך. צריך לחקור ב-opencode source.

5. **Sliced fix?** F-3 (קל ועצמאי ב-FE) יכול לצאת כ-slice קטן עצמאי. F-4 (החלטה ארכיטקטונית ארוכת טווח) ראוי לslice נפרד. רוצה לפצל?

---

## Estimated effort

### F-3 בלבד (אופציה A)
- **Code**: ~15-25 שורות ב-`agent-session.svelte.ts` (case חדש ב-switch + isLoadingHistory guards סביב loadSession + הרחבת type ב-appendBubbleChunk).
- **Tests**: 2-3 tests ב-`agent-session-history.test.ts` (user_message_chunk יוצר user bubble ב-replay; ב-live לא יוצר duplicate; messageId מנהל grouping). ~50 שורות.
- **Layers**: FE בלבד.
- **Effort**: ~1.5-2h כולל manual smoke-test עם opencode.

### F-4 אופציה B (מקבלים אובדן)
- **Code**: ~30-50 שורות UI ב-FE (tooltip / banner "response הופסק") + detection state machine (`hadStreamingAssistantAtReload`).
- **Tests**: ~30 שורות.
- **Effort**: ~2-3h.

### F-4 אופציה C (auto-cancel)
- **Code**: ~10-20 שורות ב-`ws-agent.ts` (לפני rl.close, לשלוח `session/cancel` ל-child).
- **Tests**: ~40 שורות.
- **Effort**: ~2h.

### F-4 אופציה A (BE buffer)
- **Code**: ~100-150 שורות ב-BE (new `historyBuffer` per agentId, TTL eviction, drain on reconnect, dedupe with loadSession replay).
- **Tests**: ~80-120 שורות (buffer eviction, double-reload, TTL).
- **Effort**: ~6-8h + verification.

# Future Features — drive-coding (vnext)

> רעיונות שעלו במהלך התכנון אבל אינם בסקופ הנוכחי. רשומים כאן כדי שלא יאבדו.
> פורמט: כל פיצ'ר עם תיאור קצר, מוטיבציה, רמת מורכבות, וקווי מימוש ראשוניים.

---

## 1. Client-side voice orchestrator

תאריך הרעיון: 2026-05-16

תיאור: העברת ניהול ה-pipeline של תרגום + הקראה מ-backend ל-client.
ה-backend הופך לדק — חושף 3 endpoints (`/api/transcribe`, `/api/translate`,
`/api/tts`) ו-WS עם text_chunks raw. ה-client מאסף, מחליט מתי לתרגם
ומתי להקריא, fetch-וב just-in-time (כ-2 שניות לפני שצריך), ומנגן
streaming דרך MediaSource Extensions.

מוטיבציה:
- ה-Cancel מדויק עם AbortController — אם המשתמש בוטל, segments
  pending לא ייטענו כלל. חיסכון אמיתי בעלות.
- שליטה גרניטית של ה-client — pause/resume/skip, voice switching per
  segment, prefetch אגרסיבי או שמרני.
- מעבר עתידי ל-BYOC, Web Speech fallback, או TTS מקומי (Piper, Coqui).
- backend פשוט יותר — כ-30% פחות קוד.

מורכבות: גבוהה. כ-10 שעות עבודה. דורש:
- 3 endpoints חדשים ב-backend + cache שכבה.
- VoiceController state machine ב-frontend.
- MediaSource buffer management עם AbortController per segment.
- Sentence splitting port ל-client.
- IndexedDB cache ב-client (אופציונלי).
- בדיקה ב-iOS Safari (סיכון משמעותי — MediaSource Extensions תומכים
  רק מ-iOS 17.1+ ועדיין יש cases של buggy MP3 streaming).

קווי מימוש:
- backend endpoints (3): transcribe (audio→text), translate (text→text),
  tts (text→audio/mpeg streaming).
- WS פשוט: thinking, text_chunk {kind, text}, tool_call, done, error.
- מבוטלים: stt_partial, audio_chunk, translation events.
- frontend VoiceController:
  - מאסף text_chunk לפי kind, splitIntoSentences ב-client.
  - תור segments עם status (pending/fetching/playing/done/cancelled).
  - scheduleNext() — fetch ~2s לפני שצריך, AbortController per fetch.
  - StreamingPlayer מבוסס MediaSource — append chunks תוך כדי fetch streaming.
  - cancel() → abort כל ה-fetches + stop player + empty queue.
- שכבת cache בשני הצדדים:
  - backend disk cache (כקיים) — shared בין משתמשים.
  - client IndexedDB — per-user, חוסך גם round-trip ל-backend.

שאלות פתוחות:
- iOS Safari MediaSource ל-`audio/mpeg` — תומך באמינות? בדיקה לפני
  התחייבות.
- האם ElevenLabs `experimental_generateSpeech` ב-AI SDK תומך
  ב-streaming response, או שצריך לעבור ל-REST ישיר עם fetch streaming?
- האם backend עדיין שולח tool_call narration המוכן, או שגם זה ב-client?
  אם ב-client → דורש שגם Gemini narration ייקרא מהדפדפן.
- Translation context בין משפטים רצופים — היום stateless. אם כן, לאן
  שומרים את ה-context?

החלטה שהתקבלה (2026-05-16): לא לעכשיו.
- ה-MVP עוד לא בידיים (חסר session history, settings, layout refactor).
- תיקון 5 שורות ב-`agent-session.ts` (`isCancelled` flag) פותר 90%
  מהבזבוז של cancel — ה-10% הנותר זה דולר לחודש בתרחיש ריאלי.
- iOS Safari MediaSource לא בדוק — סיכון להפסיד את המצב החשוב ביותר.
- ריפקטור בזמן ריפקטור = סיכוי גבוה לבאגים.

מתי כן לחזור לרעיון:
- אם יש פיצ'ר שדורש אותו (pause/resume, voice switching, offline TTS).
- אם backend מתפוצץ מ-load.
- אם רוצים שמשתמשים אחרים יריצו self-hosted בלי OneCLI.

עדכון 2026-05-16 (תובנה של אבי): הכיוון האמיתי לעתיד הוא יותר רדיקלי
מהמודל ה-hybrid לעיל. במקום 3 endpoints + WS עם text_chunks מעובדים,
המודל הטהור הוא:
- backend מזרים את ה-ACP session events הגולמיים ל-client כפי שהם.
- backend חושף 2 endpoints proxy בלבד: `/api/translate` ו-`/api/tts`
  (וגם `/api/transcribe`). העברה שקופה ל-Gemini ו-ElevenLabs עם
  הזרקת API keys.
- ה-client מטפל ב-coordination, sentence splitting, narration של
  tool calls, ניהול buffer של thought↔message↔tool_call, decision
  של מה לתרגם, ניהול cache.
- ה-backend נהיה proxy טהור — שכבה דקה שמטפלת ב-secrets בלבד.

יתרון מהותי: ה-rendering לוגיקה כולה במקום אחד (client), קל לבדוק,
קל לשנות, ניתן לעקוף אם רוצים BYOC ולעבוד ישירות מול ה-APIs.

---

## 2. ביטול הקלטה בלי לשלוח למודל

תאריך הרעיון: 2026-06-03

תיאור: דרך לבטל הקלטה פעילה **בלי לשלוח אותה למודל** — פשוט לעצור את
המיקרופון ולזרוק את ה-blob, בלי לעבור דרך transcribe או sendPrompt.

מוטיבציה:
- היום ביטול turn (`cancel`) קשור לזרימת השליחה/התמלול. הרעיון כאן שונה:
  המשתמש מקליט, ומחליט באמצע שהוא לא רוצה לשלוח בכלל.
- כפתור/מחווה שעוצר את ההקלטה ומשליך אותה — מבלי שתגיע למודל.

מורכבות: קטנה.

קווי מימוש:
- ב-`Mic` view-model: action `discard()` שעוצר את ה-Recorder engine
  ומאפס את ה-state ל-`idle` בלי לקרוא ל-`transcribe`/`sendPrompt`.
- UI: כפתור/מחווה במצב `recording` (לצד כפתור העצירה-ושליחה הרגיל).
- לוודא שלא נשמר recordingId ולא נוצר user bubble.

החלטה שהתקבלה: **לא לעכשיו.** נרשם כרעיון בלבד, טרם תוכנן.

---

## 3. כפתור רענון / שחזור חיבור WebSocket

תאריך הרעיון: 2026-06-03

תיאור: חיבור ה-WebSocket נופל לעיתים קרובות. צריך:
1. **טווח קצר (מה שרוצים עכשיו):** כפתור רענון ידני שמאפשר להחזיר את
   החיבור — פעולת reconnect שהמשתמש מפעיל.
2. **טווח ארוך (האידאל):** מנגנון reconnect אוטומטי שמנסה להחזיר את
   החיבור לבד כשהוא נופל.

מוטיבציה:
- החיבור נופל הרבה, והמשתמש נתקע בלי דרך פשוטה להחזיר אותו חוץ מ-reload
  מלא של הדף.

מורכבות: קטנה (כפתור ידני) → בינונית (reconnect אוטומטי עם backoff).

קווי מימוש:
- כפתור ידני: action שסוגר את ה-WS הקיים ופותח מחדש (warm reload דומה
  ל-`switchSession` שכבר קיים) — בלי לאבד את ה-bubbles.
- אוטומטי: listener על `close` ב-WS engine → retry עם backoff (אפשר
  לשלב עם helper ה-retry האחיד המתוכנן).

קשור:
- "WS closed 1005" שטופל ב-switch-session warm reload.
- slice 10 (recovery/reconnect) ב-roadmap.
- helper retry/backoff אחיד (future feature נפרד).

החלטה שהתקבלה: **לא לעכשיו.** בינתיים מסתפקים בכפתור הידני בלבד.

---

## BUG — קריינות כלים מושמעת גם כש-Speaker מושתק ✅ תוקן (2026-06-07, slice-fix-mute-tool-narration)

תאריך הרעיון: 2026-06-03 (התגלה בבדיקה הידנית של slice fix-409)

תיאור: כש-Speaker מושתק כללית (`enabled=false`, ה-toggle הראשי), הודעות ומחשבות
נחסמות נכון אבל **קריינות כלים** (tool narration) עדיין מושמעת.

שורש הבעיה: `Speaker.#processToolBubbles` (`packages/frontend/src/lib/view-models/speaker.svelte.ts:390`)
בודק רק את ההגדרה `narrateTools` (שורה 409) — ולא את `enabled`. לעומת זאת `#processBubbles`
(שורה 246) כן בודק `enabled` עבור message/thought. כלומר ה-mute הראשי לא חל על מסלול ה-tools.
שים לב: ה-`$effect` כבר קורא `this.enabled` (שורה 132) ומעביר אותו ל-`#processBubbles`, אבל
**לא** מעביר אותו ל-`#processToolBubbles` (שורה 162).

מורכבות: נמוכה (~15 דק'). תיקון: להעביר `enabled` ל-`#processToolBubbles`, וכש-`!enabled`
לסמן `#processedNarrationCallIds.add(tc.toolCallId)` ולדלג (כמו ה-`!narrateTools` בשורה 409) —
כדי שהדלקה מחדש לא תשמיע narration ישן. לשקול טסט-VM שמכסה את שני הדגלים.

קווי מימוש: slice קטן נפרד (`slice-fix-mute-tool-narration`). depends_on: []. base: dev.

החלטה שהתקבלה: known bug, מתוכנן ל-slice נפרד. **לא תוקן ב-slice fix-409** (מחוץ ל-scope).

תוקן ב-`slice-fix-mute-tool-narration` (2026-06-07): `enabled` מועבר ל-`#processToolBubbles`,
ו-guard `if (!enabled)` מסמן `processedNarrationCallIds` ומדלג — לפני בדיקת `narrateTools`.
הערה: טסט-VM אינו אפשרי כאן — ה-vitest של הפרויקט מקמפל SSR (`environment: node`) ולכן
`$effect` לא רץ; אומת static (typecheck) + קריאת קוד, מסלול תואם ל-guard הקיים של `!narrateTools`.

---

## WS reconnect — buffer של updates תוך-כדי-נתק (historyBuffer)

תאריך הרעיון: 2026-06-03 (בזמן ws-reconnect-infra)

תיאור: כיום ה-BE הוא pure pipe — אין buffer של updates ACP בצד השרת. כשה-WS נופל
ברגע שהסוכן שולח תשובה, ה-updates שנשלחו **בדיוק בחלון הנתק** אינם נלכדים.
`loadSession` מחזיר את ההיסטוריה ה-committed, אבל updates שנשלחו ב-stream בזמן
הנתק עלולים לחסר.

מוטיבציה:
- חלון הנתק הוא קצר (<5s בד"כ) אבל האיפוס של bubbles נראה ל-UI כאילו
  התשובה קוצצה באמצע.
- historyBuffer הוסר ב-slice 9 (overhead + NN חפיפה). פתרון חדש צריך
  חלון מוגבל (LIFO ring buffer, 60s), לא cache כולל.

מורכבות: בינונית. דורש:
- BE: ring buffer של N messages אחרונים לפי agentId, נוקה אחרי idle.
- FE: `flushBuffer` call אחרי WS חדש לפני (או אחרי) loadSession.
- החלטה על מיזוג: איך לאחד buffer עם loadSession היסטוריה בלי כפילות.

קווי מימוש: slice BE נפרד + slice FE תואם. depends_on: [ws-reconnect-infra].

החלטה שהתקבלה: **לא עכשיו** (אושר ע"י המשתמשת ב-slice ws-reconnect-infra §9 Q3).
loadSession מכסה את הרוב. buffer = future slice מתועד.

---

## 4. מחיקה ועריכת-שם של סשנים

תאריך הרעיון: 2026-06-03

תיאור: בטופס connect וברשימת הסשנים (sidebar) — אפשרות למחוק סשן ולערוך את שמו.

מוטיבציה:
- סשנים ישנים מצטברים ב-`session/list` (ראינו 100 בפועל) בלי דרך לנקות.
- כותרות אוטומטיות של הסוכן ("New session - 2026-...") לא תמיד קריאות; המשתמש ירצה שם משלו.

מורכבות: נמוכה (אם הפרוטוקול יתמוך) — capability-gated, slice קטן ונקי.

### למה לא עכשיו — חסם פרוטוקול (חקירה מלאה: `docs/investigations/2026-06-03-session-delete-rename.md`)

| פעולה | בספק ACP | ב-SDK שלנו `0.21.1` | ב-opencode `1.15.12` |
|--------|----------|----------------------|----------------------|
| **מחיקה** (`session/delete`) | ✅ Preview (מ-2026-06-02, RFD #1335) | ❌ לא חשוף | ❌ `-32601 Method not found` |
| **עריכת-שם ע"י המשתמש** | ❌ לא קיים בספק כלל | ❌ | ❌ `-32601` |

- **`session/close` ≠ מחיקה** — אומת אמפירית: מחזיר `{}` אבל הסשן נשאר ב-`session/list`.
  הוא משחרר משאבים/תהליך בלבד.
- **מחיקה** קיימת בספק כ-`session/delete` (capability-gated דרך
  `agentCapabilities.sessionCapabilities.delete`), אבל ה-RFD עבר ל-Preview רק ב-2026-06-02 —
  אחרי שגרסת ה-SDK שלנו (`0.21.1`) ננעלה, ו-opencode 1.15.12 עוד לא מימש.
- **עריכת-שם ע"י המשתמש פשוט לא קיימת בפרוטוקול.** מה שיש (`SessionInfoUpdate`) הוא ההפך:
  notification **מהסוכן ללקוח** (agent-initiated) — הסוכן קובע/מעדכן את הכותרת, הלקוח רק מציג.

קווי מימוש (כשיתאפשר):
- **מחיקה**: שדרג `@agentclientprotocol/sdk` לגרסה שחושפת `deleteSession` +
  `sessionCapabilities.delete`, ושדרג opencode לגרסה שמכריזה על ה-capability. אז:
  `initialize` → אם `sessionCapabilities.delete` קיים → הצג כפתור מחיקה ב-SessionCard →
  `conn.deleteSession({ sessionId })` → refresh list. CLIs שלא תומכים פשוט לא יראו כפתור.
- **עריכת-שם**: רק אם הספק יוסיף RFD ל-set-title ע"י הלקוח, או — החלטה מודעת לעקוף
  ל-opencode HTTP API (`PATCH /session/:id`), מגודר ל-`cliKind === "opencode"`, מתועד
  ב-decisions. **לא מומלץ** — שובר CLI-agnosticism.

מתי כן לחזור:
- **מחיקה**: כששדרוג SDK + opencode זמינים (לבדוק `sessionCapabilities.delete` ב-handshake).
- **עריכת-שם**: כשהספק יוסיף תמיכה, או אם opencode-only עקיפה הופכת לדרישה קשיחה.

החלטה שהתקבלה (2026-06-03): **מחיקה — דחייה עד שדרוג. עריכת-שם — ויתור** (לא קיים בפרוטוקול).

---

## 5. בורר מודל + סוכן בטופס connect

תאריך הרעיון: 2026-06-03

תיאור: בטופס החיבור (`/`), לצד בורר ה-CLI, להוסיף שני בוררים — **מודל** (claude-opus-4-8
וכו') ו**סוכן/mode** (build / eliezer / mordechai...) — כדי שהמשתמש יבחר אותם **לפני**
החיבור. היום בוחרים מודל/סוכן רק אחרי החיבור, ב-sidebar (`SessionOptionsPanel`).

מוטיבציה:
- לבחור מודל/סוכן מראש, בלי להתחבר ואז לשנות.
- הבקשה המקורית: "שם מודל וסוכן בטופס connect, המידע ייטען יחד עם רשימת הסשנים".

### מה בדקנו (handshake אמפירי, opencode 1.15.12)

- `session/new` (וגם `loadSession`) **כן** מחזיר `configOptions` עם:
  - קטגוריית `model` — ~80 מודלים + `currentValue`.
  - קטגוריית `mode` — הסוכנים (`build`, `eliezer`, `mordechai`, `just-a-man`...) עם תיאורים.
- **אבל `session/list` מחזיר רק** `sessionId, cwd, title, updatedAt` — **אין בו model/mode.**
- לחיצת היד (`initialize`) מחזירה רק `agentCapabilities` + `agentInfo` — **אין מודלים שם.**

כלומר: המודלים/modes זמינים רק אחרי שיש סשן פתוח (`session/new`/`loadSession`), לא ברשימה.

### למה לא עכשיו (החלטה 2026-06-03)

המשתמשת ביקשה לבטל. הנימוק: הבקשה נוסחה כ"ייטען יחד עם רשימת הסשנים", אבל הרשימה
(`session/list`) לא מכילה model/mode. כדי לקבל אותם בטופס היה צריך spawn זמני נוסף
(session/new) רק בשביל ה-configOptions — מורכבות שלא שווה כרגע.

קווי מימוש (כשנחזור):
- **רעיון של אבי (2026-06-03)**: לטעון את הסשן האחרון הזמין (`loadSession` על הראשון
  ב-`session/list`) ולשאוב ממנו את רשימת המודלים וה-modes → להזין את הבוררים בטופס.
  כך מקבלים את ה-options בלי spawn ייעודי (מנצלים טעינה שממילא תקרה).
- חלופה: `listSessionsForCwd` כבר עושה spawn+handshake; להרחיב אותו שיחזיר גם את
  ה-`configOptions` מתגובת `session/new` הזמנית → בוררים בטופס "בחינם".
- בוררים: שימוש ב-`Select` הקיים (כמו ב-SessionOptionsPanel). הבחירה נשלחת ב-`attach`/
  `connectAgent` → `session/new` עם ה-model/mode הנבחרים.

החלטה שהתקבלה (2026-06-03): **לא לעכשיו** (בוטל ע"י המשתמשת). מתועד לעתיד.

---

## 6. ניהול מחזור-חיים של agents — מנגנון יחיד ("future A")

תאריך הרעיון: 2026-06-04 (הובטח אחרי ה-reaper הזמני של slice 26 + NBug2)

תיאור: היום מצב של agent מפוזר על **4 מבני-נתונים** (registry / bridge-manager /
activeFeWs / bridgePorts) שאמורים להסכים ואף אחד לא אוכף סנכרון. זה השורש של NBug2
(`connected` ב-3 מקומות → אי-הסכמה → agent יתום). הכיוון: **מנגנון יחיד** —
`AgentLifecycle` כרשומה עשירה אחת + `AgentLifecycleManager` שמחליף את שלושת המנהלים,
עם מעברי-מצב synchronous ו-atomic. שומר את כל המטא-דאטה (createdAt וכו') כשדות-אזרח,
לא מוחק — מאחד.

מוטיבציה (לפי המשתמשת, 2026-06-04): רשימת agents חיים + ניהול מהיר · בסיס לריבוי-agents
במקביל · agent שרץ ברקע בלי טאב פתוח (הכי מורכב, דחוי "כל עוד דליפות קורות").

מורכבות: refactor ארכיטקטוני (5 קבצים + port ב-core). שתי אופציות-היקף:
**A** = מנגנון יחיד מלא (complexity ~8). **B** = לאחד רק `connected` קודם (complexity ~4-5,
מומלץ כשלב ראשון). טרם הוכרע.

**תכנון מלא על נייר**:
- ניתוח הבלגן + A מול B: `docs/investigations/2026-06-04-agent-lifecycle-single-mechanism.md`
- **עיצוב אופציה A במלואה** (המבנה האידאלי התאורטי, ללא תלות-מציאות):
  `docs/investigations/2026-06-04-agent-lifecycle-A-design.md`

עיקרון-העל (המשתמשת, 2026-06-04): **הצרכנים לא מכירים את המבנה — רק נקודות-קצה.**
`AgentLifecycle` (עם child/feWs) פנימי-backend בלבד; היוצא החוצה הוא `AgentView`
סריאליזבילי. זה השורש שגרם ל-4-מקורות-האמת: לא היה חוזה צר שמסתיר את ה-socket.

החלטה שהתקבלה (2026-06-04): **תכנון נכתב, brief טרם.** ייכתב brief אחרי ש-fix-nbug2
מוזג (נוגע באותם קבצים — לבנות על בסיס יציב, לא על שרשור תלוי). מרדכי מכריע A מול B
עם המשתמשת לפני ה-brief.

---

## הנחיות לעדכון הקובץ הזה

- כשמשתמש זורק רעיון ואומר "לא עכשיו" — לתעד כאן במקום לאבד.
- כשמתחילים לעבוד על אחד מהפיצ'רים — להעביר ל-`plan.md`/brief ולמחוק כאן.
- פורמט: תיאור / מוטיבציה / מורכבות / קווי מימוש / החלטה.

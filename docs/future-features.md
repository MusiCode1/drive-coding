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

## BUG — קריינות כלים מושמעת גם כש-Speaker מושתק

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

---

## הנחיות לעדכון הקובץ הזה

- כשמשתמש זורק רעיון ואומר "לא עכשיו" — לתעד כאן במקום לאבד.
- כשמתחילים לעבוד על אחד מהפיצ'רים — להעביר ל-`plan.md`/brief ולמחוק כאן.
- פורמט: תיאור / מוטיבציה / מורכבות / קווי מימוש / החלטה.
